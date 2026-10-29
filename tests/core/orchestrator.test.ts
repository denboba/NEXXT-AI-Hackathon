import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow, rerunWorkflow } from "../../src/orchestrator/engine.ts";
import type { EngineOptions, WorkflowState } from "../../src/orchestrator/engine.ts";
import type { Agent } from "../../src/orchestrator/context.ts";
import type { ChallengeReport, Strategy } from "../../src/domain/types.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";
import { httpProvider, replay, replayProvider } from "../../src/providers/llm.ts";
import { failingProvider, slowProvider } from "../../src/providers/marketData.ts";
import { counterIds, fixedClock } from "./helpers.ts";

const opts = (extra: EngineOptions = {}): EngineOptions => ({ clock: fixedClock, idFactory: counterIds(), ...extra, limits: { providerTimeoutMs: 50, ...extra.limits } });
const execStatus = (s: WorkflowState) => s.executions.map((e) => `${e.stage}:${e.status}`);
const strategies = (s: WorkflowState) => s.executions.filter((e) => e.stage === "strategy").map((e) => e.output as Strategy);

test("demo profile: propose -> challenge -> route back -> revise -> validate", async () => {
  const s = await runWorkflow(demoProfile, opts());
  assert.equal(s.status, "completed");
  assert.equal(s.revisions, 1);
  assert.deepEqual(
    s.transitions.map((t) => `${t.from}->${t.to}`),
    [
      "start->profile",
      "profile->data",
      "data->suitability",
      "suitability->strategy",
      "strategy->challenger",
      "challenger->suitability",
      "suitability->strategy",
      "strategy->challenger",
      "challenger->guardrail",
      "guardrail->nextStep",
    ],
  );
  const [first, revised] = strategies(s);
  assert.equal(first.gapLei, 0, "initial proposal meets the target in the base case");
  assert.notDeepEqual(first.weights, revised.weights);
  assert.ok(revised.liquidityBuckets.length > first.liquidityBuckets.length);
  assert.ok(revised.equityShare < first.equityShare);
  assert.ok(revised.gapLei > 0 && revised.levers.some((l) => l.id === "increase-contribution"));
  const firstChallenge = s.executions.find((e) => e.stage === "challenger")!.output as ChallengeReport;
  assert.ok(firstChallenge.findings.some((f) => f.severity === "material" && Object.keys(f.evidence.computed).length > 0));
  assert.ok(s.trace.some((t) => t.event === "conflict" && t.summary.includes("stricter outcome wins")));
  const v = s.result!.validation!;
  assert.equal(v.status, "validated-with-open-issues");
  assert.ok(v.checks.every((c) => c.pass));
  assert.ok(s.result!.strategy, "validated result is released");
  assert.ok(s.result!.unresolved.length > 0, "open issues are described");
  assert.equal(s.result!.nextStep!.primary, "talk-to-adviser");
  assert.ok(s.modelCalls <= s.limits.maxModelCalls);
});

test("missing information skips strategy/challenger and asks targeted questions", async () => {
  const s = await runWorkflow({ goal: { label: "Car", targetAmount: 30000 }, monthlyContribution: 500 }, opts());
  assert.equal(s.status, "needs-clarification");
  for (const id of ["data", "suitability", "strategy", "challenger", "guardrail"] as const) assert.equal(s.stages[id].status, "skipped");
  assert.equal(s.stages.nextStep.status, "fresh");
  assert.deepEqual(s.result!.nextStep!.questions.map((q) => q.field), ["goal.horizonYears", "maxAcceptableLossPct|statedRisk"]);
  assert.equal(s.result!.strategy, undefined);
  assert.ok(s.trace.some((t) => t.event === "skip" && t.stage === "strategy"));
});

test("rerun reuses unaffected stages and recomputes only invalidated ones", async () => {
  const o = opts();
  const first = await runWorkflow(demoProfile, o);
  const second = await rerunWorkflow(first, { monthlyContribution: 750 }, o);
  assert.deepEqual(execStatus(second), [
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
  ]);
  assert.ok(second.trace.some((t) => t.stage === "profile" && t.summary.startsWith("recomputed: input.monthlyContribution changed")));
  assert.ok(second.trace.some((t) => t.stage === "data" && t.summary.startsWith("reused: inputs unchanged")));
  assert.equal(second.previousRunId, first.runId);

  const same = await rerunWorkflow(first, {}, o);
  assert.ok(same.executions.every((e) => e.status === "reused"), execStatus(same).join(" "));
  assert.equal(same.modelCalls, 0, "reused stages make no model calls");
  assert.equal(same.status, "completed");
});

