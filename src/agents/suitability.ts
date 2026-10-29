// Agent C - Suitability & Constraints. Deterministic, documented,
// ILLUSTRATIVE policy (not a regulatory suitability assessment):
// - Equity cap by horizon: <3y 20%, 3-5y 40%, >5-10y 70%, >10y 90%.
// - Equity cap by stated preference: steady 30%, balanced 60%, growth 90%.
// - Equity cap by loss tolerance: equity*eqDrawdown + (1-equity)*bondDrawdown
//   <= tolerance, using the active drawdown basis (planning drawdowns from the
//   data stage, or the Challenger's severe scenario after a revision).
// - Reserve rule of thumb: 3 months of essential expenses (only when the
//   customer provided expenses; otherwise we ask).
// - Planned withdrawals within 3 years must be held outside equities.
// The strictest cap wins. Customer constraints are never overridden: when
// they cannot all be met, the stage returns 'needs-clarification'.
import type {
  ClarificationQuestion,
  DrawdownBasis,
  LiquidityRequirement,
  SuitabilityConflict,
  SuitabilityReport,
} from "../domain/types.ts";
import { reserveMonths } from "../domain/calculations.ts";
import { RISK_LOSS_BUDGET } from "./profile.ts";
import { StageError } from "../orchestrator/context.ts";
import type { StageContext, StageResult } from "../orchestrator/context.ts";

export const suitabilityReads = [
  "profile.facts.horizonYears",
  "profile.facts.maxAcceptableLossPct",
  "profile.facts.statedRisk",
  "profile.facts.monthlyEssentialExpenses",
  "profile.facts.emergencyFund",
  "profile.facts.plannedWithdrawals",
  "profile.facts.initialCapital",
  "data.assumptions",
  "directives.suitability",
];

export const RESERVE_MONTHS_RULE = 3;
export const LIQUIDITY_WINDOW_YEARS = 3;
export const STATED_RISK_CAP = { steady: 0.3, balanced: 0.6, growth: 0.9 } as const;

export function horizonEquityCap(years: number) {
  if (years < 3) return 0.2;
  if (years <= 5) return 0.4;
  if (years <= 10) return 0.7;
  return 0.9;
}

export function lossEquityCap(tolerance: number, basis: { equity: number; bond: number }) {
  if (basis.equity <= basis.bond) return 1;
  if (tolerance <= basis.bond) return 0;
  return Math.min(1, (tolerance - basis.bond) / (basis.equity - basis.bond));
}

