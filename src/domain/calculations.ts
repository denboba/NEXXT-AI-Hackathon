// Deterministic financial calculations. No LLM ever performs arithmetic.
//
// Conventions (documented assumptions):
// - Currency: lei (RON). Rates: decimal per year. Horizons: whole years.
// - Monthly compounding with the same monthly-rate formula as project() in
//   src/lib/finance.ts: monthlyRate = (1 + grossReturn - fee)^(1/12) - 1.
//   The fee is approximated as an annual return reduction.
// - Initial capital is invested at month 0; contributions are made at the end
//   of each month; planned withdrawals happen at the end of their year.
// - Real values use purchasingPower() (constant annual inflation).
// - Rounding: everything is computed in full precision. Round to whole lei
//   only for display (roundLei). Comparisons use LEI_TOLERANCE = 0.01 lei.
// - All functions throw RangeError on invalid input, like project().
import { purchasingPower } from "../lib/finance.ts";
import type { AssetClass, CapitalMarketAssumptions, Holding } from "./types.ts";
import type { BuildingBlock } from "./catalogue.ts";

export const LEI_TOLERANCE = 0.01;
export const roundLei = (amount: number) => Math.round(amount);
export const approxEqual = (a: number, b: number, tolerance = LEI_TOLERANCE) =>
  Math.abs(a - b) <= tolerance;

const finite = (...values: number[]) => values.every(Number.isFinite);
const validYears = (years: number) => Number.isInteger(years) && years >= 1 && years <= 50;

export function monthlyRateFor(grossReturn: number, fee: number) {
  if (!finite(grossReturn, fee) || fee < 0 || grossReturn - fee <= -1)
    throw new RangeError("Invalid return assumptions");
  return (1 + grossReturn - fee) ** (1 / 12) - 1;
}

export type Withdrawal = { amount: number; inYears: number };

export type ProjectionInput = {
  initial: number;
  monthly: number;
  years: number;
  grossReturn: number;
  fee: number;
  inflation: number;
  withdrawals?: Withdrawal[];
};

export type ProjectionPoint = { year: number; contributed: number; nominal: number; real: number };

export type GoalProjection = {
  nominal: number;
  real: number;
  contributed: number;
  withdrawn: number;
  growth: number;
  netReturn: number;
  points: ProjectionPoint[];
};

type SimulationSpec = {
  initial: number;
  monthly: number;
  months: number;
  monthlyRate: number;
  /** Months (1-based, inclusive) in which no contribution is made. */
  pause?: { fromMonth: number; toMonth: number };
  /** One-off drawdown applied at the end of the given month. */
  shock?: { month: number; pct: number };
  /** Monthly rate used after the shock (defaults to monthlyRate). */
  recoveryMonthlyRate?: number;
  withdrawals?: Withdrawal[];
};

function simulate(spec: SimulationSpec) {
  let balance = spec.initial;
  let contributed = 0;
  let withdrawn = 0;
  let beforeShock: number | undefined;
  const yearly: { year: number; balance: number; contributed: number }[] = [
    { year: 0, balance, contributed: 0 },
  ];
  let rate = spec.monthlyRate;
  for (let month = 1; month <= spec.months; month++) {
    const paused = spec.pause && month >= spec.pause.fromMonth && month <= spec.pause.toMonth;
    const contribution = paused ? 0 : spec.monthly;
    balance = balance * (1 + rate) + contribution;
    contributed += contribution;
    if (spec.shock && month === spec.shock.month) {
      beforeShock = balance;
      balance *= 1 - spec.shock.pct;
      if (spec.recoveryMonthlyRate !== undefined) rate = spec.recoveryMonthlyRate;
    }
    if (month % 12 === 0) {
      for (const w of spec.withdrawals ?? []) {
        if (w.inYears === month / 12) {
          const taken = Math.min(w.amount, Math.max(balance, 0));
          balance -= taken;
          withdrawn += taken;
        }
      }
      yearly.push({ year: month / 12, balance, contributed });
    }
  }
  return { balance, contributed, withdrawn, beforeShock, yearly };
}

