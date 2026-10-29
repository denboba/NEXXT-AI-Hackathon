#!/usr/bin/env node
// Deterministic evaluation suite: runs every scenario in src/eval/scenarios.ts
// through the real orchestrator (Node native TypeScript type stripping) and
// reports pass/fail from machine-checked assertions.
//
// Usage: npm run eval [-- --json] [-- --only id1,id2] [-- --verbose] [-- --markdown <path>] [-- --check <path>]
//   --json      also write eval-report.json (git-ignored)
//   --only      run only the listed scenario ids (others reported as skipped)
//   --verbose   print every assertion, not only failures
//   --markdown  also write a deterministic Markdown table (no timings) to <path>
//               (used for docs/evidence/eval-report.md)
//   --check     regenerate that Markdown in memory and compare with <path>
//               (ignoring the Node version line); exit 1 on any difference
// Exit code: 0 when every selected scenario passes (and --check matches), 1 otherwise.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = args.includes("--json");
const verbose = args.includes("--verbose");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 && args[onlyIndex + 1] ? args[onlyIndex + 1].split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const markdownPath = valueOf("--markdown");
const checkPath = valueOf("--check");
for (const [flag, v] of [["--markdown", markdownPath], ["--check", checkPath]])
  if (args.includes(flag) && !v) {
    console.error(`run-eval: ${flag} needs a path`);
    process.exit(2);
  }

const { runAll, EVAL_NOW } = await import(new URL("../src/eval/runner.ts", import.meta.url).href);
const { SIMULATION_SEED } = await import(new URL("../src/domain/simulation.ts", import.meta.url).href);

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

let evidenceMismatch = false;
const evidencePath = markdownPath ?? checkPath;
if (evidencePath) {
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
  const passedAssertions = report.results.reduce((s, r) => s + r.assertions.filter((a) => a.pass).length, 0);
  const totalAssertions = report.results.reduce((s, r) => s + r.assertions.length, 0);
  const command = `npm run eval --${only ? ` --only ${only.join(",")}` : ""} --markdown ${evidencePath}`;
  const headers = ["Scenario", "Category", "What it checks", "Result", "Terminal status", "Assertions", "Revisions", "Model calls", "Tool calls"];
  const lines = [
    "# Evaluation report (synthetic scenarios)",
    "",
    `- Command: \`${command}\``,
    `- Deterministic: every scenario uses the fixed clock ${EVAL_NOW.toISOString()}, synthetic or recorded providers (no network, no language model) and the simulation seed ${SIMULATION_SEED}. Timings are omitted so that regenerating gives identical content.`,
    "- Synthetic: all customers, products and market assumptions are invented test fixtures. Pass/fail comes only from assertions executed against the real orchestrator output.",
    `- Node version used: ${process.version}`,
    "",
    `Scenarios: ${report.total} total, ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped. Assertions: ${passedAssertions}/${totalAssertions} passed (scenario-specific expectations plus global invariants).`,
    "",
    row(headers),
    row(headers.map(() => "---")),
    ...report.results.map((r) =>
      row([
        `\`${r.scenarioId}\``,
        r.category,
        r.title,
        r.skipped ? "SKIP" : r.passed ? "PASS" : "FAIL",
        r.run ? r.run.status + (r.followUpRun ? ` -> ${r.followUpRun.status}` : "") : r.skipped ? "-" : "error",
        r.skipped ? "-" : `${r.assertions.filter((a) => a.pass).length}/${r.assertions.length}`,
        r.run ? r.run.revisions : "-",
        r.run ? r.run.modelCalls + (r.followUpRun ? ` + ${r.followUpRun.modelCalls}` : "") : "-",
        r.run ? r.run.toolCalls + (r.followUpRun ? ` + ${r.followUpRun.toolCalls}` : "") : "-",
      ]),
    ),
    "",
    "Columns with `a + b` show the first run and its follow-up rerun (changed-input scenarios).",
  ];
  const failing = report.results.flatMap((r) => r.assertions.filter((a) => !a.pass).map((a) => `- [${r.scenarioId}] ${a.id}: ${a.detail}`));
  if (failing.length) lines.push("", "## Failing assertions", "", ...failing);
  const text = `${lines.join("\n")}\n`;
  if (markdownPath) {
    const file = resolve(root, markdownPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`\nWrote ${file}`);
  }
  if (checkPath) {
    let existing = "";
    try {
      existing = readFileSync(resolve(root, checkPath), "utf8");
    } catch {
      existing = "";
    }
    const strip = (t) => t.replace(/^- Node version used: .*$/m, "");
    evidenceMismatch = strip(existing) !== strip(text);
    console.log(
      evidenceMismatch
        ? `\nrun-eval --check: ${checkPath} differs from freshly generated output. Regenerate with: ${command}`
        : `\nrun-eval --check: ${checkPath} matches freshly generated output.`,
    );
  }
}

process.exitCode = report.failed > 0 || evidenceMismatch ? 1 : 0;
