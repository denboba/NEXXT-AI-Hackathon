import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, FlaskConical, LoaderCircle, Play, RotateCcw, Terminal } from "lucide-react";
import { Button } from "./components/ui/button";
import { PageIntro } from "./components/Layout";
import { Chip, StageTimeline, StrategyComparison, TraceViewer, pct1 } from "./components/decision/WorkflowViews";
import { track } from "./lib/analytics";
import { SCENARIOS } from "./eval/scenarios.ts";
import type { Scenario } from "./eval/scenarios.ts";
import { describeMarketData, describeReasoning, replayScenario, runAll, runScenario } from "./eval/runner.ts";
import type { ScenarioResult, StageSummaryRow } from "./eval/runner.ts";
import type { IntakeInput } from "./domain/types.ts";
import { STAGE_TITLES, rerunDelta } from "./orchestrator/view.ts";
import type { WorkflowState } from "./orchestrator/engine.ts";

const OUTCOME: Record<StageSummaryRow["reusedOrRecomputed"], string> = {
  recomputed: "Recomputed",
  reused: "Preserved (reused)",
  mixed: "Preserved + recomputed",
  failed: "Rejected (failed)",
  "not-run": "Not run",
};

function StageSummaryTable({ rows, caption }: { rows: StageSummaryRow[]; caption: string }) {
  if (!rows.length) return null;
  return (
    <table className="lab-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Stage</th>
          <th scope="col">Final status</th>
          <th scope="col">Outputs</th>
          <th scope="col">Executions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.stage}>
            <th scope="row">{STAGE_TITLES[r.stage]}</th>
            <td>{r.status}</td>
            <td>{r.status === "skipped" && r.executions === 0 ? "Skipped" : OUTCOME[r.reusedOrRecomputed]}</td>
            <td>{r.executions}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Trace entries where an output was rejected, replaced or failed. */
function rejectedOutputs(run: WorkflowState) {
  return run.trace.filter(
    (t) => t.event === "fallback" || t.event === "conflict" || t.event === "error" || (t.event !== "reuse" && /reject|invalid|stale|malformed/i.test(t.summary)),
  );
}

function AssertionList({ result }: { result: ScenarioResult }) {
  const failed = result.assertions.filter((a) => !a.pass).length;
  return (
    <div>
      <p>
        <Chip tone={result.passed ? "good" : "bad"}>{result.passed ? "Pass" : "Fail"}</Chip> {result.assertions.length - failed} of{" "}
        {result.assertions.length} assertions passed{failed ? `, ${failed} failed` : ""} · {Math.round(result.durationMs)} ms
      </p>
      {result.error && <p className="lab-error">Runner error: {result.error}</p>}
      <ul className="lab-checks">
        {[...result.assertions]
          .sort((a, b) => Number(a.pass) - Number(b.pass))
          .map((a) => (
            <li key={a.id} className={a.pass ? "lab-check-pass" : "lab-check-fail"}>
              <span className="lab-check-mark">{a.pass ? "Pass" : "Fail"}</span>
              <span>
                <strong>{a.id}</strong>: {a.description}. <span className="lab-muted">{a.detail}</span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function ResultDetail({ scenario, result, followUpLabel }: { scenario: Scenario; result: ScenarioResult; followUpLabel?: string }) {
  const run = result.run;
  const rejected = run ? rejectedOutputs(run) : [];
  return (
    <div className="lab-result">
      <AssertionList result={result} />
      <StageSummaryTable rows={result.stageSummary} caption="First run: which outputs were preserved, recomputed, rejected or skipped" />
      {result.followUpStageSummary && (
        <StageSummaryTable
          rows={result.followUpStageSummary}
          caption={`Follow-up run (${followUpLabel ?? scenario.followUp?.description ?? "modified input"})`}
        />
      )}
      {rejected.length > 0 && (
        <div className="lab-notes-block">
          <span className="lab-kicker">Rejected, replaced or failed outputs (from the trace)</span>
          <ul className="lab-notes">
            {rejected.map((t) => (
              <li key={t.seq}>
                #{t.seq} {t.stage} · {t.event}: {t.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
      {run && (
        <>
          <details className="lab-details">
            <summary>Stage-by-stage execution and transitions</summary>
            <StageTimeline state={run} />
            {result.followUpRun && (
              <>
                <h4>Follow-up run</h4>
                <StageTimeline state={result.followUpRun} />
              </>
            )}
          </details>
          {run.revisions > 0 && (
            <details className="lab-details">
              <summary>Initial vs revised strategy assessment</summary>
              <StrategyComparison state={run} />
            </details>
          )}
          <TraceViewer trace={run.trace} label="First-run trace" />
          {result.followUpRun && <TraceViewer trace={result.followUpRun.trace} label="Follow-up trace" />}
        </>
      )}
    </div>
  );
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

function ReplayControls({ scenario, onDone }: { scenario: Scenario; onDone: (r: ScenarioResult) => void }) {
  const i = scenario.input;
  const [monthly, setMonthly] = useState(i.monthlyContribution === undefined ? "" : String(i.monthlyContribution));
  const [horizon, setHorizon] = useState(i.goal?.horizonYears === undefined ? "" : String(i.goal.horizonYears));
  const [loss, setLoss] = useState(i.maxAcceptableLossPct === undefined ? "" : String(Math.round(i.maxAcceptableLossPct * 1000) / 10));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function patch(): Partial<IntakeInput> {
    const p: Partial<IntakeInput> = {};
    const m = num(monthly);
    if (m !== undefined && m !== i.monthlyContribution) p.monthlyContribution = m;
    const h = num(horizon);
    if (h !== undefined && h !== i.goal?.horizonYears) p.goal = { ...(i.goal ?? { label: "Goal" }), horizonYears: h };
    const l = num(loss);
    if (l !== undefined && l / 100 !== i.maxAcceptableLossPct) p.maxAcceptableLossPct = l / 100;
    return p;
  }
  async function go() {
    const p = patch();
    if (!Object.keys(p).length) {
      setMessage("Change at least one input first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      onDone(await replayScenario(scenario, p));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="lab-form lab-cf-form"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label className="lab-field">
        <span>Monthly contribution (lei)</span>
        <input type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} />
      </label>
      <label className="lab-field">
        <span>Horizon (years)</span>
        <input type="number" min={1} max={40} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
      </label>
      <label className="lab-field">
        <span>Loss tolerance (%)</span>
        <input type="number" min={1} max={60} value={loss} onChange={(e) => setLoss(e.target.value)} />
      </label>
      <div className="lab-form-actions lab-field-wide">
        <Button type="submit" variant="secondary" size="small" disabled={busy}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />} Replay with modified input
        </Button>
        {message && <span className="lab-muted">{message}</span>}
      </div>
      <p className="lab-muted lab-field-wide">
        The change is applied as a follow-up run to the scenario’s first run, so you can see which stages are reused. Assertions written
        for the original follow-up may now legitimately fail; that result is real, not a display error.
      </p>
    </form>
  );
}

export default function EvalLab() {
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [replays, setReplays] = useState<Record<string, ScenarioResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const done = SCENARIOS.map((s) => results[s.id]).filter((r): r is ScenarioResult => Boolean(r) && !r.skipped);
  const passed = done.filter((r) => r.passed).length;
  const assertionsTotal = done.reduce((n, r) => n + r.assertions.length, 0);
  const assertionsPassed = done.reduce((n, r) => n + r.assertions.filter((a) => a.pass).length, 0);

  async function runEverything() {
    if (running) return;
    setRunning("all");
    try {
      const report = await runAll({ onResult: (r) => setResults((prev) => ({ ...prev, [r.scenarioId]: r })) });
      track("eval_run", { scenarioCount: report.total, passCount: report.passed });
    } finally {
      setRunning(null);
    }
  }
  async function runOne(s: Scenario) {
    if (running) return;
    setRunning(s.id);
    try {
      const r = await runScenario(s);
      setResults((prev) => ({ ...prev, [s.id]: r }));
      setOpen(s.id);
      track("eval_run", { scenarioCount: 1, passCount: r.passed ? 1 : 0 });
    } finally {
      setRunning(null);
    }
  }

  return (
    <main className="container lab-page eval-page">
      <div className="coach-page-top">
        <Link className="back-link" to="/decision">
          <ChevronLeft size={16} /> Back to the Decision Lab
        </Link>
        <span className="educational-pill">
          <FlaskConical size={13} /> All scenarios are synthetic
        </span>
      </div>
      <PageIntro eyebrow="EVALUATION LAB" title="Run the scenarios. Read the evidence.">
        Each scenario runs the real orchestrator in this browser with a fixed clock and recorded or deterministic providers. Pass or fail is
        computed from the scenario’s assertions at run time; nothing on this page is precomputed or written by a model.
      </PageIntro>

      <section className="lab-panel" aria-labelledby="suite-title">
        <div className="lab-panel-head">
          <h2 id="suite-title">Suite summary</h2>
          <Button onClick={runEverything} disabled={running !== null}>
            {running === "all" ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />} Run all {SCENARIOS.length} scenarios
          </Button>
        </div>
        <p aria-live="polite">
          {done.length === 0
            ? "No scenario has been run in this session yet."
            : `${done.length} of ${SCENARIOS.length} scenarios run: ${passed} passed, ${done.length - passed} failed. ${assertionsPassed} of ${assertionsTotal} assertions passed (${pct1(assertionsTotal ? assertionsPassed / assertionsTotal : 0)}).`}
        </p>
        <p className="lab-cli">
          <Terminal size={15} aria-hidden="true" /> Reproduce outside the browser: <code>npm run eval</code> (add{" "}
          <code>-- --verbose</code> for every assertion, <code>-- --json</code> for eval-report.json).
        </p>
      </section>

      <section className="lab-panel" aria-labelledby="scenarios-title">
        <h2 id="scenarios-title">Scenarios</h2>
        <ul className="lab-scenarios">
          {SCENARIOS.map((s) => {
            const r = results[s.id];
            const replayed = replays[s.id];
            const isOpen = open === s.id;
            return (
              <li key={s.id} className="lab-scenario">
                <div className="lab-scenario-head">
                  <div>
                    <div className="lab-scenario-tags">
                      <Chip tone="info">SYNTHETIC</Chip>
                      <Chip>{s.category}</Chip>
                      {r && !r.skipped && <Chip tone={r.passed ? "good" : "bad"}>{r.passed ? "Pass" : "Fail"}</Chip>}
                      {!r && <Chip>Not run</Chip>}
                    </div>
                    <h3>{s.title}</h3>
                    <p className="lab-muted">
                      {s.id} · reasoning: {describeReasoning(s.providers.reasoning)} · market data: {describeMarketData(s.providers.marketData)}
                      {s.followUp ? ` · follow-up: ${s.followUp.description}` : ""}
                    </p>
                  </div>
                  <div className="lab-actions">
                    <Button size="small" variant="secondary" disabled={running !== null} onClick={() => runOne(s)}>
                      {running === s.id ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} Run
                    </Button>
                    {r && (
                      <button type="button" className="text-button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                        {isOpen ? "Hide details" : "Show details"}
                      </button>
                    )}
                  </div>
                </div>
                {r && isOpen && (
                  <div className="lab-scenario-body">
                    <ResultDetail scenario={s} result={r} />
                    <h4>Replay after modifying a supported input</h4>
                    <ReplayControls
                      scenario={s}
                      onDone={(rr) => {
                        setReplays((prev) => ({ ...prev, [s.id]: rr }));
                        track("eval_run", { scenarioCount: 1, passCount: rr.passed ? 1 : 0 });
                      }}
                    />
                    {replayed && (
                      <div className="lab-replay">
                        <h4>Replay result</h4>
                        {replayed.run && replayed.followUpRun && <ReplaySummary before={replayed.run} after={replayed.followUpRun} />}
                        <ResultDetail scenario={s} result={replayed} followUpLabel="your modified input" />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function ReplaySummary({ before, after }: { before: WorkflowState; after: WorkflowState }) {
  const d = rerunDelta(before, after);
  return (
    <p>
      Changed: <strong>{d.changedFields.join(", ") || "nothing"}</strong>. Recomputed: {d.recomputed.join(", ") || "none"}. Reused:{" "}
      {d.reused.join(", ") || "none"}. Status {before.status} → {after.status}.
    </p>
  );
}
