// Agent D - Strategy. Builds up to three distinct candidate allocations from
// the fictional catalogue under the current constraints (labelled by their
// actual equity share), projects each through the traced project-goal tool,
// proposes one, and attaches a seeded synthetic outcome range
// (simulate-outcomes) and goal-seek levers (solve-levers). On revision it
// applies the Challenger's targeted remedies. It never changes the customer's target or horizon;
// remaining gaps are reported with explicit levers. The reasoning provider is
// used only for the narrative around computed numbers.
import type {
  LiquidityBucket,
  Lever,
  OutcomeRange,
  ProjectionSummary,
  Strategy,
  StrategyCandidate,
} from "../domain/types.ts";
import { CASH_BLOCK_ID, catalogue, eligibleBlocks, mixForEquity } from "../domain/catalogue.ts";
import {
  LEI_TOLERANCE,
  blendedAssumptions,
  projectGoal,
  requiredMonthly,
  roundLei,
} from "../domain/calculations.ts";
import type { GoalProjection, ProjectionInput, Withdrawal } from "../domain/calculations.ts";
import { MIN_REACH_SHARE, OUTCOME_RANGE_FINDING, SIMULATION_PATHS, SIMULATION_SEED, SOLVER_THRESHOLDS } from "../domain/simulation.ts";
import type { SimulationInput, SimulationResult } from "../domain/simulation.ts";
import { money } from "../lib/finance.ts";
import { parseExplanation } from "../providers/llm.ts";
import type { ExplainStrategyInput } from "../providers/llm.ts";
import { StageError } from "../orchestrator/context.ts";
import type { StageContext, StageResult, TraceNote } from "../orchestrator/context.ts";

export const strategyReads = ["profile.facts", "data.assumptions", "suitability", "directives.strategy", "reasoning.id", "revision"];

export const DISCLOSURES: Record<string, string> = {
  "illustrative-not-advice":
    "Educational illustration only. This is not investment advice and the coach is not an authorised financial adviser.",
  "synthetic-assumptions": "Returns, drawdowns and inflation are synthetic planning assumptions, not live market data.",
  "no-guarantee": "Returns are not guaranteed; the value of investments can fall as well as rise.",
  "fictional-products": "All funds and accounts shown are fictional demo building blocks.",
  "no-execution": "Nothing is bought, sold or booked by this tool.",
};
export const REQUIRED_DISCLOSURES = Object.keys(DISCLOSURES);

const PREFERENCE: Record<string, StrategyCandidate["label"]> = {
  steady: "Cautious",
  balanced: "Balanced",
  growth: "Growth-tilted",
};
export const LABEL_ORDER: StrategyCandidate["label"][] = ["Cautious", "Balanced", "Growth-tilted"];
/**
 * Upper-inclusive equity-share bands for strategy labels: Cautious up to 30%,
 * Balanced above 30% up to 60%, Growth-tilted above 60%. The upper edges match
 * STATED_RISK_CAP (steady 30%, balanced 60%), so a candidate at a preference's
 * own cap carries that preference's label.
 */
export const LABEL_BANDS = { cautiousUpTo: 0.3, balancedUpTo: 0.6 };
export const LABEL_BANDS_TEXT = "Cautious up to 30%, Balanced above 30% up to 60%, Growth-tilted above 60%";
/** Candidates closer than this in equity share are treated as the same candidate. */
const MIN_CANDIDATE_DISTANCE = 0.005;

/** Honest label derived from the actual equity share (small tolerance for floating-point mixes). */
export function labelForEquity(equityShare: number): StrategyCandidate["label"] {
  if (equityShare > LABEL_BANDS.balancedUpTo + 1e-9) return "Growth-tilted";
  if (equityShare > LABEL_BANDS.cautiousUpTo + 1e-9) return "Balanced";
  return "Cautious";
}

/**
 * First rationale sentence. It names the limit that actually bound the choice:
 * the constraints (the chosen candidate is the highest-equity one overall), the
 * stated preference (a higher-equity candidate within the constraints was
 * skipped because its label is riskier), or neither candidate matching the
 * preference (the most cautious one is used).
 */
