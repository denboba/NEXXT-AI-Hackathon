// Agent E - Independent Challenger / Stress-Test. It receives only the
// profile facts, the constraints and the strategy's weights, buckets and
// projection (never its rationale or narrative), recomputes the projection
// itself, and runs named stress tests with explicit inputs and evidence,
// including its own seeded synthetic outcome range. Key computations go
// through the traced tool layer (ctx.callTool).
import type { ChallengeReport, Finding } from "../domain/types.ts";
import { catalogue } from "../domain/catalogue.ts";
import {
  LEI_TOLERANCE,
  approxEqual,
  blendedAssumptions,
  concentrationShare,
  projectGoal,
  roundLei,
  stressedValueAtGoal,
} from "../domain/calculations.ts";
import { MIN_REACH_SHARE, OUTCOME_RANGE_FINDING, SIMULATION_PATHS, SIMULATION_SEED } from "../domain/simulation.ts";
import { parseExplanation } from "../providers/llm.ts";
import { StageError } from "../orchestrator/context.ts";
import type { StageContext, StageResult } from "../orchestrator/context.ts";

export const challengerReads = ["profile.facts", "suitability", "challengerInput", "data.assumptions"];

/** The Challenger's own severe scenario (independent of the planning drawdowns). */
export const SEVERE_CRASH = { equity: 0.35, bond: 0.08, cash: 0 };
export const SINGLE_STOCK_SHOCK = 0.5;
export const CONCENTRATION_LIMIT = 0.2;
export const PAUSE_MONTHS = 12;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export async function challengerAgent(ctx: StageContext): Promise<StageResult<ChallengeReport>> {
  const facts = ctx.profile?.facts;
  const suit = ctx.suitability;
  const s = ctx.challengerInput;
  const cma = ctx.data?.assumptions;
  if (!facts || !suit || !s || !cma) throw new StageError("missing-upstream", "Challenger needs profile, constraints, strategy figures and data");
  const findings: Finding[] = [];
  const testsRun: string[] = [];
  const tolerance = suit.lossTolerance;
  const target = s.targetLei;
  const horizon = s.horizonYears;
  const withdrawals = suit.laterWithdrawals.map((w) => ({ amount: w.amountLei, inYears: w.inYears }));

  // Independent recomputation from weights (not trusting the strategy's numbers).
  const blend = blendedAssumptions(s.weights, catalogue, cma);
  const base = { initial: s.investedInitialLei, monthly: s.monthlyContributionLei, years: horizon, grossReturn: blend.grossReturn, fee: blend.fee, inflation: cma.inflation, withdrawals };
  const recomputed = ctx.callTool("project-goal", base);

  testsRun.push("projection-recompute");
  if (!approxEqual(recomputed.nominal, s.projection.nominal)) {
    findings.push({
      id: "projection-mismatch",
      test: "projection-recompute",
      severity: "blocking",
      failedConstraint: "strategy projection must match an independent recomputation within 0.01 lei",
      evidence: { inputs: { ...base, withdrawals: withdrawals.length }, computed: { challengerNominal: r2(recomputed.nominal), strategyNominal: r2(s.projection.nominal) } },
      routeTo: "strategy",
      remedy: { kind: "recompute-projection" },
      message: `The stated projection (${roundLei(s.projection.nominal)} lei) does not match the independent recomputation (${roundLei(recomputed.nominal)} lei).`,
    });
  }

  // 1. Severe equity crash in the year before the goal.
  testsRun.push("severe-crash-before-goal");
  const lossPct = ctx.callTool("stress-loss", { mix: blend.assetMix, drawdowns: SEVERE_CRASH });
  const shockYear = Math.max(0, horizon - 1);
  const crash = stressedValueAtGoal({ ...base, shockPct: lossPct, shockYear, recoveryReturn: blend.netReturn });
  const crashEvidence = {
    inputs: { equityShock: SEVERE_CRASH.equity, bondShock: SEVERE_CRASH.bond, shockYear, equityShare: r4(blend.assetMix.equity), bondShare: r4(blend.assetMix.bond), lossTolerance: tolerance },
    computed: { portfolioLossPct: r4(lossPct), valueBeforeShockLei: r2(crash.valueBeforeShock), lossLei: r2(crash.shockLossLei), valueAtGoalLei: r2(crash.valueAtGoal), shortfallLei: r2(Math.max(0, target - crash.valueAtGoal)) },
  };
  if (lossPct > tolerance + 1e-9)
    findings.push({
      id: "severe-crash-loss",
      test: "severe-crash-before-goal",
      severity: "material",
      failedConstraint: `stated maximum loss ${(tolerance * 100).toFixed(1)}%`,
      evidence: crashEvidence,
      routeTo: "suitability",
      remedy: { kind: "tighten-drawdown-basis", drawdowns: SEVERE_CRASH },
      message: `A severe crash (equities -35%, bonds -8%) would cut the invested part by ${(lossPct * 100).toFixed(1)}%, above the stated ${(tolerance * 100).toFixed(1)}% limit.`,
    });
  findings.push({
    id: "crash-shortfall",
    test: "severe-crash-before-goal",
    severity: "info",
    evidence: crashEvidence,
    routeTo: "strategy",
    message:
      crash.valueAtGoal + LEI_TOLERANCE < target
        ? `After a severe crash in year ${shockYear} the plan would reach about ${roundLei(crash.valueAtGoal)} lei, ${roundLei(target - crash.valueAtGoal)} lei short of the target.`
        : `Even after a severe crash in year ${shockYear} the plan would reach about ${roundLei(crash.valueAtGoal)} lei.`,
  });

  // 2. Goal needed two years earlier.
  if (horizon - 2 >= 1) {
    testsRun.push("goal-two-years-earlier");
    const earlier = projectGoal({ ...base, years: horizon - 2, withdrawals: withdrawals.filter((w) => w.inYears <= horizon - 2) });
    findings.push({
      id: "goal-earlier",
      test: "goal-two-years-earlier",
      severity: "info",
      evidence: { inputs: { years: horizon - 2 }, computed: { valueLei: r2(earlier.nominal), shortfallLei: r2(Math.max(0, target - earlier.nominal)) } },
      routeTo: "strategy",
      message: `If the money were needed 2 years earlier the plan would hold about ${roundLei(earlier.nominal)} lei.`,
    });
  }

  // 3. Unexpected liquidity need.
  testsRun.push("unexpected-liquidity-need");
  const expenses = facts.monthlyEssentialExpenses?.value;
  const fund = facts.emergencyFund?.value;
  const need = expenses !== undefined ? 3 * expenses : 0.1 * target;
  const topUps = s.liquidityBuckets.filter((b) => b.purpose === "emergency-reserve-top-up").reduce((a, b) => a + b.amountLei, 0);
  if (fund === undefined) {
    findings.push({
      id: "liquidity-unknown-reserve",
      test: "unexpected-liquidity-need",
      severity: "material",
      evidence: { inputs: { needLei: need, needBasis: expenses !== undefined ? "3 months of essential expenses" : "10% of target (expenses unknown)" }, computed: {} },
      routeTo: "profile",
      remedy: { kind: "request-information", field: "emergencyFund" },
      message: "The emergency fund is not stated, so the effect of an unexpected expense cannot be checked.",
    });
  } else {
    const available = fund + topUps;
    const shortfall = need - available;
    const evidence = {
      inputs: { needLei: need, needBasis: expenses !== undefined ? "3 months of essential expenses" : "10% of target (expenses unknown)", emergencyFundLei: fund, reserveTopUpLei: topUps },
      computed: { shortfallLei: r2(Math.max(0, shortfall)), forcedSaleLossLei: r2(Math.max(0, shortfall) * (lossPct / (1 - lossPct))) },
    };
    if (shortfall > LEI_TOLERANCE)
      findings.push({
        id: "liquidity-need",
        test: "unexpected-liquidity-need",
        severity: "material",
        failedConstraint: "an unexpected expense must not force selling investments",
        evidence,
        routeTo: "strategy",
        remedy: { kind: "top-up-reserve", amountLei: shortfall },
        message: `An unexpected expense of ${roundLei(need)} lei exceeds the available reserve by ${roundLei(shortfall)} lei, which would force selling investments, possibly after a fall.`,
      });
    else
      findings.push({ id: "liquidity-need", test: "unexpected-liquidity-need", severity: "info", evidence, routeTo: "strategy", message: `The reserve covers an unexpected expense of ${roundLei(need)} lei.` });
  }

  // 4. Planned withdrawals within the liquidity window must be ring-fenced.
  testsRun.push("planned-withdrawals-liquidity");
  suit.liquidityRequirements.forEach((req, i) => {
    const covered = s.liquidityBuckets
      .filter((b) => b.purpose === "planned-withdrawal" && b.label === req.label && b.neededInYears === req.neededInYears)
      .reduce((a, b) => a + b.amountLei, 0);
    if (covered + LEI_TOLERANCE < req.amountLei)
      findings.push({
        id: `withdrawal-not-ring-fenced-${i + 1}`,
        test: "planned-withdrawals-liquidity",
        severity: "blocking",
        failedConstraint: "money needed within 3 years must not be held in equities",
        evidence: { inputs: { amountLei: req.amountLei, inYears: req.neededInYears }, computed: { coveredLei: covered, equityShare: r4(blend.assetMix.equity) } },
        routeTo: "strategy",
        remedy: { kind: "ring-fence-withdrawal", label: req.label, amountLei: req.amountLei, inYears: req.neededInYears },
        message: `A planned withdrawal of ${roundLei(req.amountLei)} lei in ${req.neededInYears} year(s) is not held in cash.`,
      });
  });

  // 5. 12-month contribution pause.
  if (s.monthlyContributionLei > 0) {
    testsRun.push("contribution-pause-12m");
    const from = horizon >= 2 ? 13 : 1;
    const paused = stressedValueAtGoal({ ...base, shockPct: 0, shockYear: 0, recoveryReturn: blend.netReturn, pause: { fromMonth: from, toMonth: from + PAUSE_MONTHS - 1 } });
    findings.push({
      id: "contribution-pause",
      test: "contribution-pause-12m",
      severity: "info",
      evidence: { inputs: { pauseMonths: PAUSE_MONTHS, fromMonth: from }, computed: { valueLei: r2(paused.valueAtGoal), reductionLei: r2(recomputed.nominal - paused.valueAtGoal) } },
      routeTo: "strategy",
      message: `Pausing contributions for 12 months would lower the end value by about ${roundLei(recomputed.nominal - paused.valueAtGoal)} lei.`,
    });
  }

  // 6. Single-stock concentration across investable assets.
  const holdings = facts.holdings?.value ?? [];
  if (holdings.length) {
    testsRun.push("single-stock-concentration");
    const initial = facts.initialCapital?.value ?? 0;
    const share = concentrationShare(holdings, initial);
    const singleValue = holdings.filter((h) => h.assetClass === "single-stock").reduce((a, h) => a + h.value, 0);
    if (share > CONCENTRATION_LIMIT + 1e-9)
      findings.push({
        id: "single-stock-concentration",
        test: "single-stock-concentration",
        severity: "material",
        failedConstraint: `single-company exposure <= ${CONCENTRATION_LIMIT * 100}% of investable assets`,
        evidence: { inputs: { singleStockLei: singleValue, investableLei: holdings.reduce((a, h) => a + h.value, 0) + initial, shock: SINGLE_STOCK_SHOCK }, computed: { share: r4(share), lossIfShockLei: r2(singleValue * SINGLE_STOCK_SHOCK) } },
        routeTo: "strategy",
        remedy: { kind: "acknowledge-external", topic: "concentration" },
        message: `Shares of a single company are ${(share * 100).toFixed(1)}% of investable assets; a 50% fall would cost about ${roundLei(singleValue * SINGLE_STOCK_SHOCK)} lei.`,
      });
  }

  // 7. Seeded synthetic outcome range, computed from the Challenger's own
  // recomputed inputs (not the strategy's outcomeRange).
  testsRun.push("seeded-outcome-range");
  const inTodaysMoney = facts.targetIsInTodaysMoney?.value === true;
  const sim = ctx.callTool("simulate-outcomes", {
    ...base,
    assetMix: blend.assetMix,
    assumptions: cma,
    target,
    targetIsReal: inTodaysMoney,
    paths: SIMULATION_PATHS,
    seed: SIMULATION_SEED,
  });
  const baseReaches = (inTodaysMoney ? recomputed.real : recomputed.nominal) + LEI_TOLERANCE >= target;
  const shown = (nominal: number, real: number) => roundLei(inTodaysMoney ? real : nominal);
  const rangeEvidence = {
    inputs: { seed: sim.seed, paths: sim.paths, portfolioVolatility: r4(sim.portfolioVolatility), minReachShare: MIN_REACH_SHARE, baseCaseReachesTarget: baseReaches },
    computed: { p10Lei: r2(sim.p10), p50Lei: r2(sim.p50), p90Lei: r2(sim.p90), reachShare: r4(sim.reachShare) },
  };
  const rangeText = `Across ${sim.paths} seeded synthetic paths (seed ${sim.seed}) the value at the goal is about ${shown(sim.p10, sim.p10Real)} lei at the 10th percentile, ${shown(sim.p50, sim.p50Real)} lei at the median and ${shown(sim.p90, sim.p90Real)} lei at the 90th percentile; ${(sim.reachShare * 100).toFixed(1)}% of paths reach the target.`;
  // Material only when the base case looks fine but most paths miss. The
  // remedy is an acknowledgement (the strategy discloses it and its solver
  // levers show how to raise the share), so it can never cause a loop.
  if (baseReaches && sim.reachShare < MIN_REACH_SHARE)
    findings.push({
      id: OUTCOME_RANGE_FINDING,
      test: "seeded-outcome-range",
      severity: "material",
      failedConstraint: `at least ${MIN_REACH_SHARE * 100}% of seeded synthetic paths should reach a target that the base case reaches`,
      evidence: rangeEvidence,
      routeTo: "strategy",
      remedy: { kind: "acknowledge-external", topic: "outcome-range" },
      message: `The base case reaches the target, but only ${(sim.reachShare * 100).toFixed(1)}% of ${sim.paths} seeded synthetic paths do. ${rangeText}`,
    });
  else findings.push({ id: "outcome-range", test: "seeded-outcome-range", severity: "info", evidence: rangeEvidence, routeTo: "strategy", message: rangeText });

  // 8. Fee and inflation sensitivity.
  testsRun.push("fee-inflation-sensitivity");
  const higherFee = projectGoal({ ...base, fee: base.fee + 0.005 });
  const higherInflation = projectGoal({ ...base, inflation: base.inflation + 0.02 });
  findings.push({
    id: "fee-inflation-sensitivity",
    test: "fee-inflation-sensitivity",
    severity: "info",
    evidence: {
      inputs: { feeDelta: 0.005, inflationDelta: 0.02 },
      computed: { nominalWithHigherFeeLei: r2(higherFee.nominal), realWithHigherInflationLei: r2(higherInflation.real), baseRealLei: r2(recomputed.real) },
    },
    routeTo: "strategy",
    message: `0.5 points more in fees lowers the end value by about ${roundLei(recomputed.nominal - higherFee.nominal)} lei; 2 points more inflation lowers its value in today's money by about ${roundLei(recomputed.real - higherInflation.real)} lei.`,
  });

  const summary = await ctx.callModel(
    "explain-objections",
    { findings: findings.map((f) => ({ id: f.id, severity: f.severity, message: f.message })) },
    parseExplanation,
  );
  const serious = findings.filter((f) => f.severity !== "info");
  return {
    output: { strategyId: s.strategyId, strategyVersion: s.strategyVersion, testsRun, findings, summary: { ...summary.value, source: summary.providerId } },
    notes: [
      {
        event: "output",
        summary: `challenger ran ${testsRun.length} tests on ${s.strategyId}: ${serious.length} material/blocking finding(s) [${serious.map((f) => f.id).join(", ")}]`,
        data: { findings: findings.map((f) => ({ id: f.id, severity: f.severity, routeTo: f.routeTo })) },
      },
    ],
  };
}
