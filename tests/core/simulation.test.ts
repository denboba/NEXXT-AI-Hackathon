import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VOLATILITY,
  SIMULATION_PATHS,
  SIMULATION_SEED,
  defaultedVolatilityClasses,
  drawNormals,
  missingVolatilityClasses,
  mulberry32,
  percentile,
  portfolioVolatility,
  simulateGoal,
  solveLevers,
  volatilityProvenance,
} from "../../src/domain/simulation.ts";
import type { SimulationInput } from "../../src/domain/simulation.ts";
import { LEI_TOLERANCE, blendedAssumptions, projectGoal } from "../../src/domain/calculations.ts";
import { catalogue } from "../../src/domain/catalogue.ts";
import { syntheticAssumptions } from "../../src/providers/marketData.ts";
import type { CapitalMarketAssumptions } from "../../src/domain/types.ts";

const cma = syntheticAssumptions();
const balanced = blendedAssumptions({ balanced: 1 }, catalogue, cma);
const base: SimulationInput = {
  initial: 20000,
  monthly: 700,
  years: 7,
  assetMix: balanced.assetMix,
  assumptions: cma,
  fee: balanced.fee,
  inflation: cma.inflation,
  withdrawals: [],
  target: 90000,
  targetIsReal: false,
};
const zeroVol = (a: CapitalMarketAssumptions): CapitalMarketAssumptions => ({
  ...a,
  assetClasses: {
    equity: { ...a.assetClasses.equity, volatility: 0 },
    bond: { ...a.assetClasses.bond, volatility: 0 },
    cash: { ...a.assetClasses.cash, volatility: 0 },
  },
});

test("simulation: PRNG and normals are deterministic and prefix-stable per path", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(Array.from({ length: 5 }, () => b()), xs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const short = drawNormals(7, 3, 12);
  const long = drawNormals(7, 3, 24);
  for (let p = 0; p < 3; p++) assert.deepEqual(Array.from(long[p].slice(0, 12)), Array.from(short[p]), "a longer horizon extends each path without changing it");
  const many = drawNormals(SIMULATION_SEED, 400, 12).flatMap((z) => Array.from(z));
  const mean = many.reduce((s, z) => s + z, 0) / many.length;
  const sd = Math.sqrt(many.reduce((s, z) => s + (z - mean) ** 2, 0) / many.length);
  assert.ok(Math.abs(mean) < 0.05 && Math.abs(sd - 1) < 0.05, `mean ${mean}, sd ${sd}`);
});

test("simulation: same seed gives identical output; another seed changes the paths", () => {
  const a = simulateGoal(base);
  const b = simulateGoal(base);
  assert.deepEqual(a, b);
  assert.equal(a.seed, SIMULATION_SEED);
  assert.equal(a.paths, SIMULATION_PATHS);
  const c = simulateGoal({ ...base, seed: SIMULATION_SEED + 1 });
  assert.notEqual(c.p50, a.p50);
  assert.ok(c.p10 <= c.p50 && c.p50 <= c.p90);
});

test("simulation: with zero volatility every path equals projectGoal (withdrawals included)", () => {
  const withdrawals = [{ amount: 15000, inYears: 2 }];
  const input = { ...base, initial: 35000, withdrawals, assumptions: zeroVol(cma) };
  const r = simulateGoal(input);
  const p = projectGoal({ initial: 35000, monthly: 700, years: 7, grossReturn: balanced.grossReturn, fee: balanced.fee, inflation: cma.inflation, withdrawals });
  assert.ok(Math.abs(r.p50 - p.nominal) <= LEI_TOLERANCE, `${r.p50} vs ${p.nominal}`);
  assert.ok(Math.abs(r.p10 - r.p90) <= LEI_TOLERANCE);
  assert.ok(Math.abs(r.p50Real - p.real) <= LEI_TOLERANCE);
  assert.equal(r.reachShare, p.nominal + LEI_TOLERANCE >= input.target ? 1 : 0);
  assert.equal(r.worstPathMaxDrawdown, 0);
  assert.equal(r.portfolioVolatility, 0);
});

test("simulation: percentiles ordered, reach share bounded, withdrawals and real targets handled", () => {
  const mixes: Record<string, number>[] = [{ steady: 1 }, { balanced: 1 }, { growth: 1 }];
  for (const weights of mixes) {
    const blend = blendedAssumptions(weights, catalogue, cma);
    const r = simulateGoal({ ...base, years: 12, assetMix: blend.assetMix, fee: blend.fee });
    assert.ok(r.p10 <= r.p50 && r.p50 <= r.p90, JSON.stringify(weights));
    assert.ok(r.p10Real <= r.p50Real && r.p50Real <= r.p90Real);
    assert.ok(r.reachShare >= 0 && r.reachShare <= 1);
    assert.ok(r.worstPathMaxDrawdown >= 0 && r.worstPathMaxDrawdown < 1);
  }
  const riskier = simulateGoal({ ...base, assetMix: blendedAssumptions({ growth: 1 }, catalogue, cma).assetMix });
  assert.ok(riskier.p90 - riskier.p10 > simulateGoal(base).p90 - simulateGoal(base).p10, "more equity widens the range");
  const withWithdrawal = simulateGoal({ ...base, withdrawals: [{ amount: 10000, inYears: 3 }] });
  assert.ok(withWithdrawal.p50 < simulateGoal(base).p50);
  const real = simulateGoal({ ...base, target: 60000, targetIsReal: true });
  assert.equal(real.targetIsReal, true);
  assert.ok(real.reachShare < simulateGoal({ ...base, target: 60000 }).reachShare, "a today's-money target is harder to reach");
});

