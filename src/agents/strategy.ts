// Agent D - Strategy. Builds 2-3 candidate allocations from the fictional
// catalogue under the current constraints, projects each with deterministic
// calculations, and proposes one. On revision it applies the Challenger's
// targeted remedies. It never changes the customer's target or horizon;
// remaining gaps are reported with explicit levers. The reasoning provider is
// used only for the narrative around computed numbers.
import type {
  LiquidityBucket,
  Lever,
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
  stressLoss,
} from "../domain/calculations.ts";
import type { Withdrawal } from "../domain/calculations.ts";
import { money } from "../lib/finance.ts";
import { parseExplanation } from "../providers/llm.ts";
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

export type SleeveInputs = {
  invested: number;
  monthly: number;
  horizon: number;
  inflation: number;
  withdrawals: Withdrawal[];
};

export function projectSleeve(weights: Record<string, number>, s: SleeveInputs, cma: Parameters<typeof blendedAssumptions>[2]): ProjectionSummary {
  const blend = blendedAssumptions(weights, catalogue, cma);
  const p = projectGoal({
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
  const targets: [StrategyCandidate["label"], number][] = [
    ["Cautious", Math.min(0.2, cap)],
    ["Balanced", Math.min(0.5, cap, maxBlockEquity)],
    ["Growth-tilted", Math.min(cap, maxBlockEquity)],
  ];
  const candidates: StrategyCandidate[] = [];
  for (const [label, equityTarget] of targets) {
    const weights = mixForEquity(equityTarget, blocks.length ? blocks : catalogue);
    const blend = blendedAssumptions(weights, catalogue, cma);
    if (candidates.some((c) => Math.abs(c.equityShare - blend.equityShare) < 1e-9)) continue;
    const projection = projectSleeve(weights, sleeve, cma);
    candidates.push({
      label,
      weights,
      equityShare: blend.equityShare,
      projection,
      gapLei: gapFor(target, projection, inTodaysMoney),
      planningStressLoss: stressLoss(blend.assetMix, suit.drawdownBasis),
    });
  }

  // Pick: the candidate matching the stated preference (or the riskiest
  // allowed below it); never riskier than the stated preference.
  const risk = facts.statedRisk?.value;
  const preferredLabel = risk ? PREFERENCE[risk] : "Balanced";
  const order = ["Cautious", "Balanced", "Growth-tilted"];
  const withinPreference = candidates.filter((c) => order.indexOf(c.label) <= order.indexOf(preferredLabel));
  const chosen = (withinPreference.length ? withinPreference : candidates).at(-1)!;
  const blend = blendedAssumptions(chosen.weights, catalogue, cma);
  const feasible = candidates.some((c) => c.gapLei === 0);

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
  levers.push(...extraLevers);

  const eqPct = Math.round(chosen.equityShare * 100);
  const lowerRiskAlsoReaches = candidates.find((c) => c.gapLei === 0 && c.equityShare < chosen.equityShare);
  const rationale = [
    `${chosen.label} is the highest-risk candidate allowed by the constraints and your stated preference (max equity ${(cap * 100).toFixed(1)}%).`,
    maxBlockEquity < cap ? `Blocks with a longer recommended holding period than ${horizon} years are excluded.` : "",
    buckets.length ? `${buckets.length} liquidity bucket(s) totalling ${money(allocated())} lei are held in cash outside the invested part.` : "",
    lowerRiskAlsoReaches ? `${lowerRiskAlsoReaches.label} would also reach the target in the base case with less equity.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const explanation = await ctx.callModel(
    "explain-strategy",
    {
      label: chosen.label,
      equityPct: eqPct,
      nominalLei: roundLei(chosen.projection.nominal),
      realLei: roundLei(chosen.projection.real),
      targetLei: roundLei(target),
      gapLei: roundLei(chosen.gapLei),
      horizonYears: horizon,
    },
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
    ],
    projection: chosen.projection,
    gapLei: chosen.gapLei,
    levers,
    candidates,
    rationale,
    risks: [
      `With about ${eqPct}% in equities, the invested part can fall by about ${(chosen.planningStressLoss * 100).toFixed(1)}% in a bad year under the active drawdown basis.`,
      "Returns can be lower than assumed for many years in a row.",
      "Inflation above the assumption reduces the value in today's money.",
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
      candidates: candidates.map((c) => ({ label: c.label, equityShare: c.equityShare, gapLei: roundLei(c.gapLei) })),
      narrativeSource: explanation.providerId,
    },
  });
  return { output: strategy, notes };
}
