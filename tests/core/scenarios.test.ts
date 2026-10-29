import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, normalProfile, scenarioById } from "../../src/eval/scenarios.ts";
import type { Scenario } from "../../src/eval/scenarios.ts";
import { comparableResult, replayScenario, runAll, runScenario } from "../../src/eval/runner.ts";
import { assertion, evaluate, independentFutureValue, noValidatedWhenMandatoryCheckFails } from "../../src/eval/assertions.ts";
import { classifyRequests } from "../../src/agents/profile.ts";
import { dataAgent } from "../../src/agents/data.ts";
import { runWorkflow } from "../../src/orchestrator/engine.ts";
import type { WorkflowState } from "../../src/orchestrator/engine.ts";
import { projectGoal } from "../../src/domain/calculations.ts";
import { syntheticAssumptions } from "../../src/providers/marketData.ts";
import type { MarketDataProvider } from "../../src/providers/marketData.ts";
import { replayProvider } from "../../src/providers/llm.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";
import { counterIds, fixedClock, makeContext } from "./helpers.ts";

const failures = (r: Awaited<ReturnType<typeof runScenario>>) =>
  r.assertions.filter((a) => !a.pass).map((a) => `[${a.id}] ${a.detail}`).join("\n");

test("catalogue covers the required cases with unique ids", () => {
  assert.ok(SCENARIOS.length >= 12, `${SCENARIOS.length} scenarios`);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  for (const id of [
    "normal-journey",
    "missing-information",
    "constraint-mismatch",
    "challenger-rejection",
    "changed-assumptions",
    "stale-market-data",
    "missing-market-data",
    "provider-malformed",
    "provider-timeout",
    "conflicting-conclusions",
    "safety-boundary",
    "privacy-consent",
    "concentration-risk",
    "loop-limit",
  ])
    assert.ok(scenarioById(id), `missing scenario ${id}`);
  assert.ok(SCENARIOS.every((s) => s.synthetic === true && s.assertions.length > 0));
});

for (const scenario of SCENARIOS)
  test(`scenario ${scenario.id}: ${scenario.title}`, async () => {
    const r = await runScenario(scenario);
    assert.equal(r.error, undefined, r.error);
    assert.ok(r.assertions.length > 0);
    assert.ok(r.passed, `failing assertions:\n${failures(r)}`);
    for (const a of r.assertions) assert.ok(a.pass, `${a.id}: ${a.detail}`);
  });

test("determinism: every scenario produces identical traces and results on a second run", async () => {
  for (const scenario of SCENARIOS) {
    const a = await runScenario(scenario);
    const b = await runScenario(scenario);
    assert.deepEqual(b.run?.trace, a.run?.trace, `trace differs for ${scenario.id}`);
    assert.deepEqual(b.followUpRun?.trace, a.followUpRun?.trace, `follow-up trace differs for ${scenario.id}`);
    assert.deepEqual(comparableResult(b), comparableResult(a), `result differs for ${scenario.id}`);
  }
});

test("scenario 5: exact reused vs recomputed executions after the contribution change", async () => {
  const r = await runScenario(scenarioById("changed-assumptions")!);
  assert.deepEqual(
    r.followUpRun!.executions.map((e) => `${e.stage}:${e.status}`),
    [
      "profile:fresh",
      "data:reused",
      "suitability:reused",
      "strategy:fresh",
      "challenger:fresh",
      "suitability:reused",
      "strategy:fresh",
      "challenger:fresh",
      "guardrail:fresh",
      "nextStep:fresh",
    ],
  );
  assert.deepEqual(
    r.followUpStageSummary!.map((s) => `${s.stage}:${s.reusedOrRecomputed}`),
    ["profile:recomputed", "data:reused", "suitability:reused", "strategy:recomputed", "challenger:recomputed", "guardrail:recomputed", "nextStep:recomputed"],
  );
});

test("scenario 7b: timeout recovery is bounded and fast", async () => {
  const started = Date.now();
  const r = await runScenario(scenarioById("provider-timeout")!);
  assert.ok(Date.now() - started < 2000);
  assert.ok(r.run!.trace.some((t) => t.event === "retry" && t.summary.includes("timeout")));
  assert.ok(r.run!.modelCalls <= r.run!.limits.maxModelCalls);
});

test("replayScenario applies an input patch as a follow-up run", async () => {
  const r = await replayScenario(scenarioById("normal-journey")!, { monthlyContribution: 400 });
  assert.ok(r.followUpRun);
  assert.equal(r.followUpRun!.input.monthlyContribution, 400);
  assert.equal(r.followUpStageSummary!.find((s) => s.stage === "data")!.reusedOrRecomputed, "reused");
  assert.equal(r.followUpStageSummary!.find((s) => s.stage === "strategy")!.reusedOrRecomputed, "recomputed");
});

test("runAll reports skipped scenarios and counts", async () => {
  const report = await runAll({ only: ["normal-journey"] });
  assert.equal(report.total, SCENARIOS.length);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.skipped, SCENARIOS.length - 1);
});

test("a broken expectation is reported as a failure with an actionable detail", async () => {
  const base = scenarioById("normal-journey")!;
  const broken: Scenario = { ...base, expected: { ...base.expected, terminalStatus: "withheld" } };
  const r = await runScenario(broken);
  assert.equal(r.passed, false);
  const a = r.assertions.find((x) => x.id === "expected.terminal-status")!;
  assert.equal(a.pass, false);
  assert.match(a.detail, /status completed/);
});