export async function suitabilityAgent(ctx: StageContext): Promise<StageResult<SuitabilityReport>> {
  const facts = ctx.profile?.facts;
  const cma = ctx.data?.assumptions;
  if (!facts || !cma) throw new StageError("missing-upstream", "Suitability needs profile and data outputs");
  const horizon = facts.horizonYears?.value;
  if (horizon === undefined) throw new StageError("missing-upstream", "Horizon is required");
  const risk = facts.statedRisk?.value;
  const statedLoss = facts.maxAcceptableLossPct?.value;
  const lossTolerance = statedLoss ?? (risk ? RISK_LOSS_BUDGET[risk] : undefined);
  if (lossTolerance === undefined) throw new StageError("missing-upstream", "A loss tolerance or stated risk is required");

  let drawdownBasis: DrawdownBasis = {
    label: "Planning drawdowns from the data stage",
    equity: cma.assetClasses.equity.stressDrawdown,
    bond: cma.assetClasses.bond.stressDrawdown,
    cash: cma.assetClasses.cash.stressDrawdown,
    source: "market-data-planning",
  };
  const appliedDirectives: string[] = [];
  for (const d of ctx.directives.suitability) {
    if (d.remedy.kind === "tighten-drawdown-basis") {
      const r = d.remedy.drawdowns;
      drawdownBasis = {
        label: "Challenger severe-crash scenario (stricter outcome wins)",
        equity: Math.max(drawdownBasis.equity, r.equity),
        bond: Math.max(drawdownBasis.bond, r.bond),
        cash: Math.max(drawdownBasis.cash, r.cash),
        source: "challenger-severe-scenario",
      };
      appliedDirectives.push(d.findingId);
    }
  }

  const equityCaps = [{ source: `horizon ${horizon}y`, cap: horizonEquityCap(horizon) }];
  if (risk) equityCaps.push({ source: `stated preference '${risk}'`, cap: STATED_RISK_CAP[risk] });
  equityCaps.push({
    source: `loss tolerance ${(lossTolerance * 100).toFixed(1)}% under ${drawdownBasis.source}`,
    cap: lossEquityCap(lossTolerance, drawdownBasis),
  });
  const maxEquityShare = Math.min(...equityCaps.map((c) => c.cap));

  const conflicts: SuitabilityConflict[] = [];
  if (risk && statedLoss !== undefined && RISK_LOSS_BUDGET[risk] > statedLoss + 0.05)
    conflicts.push({
      id: "stated-risk-vs-loss-tolerance",
      description: `Stated preference '${risk}' implies accepting falls of about ${RISK_LOSS_BUDGET[risk] * 100}%, but the stated limit is ${(statedLoss * 100).toFixed(1)}%.`,
      resolution: "The stricter stated loss limit is applied; please confirm it.",
      requiresConfirmation: true,
    });
  if (risk === "growth" && horizon <= 5)
    conflicts.push({
      id: "stated-risk-vs-horizon",
      description: `A growth preference with a ${horizon}-year horizon leaves little time to recover from a fall.`,
      resolution: `The horizon cap of ${horizonEquityCap(horizon) * 100}% equities is applied.`,
      requiresConfirmation: true,
    });

  const questions: ClarificationQuestion[] = [];
  let reserveRequiredLei: number | undefined;
  let reserveGapLei: number | undefined;
  let months: number | undefined;
  const expenses = facts.monthlyEssentialExpenses?.value;
  const fund = facts.emergencyFund?.value;
  if (expenses !== undefined && expenses > 0) {
    reserveRequiredLei = RESERVE_MONTHS_RULE * expenses;
    if (fund !== undefined) {
      months = reserveMonths(fund, expenses);
      reserveGapLei = Math.max(0, reserveRequiredLei - fund);
    } else
      questions.push({
        field: "emergencyFund",
        question: "How much do you keep as an emergency fund today (in lei)?",
        reason: `Compared with the ${RESERVE_MONTHS_RULE}-month reserve rule of thumb.`,
      });
  } else
    questions.push({
      field: "monthlyEssentialExpenses",
      question: "Roughly how much are your essential monthly expenses (in lei)?",
      reason: `Needed to size a ${RESERVE_MONTHS_RULE}-month emergency reserve; no reserve is assumed meanwhile.`,
    });

  const liquidityRequirements: LiquidityRequirement[] = [];
  const laterWithdrawals: SuitabilityReport["laterWithdrawals"] = [];
  for (const w of facts.plannedWithdrawals?.value ?? []) {
    if (w.inYears > horizon) continue;
    if (w.inYears <= LIQUIDITY_WINDOW_YEARS)
      liquidityRequirements.push({ purpose: "planned-withdrawal", label: w.label, amountLei: w.amount, neededInYears: w.inYears });
    else laterWithdrawals.push({ label: w.label, amountLei: w.amount, inYears: w.inYears });
  }
  const ringFenced = liquidityRequirements.reduce((s, r) => s + r.amountLei, 0);
  const initial = facts.initialCapital?.value ?? 0;
  let status: SuitabilityReport["status"] = "ok";
  if (ringFenced > initial + 0.01) {
    status = "needs-clarification";
    questions.push({
      field: "plannedWithdrawals",
      question: `Withdrawals planned within ${LIQUIDITY_WINDOW_YEARS} years exceed the starting amount. Will they be funded from savings outside this plan?`,
      reason: "Money needed soon must not depend on investment returns, and we will not assume where it comes from.",
    });
  }

  return {
    output: {
      status,
      maxEquityShare,
      equityCaps,
      lossTolerance,
      lossToleranceSource: statedLoss !== undefined ? "stated-max-loss" : "stated-risk-mapping",
      drawdownBasis,
      reserveRequiredLei,
      reserveGapLei,
      reserveMonths: months,
      liquidityRequirements,
      laterWithdrawals,
      conflicts,
      questions,
      appliedDirectives,
      policyNote: "Illustrative policy for a demo; not a regulatory suitability assessment.",
    },
    notes: [
      {
        event: "output",
        summary: `suitability ${status}: max equity ${(maxEquityShare * 100).toFixed(1)}%, loss tolerance ${(lossTolerance * 100).toFixed(1)}% (${drawdownBasis.source}), ${liquidityRequirements.length} liquidity requirement(s), ${conflicts.length} conflict(s)`,
        data: { maxEquityShare, lossTolerance, drawdownBasis: drawdownBasis.source, conflicts: conflicts.map((c) => c.id), appliedDirectives },
      },
    ],
  };
}