test("revision loop is bounded by maxRevisions", async () => {
  // Each objection asks for a different remedy, so every revision makes progress
  // and only the revision limit can stop the loop.
  let n = 0;
  const stubborn: Agent<unknown> = async (ctx) => ({
    output: {
      strategyId: ctx.challengerInput!.strategyId,
      strategyVersion: ctx.challengerInput!.strategyVersion,
      testsRun: ["stub"],
      findings: [{ id: "always", test: "stub", severity: "blocking", evidence: { inputs: {}, computed: {} }, routeTo: "strategy", remedy: { kind: "top-up-reserve", amountLei: 100 * ++n }, message: "stub objection" }],
      summary: { text: "stub", citedNumbers: [], source: "stub" },
    } satisfies ChallengeReport,
    notes: [],
  });
  const s = await runWorkflow(demoProfile, opts({ agents: { challenger: stubborn } }));
  assert.equal(s.revisions, 2);
  assert.equal(s.executions.filter((e) => e.stage === "challenger").length, 3);
  assert.equal(s.status, "withheld");
  assert.equal(s.result!.strategy, undefined, "nothing released with an unresolved blocking finding");
  assert.ok(s.trace.some((t) => t.summary.includes("revision limit (2) reached")));
});

test("loop detection stops revisions that change nothing", async () => {
  const noop: Agent<unknown> = async (ctx) => ({
    output: {
      strategyId: ctx.challengerInput!.strategyId,
      strategyVersion: ctx.challengerInput!.strategyVersion,
      testsRun: ["stub"],
      findings: [{ id: "noop", test: "stub", severity: "material", evidence: { inputs: {}, computed: {} }, routeTo: "strategy", remedy: { kind: "recompute-projection" }, message: "stub" }],
      summary: { text: "stub", citedNumbers: [], source: "stub" },
    } satisfies ChallengeReport,
    notes: [],
  });
  const s = await runWorkflow(demoProfile, opts({ agents: { challenger: noop } }));
  assert.equal(s.revisions, 1);
  assert.ok(s.trace.some((t) => t.summary.startsWith("loop detected")));
  assert.ok(s.steps <= s.limits.maxSteps);
});

test("step limit terminates fail-safe", async () => {
  const s = await runWorkflow(demoProfile, opts({ limits: { maxSteps: 4 } }));
  assert.equal(s.status, "failed");
  assert.ok(s.result!.unresolved[0].includes("step limit"));
});

test("provider timeout -> retry -> deterministic fallback is recorded", async () => {
  const provider = replayProvider({
    "extract-profile": [replay.hang(), replay.hang()],
    "explain-strategy": [replay.hang(), replay.hang()],
    "explain-objections": () => ({ text: "Replay summary.", citedNumbers: [] }),
  });
  const s = await runWorkflow(demoProfile, opts({ reasoning: provider }));
  assert.equal(s.status, "completed");
  assert.ok(s.trace.some((t) => t.event === "retry" && t.summary.includes("timeout")));
  assert.ok(s.trace.some((t) => t.event === "fallback" && t.summary.startsWith("extract-profile")));
  assert.equal(strategies(s)[0].narrative.source, "deterministic-rules");
  assert.ok(s.fallbacks >= 2);
});

test("malformed output gets bounded recovery and model-call limits hold", async () => {
  const provider = replayProvider({
    "extract-profile": [replay.malformed(), { targetAmount: "ninety" }],
    "explain-strategy": () => replay.malformed("{oops"),
    "explain-objections": () => replay.throwing("boom"),
  });
  const s = await runWorkflow(demoProfile, opts({ reasoning: provider, limits: { maxModelCalls: 5 } }));
  assert.equal(s.status, "completed");
  assert.ok(s.modelCalls <= 5);
  assert.ok(provider.calls.length <= 5);
  assert.ok(s.trace.some((t) => t.event === "retry" && t.summary.includes("malformed output")));
  assert.ok(s.trace.some((t) => t.event === "fallback" && t.summary.includes("model-call limit")));
});

test("narrative with prohibited claims is replaced deterministically (conflict recorded)", async () => {
  const provider = replayProvider({
    "extract-profile": () => ({}),
    "explain-strategy": () => ({ text: "This is guaranteed and will earn 12% a year.", citedNumbers: [12] }),
    "explain-objections": () => ({ text: "Summary.", citedNumbers: [] }),
  });
  const s = await runWorkflow(demoProfile, opts({ reasoning: provider }));
  assert.equal(s.status, "completed");
  assert.ok(s.trace.some((t) => t.event === "conflict" && t.summary.startsWith("narrative claims")));
  assert.equal(s.result!.strategy!.narrative.repaired, true);
  assert.ok(!/guarantee/i.test(s.result!.strategy!.narrative.text));
});

