import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_ADAPTER_LABEL,
  declineConsent,
  exportHandoff,
  grantConsent,
  initialConsent,
  prepareHandoff,
  requestConsent,
} from "../../src/handoff/consent.ts";
import { runWorkflow } from "../../src/orchestrator/engine.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";
import { counterIds, fixedClock, FIXED_NOW } from "./helpers.ts";

async function demoBriefing() {
  const s = await runWorkflow(demoProfile, { clock: fixedClock, idFactory: counterIds() });
  return s.result!.nextStep!.briefing!;
}

test("consent state machine transitions", () => {
  const c0 = initialConsent();
  assert.equal(c0.status, "not-requested");
  assert.throws(() => grantConsent(c0, ["briefing-content"], FIXED_NOW), /Invalid consent transition/);
  const c1 = requestConsent(c0, FIXED_NOW);
  assert.throws(() => grantConsent(c1, ["contact-name"], FIXED_NOW), /briefing content/);
  const c2 = grantConsent(c1, ["briefing-content"], FIXED_NOW);
  assert.equal(c2.status, "granted");
  assert.equal(c2.updatedAt, FIXED_NOW.toISOString());
  const c3 = declineConsent(c2, FIXED_NOW);
  assert.deepEqual(c3.scope, []);
  assert.equal(c3.history.length, 3);
});

test("export is blocked without consent, allowed after grant, never books", async () => {
  const briefing = await demoBriefing();
  assert.deepEqual(exportHandoff({ briefing, consent: initialConsent() }), { ok: false, reason: "consent-required" });
  const requested = requestConsent(initialConsent(), FIXED_NOW);
  assert.deepEqual(exportHandoff({ briefing, consent: requested }), { ok: false, reason: "consent-required" });
  assert.deepEqual(exportHandoff({ briefing, consent: declineConsent(requested, FIXED_NOW) }), { ok: false, reason: "consent-required" });
  const granted = grantConsent(requested, ["briefing-content"], FIXED_NOW);
  const r = exportHandoff({ briefing, consent: granted });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.booked, false);
    assert.equal(r.adapterLabel, LOCAL_ADAPTER_LABEL);
    assert.ok(r.file.content.includes("No appointment has been booked"));
  }
  const preview = prepareHandoff(briefing, initialConsent());
  assert.equal(preview.canExport, false);
  assert.ok(preview.preview.goal.targetLei === 90000);
});

test("export is blocked when the workflow was withheld or failed", async () => {
  const briefing = await demoBriefing();
  const granted = grantConsent(requestConsent(initialConsent(), FIXED_NOW), ["briefing-content"], FIXED_NOW);
  assert.deepEqual(exportHandoff({ briefing, consent: granted, workflowStatus: "withheld" }), { ok: false, reason: "validation-blocked" });
  assert.deepEqual(exportHandoff({ briefing: { ...briefing, validationStatus: "withheld" }, consent: granted }), { ok: false, reason: "validation-blocked" });
  assert.deepEqual(exportHandoff({ briefing, consent: granted, workflowStatus: "failed" }), { ok: false, reason: "validation-blocked" });
});

test("briefing excludes the name unless the contact-name scope is granted", async () => {
  const briefing = await demoBriefing();
  const contentOnly = grantConsent(requestConsent(initialConsent(), FIXED_NOW), ["briefing-content"], FIXED_NOW);
  const withName = grantConsent(requestConsent(initialConsent(), FIXED_NOW), ["briefing-content", "contact-name"], FIXED_NOW);
  const a = exportHandoff({ briefing, consent: contentOnly, contactName: "Ana" });
  const b = exportHandoff({ briefing, consent: withName, contactName: "Ana" });
  assert.ok(a.ok && !a.file.content.includes("Ana\""));
  assert.ok(b.ok && JSON.parse(b.file.content).briefing.contactName === "Ana");
  assert.equal(prepareHandoff(briefing, contentOnly, { contactName: "Ana" }).preview.contactName, undefined);
  const raw = JSON.stringify(briefing);
  assert.ok(!raw.includes(demoProfile.freeText!), "briefing has no free text");
});
