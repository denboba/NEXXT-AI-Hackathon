// Seeded, deterministic outcome simulation and goal-seek solver. No LLM and no
// randomness outside the seeded generator: the same inputs and seed always
// give identical output.
//
// Model (documented assumptions, illustrative only, not a forecast):
// - Single-factor approximation: the blended asset mix is treated as one
//   asset rebalanced monthly, with annual volatility
//   sigmaP = sqrt(we^2 se^2 + wb^2 sb^2 + wc^2 sc^2 + 2 we wb rho se sb)
//   (cash uncorrelated with equity and bonds).
// - Monthly log-normal growth factor exp(mu + s z), z ~ N(0, 1) from a
//   seeded mulberry32 generator with Box-Muller normals, s = sigmaP / sqrt(12)
//   and mu = ln(1 + gross - fee) / 12 - s^2 / 2, so the EXPECTED monthly growth
//   equals the base-case monthly rate of projectGoal (fee deducted like
//   projectGoal). With zero volatility every path equals projectGoal.
// - Same cash-flow conventions as projectGoal: initial capital at month 0,
//   contributions at the end of each month, planned withdrawals at the end of
//   their year (never more than the balance).
// - Each path has its own generator seeded from (seed, path index), so a
//   longer horizon extends every path without changing its first months.
import { purchasingPower } from "../lib/finance.ts";
import { LEI_TOLERANCE } from "./calculations.ts";
import type { Withdrawal } from "./calculations.ts";
import type { AssetClass, CapitalMarketAssumptions, OutcomeRange, VolatilityClassSource, VolatilitySource } from "./types.ts";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "cash"];

/** Fixed default seed so every run of the demo and the eval suite is reproducible. */
export const SIMULATION_SEED = 20260115;
/** Default number of paths (keeps `npm run eval` fast; see README). */
export const SIMULATION_PATHS = 1000;
export const MAX_SIMULATION_PATHS = 20000;
/**
 * Illustrative synthetic volatility used, per asset class, only when a
 * market-data payload has none for that class. Same values as
 * syntheticAssumptions() in providers/marketData.ts.
 */
export const DEFAULT_VOLATILITY: Record<AssetClass, number> = { equity: 0.16, bond: 0.05, cash: 0.005 };
export const DEFAULT_EQUITY_BOND_CORRELATION = 0.2;
/** Reach-share thresholds the goal-seek solver solves for by default. */
export const SOLVER_THRESHOLDS = [0.5, 0.75];
/**
 * Below this share of seeded paths reaching the target, a base case that
 * reaches it is flagged as material by the Challenger ("base case looks fine,
 * most paths miss").
 */
export const MIN_REACH_SHARE = 0.5;
/** Finding id of that Challenger test; the Strategy acknowledges it when it already discloses the condition. */
export const OUTCOME_RANGE_FINDING = "outcome-range-low-reach";
/** Upper bound for the solved monthly contribution (lei); above it the lever is reported as not reachable. */
export const MAX_SOLVER_MONTHLY_LEI = 1_000_000;
/** Upper bound for the solved horizon (years), same as projectGoal. */
export const MAX_SOLVER_YEARS = 50;

/** mulberry32: small, fast 32-bit seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pathSeed = (seed: number, path: number) => (Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) + Math.imul(path + 1, 0xc2b2ae35)) >>> 0;

/** Standard normal draws for every path (Box-Muller, both outputs used). */
export function drawNormals(seed: number, paths: number, months: number): Float64Array[] {
  const out: Float64Array[] = [];
  for (let p = 0; p < paths; p++) {
    const rng = mulberry32(pathSeed(seed, p));
    const z = new Float64Array(months);
    for (let m = 0; m < months; m += 2) {
      const u1 = 1 - rng(); // (0, 1]: avoids log(0)
      const u2 = rng();
      const r = Math.sqrt(-2 * Math.log(u1));
      z[m] = r * Math.cos(2 * Math.PI * u2);
      if (m + 1 < months) z[m + 1] = r * Math.sin(2 * Math.PI * u2);
    }
    out.push(z);
  }
  return out;
}