test("market data unavailable without fallback fails safely; slow data falls back", async () => {
  const failed = await runWorkflow(demoProfile, opts({ marketData: failingProvider(), fallbackMarketData: null }));
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.result!.unresolved, ["market-data-unavailable"]);
  assert.equal(failed.stages.strategy.status, "skipped");
  const slow = await runWorkflow(demoProfile, opts({ marketData: slowProvider(500) }));
  assert.equal(slow.status, "completed");
  assert.ok(slow.trace.some((t) => t.event === "fallback" && t.stage === "data"));
});

test("external provider is not called without consent", async () => {
  const calls: string[] = [];
  const provider = httpProvider(async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ output: {} }) };
  });
  const s = await runWorkflow(demoProfile, opts({ reasoning: provider }));
  assert.equal(calls.length, 0);
  assert.ok(s.trace.some((t) => t.event === "fallback" && t.summary.includes("no consent for external processing")));
  assert.equal(s.status, "completed");
});

test("server 503 {fallback:'deterministic'} falls back immediately without retries", async () => {
  let calls = 0;
  const provider = httpProvider(async () => {
    calls++;
    return { ok: false, status: 503, json: async () => ({ error: "No model is configured on this server.", fallback: "deterministic" }) };
  });
  const s = await runWorkflow(demoProfile, opts({ reasoning: provider, externalProcessingConsent: true, limits: { maxRetries: 2 } }));
  assert.equal(s.status, "completed");
  assert.equal(s.trace.filter((t) => t.event === "retry").length, 0);
  // one call per model task, no retries
  assert.equal(calls, s.modelCalls);
  assert.ok(s.trace.some((t) => t.event === "fallback" && t.summary.includes("deterministic fallback requested")));

  let generic = 0;
  const flaky = httpProvider(async () => {
    generic++;
    return { ok: false, status: 502, json: async () => ({}) };
  });
  const f = await runWorkflow(demoProfile, opts({ reasoning: flaky, externalProcessingConsent: true, limits: { maxRetries: 2 } }));
  assert.ok(f.trace.some((t) => t.event === "retry"), "generic HTTP errors are still retried");
  assert.ok(generic > calls);
});

test("server 403 (consent rejected) falls back immediately without retries", async () => {
  let calls = 0;
  const provider = httpProvider(async () => {
    calls++;
    return { ok: false, status: 403, json: async () => ({ error: "Consent to external processing is required.", fallback: "deterministic" }) };
  });
  const s = await runWorkflow(demoProfile, opts({ reasoning: provider, externalProcessingConsent: true, limits: { maxRetries: 2 } }));
  assert.equal(s.status, "completed");
  assert.equal(s.trace.filter((t) => t.event === "retry").length, 0);
  assert.equal(calls, s.modelCalls);
  assert.ok(s.trace.some((t) => t.event === "fallback" && t.summary.includes("returned 403")));
});

test("tool layer: calls are counted, traced with numbers only, and identical across runs", async () => {
  const input = { ...demoProfile, customerRequests: ["Please call me at 0700 000 000"] };
  const a = await runWorkflow(input, opts());
  const b = await runWorkflow(input, opts());
  const tools = a.trace.filter((t) => t.event === "tool");
  assert.equal(tools.length, a.toolCalls);
  assert.ok(a.toolCalls > 0 && a.toolCalls <= a.limits.maxToolCalls, `${a.toolCalls}/${a.limits.maxToolCalls}`);
  assert.ok(a.toolCalls <= a.limits.maxToolCalls / 2, "the demo stays well below the default tool budget");
  const byStage = new Set(tools.map((t) => `${t.stage}:${String(t.data?.tool)}`));
  for (const k of ["strategy:project-goal", "strategy:stress-loss", "strategy:simulate-outcomes", "strategy:solve-levers", "challenger:project-goal", "challenger:simulate-outcomes", "guardrail:simulate-outcomes"])
    assert.ok(byStage.has(k), k);
  for (const t of tools) {
    for (const part of ["args", "result"] as const) {
      const values = Object.values((t.data?.[part] ?? {}) as Record<string, unknown>);
      assert.ok(values.length > 0 && values.every((v) => typeof v === "number"), `${t.summary}: ${part} must be numbers only`);
    }
    assert.equal(typeof t.data?.durationMs, "number");
  }
  const text = JSON.stringify(tools);
  for (const secret of [demoProfile.freeText!, "Wedding", "Employer shares", "0700 000 000", "Apartment down payment"]) assert.ok(!text.includes(secret), secret);
  // Byte-identical outcome ranges (and traces) for the same input and seed.
  assert.equal(JSON.stringify(a.result!.strategy!.outcomeRange), JSON.stringify(b.result!.strategy!.outcomeRange));
  assert.deepEqual(a.trace, b.trace);
  assert.equal(a.toolCalls, b.toolCalls);
  // Reused stages make no tool calls.
  const same = await rerunWorkflow(a, {}, opts());
  assert.equal(same.toolCalls, 0);
});