test("a throwing assertion counts as a failure, never as a pass", async () => {
  const thrower = assertion("throws", "throws", () => {
    throw new Error("boom");
  });
  const r = evaluate(thrower, {} as WorkflowState, { durationMs: 0, probes: { externalCalls: 0, replayCalls: [] }, now: new Date(0) });
  assert.equal(r.pass, false);
  assert.match(r.detail, /boom/);
});

test("per-scenario timeout guard stops a stalled run", async () => {
  const stalled: Scenario = {
    ...scenarioById("normal-journey")!,
    id: "stalled",
    agents: () => ({ guardrail: () => new Promise(() => {}) }),
    options: { timeoutMs: 100 },
  };
  const r = await runScenario(stalled);
  assert.equal(r.passed, false);
  assert.equal(r.assertions[0].id, "runner.timeout");
});

test("invariant: a failed hard check with a released strategy is detected", async () => {
  const s = await runWorkflow(demoProfile, { clock: fixedClock, idFactory: counterIds() });
  const tampered = structuredClone(s);
  tampered.result!.validation!.checks[0] = { ...tampered.result!.validation!.checks[0], pass: false };
  const r = evaluate(noValidatedWhenMandatoryCheckFails, tampered, { durationMs: 0, probes: { externalCalls: 0, replayCalls: [] }, now: new Date(0) });
  assert.equal(r.pass, false);
});

test("independent closed form agrees with the simulation within 0.01 lei", () => {
  const a = syntheticAssumptions();
  const expected = independentFutureValue({ weights: { balanced: 1 }, assumptions: a, initial: 20000, monthly: 300, years: 10, withdrawals: [{ amount: 5000, inYears: 6 }] });
  const sim = projectGoal({ initial: 20000, monthly: 300, years: 10, grossReturn: 0.5 * 0.09 + 0.5 * 0.03, fee: 0.009, inflation: a.inflation, withdrawals: [{ amount: 5000, inYears: 6 }] });
  assert.ok(Math.abs(expected - sim.nominal) <= 0.01, `${expected} vs ${sim.nominal}`);
});

// ---------- Regression tests for defects found while building the scenarios ----------

// Defect 1 (scenario 'safety-boundary'): "Buy Tesla stock for me" was not
// flagged as a specific-security request because only tickers (TSLA stock)
// and "shares of X" were matched.
test("regression: named-company buy requests are flagged as specific-security", () => {
  assert.deepEqual(classifyRequests(["Buy Tesla stock for me"]).sort(), ["specific-security", "trade-execution"]);
  assert.ok(classifyRequests(["Can you purchase some Apple shares?"]).includes("specific-security"));
  assert.deepEqual(classifyRequests(["I want a balanced plan"]), []);
});

// Defect 2 (scenario 'spoofed-live-data'): a payload claiming kind 'live' was
// accepted as fresh live data although no live provider exists.
test("regression: a payload claiming live data is rejected", async () => {
  const spoof: MarketDataProvider = { id: "spoof", kind: "cached", getAssumptions: async () => ({ ...syntheticAssumptions("2026-02-20"), kind: "live", sourceLabel: "Live feed" }) };
  const r = await dataAgent(makeContext(normalProfile, { marketData: spoof }));
  assert.equal(r.output.assumptions.kind, "synthetic-fixture");
  assert.ok(r.output.flags.includes("fallback-applied"));
  assert.ok(r.notes.some((n) => n.event === "error" && n.summary.includes("claims live")));
  const mismatch: MarketDataProvider = { id: "mismatch", kind: "cached", getAssumptions: async () => syntheticAssumptions() };
  const m = await dataAgent(makeContext(normalProfile, { marketData: mismatch }));
  assert.ok(m.output.flags.includes("fallback-applied"), "payload kind must match the provider's declared kind");
});

// Defect 3 (scenario 'conflicting-conclusions'): a prohibited claim in the
// challenger's model-written summary withheld the whole plan because only the
// strategy narrative was repaired; the summary is now rebuilt from findings.
test("regression: prohibited claims in the challenger summary are repaired, not fatal", async () => {
  const provider = replayProvider({
    "extract-profile": () => ({}),
    "explain-strategy": () => ({ text: "Illustrative only.", citedNumbers: [] }),
    "explain-objections": () => ({ text: "Risk-free and guaranteed.", citedNumbers: [] }),
  });
  const s = await runWorkflow(demoProfile, { clock: fixedClock, idFactory: counterIds(), reasoning: provider });
  assert.equal(s.status, "completed");
  assert.equal(s.result!.challenge!.summary.repaired, true);
  assert.ok(!/guarantee|risk-free/i.test(s.result!.challenge!.summary.text));
  assert.ok(s.trace.some((t) => t.event === "conflict" && t.summary.startsWith("challenger summary contained prohibited claims")));
});

// Defect 4 (scenario 'missing-market-data'): retry and error notes of a stage
// that failed with a StageError were dropped from the trace.
test("regression: notes of a failed stage are kept in the trace", async () => {
  const r = await runScenario(scenarioById("missing-market-data")!);
  const dataEvents = r.run!.trace.filter((t) => t.stage === "data").map((t) => t.event);
  assert.ok(dataEvents.includes("retry"));
  assert.ok(dataEvents.includes("error"));
});