export type SimulationInput = {
  initial: number;
  monthly: number;
  years: number;
  assetMix: Record<AssetClass, number>;
  assumptions: CapitalMarketAssumptions;
  /** Annual fee as a return reduction (decimal), like projectGoal. */
  fee: number;
  inflation: number;
  withdrawals?: Withdrawal[];
  target: number;
  /** Compare the target with the value in today's money. */
  targetIsReal: boolean;
  paths?: number;
  seed?: number;
};

export type SimulationResult = OutcomeRange & {
  assumptionsUsed: {
    grossReturn: number;
    fee: number;
    volatility: Record<AssetClass, number>;
    equityBondCorrelation: number;
    model: "single-factor-lognormal-monthly";
  };
};

const finite = (...values: number[]) => values.every(Number.isFinite);

function assertSimulation(s: SimulationInput) {
  const paths = s.paths ?? SIMULATION_PATHS;
  const mix = [s.assetMix.equity, s.assetMix.bond, s.assetMix.cash];
  if (
    !finite(s.initial, s.monthly, s.years, s.fee, s.inflation, s.target, paths, s.seed ?? 0, ...mix) ||
    s.initial < 0 ||
    s.monthly < 0 ||
    !Number.isInteger(s.years) ||
    s.years < 1 ||
    s.years > MAX_SOLVER_YEARS ||
    s.fee < 0 ||
    s.inflation <= -1 ||
    s.target < 0 ||
    !Number.isInteger(paths) ||
    paths < 1 ||
    paths > MAX_SIMULATION_PATHS ||
    !Number.isInteger(s.seed ?? 0) ||
    mix.some((w) => w < 0 || w > 1 + 1e-9) ||
    (s.withdrawals ?? []).some((w) => !finite(w.amount, w.inYears) || w.amount < 0 || !Number.isInteger(w.inYears) || w.inYears < 0)
  )
    throw new RangeError("Invalid simulation inputs");
}

/** Asset classes (in display order) whose volatility is missing from a market-data payload. */
export function missingVolatilityClasses(a: CapitalMarketAssumptions): AssetClass[] {
  return ASSET_CLASSES.filter((cls) => a.assetClasses[cls].volatility === undefined);
}

/** Asset classes (in display order) whose simulation volatility came from the synthetic default. */
export function defaultedVolatilityClasses(r: Pick<OutcomeRange, "volatilityByClassSource">): AssetClass[] {
  return ASSET_CLASSES.filter((cls) => r.volatilityByClassSource[cls] === "synthetic-default");
}

/**
 * Short provenance label for the volatility used: 'synthetic assumptions',
 * 'synthetic default', or for a partial payload 'synthetic assumptions;
 * default volatility for bond, cash' (naming the defaulted classes).
 */
export function volatilityProvenance(r: Pick<OutcomeRange, "volatilitySource" | "volatilityByClassSource">): string {
  if (r.volatilitySource === "synthetic-default") return "synthetic default";
  const defaulted = defaultedVolatilityClasses(r);
  return defaulted.length ? `synthetic assumptions; default volatility for ${defaulted.join(", ")}` : "synthetic assumptions";
}

/**
 * Per asset class: the payload volatility when present, otherwise the
 * labelled synthetic default. Provenance is recorded per class, so a partial
 * payload is never silently replaced by defaults for every class.
 */
function volatilityOf(a: CapitalMarketAssumptions) {
  const volatility = {} as Record<AssetClass, number>;
  const byClass = {} as Record<AssetClass, VolatilityClassSource>;
  for (const cls of ASSET_CLASSES) {
    const v = a.assetClasses[cls].volatility;
    volatility[cls] = v ?? DEFAULT_VOLATILITY[cls];
    byClass[cls] = v === undefined ? "synthetic-default" : "market-data-payload";
  }
  const defaulted = ASSET_CLASSES.filter((cls) => byClass[cls] === "synthetic-default").length;
  const source: VolatilitySource = defaulted === 0 ? "market-data-payload" : defaulted === ASSET_CLASSES.length ? "synthetic-default" : "mixed";
  const rho = a.equityBondCorrelation ?? DEFAULT_EQUITY_BOND_CORRELATION;
  return { volatility, rho, source, byClass };
}