test("tool layer: exceeding maxToolCalls fails the stage explicitly and releases nothing", async () => {
  for (const maxToolCalls of [0, 5, 12]) {
    const s = await runWorkflow(demoProfile, opts({ limits: { maxToolCalls } }));
    assert.equal(s.status, "failed", `maxToolCalls ${maxToolCalls}`);
    assert.deepEqual(s.result!.unresolved, ["tool-budget-exceeded"]);
    assert.equal(s.result!.strategy, undefined);
    assert.notEqual(s.result!.validation?.status, "validated");
    assert.ok(s.toolCalls <= maxToolCalls);
    assert.ok(s.trace.some((t) => t.event === "error" && t.summary.includes(`tool-call limit (${maxToolCalls}) reached`)));
  }
});

test("demo: revised strategy is labelled by its equity share and carries a seeded outcome range", async () => {
  const s = await runWorkflow(demoProfile, opts());
  const [first, revised] = strategies(s);
  assert.equal(first.label, "Balanced");
  assert.ok(Math.abs(revised.equityShare - 0.257) < 1e-9);
  assert.equal(revised.label, "Cautious", "25.7% equity is no longer called Balanced");
  for (const st of [first, revised]) {
    const o = st.outcomeRange;
    assert.ok(o.p10 <= o.p50 && o.p50 <= o.p90);
    assert.ok(o.reachShare >= 0 && o.reachShare <= 1);
    assert.equal(o.paths, 1000);
  }
  assert.ok(revised.outcomeRange.reachShare < first.outcomeRange.reachShare);
  const solver = revised.levers.filter((l) => l.reachShare !== undefined);
  assert.ok(solver.some((l) => l.id === "contribution-for-reach-share" && l.reachShare === 0.75 && /75% across 1,000 seeded synthetic paths/.test(l.description)));
  assert.ok(solver.some((l) => l.id === "horizon-for-reach-share"));
  assert.ok(s.result!.validation!.checks.some((c) => c.id === "simulation-reproducible" && c.pass));
  assert.ok(/1,000 seeded synthetic paths/.test(s.result!.strategy!.narrative.text));
});

test("challenger low-reach finding is acknowledged up front and costs no extra revision", async () => {
  // At 750 lei/month the revised base case reaches 90,000 lei but fewer than half of the seeded paths do.
  const s = await runWorkflow({ ...demoProfile, monthlyContribution: 750 }, opts());
  const strategy = s.result!.strategy!;
  assert.equal(s.status, "completed");
  assert.equal(s.revisions, 1);
  assert.equal(strategy.gapLei, 0);
  assert.ok(strategy.outcomeRange.reachShare < 0.5);
  const finding = s.result!.challenge!.findings.find((f) => f.id === "outcome-range-low-reach");
  assert.equal(finding?.severity, "material");
  assert.equal(finding?.routeTo, "strategy");
  assert.ok(strategy.acknowledgedFindings.includes("outcome-range-low-reach"));
  assert.ok(s.result!.validation!.openIssues.some((i) => i.includes("seeded synthetic paths")));
  assert.equal(s.result!.validation!.status, "validated-with-open-issues");
});

test("trace excludes free text, labels and customer requests", async () => {
  const input = { ...demoProfile, customerRequests: ["Please call me at 0700 000 000"] };
  const s = await runWorkflow(input, opts());
  const text = JSON.stringify(s.trace);
  assert.ok(!text.includes(demoProfile.freeText!));
  assert.ok(!text.includes("apartment down payment in 7 years"));
  assert.ok(!text.includes("Wedding"));
  assert.ok(!text.includes("Employer shares"));
  assert.ok(!text.includes("0700 000 000"));
  assert.ok(s.trace.every((t, i) => t.seq === i + 1 && typeof t.at === "string"));
});
