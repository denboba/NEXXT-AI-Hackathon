#!/usr/bin/env node
// No-install CLI demo of the Decision Lab: runs the synthetic demo customer
// Ana (src/domain/demoProfile.ts) through the real orchestrator with the fixed
// evaluation clock, the deterministic reasoning provider and the synthetic
// market assumptions, and prints the journey as Markdown (readable in a
// terminal): stage timeline, tool calls, challenger findings, v1 vs v2
// strategy, guardrail checks, levers and next step.
//
// Usage: npm run demo [-- --replay key=value[,key=value]] [-- --markdown <path>] [-- --check <path>]
//   --replay    counterfactual rerun with changed input, showing reuse/recompute per stage.
//               Keys: monthlyContribution, initialCapital, emergencyFund,
//               monthlyEssentialExpenses, maxAcceptableLossPct, targetAmount, horizonYears.
//   --markdown  also write the output to <path> (used for docs/evidence/demo-ana.md)
//   --check     regenerate in memory and compare with <path> (ignoring the Node
//               version line); exit 1 on any difference
// Output is deterministic: no wall-clock times, durations or random ids.
// No free text, names or user-entered labels are printed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = (message) => {
  console.error(`run-demo: ${message}`);
  console.error("Usage: npm run demo [-- --replay key=value[,key=value]] [-- --markdown <path>] [-- --check <path>]");
  process.exit(2);
};

const { runWorkflow, rerunWorkflow } = await import(src("orchestrator/engine.ts"));
const { DEFAULT_LIMITS } = await import(src("orchestrator/context.ts"));
const { STAGE_TITLES, toolCalls } = await import(src("orchestrator/view.ts"));
const { demoProfile, DEMO_PROFILE_NAME } = await import(src("domain/demoProfile.ts"));
const { EVAL_NOW, evalClock } = await import(src("eval/runner.ts"));
const { deterministicProvider } = await import(src("providers/llm.ts"));
const { SYNTHETIC_LABEL, syntheticFixtureProvider } = await import(src("providers/marketData.ts"));
const { SIMULATION_PATHS, SIMULATION_SEED } = await import(src("domain/simulation.ts"));

// ---- arguments -------------------------------------------------------------
const NUMERIC_KEYS = ["monthlyContribution", "initialCapital", "emergencyFund", "monthlyEssentialExpenses", "maxAcceptableLossPct"];
const GOAL_KEYS = ["targetAmount", "horizonYears"];
const replayRaw = valueOf("--replay");
if (args.includes("--replay") && !replayRaw) usage("--replay needs key=value");
let replayPatch;
if (replayRaw) {
  replayPatch = {};
  for (const pair of replayRaw.split(",")) {
    const [key, raw] = pair.split("=");
    const value = Number(raw);
    if (![...NUMERIC_KEYS, ...GOAL_KEYS].includes(key)) usage(`unsupported replay key '${key}'`);
    if (raw === undefined || raw.trim() === "" || !Number.isFinite(value)) usage(`replay value for '${key}' must be a number`);
    if (GOAL_KEYS.includes(key)) replayPatch.goal = { ...demoProfile.goal, ...replayPatch.goal, [key]: value };
    else replayPatch[key] = value;
  }
}
const markdownPath = valueOf("--markdown");
const checkPath = valueOf("--check");
if (args.includes("--markdown") && !markdownPath) usage("--markdown needs a path");
if (args.includes("--check") && !checkPath) usage("--check needs a path");
const evidencePath = markdownPath ?? checkPath;
const command = `npm run demo --${replayRaw ? ` --replay ${replayRaw}` : ""}${evidencePath ? ` --markdown ${evidencePath}` : ""}`.replace(/ --$/, "");