/** Annual volatility of the blended mix (single-factor approximation, see header). */
export function portfolioVolatility(mix: Record<AssetClass, number>, volatility: Record<AssetClass, number>, rho: number) {
  const variance =
    (mix.equity * volatility.equity) ** 2 +
    (mix.bond * volatility.bond) ** 2 +
    (mix.cash * volatility.cash) ** 2 +
    2 * mix.equity * mix.bond * rho * volatility.equity * volatility.bond;
  return Math.sqrt(Math.max(variance, 0));
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: ArrayLike<number>, p: number) {
  const n = sorted.length;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
}

type Prepared = {
  grossReturn: number;
  mu: number;
  s: number;
  sigmaP: number;
  vol: ReturnType<typeof volatilityOf>;
};

function prepare(input: SimulationInput): Prepared {
  const a = input.assumptions.assetClasses;
  // Same expression as blendedAssumptions() so the base case matches exactly.
  const grossReturn = input.assetMix.equity * a.equity.expectedReturn + input.assetMix.bond * a.bond.expectedReturn + input.assetMix.cash * a.cash.expectedReturn;
  if (grossReturn - input.fee <= -1) throw new RangeError("Invalid return assumptions");
  const vol = volatilityOf(input.assumptions);
  const sigmaP = portfolioVolatility(input.assetMix, vol.volatility, vol.rho);
  const s = sigmaP / Math.sqrt(12);
  const mu = Math.log(1 + grossReturn - input.fee) / 12 - (s * s) / 2;
  return { grossReturn, mu, s, sigmaP, vol };
}

/** Terminal nominal values (unsorted) and worst unit-value drawdown for given normals. */
function runPaths(input: SimulationInput, prep: Prepared, normals: Float64Array[], years: number, monthly: number) {
  const months = years * 12;
  const values = new Float64Array(normals.length);
  let worstDrawdown = 0;
  const withdrawals = input.withdrawals ?? [];
  for (let p = 0; p < normals.length; p++) {
    const z = normals[p];
    let balance = input.initial;
    let index = 1;
    let peak = 1;
    for (let m = 1; m <= months; m++) {
      const growth = Math.exp(prep.mu + prep.s * z[m - 1]);
      balance = balance * growth + monthly;
      index *= growth;
      if (index > peak) peak = index;
      else if (1 - index / peak > worstDrawdown) worstDrawdown = 1 - index / peak;
      if (m % 12 === 0)
        for (const w of withdrawals)
          if (w.inYears === m / 12) balance -= Math.min(w.amount, Math.max(balance, 0));
    }
    values[p] = balance;
  }
  return { values, worstDrawdown };
}

function reachShareOf(values: Float64Array, target: number, targetIsReal: boolean, years: number, inflation: number) {
  let reached = 0;
  for (const v of values) {
    const compared = targetIsReal ? purchasingPower(Math.max(v, 0), years, inflation) : v;
    if (compared + LEI_TOLERANCE >= target) reached++;
  }
  return reached / values.length;
}

/** Seeded Monte Carlo range of outcomes for one strategy. Pure and deterministic. */
export function simulateGoal(input: SimulationInput): SimulationResult {
  assertSimulation(input);
  const paths = input.paths ?? SIMULATION_PATHS;
  const seed = input.seed ?? SIMULATION_SEED;
  const prep = prepare(input);
  const normals = drawNormals(seed, paths, input.years * 12);
  const { values, worstDrawdown } = runPaths(input, prep, normals, input.years, input.monthly);
  const sorted = Float64Array.from(values).sort();
  const real = (v: number) => purchasingPower(Math.max(v, 0), input.years, input.inflation);
  const p10 = percentile(sorted, 0.1);
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  return {
    seed,
    paths,
    p10,
    p50,
    p90,
    p10Real: real(p10),
    p50Real: real(p50),
    p90Real: real(p90),
    reachShare: reachShareOf(values, input.target, input.targetIsReal, input.years, input.inflation),
    targetIsReal: input.targetIsReal,
    worstPathMaxDrawdown: worstDrawdown,
    portfolioVolatility: prep.sigmaP,
    volatilitySource: prep.vol.source,
    volatilityByClassSource: prep.vol.byClass,
    assumptionsUsed: {
      grossReturn: prep.grossReturn,
      fee: input.fee,
      volatility: prep.vol.volatility,
      equityBondCorrelation: prep.vol.rho,
      model: "single-factor-lognormal-monthly",
    },
  };
}