function assertProjection(p: ProjectionInput) {
  if (
    !finite(p.initial, p.monthly, p.years, p.grossReturn, p.fee, p.inflation) ||
    p.initial < 0 ||
    p.monthly < 0 ||
    !validYears(p.years) ||
    p.fee < 0 ||
    p.grossReturn - p.fee <= -1 ||
    p.inflation <= -1 ||
    (p.withdrawals ?? []).some((w) => !finite(w.amount, w.inYears) || w.amount < 0 || !Number.isInteger(w.inYears) || w.inYears < 0)
  )
    throw new RangeError("Invalid projection assumptions");
}

/** Lump sum + end-of-month contributions, nominal and real (today's lei). */
export function projectGoal(p: ProjectionInput): GoalProjection {
  assertProjection(p);
  const sim = simulate({
    initial: p.initial,
    monthly: p.monthly,
    months: p.years * 12,
    monthlyRate: monthlyRateFor(p.grossReturn, p.fee),
    withdrawals: p.withdrawals,
  });
  const points = sim.yearly.map((y) => ({
    year: y.year,
    contributed: p.initial + y.contributed,
    nominal: y.balance,
    real: purchasingPower(Math.max(y.balance, 0), y.year, p.inflation),
  }));
  const contributed = p.initial + sim.contributed;
  return {
    nominal: sim.balance,
    real: purchasingPower(Math.max(sim.balance, 0), p.years, p.inflation),
    contributed,
    withdrawn: sim.withdrawn,
    growth: sim.balance + sim.withdrawn - contributed,
    netReturn: p.grossReturn - p.fee,
    points,
  };
}

/**
 * Monthly end-of-month contribution needed to reach `target` (nominal lei)
 * after `years`, given `initial` capital and a net annual return. Closed-form
 * annuity; when the monthly rate is zero the factor is simply n months.
 * Returns 0 when the initial capital alone already reaches the target.
 */
export function requiredMonthly(target: number, initial: number, years: number, netAnnualReturn: number) {
  if (!finite(target, initial, years, netAnnualReturn) || target < 0 || initial < 0 || !validYears(years) || netAnnualReturn <= -1)
    throw new RangeError("Invalid required-contribution inputs");
  const r = (1 + netAnnualReturn) ** (1 / 12) - 1;
  const n = years * 12;
  const growthFactor = (1 + r) ** n;
  const remaining = target - initial * growthFactor;
  if (remaining <= 0) return 0;
  const annuityFactor = r === 0 ? n : (growthFactor - 1) / r;
  return remaining / annuityFactor;
}

/** Asset-class mix implied by block weights. */
export function assetMixFor(weights: Record<string, number>, blocks: BuildingBlock[]) {
  const mix: Record<AssetClass, number> = { equity: 0, bond: 0, cash: 0 };
  for (const [id, weight] of Object.entries(weights)) {
    const block = blocks.find((b) => b.id === id);
    if (!block || !Number.isFinite(weight) || weight < 0) throw new RangeError(`Invalid weight for block ${id}`);
    for (const cls of ["equity", "bond", "cash"] as const) mix[cls] += weight * block.assetMix[cls];
  }
  return mix;
}

export type BlendedAssumptions = {
  grossReturn: number;
  fee: number;
  netReturn: number;
  stressDrawdown: number;
  assetMix: Record<AssetClass, number>;
  equityShare: number;
};

/**
 * Gross return = sum over asset classes of mix x expected return (from the
 * capital-market assumptions); fee = weight-averaged block fee; planning
 * stress drawdown = sum of mix x asset-class drawdown.
 */
export function blendedAssumptions(
  weights: Record<string, number>,
  blocks: BuildingBlock[],
  cma: CapitalMarketAssumptions,
): BlendedAssumptions {
  const mix = assetMixFor(weights, blocks);
  let fee = 0;
  for (const [id, weight] of Object.entries(weights)) fee += weight * blocks.find((b) => b.id === id)!.fee;
  const grossReturn =
    mix.equity * cma.assetClasses.equity.expectedReturn +
    mix.bond * cma.assetClasses.bond.expectedReturn +
    mix.cash * cma.assetClasses.cash.expectedReturn;
  return {
    grossReturn,
    fee,
    netReturn: grossReturn - fee,
    stressDrawdown: stressLoss(mix, {
      equity: cma.assetClasses.equity.stressDrawdown,
      bond: cma.assetClasses.bond.stressDrawdown,
      cash: cma.assetClasses.cash.stressDrawdown,
    }),
    assetMix: mix,
    equityShare: mix.equity,
  };
}