export function choiceSentence(
  chosen: Pick<StrategyCandidate, "label" | "equityShare">,
  candidates: Pick<StrategyCandidate, "label" | "equityShare">[],
  matchesPreference: boolean,
  cap: number,
  preferredLabel: StrategyCandidate["label"],
  preferenceStated = true,
): string {
  const pct = (x: number) => Math.round(x * 100);
  const pref = preferenceStated ? `your stated preference (${preferredLabel})` : `the default preference (${preferredLabel}, no risk preference stated)`;
  const capText = `max equity ${(cap * 100).toFixed(1)}%`;
  const head = `${chosen.label} (about ${pct(chosen.equityShare)}% equity)`;
  if (!matchesPreference)
    return `${head} is the most cautious candidate allowed by the constraints (${capText}); no candidate matches ${pref}.`;
  const highest = candidates.reduce((a, b) => (b.equityShare > a.equityShare ? b : a), chosen);
  if (highest.equityShare <= chosen.equityShare)
    return `${head} is the highest-equity candidate allowed by the constraints (${capText}) and not riskier than ${pref}.`;
  return `${head} is the highest-equity candidate not riskier than ${pref}; ${highest.label} (about ${pct(highest.equityShare)}% equity) is allowed by the constraints (${capText}) but is riskier than that preference.`;
}

export function outcomeRangeOf(sim: SimulationResult): OutcomeRange {
  return {
    seed: sim.seed,
    paths: sim.paths,
    p10: sim.p10,
    p50: sim.p50,
    p90: sim.p90,
    p10Real: sim.p10Real,
    p50Real: sim.p50Real,
    p90Real: sim.p90Real,
    reachShare: sim.reachShare,
    targetIsReal: sim.targetIsReal,
    worstPathMaxDrawdown: sim.worstPathMaxDrawdown,
    portfolioVolatility: sim.portfolioVolatility,
    volatilitySource: sim.volatilitySource,
  };
}

/** Rounded, numbers-only input for the explain-strategy task (also used for the deterministic narrative repair). */
export function explainStrategyInput(
  s: Pick<Strategy, "label" | "equityShare" | "projection" | "targetLei" | "gapLei" | "horizonYears"> & { outcomeRange?: OutcomeRange },
): ExplainStrategyInput {
  const base: ExplainStrategyInput = {
    label: s.label,
    equityPct: Math.round(s.equityShare * 100),
    nominalLei: roundLei(s.projection.nominal),
    realLei: roundLei(s.projection.real),
    targetLei: roundLei(s.targetLei),
    gapLei: roundLei(s.gapLei),
    horizonYears: s.horizonYears,
  };
  const r = s.outcomeRange;
  if (!r) return base;
  const value = (nominal: number, real: number) => roundLei(r.targetIsReal ? real : nominal);
  return {
    ...base,
    paths: r.paths,
    p10Lei: value(r.p10, r.p10Real),
    p50Lei: value(r.p50, r.p50Real),
    p90Lei: value(r.p90, r.p90Real),
    reachSharePct: Math.round(r.reachShare * 100),
  };
}

export type SleeveInputs = {
  invested: number;
  monthly: number;
  horizon: number;
  inflation: number;
  withdrawals: Withdrawal[];
};

export type ProjectFn = (p: ProjectionInput) => GoalProjection;

/** Base-case projection of the invested part. Agents pass `project` = the traced project-goal tool. */
export function projectSleeve(
  weights: Record<string, number>,
  s: SleeveInputs,
  cma: Parameters<typeof blendedAssumptions>[2],
  project: ProjectFn = projectGoal,
): ProjectionSummary {
  const blend = blendedAssumptions(weights, catalogue, cma);
  const p = project({
    initial: s.invested,
    monthly: s.monthly,
    years: s.horizon,
    grossReturn: blend.grossReturn,
    fee: blend.fee,
    inflation: s.inflation,
    withdrawals: s.withdrawals,
  });
  return {
    nominal: p.nominal,
    real: p.real,
    contributed: p.contributed,
    netReturn: blend.netReturn,
    grossReturn: blend.grossReturn,
    fee: blend.fee,
    inflation: s.inflation,
    points: p.points.map((pt) => ({ year: pt.year, nominal: pt.nominal, real: pt.real })),
  };
}

/** Gap to target in lei (positive = shortfall). Today's-money targets compare real values. */
export function gapFor(target: number, projection: ProjectionSummary, inTodaysMoney: boolean) {
  const value = inTodaysMoney ? projection.real : projection.nominal;
  const gap = target - value;
  return gap > LEI_TOLERANCE ? gap : 0;
}