export type SolvedThreshold = {
  /** Target reach share (0..1). */
  threshold: number;
  /** Minimum whole-lei monthly contribution reaching the threshold at the current horizon; null when above MAX_SOLVER_MONTHLY_LEI. */
  monthlyLei: number | null;
  /** monthlyLei minus the current contribution (0 when already reached). */
  extraMonthlyLei: number | null;
  /** Minimum extra whole years at the current contribution; null when not reachable within MAX_SOLVER_YEARS in total. */
  extraYears: number | null;
};

export type SolverInput = SimulationInput & { thresholds?: number[] };
export type SolverResult = {
  seed: number;
  paths: number;
  currentReachShare: number;
  solutions: SolvedThreshold[];
  /** Number of simulations evaluated (bounded). */
  evaluations: number;
};

/**
 * Goal-seek over the seeded simulation (same seed and paths for every
 * evaluation, so the search is reproducible). Monthly contribution: doubling
 * then integer bisection (terminal values rise with the contribution on every
 * path, so the reach share is monotone). Horizon: stepwise search up to
 * MAX_SOLVER_YEARS in total.
 */
export function solveLevers(input: SolverInput): SolverResult {
  assertSimulation(input);
  const thresholds = input.thresholds ?? SOLVER_THRESHOLDS;
  if (!thresholds.every((t) => Number.isFinite(t) && t > 0 && t <= 1)) throw new RangeError("Invalid reach-share thresholds");
  const paths = input.paths ?? SIMULATION_PATHS;
  const seed = input.seed ?? SIMULATION_SEED;
  const prep = prepare(input);
  const normals = drawNormals(seed, paths, MAX_SOLVER_YEARS * 12);
  let evaluations = 0;
  const share = (monthly: number, years: number) => {
    evaluations++;
    return reachShareOf(runPaths(input, prep, normals, years, monthly).values, input.target, input.targetIsReal, years, input.inflation);
  };
  const current = share(input.monthly, input.years);
  const byYears = new Map<number, number>([[input.years, current]]);
  const yearsShare = (years: number) => {
    if (!byYears.has(years)) byYears.set(years, share(input.monthly, years));
    return byYears.get(years)!;
  };
  const solutions = thresholds.map((threshold): SolvedThreshold => {
    let monthlyLei: number | null;
    if (current >= threshold) monthlyLei = input.monthly;
    else {
      let lo = Math.ceil(input.monthly);
      if (share(lo, input.years) >= threshold) monthlyLei = lo;
      else {
        let hi = Math.max(lo * 2, lo + 100);
        while (hi <= MAX_SOLVER_MONTHLY_LEI && share(hi, input.years) < threshold) {
          lo = hi;
          hi *= 2;
        }
        if (hi > MAX_SOLVER_MONTHLY_LEI) monthlyLei = null;
        else {
          // Invariant: lo misses the threshold, hi reaches it.
          while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (share(mid, input.years) >= threshold) hi = mid;
            else lo = mid;
          }
          monthlyLei = hi;
        }
      }
    }
    let extraYears: number | null = null;
    for (let years = input.years; years <= MAX_SOLVER_YEARS; years++)
      if (yearsShare(years) >= threshold) {
        extraYears = years - input.years;
        break;
      }
    return { threshold, monthlyLei, extraMonthlyLei: monthlyLei === null ? null : Math.max(0, monthlyLei - input.monthly), extraYears };
  });
  return { seed, paths, currentReachShare: current, solutions, evaluations };
}