// ---- formatting helpers ------------------------------------------------------
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const lei = (n) => `${n < 0 ? "-" : ""}${group(Math.abs(Math.round(n)))} lei`;
const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (headers, rows) => [`| ${headers.map(cell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)];
const kv = (obj) =>
  Object.entries(obj ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
const weightsText = (w) =>
  Object.entries(w)
    .map(([id, share]) => `${id} ${pct(share, 0)}`)
    .join(", ");
const bucketsText = (buckets) =>
  buckets.length ? buckets.map((b) => `${b.purpose} ${lei(b.amountLei)}${b.neededInYears ? ` (year ${b.neededInYears})` : ""}`).join("; ") : "none";
const value = (r, nominal, real) => (r.targetIsReal ? real : nominal);

// ---- run -------------------------------------------------------------------
const ids = (prefix) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const options = () => ({
  reasoning: deterministicProvider(),
  marketData: syntheticFixtureProvider(),
  clock: evalClock,
  idFactory: ids("demo-run"),
  externalProcessingConsent: false,
});
const run = await runWorkflow(demoProfile, options());
const replay = replayPatch ? await rerunWorkflow(run, replayPatch, { ...options(), idFactory: ids("demo-replay") }) : undefined;

const strategies = (state) => state.executions.filter((e) => e.stage === "strategy" && e.output).map((e) => e.output);
const challenges = (state) => state.executions.filter((e) => e.stage === "challenger" && e.output).map((e) => ({ pass: e.pass, report: e.output }));

function timeline(state) {
  return table(
    ["#", "Stage", "Pass", "Execution", "Reason"],
    state.executions.map((e) => [e.seq, `${e.stage} (${STAGE_TITLES[e.stage]})`, e.pass, e.status, e.reason]),
  );
}

function strategyComparison(list) {
  const headers = ["", ...list.map((s) => `v${s.version}`)];
  const row = (label, f) => [label, ...list.map(f)];
  return table(headers, [
    row("Label (from actual equity share)", (s) => s.label),
    row("Equity share", (s) => pct(s.equityShare)),
    row("Building blocks", (s) => weightsText(s.weights)),
    row("Liquidity buckets (cash, outside the invested part)", (s) => bucketsText(s.liquidityBuckets)),
    row("Invested initial capital", (s) => lei(s.investedInitialLei)),
    row("Monthly contribution", (s) => lei(s.monthlyContributionLei)),
    row("Base-case projection (nominal)", (s) => lei(s.projection.nominal)),
    row("Base-case projection (today's money)", (s) => lei(s.projection.real)),
    row("Gap to target", (s) => (s.gapLei > 0 ? lei(s.gapLei) : "none")),
    row("Seeded outcome range p10 / p50 / p90", (s) => {
      const r = s.outcomeRange;
      return `${lei(value(r, r.p10, r.p10Real))} / ${lei(value(r, r.p50, r.p50Real))} / ${lei(value(r, r.p90, r.p90Real))}`;
    }),
    row("Share of seeded paths reaching the target", (s) => pct(s.outcomeRange.reachShare)),
    row("Portfolio volatility (synthetic)", (s) => `${pct(s.outcomeRange.portfolioVolatility)}/yr`),
    row("Candidates considered", (s) => s.candidates.map((c) => `${c.label} ${pct(c.equityShare)}`).join(", ")),
    // First rationale sentence (choiceSentence in src/agents/strategy.ts): engine-generated text, no user input.
    row("Why this mix", (s) => s.rationale.split(" Labels follow the actual equity share")[0]),
    row("Findings addressed / acknowledged", (s) => `${s.addressedFindings.join(", ") || "none"} / ${s.acknowledgedFindings.join(", ") || "none"}`),
  ]);
}

const lines = [];
const out = (...l) => lines.push(...l);
const nodeLine = `- Node version used: ${process.version}`;

out(
  `# Decision Lab demo: ${DEMO_PROFILE_NAME}`,
  "",
  `- Command: \`${command}\``,
  `- Deterministic: fixed clock ${EVAL_NOW.toISOString()}, deterministic reasoning provider (no language model, no network), seeded simulation (seed ${SIMULATION_SEED}, ${group(SIMULATION_PATHS)} paths). Running the command again gives identical output.`,
  `- Synthetic: the customer, the funds and the market assumptions ("${SYNTHETIC_LABEL}") are invented for the demo. This is an educational illustration, not investment advice and not a forecast.`,
  "- Privacy: no free text, names or user-entered labels are printed; liquidity buckets are shown by purpose.",
  nodeLine,
  "",
  "## Input (synthetic scenario fixture)",
  "",
);
const g = demoProfile.goal;
out(
  ...table(
    ["Fact", "Value"],
    [
      ["Goal", `${lei(g.targetAmount)} in ${g.horizonYears} years (${g.flexibility})`],
      ["Initial capital", lei(demoProfile.initialCapital)],
      ["Monthly contribution", lei(demoProfile.monthlyContribution)],
      ["Essential monthly expenses", lei(demoProfile.monthlyEssentialExpenses)],
      ["Emergency fund", lei(demoProfile.emergencyFund)],
      ["Planned withdrawals", demoProfile.plannedWithdrawals.map((w) => `${lei(w.amount)} in year ${w.inYears}`).join("; ")],
      ["Stated risk preference", demoProfile.statedRisk],
      ["Maximum acceptable loss", pct(demoProfile.maxAcceptableLossPct)],
      ["Existing holdings", demoProfile.holdings.map((h) => `${h.assetClass} ${lei(h.value)}`).join("; ")],
    ],
  ),
  "",
  "## Run summary",
  "",
  ...table(
    ["Item", "Value"],
    [
      ["Terminal status", run.status],
      ["Validation status", run.result?.validation?.status ?? "not-run"],
      ["Revisions", `${run.revisions} (limit ${run.limits.maxRevisions})`],
      ["Steps", `${run.steps} (limit ${run.limits.maxSteps})`],
      ["Model calls (deterministic provider)", `${run.modelCalls} (limit ${run.limits.maxModelCalls})`],
      ["Deterministic tool calls", `${run.toolCalls} (limit ${run.limits.maxToolCalls}, default ${DEFAULT_LIMITS.maxToolCalls})`],
      ["Provider fallbacks", run.fallbacks],
      ["Providers", `reasoning ${run.providers.reasoning}, market data ${run.providers.marketData}`],
    ],
  ),
  "",
  "## Stage timeline",
  "",
  ...timeline(run),
  "",
  "Transitions:",
  "",
  ...run.transitions.map((t) => `- ${t.from} -> ${t.to}: ${t.reason}`),
  "",
  "## Tool calls (traced, numbers only)",
  "",
  ...table(
    ["Call", "Stage", "Tool", "Arguments", "Result"],
    toolCalls(run).map((t) => [t.call, t.stage, t.tool, kv(t.args), kv(t.result)]),
  ),
  "",
);