export async function strategyAgent(ctx: StageContext): Promise<StageResult<Strategy>> {
  const facts = ctx.profile?.facts;
  const cma = ctx.data?.assumptions;
  const suit = ctx.suitability;
  if (!facts || !cma || !suit) throw new StageError("missing-upstream", "Strategy needs profile, data and suitability");
  const target = facts.targetAmount?.value;
  const horizon = facts.horizonYears?.value;
  if (target === undefined || horizon === undefined) throw new StageError("missing-upstream", "Target and horizon required");
  const notes: TraceNote[] = [];
  const initial = facts.initialCapital?.value ?? 0;
  const monthly = facts.monthlyContribution?.value ?? 0;
  const inTodaysMoney = facts.targetIsInTodaysMoney?.value === true;
  const version = ctx.revision + 1;

  // Liquidity buckets: required by suitability, plus remedies from the Challenger.
  const buckets: LiquidityBucket[] = suit.liquidityRequirements.map((r, i) => ({
    id: `bucket-${i + 1}`,
    purpose: "planned-withdrawal",
    label: r.label,
    amountLei: r.amountLei,
    neededInYears: r.neededInYears,
    blockId: CASH_BLOCK_ID,
  }));
  const addressed: string[] = [];
  const acknowledged: string[] = [];
  const extraLevers: Lever[] = [];
  const allocated = () => buckets.reduce((s, b) => s + b.amountLei, 0);
  for (const d of ctx.directives.strategy) {
    const r = d.remedy;
    if (r.kind === "ring-fence-withdrawal") {
      if (!buckets.some((b) => b.label === r.label && b.neededInYears === r.inYears)) {
        const amount = Math.min(r.amountLei, Math.max(0, initial - allocated()));
        if (amount > 0)
          buckets.push({ id: `bucket-${buckets.length + 1}`, purpose: "planned-withdrawal", label: r.label, amountLei: amount, neededInYears: r.inYears, blockId: CASH_BLOCK_ID });
      }
      addressed.push(d.findingId);
    } else if (r.kind === "top-up-reserve") {
      const amount = Math.min(r.amountLei, Math.max(0, initial - allocated()));
      if (amount > 0)
        buckets.push({
          id: `bucket-${buckets.length + 1}`,
          purpose: "emergency-reserve-top-up",
          label: "Emergency reserve top-up",
          amountLei: amount,
          neededInYears: 0,
          blockId: CASH_BLOCK_ID,
        });
      if (amount + LEI_TOLERANCE < r.amountLei)
        notes.push({ event: "output", summary: `reserve top-up limited to available capital (${roundLei(amount)} of ${roundLei(r.amountLei)} lei)` });
      addressed.push(d.findingId);
    } else if (r.kind === "acknowledge-external") {
      // Topics: 'concentration' (holdings outside the plan) and 'outcome-range'
      // (base case reaches the target but most seeded paths miss it; the
      // solver levers below already show what would raise the reach share).
      acknowledged.push(d.findingId);
      if (r.topic === "concentration")
        extraLevers.push({
          id: "review-concentration",
          description: "Existing single-company shares are outside this plan; reviewing that concentration with an adviser is suggested.",
        });
    } else if (r.kind === "recompute-projection") addressed.push(d.findingId);
  }
  const invested = Math.max(0, initial - allocated());

  const sleeve: SleeveInputs = {
    invested,
    monthly,
    horizon,
    inflation: cma.inflation,
    withdrawals: suit.laterWithdrawals.map((w) => ({ amount: w.amountLei, inYears: w.inYears })),
  };
  const eligible = eligibleBlocks(horizon);
  const nonCash = eligible.filter((b) => b.id !== CASH_BLOCK_ID);
  // The cash block is only part of the invested mix when equity must stay below the most cautious fund.
  const blocks = suit.maxEquityShare < 0.2 || nonCash.length === 0 ? eligible : nonCash;
  const maxBlockEquity = Math.max(...blocks.map((b) => b.equityShare));
  const cap = suit.maxEquityShare;
  // Up to three distinct candidates spanning the allowed range: the most
  // cautious eligible mix, the middle and the maximum allowed equity.
  const allowedMax = Math.min(cap, maxBlockEquity);
  const low = Math.min(Math.min(...blocks.map((b) => b.equityShare)), allowedMax);
  const targets = [low, (low + allowedMax) / 2, allowedMax];
  const project: ProjectFn = (p) => ctx.callTool("project-goal", p);
  const candidates: StrategyCandidate[] = [];
  for (const equityTarget of targets) {
    const weights = mixForEquity(equityTarget, blocks.length ? blocks : catalogue);
    const blend = blendedAssumptions(weights, catalogue, cma);
    if (candidates.some((c) => Math.abs(c.equityShare - blend.equityShare) < MIN_CANDIDATE_DISTANCE)) continue;
    const projection = projectSleeve(weights, sleeve, cma, project);
    candidates.push({
      label: labelForEquity(blend.equityShare),
      weights,
      equityShare: blend.equityShare,
      projection,
      gapLei: gapFor(target, projection, inTodaysMoney),
      planningStressLoss: ctx.callTool("stress-loss", { mix: blend.assetMix, drawdowns: suit.drawdownBasis }),
    });
  }

  // Pick: the highest-equity candidate whose label is not riskier than the
  // stated preference (candidates are in ascending equity order).
  const risk = facts.statedRisk?.value;
  const preferredLabel = risk ? PREFERENCE[risk] : "Balanced";
  const withinPreference = candidates.filter((c) => LABEL_ORDER.indexOf(c.label) <= LABEL_ORDER.indexOf(preferredLabel));
  const chosen = withinPreference.length ? withinPreference.at(-1)! : candidates[0];
  const blend = blendedAssumptions(chosen.weights, catalogue, cma);
  const feasible = candidates.some((c) => c.gapLei === 0);

  // Seeded synthetic range of outcomes and goal-seek levers for the chosen candidate.
  const simArgs: SimulationInput = {
    initial: invested,
    monthly,
    years: horizon,
    assetMix: blend.assetMix,
    assumptions: cma,
    fee: blend.fee,
    inflation: cma.inflation,
    withdrawals: sleeve.withdrawals,
    target,
    targetIsReal: inTodaysMoney,
    paths: SIMULATION_PATHS,
    seed: SIMULATION_SEED,
  };
  const sim = ctx.callTool("simulate-outcomes", simArgs);
  const outcomeRange = outcomeRangeOf(sim);
  const solved = ctx.callTool("solve-levers", { ...simArgs, thresholds: SOLVER_THRESHOLDS });
  // Base case reaches the target but most seeded paths miss it: disclosed in
  // the risks with solver levers, and acknowledged up front so the
  // Challenger's matching finding stays an open issue instead of forcing a
  // revision that would change nothing.
  const lowReach = chosen.gapLei === 0 && outcomeRange.reachShare < MIN_REACH_SHARE;
  if (lowReach && !acknowledged.includes(OUTCOME_RANGE_FINDING)) acknowledged.push(OUTCOME_RANGE_FINDING);

  const levers: Lever[] = [];
  if (chosen.gapLei > 0) {
    const nominalGap = inTodaysMoney ? chosen.gapLei * (1 + cma.inflation) ** horizon : chosen.gapLei;
    let extraMonthly: number;
    if (sleeve.withdrawals.length === 0 && !inTodaysMoney) extraMonthly = requiredMonthly(target, invested, horizon, blend.netReturn) - monthly;
    else {
      const perLei = projectGoal({ initial: 0, monthly: 1, years: horizon, grossReturn: blend.grossReturn, fee: blend.fee, inflation: cma.inflation }).nominal;
      extraMonthly = nominalGap / perLei;
    }
    levers.push({
      id: "increase-contribution",
      description: `Add about ${money(Math.ceil(extraMonthly))} lei per month (to about ${money(Math.ceil(monthly + extraMonthly))} lei).`,
      value: Math.ceil(extraMonthly),
      unit: "lei-per-month",
    });
    for (let extra = 1; extra <= 50 - horizon; extra++) {
      const p = projectSleeve(chosen.weights, { ...sleeve, horizon: horizon + extra }, cma);
      if ((inTodaysMoney ? p.real : p.nominal) + LEI_TOLERANCE >= target) {
        levers.push({ id: "extend-horizon", description: `Allow about ${extra} more year(s).`, value: extra, unit: "years" });
        break;
      }
    }
    const reachable = roundLei(inTodaysMoney ? chosen.projection.real : chosen.projection.nominal);
    levers.push({ id: "lower-target", description: `Or aim for about ${money(reachable)} lei instead.`, value: reachable, unit: "lei" });
  }
  const reachPct = (x: number) => Math.round(x * 100);
  for (const sol of solved.solutions) {
    if (outcomeRange.reachShare >= sol.threshold) continue;
    const across = `a target reach share of ${reachPct(sol.threshold)}% across ${money(solved.paths)} seeded synthetic paths (not a forecast)`;
    if (sol.monthlyLei !== null && sol.extraMonthlyLei !== null && sol.extraMonthlyLei > 0)
      levers.push({
        id: "contribution-for-reach-share",
        description: `About ${money(sol.monthlyLei)} lei per month (${money(sol.extraMonthlyLei)} more) gives ${across}.`,
        value: sol.extraMonthlyLei,
        unit: "lei-per-month",
        reachShare: sol.threshold,
      });
    if (sol.extraYears !== null && sol.extraYears > 0)
      levers.push({
        id: "horizon-for-reach-share",
        description: `About ${sol.extraYears} more year(s) at the current contribution gives ${across}.`,
        value: sol.extraYears,
        unit: "years",
        reachShare: sol.threshold,
      });
  }
  levers.push(...extraLevers);

  const eqPct = Math.round(chosen.equityShare * 100);
  const lowerRiskAlsoReaches = candidates.find((c) => c.gapLei === 0 && c.equityShare < chosen.equityShare);
  const rationale = [
    choiceSentence(chosen, candidates, withinPreference.length > 0, cap, preferredLabel, risk !== undefined),
    `Labels follow the actual equity share: ${LABEL_BANDS_TEXT}.`,
    maxBlockEquity < cap ? `Blocks with a longer recommended holding period than ${horizon} years are excluded.` : "",
    buckets.length ? `${buckets.length} liquidity bucket(s) totalling ${money(allocated())} lei are held in cash outside the invested part.` : "",
    lowerRiskAlsoReaches ? `${lowerRiskAlsoReaches.label} would also reach the target in the base case with less equity.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const explanation = await ctx.callModel(
    "explain-strategy",
    explainStrategyInput({ label: chosen.label, equityShare: chosen.equityShare, projection: chosen.projection, targetLei: target, gapLei: chosen.gapLei, horizonYears: horizon, outcomeRange }),
    parseExplanation,
  );

  const strategy: Strategy = {
    id: `strategy-v${version}`,
    version,
    label: chosen.label,
    weights: chosen.weights,
    assetMix: blend.assetMix,
    equityShare: chosen.equityShare,
    liquidityBuckets: buckets,
    investedInitialLei: invested,
    monthlyContributionLei: monthly,
    horizonYears: horizon,
    targetLei: target,
    assumptions: [
      `Gross return ${(blend.grossReturn * 100).toFixed(2)}%/yr from ${cma.kind} assumptions (${cma.sourceLabel}).`,
      `Fees ${(blend.fee * 100).toFixed(2)}%/yr deducted from returns.`,
      `Inflation ${(cma.inflation * 100).toFixed(1)}%/yr for today's-money values.`,
      "Contributions at the end of each month; withdrawals at the end of their year; amounts in lei, rounded only for display.",
      `Outcome range: ${money(outcomeRange.paths)} seeded synthetic paths (seed ${outcomeRange.seed}), portfolio volatility ${(outcomeRange.portfolioVolatility * 100).toFixed(1)}%/yr (${outcomeRange.volatilitySource === "market-data-payload" ? "from the synthetic assumptions" : "synthetic default"}); a simulation, not a forecast.`,
    ],
    projection: chosen.projection,
    gapLei: chosen.gapLei,
    outcomeRange,
    levers,
    candidates,
    rationale,
    risks: [
      `With about ${eqPct}% in equities, the invested part can fall by about ${(chosen.planningStressLoss * 100).toFixed(1)}% in a bad year under the active drawdown basis.`,
      "Returns can be lower than assumed for many years in a row.",
      "Inflation above the assumption reduces the value in today's money.",
      ...(lowReach
        ? [`The base case reaches the target, but only about ${Math.round(outcomeRange.reachShare * 100)}% of ${money(outcomeRange.paths)} seeded synthetic paths do; see the options for a higher reach share.`]
        : []),
    ],
    narrative: { ...explanation.value, source: explanation.providerId },
    disclosures: [...REQUIRED_DISCLOSURES],
    addressedFindings: addressed,
    acknowledgedFindings: acknowledged,
    feasibleAtAllowedAllocation: feasible,
  };
  notes.push({
    event: "output",
    summary: `strategy v${version}: ${chosen.label}, equity ${(chosen.equityShare * 100).toFixed(1)}%, ${buckets.length} bucket(s), projected ${roundLei(chosen.projection.nominal)} lei, gap ${roundLei(chosen.gapLei)} lei`,
    data: {
      weights: chosen.weights,
      buckets: buckets.map((b) => ({ purpose: b.purpose, amountLei: b.amountLei, neededInYears: b.neededInYears })),
      investedInitialLei: invested,
      candidates: candidates.map((c) => ({ equityShare: c.equityShare, gapLei: roundLei(c.gapLei) })),
      outcomeRange: { seed: outcomeRange.seed, paths: outcomeRange.paths, p10: roundLei(outcomeRange.p10), p50: roundLei(outcomeRange.p50), p90: roundLei(outcomeRange.p90), reachShare: outcomeRange.reachShare },
      narrativeSource: explanation.providerId,
    },
  });
  return { output: strategy, notes };
}
