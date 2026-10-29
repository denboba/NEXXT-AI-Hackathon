// The committed evidence files in docs/evidence are generated output. These
// tests regenerate them in memory (the scripts' --check mode) and fail when
// the committed content differs, so the evidence can never drift from the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const node = (...args: string[]) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60_000 });

test("docs/evidence/demo-ana.md matches freshly generated demo output", () => {
  const r = node("scripts/run-demo.mjs", "--replay", "monthlyContribution=900", "--check", "docs/evidence/demo-ana.md");
  assert.equal(r.status, 0, `${r.stdout.slice(-400)}\n${r.stderr}`);
  assert.match(r.stdout, /matches freshly generated output/);
  // The demo shows the revision, the guardrail result and the seeded range.
  assert.match(r.stdout, /## Strategy v1 vs v2/);
  assert.match(r.stdout, /16 of 16 checks pass/);
  assert.match(r.stdout, /Seeded outcome range p10 \/ p50 \/ p90/);
});

test("demo output never contains free text or user-entered labels", () => {
  const r = node("scripts/run-demo.mjs");
  assert.equal(r.status, 0, r.stderr);
  for (const s of ["Apartment down payment", "Wedding", "Employer shares", "I want to save"]) assert.ok(!r.stdout.includes(s), `found '${s}'`);
});

test("demo rejects unsupported replay keys", () => {
  const r = node("scripts/run-demo.mjs", "--replay", "freeText=1");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unsupported replay key/);
});

test("docs/evidence/eval-report.md matches a fresh evaluation run", () => {
  const r = node("scripts/run-eval.mjs", "--check", "docs/evidence/eval-report.md");
  assert.equal(r.status, 0, `${r.stdout.slice(-800)}\n${r.stderr}`);
  assert.match(r.stdout, /run-eval --check: docs\/evidence\/eval-report\.md matches freshly generated output/);
});
