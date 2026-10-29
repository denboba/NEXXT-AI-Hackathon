import { test } from "node:test";
import assert from "node:assert/strict";
import { validateIntake } from "../../src/domain/validate.ts";
import { extractWithRules, numberAppearsIn, parseExplanation, parseExtraction } from "../../src/providers/llm.ts";
import { validateAssumptions, syntheticAssumptions } from "../../src/providers/marketData.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";

test("demo profile is a valid intake", () => {
  assert.deepEqual(validateIntake(demoProfile), { ok: true, errors: [] });
});

test("validateIntake reports errors with field paths", () => {
  const r = validateIntake({
    goal: { label: "", targetAmount: -5, horizonYears: 2.5 },
    monthlyContribution: Number.NaN,
    maxAcceptableLossPct: 15,
    statedRisk: "yolo",
    plannedWithdrawals: [{ label: "x", amount: 0, inYears: 1 }],
    holdings: [{ label: "y", assetClass: "crypto", value: 1 }],
  });
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  for (const p of [
    "goal.label",
    "goal.targetAmount",
    "goal.horizonYears",
    "monthlyContribution",
    "maxAcceptableLossPct",
    "statedRisk",
    "plannedWithdrawals[0].amount",
    "holdings[0].assetClass",
  ])
    assert.ok(paths.includes(p), `expected error at ${p}, got ${paths.join(", ")}`);
  assert.equal(validateIntake("nope").ok, false);
  assert.equal(validateIntake({}).ok, true, "absent fields are allowed (they become missing facts)");
});

test("parseExtraction accepts valid shapes and rejects malformed ones", () => {
  assert.deepEqual(parseExtraction({ targetAmount: 90000, horizonYears: 7 }), { ok: true, value: { targetAmount: 90000, horizonYears: 7 } });
  assert.equal(parseExtraction('{"targetAmount": 5}').ok, true);
  assert.equal(parseExtraction("{not json").ok, false);
  assert.equal(parseExtraction([1, 2]).ok, false);
  assert.equal(parseExtraction({ targetAmount: "90000" }).ok, false);
  assert.equal(parseExtraction({ horizonYears: 6.5 }).ok, false);
  assert.equal(parseExtraction({ targetAmount: -1 }).ok, false);
  assert.equal(parseExtraction({ mentionsEmergencyFund: "yes" }).ok, false);
});

test("parseExplanation validates text and cited numbers", () => {
  assert.equal(parseExplanation({ text: "ok", citedNumbers: [1, 2] }).ok, true);
  assert.equal(parseExplanation({ text: "", citedNumbers: [] }).ok, false);
  assert.equal(parseExplanation({ text: "x", citedNumbers: ["1"] }).ok, false);
  assert.equal(parseExplanation(null).ok, false);
});

test("rule-based extraction and literal-number check", () => {
  const text = "I want 90,000 lei in 7 years, saving 700 lei per month. Emergency fund is small.";
  assert.deepEqual(extractWithRules(text), { targetAmount: 90000, monthlyContribution: 700, horizonYears: 7, mentionsEmergencyFund: true });
  assert.equal(numberAppearsIn(text, 90000), true);
  assert.equal(numberAppearsIn(text, 9000), false);
  assert.equal(numberAppearsIn(text, 120000), false);
  assert.deepEqual(extractWithRules("about 90k lei"), {}, "shorthand is not guessed");
});

test("validateAssumptions rejects malformed market data", () => {
  assert.equal(validateAssumptions(syntheticAssumptions()).ok, true);
  assert.equal(validateAssumptions({ asOf: "yesterday" }).ok, false);
  assert.equal(validateAssumptions({ ...syntheticAssumptions(), units: "percent" }).ok, false);
  assert.equal(validateAssumptions({ ...syntheticAssumptions(), sourceLabel: "" }).ok, false);
});
