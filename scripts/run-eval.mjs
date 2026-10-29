#!/usr/bin/env node
// Deterministic evaluation suite: runs every scenario in src/eval/scenarios.ts
// through the real orchestrator (Node native TypeScript type stripping) and
// reports pass/fail from machine-checked assertions.
//
// Usage: npm run eval [-- --json] [-- --only id1,id2] [-- --verbose]
//   --json      also write eval-report.json (git-ignored)
//   --only      run only the listed scenario ids (others reported as skipped)
//   --verbose   print every assertion, not only failures
// Exit code: 0 when every selected scenario passes, 1 otherwise.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = args.includes("--json");
const verbose = args.includes("--verbose");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 && args[onlyIndex + 1] ? args[onlyIndex + 1].split(",").map((s) => s.trim()).filter(Boolean) : undefined;

const { runAll } = await import(new URL("../src/eval/runner.ts", import.meta.url).href);

const pad = (s, n) => (String(s).length >= n ? String(s).slice(0, n) : String(s) + " ".repeat(n - String(s).length));
const columns = [
  ["scenario", 24],
  ["result", 7],
  ["terminal", 26],
  ["assertions", 11],
  ["revisions", 10],
  ["model calls", 12],
  ["ms", 6],
];
console.log(columns.map(([h, w]) => pad(h, w)).join(" "));
console.log(columns.map(([, w]) => "-".repeat(w)).join(" "));

const report = await runAll({
  only,
  onResult: (r) => {
    const passedCount = r.assertions.filter((a) => a.pass).length;
    const row = [
      r.scenarioId,
      r.skipped ? "SKIP" : r.passed ? "PASS" : "FAIL",
      r.run ? r.run.status + (r.followUpRun ? ` -> ${r.followUpRun.status}` : "") : r.skipped ? "-" : "error",
      r.skipped ? "-" : `${passedCount}/${r.assertions.length}`,
      r.run ? r.run.revisions : "-",
      r.run ? r.run.modelCalls + (r.followUpRun ? `+${r.followUpRun.modelCalls}` : "") : "-",
      r.skipped ? "-" : r.durationMs,
    ];
    console.log(row.map((v, i) => pad(v, columns[i][1])).join(" "));
    for (const a of r.assertions)
      if (!a.pass || verbose) console.log(`    ${a.pass ? "ok  " : "FAIL"} ${a.id}: ${a.description}\n         ${a.detail}`);
  },
});

console.log("");
console.log(
  `Scenarios: ${report.total} total, ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.durationMs} ms). ` +
    `Assertions: ${report.results.reduce((s, r) => s + r.assertions.filter((a) => a.pass).length, 0)}/${report.results.reduce((s, r) => s + r.assertions.length, 0)} passed.`,
);
if (report.failed) {
  console.log("\nFailing assertions:");
  for (const r of report.results)
    for (const a of r.assertions) if (!a.pass) console.log(`  [${r.scenarioId}] ${a.id}: ${a.detail}`);
}

if (json) {
  const out = {
    generatedBy: "scripts/run-eval.mjs",
    note: "Synthetic scenarios; pass/fail derived from executed assertions against orchestrator output.",
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    durationMs: report.durationMs,
    results: report.results.map((r) => ({
      scenarioId: r.scenarioId,
      title: r.title,
      category: r.category,
      passed: r.passed,
      skipped: r.skipped,
      error: r.error,
      durationMs: r.durationMs,
      terminalStatus: r.run?.status,
      followUpTerminalStatus: r.followUpRun?.status,
      revisions: r.run?.revisions,
      modelCalls: r.run?.modelCalls,
      providers: r.providers,
      stageSummary: r.stageSummary,
      followUpStageSummary: r.followUpStageSummary,
      assertions: r.assertions,
    })),
  };
  const file = resolve(root, "eval-report.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${file}`);
}

process.exitCode = report.failed > 0 ? 1 : 0;
