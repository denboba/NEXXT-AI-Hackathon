import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEI_TOLERANCE,
  blendedAssumptions,
  concentrationShare,
  projectGoal,
  requiredMonthly,
  reserveMonths,
  stressLoss,
  stressedValueAtGoal,
} from "../../src/domain/calculations.ts";
import { catalogue, mixForEquity, eligibleBlocks } from "../../src/domain/catalogue.ts";
import { project, purchasingPower } from "../../src/lib/finance.ts";
import { syntheticAssumptions } from "../../src/providers/marketData.ts";

const close = (a: number, b: number, tol = LEI_TOLERANCE) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("projectGoal matches closed-form lump sum + end-of-month annuity", () => {
  const initial = 20_000, monthly = 700, years = 7, gross = 0.06, fee = 0.009;
  const r = (1 + gross - fee) ** (1 / 12) - 1;
  const n = years * 12;
  const expected = initial * (1 + r) ** n + (monthly * ((1 + r) ** n - 1)) / r;
  const p = projectGoal({ initial, monthly, years, grossReturn: gross, fee, inflation: 0.055 });
  close(p.nominal, expected);
  close(p.real, purchasingPower(expected, years));
  assert.equal(p.points.length, years + 1);
  close(p.contributed, initial + monthly * n);
});

test("projectGoal with no initial capital equals the existing project() helper", () => {
  const p = projectGoal({ initial: 0, monthly: 500, years: 10, grossReturn: 0.06, fee: 0.009, inflation: 0.055 });
  close(p.nominal, project(500, 10).balance);
});

test("projectGoal zero-rate case and planned withdrawals", () => {
  const p = projectGoal({ initial: 1000, monthly: 100, years: 2, grossReturn: 0, fee: 0, inflation: 0 });
  close(p.nominal, 1000 + 2400);
  const w = projectGoal({ initial: 1000, monthly: 100, years: 2, grossReturn: 0, fee: 0, inflation: 0, withdrawals: [{ amount: 500, inYears: 1 }] });
  close(w.nominal, 2900);
  close(w.withdrawn, 500);
});

test("requiredMonthly round-trips through projectGoal (incl. zero rate)", () => {
  for (const net of [0.051, 0.0389, 0]) {
    const m = requiredMonthly(90_000, 14_000, 7, net);
    const p = projectGoal({ initial: 14_000, monthly: m, years: 7, grossReturn: net, fee: 0, inflation: 0.055 });
    close(p.nominal, 90_000);
  }
  assert.equal(requiredMonthly(1000, 5000, 3, 0.03), 0);
  close(requiredMonthly(1200, 0, 1, 0), 100);
});

test("calculations throw RangeError on invalid input", () => {
  const base = { initial: 0, monthly: 100, years: 5, grossReturn: 0.05, fee: 0.01, inflation: 0.05 };
  assert.throws(() => projectGoal({ ...base, monthly: -1 }), RangeError);
  assert.throws(() => projectGoal({ ...base, years: 2.5 }), RangeError);
  assert.throws(() => projectGoal({ ...base, years: 0 }), RangeError);
  assert.throws(() => projectGoal({ ...base, grossReturn: Number.NaN }), RangeError);
  assert.throws(() => projectGoal({ ...base, fee: -0.01 }), RangeError);
  assert.throws(() => requiredMonthly(-1, 0, 5, 0.03), RangeError);
  assert.throws(() => requiredMonthly(100, 0, 51, 0.03), RangeError);
  assert.throws(() => reserveMonths(1000, 0), RangeError);
  assert.throws(() => stressedValueAtGoal({ ...base, shockPct: 1.5, shockYear: 1, recoveryReturn: 0.03 }), RangeError);
  assert.throws(() => stressedValueAtGoal({ ...base, shockPct: 0.3, shockYear: 9, recoveryReturn: 0.03 }), RangeError);
  assert.throws(() => concentrationShare([{ label: "x", assetClass: "single-stock", value: -5 }]), RangeError);
});

test("stressedValueAtGoal applies a one-off drawdown then continues", () => {
  // Zero rates make the arithmetic exact: 12 months x 100 = 1200, -50% = 600, + 1200 = 1800.
  const s = stressedValueAtGoal({ initial: 0, monthly: 100, years: 2, grossReturn: 0, fee: 0, inflation: 0, shockPct: 0.5, shockYear: 1, recoveryReturn: 0 });
  close(s.valueBeforeShock, 1200);
  close(s.shockLossLei, 600);
  close(s.valueAtGoal, 1800);
  const none = stressedValueAtGoal({ initial: 5000, monthly: 100, years: 3, grossReturn: 0.05, fee: 0.01, inflation: 0, shockPct: 0, shockYear: 2, recoveryReturn: 0.04 });
  close(none.valueAtGoal, projectGoal({ initial: 5000, monthly: 100, years: 3, grossReturn: 0.05, fee: 0.01, inflation: 0 }).nominal);
  const paused = stressedValueAtGoal({ initial: 0, monthly: 100, years: 2, grossReturn: 0, fee: 0, inflation: 0, shockPct: 0, shockYear: 0, recoveryReturn: 0, pause: { fromMonth: 13, toMonth: 24 } });
  close(paused.valueAtGoal, 1200);
});

test("reserveMonths, concentrationShare, stressLoss", () => {
  assert.equal(reserveMonths(6000, 4000), 1.5);
  const holdings = [{ label: "x", assetClass: "single-stock" as const, value: 12_000 }];
  close(concentrationShare(holdings, 35_000), 12_000 / 47_000, 1e-12);
  assert.equal(concentrationShare([], 0), 0);
  close(stressLoss({ equity: 0.5, bond: 0.5, cash: 0 }, { equity: 0.35, bond: 0.08, cash: 0 }), 0.215, 1e-12);
});

test("blendedAssumptions and catalogue mixes are consistent with the demo products", () => {
  const cma = syntheticAssumptions();
  const balanced = blendedAssumptions({ balanced: 1 }, catalogue, cma);
  close(balanced.grossReturn, 0.06, 1e-12);
  close(balanced.fee, 0.009, 1e-12);
  close(balanced.stressDrawdown, 0.5 * 0.2 + 0.5 * 0.05, 1e-12);
  const mix = mixForEquity(0.2593, eligibleBlocks(7).filter((b) => b.id !== "cash-reserve"));
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  close(sum, 1, 1e-9);
  assert.ok(blendedAssumptions(mix, catalogue, cma).equityShare <= 0.2593);
  assert.ok(!eligibleBlocks(7).some((b) => b.id === "growth"), "growth fund needs 10+ years");
});