out("## Challenger findings", "");
for (const { pass, report } of challenges(run)) {
  out(
    `### Pass ${pass}: challenge of ${report.strategyId}`,
    "",
    `Tests run: ${report.testsRun.join(", ")}.`,
    "",
    ...table(
      ["Finding", "Severity", "Routed to", "Remedy", "Computed evidence", "Message"],
      report.findings.map((f) => [f.id, f.severity, f.routeTo, f.remedy?.kind ?? "-", kv(f.evidence?.computed), f.message]),
    ),
    "",
  );
}

out("## Strategy v1 vs v2", "", ...strategyComparison(strategies(run)), "");
const v = run.result?.validation;
if (v) {
  const passed = v.checks.filter((c) => c.pass).length;
  out(
    "## Guardrail checks",
    "",
    `${passed} of ${v.checks.length} checks pass. Status: ${v.status}.`,
    "",
    ...table(
      ["Check", "Result", "Detail"],
      v.checks.map((c) => [c.id, c.pass ? "pass" : "FAIL", c.detail]),
    ),
    "",
    "Open issues:",
    "",
    ...(v.openIssues.length ? v.openIssues.map((i) => `- ${i}`) : ["- none"]),
    "",
  );
}
const released = run.result?.strategy;
if (released) out("## Levers (target and horizon are never changed silently)", "", ...released.levers.map((l) => `- \`${l.id}\`: ${l.description}`), "");
const next = run.result?.nextStep;
if (next)
  out(
    "## Next step",
    "",
    `- Primary: \`${next.primary}\``,
    `- ${next.message}`,
    `- Adviser recommended: ${next.adviser.recommended ? "yes" : "no"}${next.adviser.reasons.length ? ` (${next.adviser.reasons.join("; ")})` : ""}`,
    "- The adviser briefing is not exported here: export needs the customer's consent in the UI and is a local download only (nothing is booked or sent).",
    "",
  );

if (replay) {
  const rs = replay.result?.strategy;
  out(
    `## Counterfactual replay: ${replayRaw}`,
    "",
    "The rerun starts from the previous executions; a stage is reused when its input fingerprint matches an earlier execution, otherwise it is recomputed.",
    "",
    ...timeline(replay),
    "",
    ...table(
      ["Item", "Original run", "Replay"],
      [
        ["Terminal status", run.status, replay.status],
        ["Validation status", run.result?.validation?.status ?? "not-run", replay.result?.validation?.status ?? "not-run"],
        ["Revisions", run.revisions, replay.revisions],
        ["Model calls", run.modelCalls, replay.modelCalls],
        ["Tool calls", run.toolCalls, replay.toolCalls],
        ["Released strategy", released ? `${released.label} ${pct(released.equityShare)}` : "none", rs ? `${rs.label} ${pct(rs.equityShare)}` : "none"],
        ["Base-case projection (nominal)", released ? lei(released.projection.nominal) : "-", rs ? lei(rs.projection.nominal) : "-"],
        ["Gap to target", released ? (released.gapLei > 0 ? lei(released.gapLei) : "none") : "-", rs ? (rs.gapLei > 0 ? lei(rs.gapLei) : "none") : "-"],
        ["Share of seeded paths reaching the target", released ? pct(released.outcomeRange.reachShare) : "-", rs ? pct(rs.outcomeRange.reachShare) : "-"],
        ["Next step", next?.primary ?? "-", replay.result?.nextStep?.primary ?? "-"],
      ],
    ),
    "",
  );
}

// Defence in depth: user-entered labels and free text must never appear.
const sensitive = [demoProfile.freeText, g.label, ...demoProfile.plannedWithdrawals.map((w) => w.label), ...demoProfile.holdings.map((h) => h.label)].filter(Boolean);
let text = `${lines.join("\n").trimEnd()}\n`;
for (const s of sensitive) text = text.split(s).join("[label omitted]");

process.stdout.write(text);

if (markdownPath) {
  const file = resolve(root, markdownPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`\nWrote ${file}`);
}
if (checkPath) {
  const file = resolve(root, checkPath);
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    console.error(`\nrun-demo --check: cannot read ${file}`);
    process.exit(1);
  }
  const strip = (t) => t.replace(/^- Node version used: .*$/m, "");
  if (strip(existing) !== strip(text)) {
    console.error(`\nrun-demo --check: ${checkPath} differs from freshly generated output. Regenerate with: ${command}`);
    process.exitCode = 1;
  } else console.log(`\nrun-demo --check: ${checkPath} matches freshly generated output.`);
}
if (run.status !== "completed" && !process.exitCode) process.exitCode = 1;
