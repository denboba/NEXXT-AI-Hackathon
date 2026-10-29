import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow, rerunWorkflow } from "../../src/orchestrator/engine.ts";
import type { EngineOptions } from "../../src/orchestrator/engine.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";
import { changedInputFields, compareVersions, rerunDelta, revisionTransitions, stageRows, stressCaseOf } from "../../src/orchestrator/view.ts";
import { counterIds, fixedClock } from "./helpers.ts";

const opts = (): EngineOptions => ({ clock: fixedClock, idFactory: counterIds(), limits: { providerTimeoutMs: 50 } });

test("view: demo comparison exposes initial vs revised strategy with evidence", async () => {
  const s = await runWorkflow(demoProfile, opts());
  const c = compareVersions(s);
  assert.equal(c.released, true);
  assert.equal(c.initial?.version, 1);
  assert.equal(c.revised?.version, 2);
  assert.equal(c.initial?.label, "Balanced");
  assert.equal(c.revised?.label, "Balanced");
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

test("view: a run that needs clarification is not presented as released", async () => {
  const s = await runWorkflow({ ...demoProfile, goal: undefined, freeText: undefined }, opts());
  const c = compareVersions(s);
  assert.equal(s.status, "needs-clarification");
  assert.equal(c.released, false);
  assert.equal(c.initial, undefined);
  assert.ok(stageRows(s).some((r) => r.execution === "not-run"));
});