test("simulation: volatility comes from the payload or a labelled synthetic default", () => {
  assert.equal(simulateGoal(base).volatilitySource, "market-data-payload");
  const stripped: CapitalMarketAssumptions = {
    ...cma,
    equityBondCorrelation: undefined,
    assetClasses: {
      equity: { expectedReturn: 0.09, stressDrawdown: 0.2 },
      bond: { expectedReturn: 0.03, stressDrawdown: 0.05 },
      cash: { expectedReturn: 0.025, stressDrawdown: 0 },
    },
  };
  const r = simulateGoal({ ...base, assumptions: stripped });
  assert.equal(r.volatilitySource, "synthetic-default");
  assert.deepEqual(r.assumptionsUsed.volatility, DEFAULT_VOLATILITY);
  assert.equal(r.p50, simulateGoal(base).p50, "defaults equal the synthetic fixture values");
  assert.ok(Math.abs(portfolioVolatility({ equity: 1, bond: 0, cash: 0 }, DEFAULT_VOLATILITY, 0.2) - 0.16) < 1e-12);
  assert.equal(percentile(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 0.1), 1);
  assert.equal(percentile(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 0.5), 5);
});

test("simulation: partial payload volatility is used per class, the rest defaults and the source is 'mixed'", () => {
  const equityOnly: CapitalMarketAssumptions = {
    ...cma,
    assetClasses: {
      equity: { expectedReturn: 0.09, stressDrawdown: 0.2, volatility: 0.24 },
      bond: { expectedReturn: 0.03, stressDrawdown: 0.05 },
      cash: { expectedReturn: 0.025, stressDrawdown: 0 },
    },
  };
  const r = simulateGoal({ ...base, assumptions: equityOnly });
  assert.equal(r.volatilitySource, "mixed");
  assert.deepEqual(r.volatilityByClassSource, { equity: "market-data-payload", bond: "synthetic-default", cash: "synthetic-default" });
  assert.deepEqual(r.assumptionsUsed.volatility, { equity: 0.24, bond: DEFAULT_VOLATILITY.bond, cash: DEFAULT_VOLATILITY.cash });
  const allDefault = simulateGoal({
    ...base,
    assumptions: { ...equityOnly, assetClasses: { ...equityOnly.assetClasses, equity: { expectedReturn: 0.09, stressDrawdown: 0.2 } } },
  });
  assert.equal(allDefault.volatilitySource, "synthetic-default");
  assert.ok(r.portfolioVolatility > allDefault.portfolioVolatility + 1e-6, "the payload equity volatility is not discarded");
  assert.deepEqual(missingVolatilityClasses(equityOnly), ["bond", "cash"]);
  assert.deepEqual(defaultedVolatilityClasses(r), ["bond", "cash"]);
  assert.equal(volatilityProvenance(r), "synthetic assumptions; default volatility for bond, cash");
  assert.equal(volatilityProvenance(allDefault), "synthetic default");
  assert.equal(volatilityProvenance(simulateGoal(base)), "synthetic assumptions");
  assert.deepEqual(simulateGoal(base).volatilityByClassSource, { equity: "market-data-payload", bond: "market-data-payload", cash: "market-data-payload" });
});

test("simulation: invalid inputs throw RangeError", () => {
  for (const bad of [{ years: 0 }, { years: 51 }, { paths: 0 }, { paths: 1.5 }, { monthly: -1 }, { seed: 0.5 }, { target: Number.NaN }])
    assert.throws(() => simulateGoal({ ...base, ...bad }), RangeError, JSON.stringify(bad));
});

test("solver: solved contribution reaches the threshold and one lei less does not", () => {
  const input = { ...base, initial: 20000, monthly: 700 };
  const r = solveLevers({ ...input, thresholds: [0.5, 0.75] });
  assert.equal(r.seed, SIMULATION_SEED);
  assert.ok(r.evaluations > 0 && r.evaluations < 200, `${r.evaluations} evaluations`);
  assert.equal(r.currentReachShare, simulateGoal(input).reachShare);
  for (const s of r.solutions) {
    assert.ok(s.monthlyLei !== null && Number.isInteger(s.monthlyLei));
    if (r.currentReachShare >= s.threshold) continue;
    assert.ok(simulateGoal({ ...input, monthly: s.monthlyLei! }).reachShare >= s.threshold, `${s.monthlyLei} reaches ${s.threshold}`);
    assert.ok(simulateGoal({ ...input, monthly: s.monthlyLei! - 1 }).reachShare < s.threshold, `${s.monthlyLei! - 1} misses ${s.threshold}`);
    assert.equal(s.extraMonthlyLei, s.monthlyLei! - input.monthly);
    assert.ok(s.extraYears !== null && s.extraYears > 0);
    assert.ok(simulateGoal({ ...input, years: input.years + s.extraYears! }).reachShare >= s.threshold);
    assert.ok(simulateGoal({ ...input, years: input.years + s.extraYears! - 1 }).reachShare < s.threshold);
  }
  const [half, threeQuarters] = r.solutions;
  assert.ok(threeQuarters.monthlyLei! >= half.monthlyLei!, "a higher reach share never needs less");
  assert.deepEqual(solveLevers({ ...input, thresholds: [0.5, 0.75] }), r, "deterministic");
});

test("solver: returns null when the target is out of reach within bounds; current share already enough -> no extra", () => {
  const out = solveLevers({ ...base, target: 1e12, thresholds: [0.5] });
  assert.equal(out.solutions[0].monthlyLei, null);
  assert.equal(out.solutions[0].extraYears, null);
  const easy = solveLevers({ ...base, target: 1000, thresholds: [0.75] });
  assert.equal(easy.solutions[0].extraMonthlyLei, 0);
  assert.equal(easy.solutions[0].extraYears, 0);
  assert.throws(() => solveLevers({ ...base, thresholds: [1.5] }), RangeError);
});