/** Portfolio loss (decimal) for given asset-class drawdowns. */
export function stressLoss(mix: Record<AssetClass, number>, drawdowns: Record<AssetClass, number>) {
  const values = [mix.equity, mix.bond, mix.cash, drawdowns.equity, drawdowns.bond, drawdowns.cash];
  if (!finite(...values) || values.some((v) => v < 0 || v > 1)) throw new RangeError("Invalid stress inputs");
  return mix.equity * drawdowns.equity + mix.bond * drawdowns.bond + mix.cash * drawdowns.cash;
}

export type StressInput = ProjectionInput & {
  /** One-off drawdown (decimal, e.g. 0.247). */
  shockPct: number;
  /** Shock applied at the end of this year (0 = immediately). */
  shockYear: number;
  /** Net annual return assumed after the shock. */
  recoveryReturn: number;
  /** Optional contribution pause (1-based months, inclusive). */
  pause?: { fromMonth: number; toMonth: number };
};

/** Value at the goal date after a one-off drawdown in `shockYear`. */
export function stressedValueAtGoal(s: StressInput) {
  assertProjection(s);
  if (
    !finite(s.shockPct, s.shockYear, s.recoveryReturn) ||
    s.shockPct < 0 ||
    s.shockPct > 1 ||
    !Number.isInteger(s.shockYear) ||
    s.shockYear < 0 ||
    s.shockYear > s.years ||
    s.recoveryReturn <= -1
  )
    throw new RangeError("Invalid stress assumptions");
  const monthlyRate = monthlyRateFor(s.grossReturn, s.fee);
  const recoveryMonthlyRate = (1 + s.recoveryReturn) ** (1 / 12) - 1;
  let initial = s.initial;
  let shockMonth = s.shockYear * 12;
  let lossAtStart = 0;
  if (shockMonth === 0) {
    lossAtStart = initial * s.shockPct;
    initial -= lossAtStart;
    shockMonth = -1;
  }
  const sim = simulate({
    initial,
    monthly: s.monthly,
    months: s.years * 12,
    monthlyRate: shockMonth === -1 ? recoveryMonthlyRate : monthlyRate,
    shock: shockMonth > 0 ? { month: shockMonth, pct: s.shockPct } : undefined,
    recoveryMonthlyRate,
    pause: s.pause,
    withdrawals: s.withdrawals,
  });
  const before = sim.beforeShock ?? s.initial;
  return {
    valueAtGoal: sim.balance,
    realValueAtGoal: purchasingPower(Math.max(sim.balance, 0), s.years, s.inflation),
    valueBeforeShock: before,
    shockLossLei: shockMonth === -1 ? lossAtStart : before * s.shockPct,
  };
}

/** Months of essential expenses covered by the emergency fund. */
export function reserveMonths(emergencyFund: number, monthlyEssentialExpenses: number) {
  if (!finite(emergencyFund, monthlyEssentialExpenses) || emergencyFund < 0 || monthlyEssentialExpenses <= 0)
    throw new RangeError("Invalid reserve inputs");
  return emergencyFund / monthlyEssentialExpenses;
}

/**
 * Single-stock share of investable assets: single-stock holdings divided by
 * (all holdings + additional investable capital, e.g. the plan's initial capital).
 */
export function concentrationShare(holdings: Holding[], additionalInvestableLei = 0) {
  if (!finite(additionalInvestableLei) || additionalInvestableLei < 0 || holdings.some((h) => !finite(h.value) || h.value < 0))
    throw new RangeError("Invalid holdings");
  const total = holdings.reduce((s, h) => s + h.value, 0) + additionalInvestableLei;
  if (total === 0) return 0;
  return holdings.filter((h) => h.assetClass === "single-stock").reduce((s, h) => s + h.value, 0) / total;
}
