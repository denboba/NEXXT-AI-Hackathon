import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow, rerunWorkflow } from "../../src/orchestrator/engine.ts";
import type { EngineOptions } from "../../src/orchestrator/engine.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";
import {
  OUTCOME_RANGE_LABEL,
  changedInputFields,
  compareVersions,
  outcomeRangeRows,
  rerunDelta,
  revisionTransitions,
  snapshot,
  solverLevers,
  stageRows,
  stressCaseOf,
  toolCalls,
  toolCallsByStage,
} from "../../src/orchestrator/view.ts";
import { counterIds, fixedClock } from "./helpers.ts";

const opts = (): EngineOptions => ({ clock: fixedClock, idFactory: counterIds(), limits: { providerTimeoutMs: 50 } });

test("view: demo comparison exposes initial vs revised strategy with evidence", async () => {
  const s = await runWorkflow(demoProfile, opts());
  const c = compareVersions(s);
  assert.equal(c.released, true);
  assert.equal(c.initial?.version, 1);
  assert.equal(c.revised?.version, 2);
  assert.equal(c.initial?.label, "Balanced");
  // Labels follow the actual equity share: 25.7% equity is Cautious (< 30%).
  assert.equal(c.revised?.label, "Cautious");
  assert.ok(c.changes.includes("Scenario label changed from Balanced to Cautious."));
  assert.equal(Math.round(c.initial!.projection.nominal), 98521);
  assert.equal(Math.round(c.revised!.projection.nominal), 85565);
  assert.equal(Math.round(c.revised!.gapLei), 4435);
  assert.deepEqual(
    c.objections.map((f) => f.id),
    ["severe-crash-loss", "liquidity-need", "single-stock-concentration"],
  );
  assert.deepEqual(
    c.resolved.map((f) => f.id),
    ["severe-crash-loss", "liquidity-need"],
  );
  assert.deepEqual(
    c.remaining.map((f) => f.id),
    ["single-stock-concentration"],
  );
  assert.equal(stressCaseOf(c.initialChallenge)?.lossPct, 0.215);
  assert.equal(stressCaseOf(c.finalChallenge)?.lossPct, 0.1494);
  assert.ok(c.changes.some((t) => t.includes("Equity share 50.0% -> 25.7%")));
  assert.ok(c.changes.some((t) => t.includes("emergency reserve top-up of 6,000 lei")));
  assert.ok(c.changes.some((t) => t.includes("21.5% -> 14.9%")));
  assert.ok(c.changes.some((t) => t.includes("98,521 lei -> 85,565 lei")));
  assert.ok(c.changes.some((t) => t.includes("Gap to target 0 lei -> 4,435 lei")));
  assert.equal(revisionTransitions(s).length, 1);
  assert.ok(revisionTransitions(s)[0].reason.includes("severe-crash-loss"));
  const rows = stageRows(s);
  assert.equal(rows.find((r) => r.stage === "strategy")?.executions.length, 2);
  assert.ok(rows.every((r) => r.execution === "recomputed"));
});

test("view: counterfactual delta lists reused and recomputed stages", async () => {
  const first = await runWorkflow(demoProfile, opts());
  const second = await rerunWorkflow(first, { monthlyContribution: 900 }, opts());
  const d = rerunDelta(first, second);
  assert.deepEqual(d.changedFields, ["monthlyContribution"]);
  assert.deepEqual(d.reused, ["data", "suitability"]);
  assert.deepEqual(d.recomputed, ["profile", "strategy", "challenger", "guardrail", "nextStep"]);
  assert.equal(Math.round(d.before.projectedLei!), 85565);
  assert.ok(d.after.projectedLei! > d.before.projectedLei!);
  assert.deepEqual(changedInputFields(demoProfile, { ...demoProfile, goal: { ...demoProfile.goal!, horizonYears: 9 } }), ["goal.horizonYears"]);
});

test("view: outcome range rows, solver levers and tool calls per stage", async () => {
  const s = await runWorkflow(demoProfile, opts());
  const strategy = s.result!.strategy!;
  const rows = outcomeRangeRows(strategy.outcomeRange);
  assert.equal(OUTCOME_RANGE_LABEL, "Seeded synthetic simulation, not a forecast");
  assert.deepEqual(rows.map((r) => r.label).slice(0, 4), ["Low case (10th percentile)", "Middle case (median)", "High case (90th percentile)", "Paths reaching the target"]);
  assert.equal(rows[1].value, `${Math.round(strategy.outcomeRange.p50).toLocaleString("en-GB")} lei`);
  assert.equal(rows[3].value, `${(Math.round(strategy.outcomeRange.reachShare * 1000) / 10).toFixed(1)}%`);
  assert.ok(rows.some((r) => r.value.startsWith(`1,000 · ${strategy.outcomeRange.seed}`)));
  const real = outcomeRangeRows({ ...strategy.outcomeRange, targetIsReal: true });
  assert.ok(real[0].value.endsWith("(today's money)"));
  const solver = solverLevers(strategy);
  assert.ok(solver.length > 0 && solver.every((l) => l.reachShare !== undefined));
  const calls = toolCalls(s);
  assert.equal(calls.length, s.toolCalls);
  assert.deepEqual(calls.map((c) => c.call), calls.map((_, i) => i + 1));
  const perStage = toolCallsByStage(s);
  assert.equal(Object.values(perStage).reduce((a, b) => a + b, 0), s.toolCalls);
  assert.equal(perStage.profile, 0);
  assert.ok(perStage.strategy > 0 && perStage.challenger > 0 && perStage.guardrail > 0);
  assert.equal(stageRows(s).find((r) => r.stage === "strategy")?.toolCalls, perStage.strategy);
  const snap = snapshot(s);
  assert.equal(snap.toolCalls, s.toolCalls);
  assert.equal(snap.reachShare, strategy.outcomeRange.reachShare);
});

test("view: a run that needs clarification is not presented as released", async () => {
  const s = await runWorkflow({ ...demoProfile, goal: undefined, freeText: undefined }, opts());
  const c = compareVersions(s);
  assert.equal(s.status, "needs-clarification");
  assert.equal(c.released, false);
  assert.equal(c.initial, undefined);
  assert.ok(stageRows(s).some((r) => r.execution === "not-run"));
});
