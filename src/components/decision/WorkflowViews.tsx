// Presentational views of a WorkflowState shared by the Decision Lab and the
// Evaluation Lab. Every value shown here comes from recorded stage outputs;
// statuses are always written out as text, never conveyed by colour alone.
import { ArrowRight, CornerUpLeft } from "lucide-react";
import type { ReactNode } from "react";
import { money } from "../../lib/finance";
import { blockById } from "../../domain/catalogue.ts";
import type { ChallengeReport, Finding, Strategy, ValidationReport } from "../../domain/types.ts";
import type { WorkflowState } from "../../orchestrator/engine.ts";
import type { TraceEntry } from "../../orchestrator/trace.ts";
import { STAGE_TITLES, compareVersions, revisionTransitions, stageRows, stressCaseOf } from "../../orchestrator/view.ts";
import type { StageRow } from "../../orchestrator/view.ts";

export const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
export const lei = (x: number) => `${money(x)} lei`;

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`lab-chip lab-chip-${tone}`}>{children}</span>;
}

const EXECUTION_TEXT: Record<StageRow["execution"], { text: string; tone: Tone }> = {
  recomputed: { text: "Recomputed", tone: "info" },
  reused: { text: "Reused", tone: "neutral" },
  mixed: { text: "Reused + recomputed", tone: "info" },
  failed: { text: "Failed", tone: "bad" },
  "not-run": { text: "Not run", tone: "neutral" },
};

export const statusTone = (status: string): Tone =>
  status === "completed" || status === "validated"
    ? "good"
    : status === "validated-with-open-issues" || status === "needs-clarification"
      ? "warn"
      : status === "withheld" || status === "failed"
        ? "bad"
        : "neutral";

export const STATUS_TEXT: Record<string, string> = {
  completed: "Completed",
  "needs-clarification": "Needs clarification",
  withheld: "Withheld",
  failed: "Failed",
  running: "Running",
  validated: "Validated",
  "validated-with-open-issues": "Validated with open issues",
};

/** Stage-by-stage status with how many passes ran and why. */
export function StageTimeline({ state, caption }: { state: WorkflowState; caption?: string }) {
  const rows = stageRows(state);
  const loops = revisionTransitions(state);
  return (
    <div className="lab-timeline">
      {caption && <p className="lab-caption">{caption}</p>}
      <ol className="lab-stage-list">
        {rows.map((row) => {
          const ex = EXECUTION_TEXT[row.execution];
          return (
            <li key={row.stage} className={`lab-stage lab-stage-${row.execution}`}>
              <div className="lab-stage-head">
                <strong>{row.title}</strong>
                <Chip tone={ex.tone}>{ex.text}</Chip>
                {row.executions.length > 1 && <Chip>{row.executions.length} executions</Chip>}
                {row.status === "skipped" && <Chip>Skipped</Chip>}
              </div>
              {row.executions.length > 0 ? (
                <ul className="lab-stage-passes">
                  {row.executions.map((e, i) => (
                    <li key={i}>
                      Round {e.pass + 1}: {e.status === "fresh" ? "computed" : e.status} · {e.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lab-muted">{row.reason ?? "Not reached in this run."}</p>
              )}
              {row.error && <p className="lab-error">Error: {row.error}</p>}
            </li>
          );
        })}
      </ol>
      {loops.length > 0 && (
        <div className="lab-loopback" role="note">
          {loops.map((t, i) => (
            <p key={i}>
              <CornerUpLeft size={15} aria-hidden="true" /> Routed back from {STAGE_TITLES.challenger} to {STAGE_TITLES[t.to as keyof typeof STAGE_TITLES] ?? t.to} because of findings: {t.reason.replace(/^revision \d+: /, "")}
            </p>
          ))}
        </div>
      )}
      <details className="lab-details">
        <summary>All {state.transitions.length} transitions</summary>
        <ol className="lab-transitions">
          {state.transitions.map((t, i) => (
            <li key={i}>
              {t.from} <ArrowRight size={12} aria-hidden="true" /> {t.to}: {t.reason}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

const blockName = (id: string) => blockById(id)?.name ?? id;

/** One strategy version with its assumptions and the Challenger's severe-crash numbers. */
export function StrategyCard({ title, strategy, challenge, note }: { title: string; strategy: Strategy; challenge?: ChallengeReport; note?: string }) {
  const stress = stressCaseOf(challenge);
  return (
    <article className="lab-strategy">
      <header>
        <span className="lab-kicker">{title}</span>
        <h4>
          {strategy.label} <small>v{strategy.version}</small>
        </h4>
        {note && <p className="lab-muted">{note}</p>}
      </header>
      <dl className="lab-facts">
        <div>
          <dt>Equity share</dt>
          <dd>{pct1(strategy.equityShare)}</dd>
        </div>
        <div>
          <dt>Building blocks (fictional)</dt>
          <dd>
            {Object.entries(strategy.weights).map(([id, w]) => (
              <span key={id} className="lab-line">
                {blockName(id)}: {pct1(w)}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>Cash buckets outside the investment</dt>
          <dd>
            {strategy.liquidityBuckets.length === 0
              ? "None"
              : strategy.liquidityBuckets.map((b) => (
                  <span key={b.id} className="lab-line">
                    {b.purpose === "emergency-reserve-top-up" ? "Emergency reserve top-up" : "Planned withdrawal"}: {lei(b.amountLei)}
                    {b.neededInYears > 0 ? ` in ${b.neededInYears}y` : ", available now"}
                  </span>
                ))}
          </dd>
        </div>
        <div>
          <dt>Invested now · monthly</dt>
          <dd>
            {lei(strategy.investedInitialLei)} · {lei(strategy.monthlyContributionLei)}/month
          </dd>
        </div>
        <div>
          <dt>Projected in {strategy.horizonYears} years</dt>
          <dd>
            {lei(strategy.projection.nominal)} <span className="lab-muted">({lei(strategy.projection.real)} in today’s money)</span>
          </dd>
        </div>
        <div>
          <dt>Gap to {lei(strategy.targetLei)} target</dt>
          <dd>{strategy.gapLei > 0 ? lei(strategy.gapLei) : "None in the base case"}</dd>
        </div>
        <div>
          <dt>Severe crash (Challenger test)</dt>
          <dd>
            {stress
              ? `invested part falls ${pct1(stress.lossPct)}; value at goal ${lei(stress.valueAtGoalLei)}`
              : "Not available"}
          </dd>
        </div>
      </dl>
      <details className="lab-details">
        <summary>Assumptions behind this version</summary>
        <ul>
          {strategy.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
          <li>Net return {pct1(strategy.projection.netReturn)}/yr after fees; inflation {pct1(strategy.projection.inflation)}/yr.</li>
        </ul>
        <p className="lab-muted">{strategy.rationale}</p>
      </details>
      <p className="lab-hypothetical">Hypothetical scenario, not a forecast.</p>
    </article>
  );
}

const SEVERITY_TEXT: Record<Finding["severity"], { text: string; tone: Tone }> = {
  blocking: { text: "Blocking", tone: "bad" },
  material: { text: "Material", tone: "warn" },
  info: { text: "Information", tone: "neutral" },
};

function evidenceValue(key: string, value: unknown): string {
  if (typeof value === "number") {
    if (/lei$/i.test(key)) return lei(value);
    if (/(pct|share|shock|tolerance)$/i.test(key) || (Math.abs(value) <= 1 && !Number.isInteger(value))) return pct1(value);
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function EvidenceTable({ label, values }: { label: string; values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (!entries.length) return null;
  return (
    <div className="lab-evidence">
      <span className="lab-kicker">{label}</span>
      <dl>
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{evidenceValue(k, v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FindingCard({ finding, outcome }: { finding: Finding; outcome?: string }) {
  const sev = SEVERITY_TEXT[finding.severity];
  return (
    <li className="lab-finding">
      <div className="lab-finding-head">
        <Chip tone={sev.tone}>{sev.text}</Chip>
        <strong>{finding.test}</strong>
        {outcome && <Chip tone={outcome === "Resolved" ? "good" : "warn"}>{outcome}</Chip>}
      </div>
      <p>{finding.message}</p>
      {finding.failedConstraint && (
        <p className="lab-muted">
          Failed constraint: <strong>{finding.failedConstraint}</strong> · routed to {STAGE_TITLES[finding.routeTo]}
        </p>
      )}
      <div className="lab-evidence-grid">
        <EvidenceTable label="Inputs" values={finding.evidence.inputs} />
        <EvidenceTable label="Computed" values={finding.evidence.computed} />
      </div>
    </li>
  );
}

export function ValidationChecklist({ validation }: { validation: ValidationReport }) {
  const failed = validation.checks.filter((c) => !c.pass).length;
  return (
    <div className="lab-validation">
      <p>
        <Chip tone={statusTone(validation.status)}>{STATUS_TEXT[validation.status] ?? validation.status}</Chip>{" "}
        {validation.checks.length - failed} of {validation.checks.length} checks passed
        {failed ? `, ${failed} failed` : ""}.
      </p>
      <ul className="lab-checks">
        {validation.checks.map((c) => (
          <li key={c.id} className={c.pass ? "lab-check-pass" : "lab-check-fail"}>
            <span className="lab-check-mark">{c.pass ? "Pass" : "Fail"}</span>
            <span>
              <strong>{c.id}</strong>
              {c.hard ? " (mandatory)" : ""}: {c.detail}
            </span>
          </li>
        ))}
      </ul>
      {validation.openIssues.length > 0 && (
        <div className="lab-open-issues">
          <span className="lab-kicker">Open issues carried forward</span>
          <ul>
            {validation.openIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Initial proposal vs revised proposal, with the objections between them. */
export function StrategyComparison({ state }: { state: WorkflowState }) {
  const c = compareVersions(state);
  if (!c.initial)
    return <p className="lab-muted">No strategy was proposed in this run ({STATUS_TEXT[state.status] ?? state.status}). See the stage timeline for the reason.</p>;
  const draftNote = c.released ? undefined : "Not released: validation did not allow this result to be shown as a plan.";
  return (
    <div className="lab-comparison">
      <div className="lab-compare-grid">
        <StrategyCard
          title="1 · Initial proposal"
          strategy={c.initial}
          challenge={c.initialChallenge}
          note={c.revised ? "Challenged before release; never shown as the plan." : draftNote}
        />
        {c.revised ? (
          <StrategyCard title="2 · Revised after challenge" strategy={c.revised} challenge={c.finalChallenge} note={draftNote} />
        ) : (
          <div className="lab-strategy lab-strategy-empty">
            <span className="lab-kicker">2 · Revised after challenge</span>
            <p>No revision was needed: the Challenger raised no actionable objection that the workflow could address.</p>
          </div>
        )}
      </div>
      <div className="lab-objections">
        <h4>The Challenger’s objections to the initial proposal</h4>
        {c.objections.length === 0 ? (
          <p className="lab-muted">No blocking or material objections. {c.initialChallenge?.testsRun.length ?? 0} stress tests ran.</p>
        ) : (
          <ul className="lab-findings">
            {c.objections.map((f) => (
              <FindingCard key={f.id} finding={f} outcome={c.revised ? (c.resolved.includes(f) ? "Resolved" : "Still open") : undefined} />
            ))}
          </ul>
        )}
      </div>
      {c.changes.length > 0 && (
        <div className="lab-changes">
          <h4>What changed and why</h4>
          <ul>
            {c.changes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {c.remaining.length > 0 && (
        <div className="lab-remaining">
          <h4>Remaining risks after the last challenge</h4>
          <ul>
            {c.remaining.map((f) => (
              <li key={f.id}>
                <strong>{f.test}:</strong> {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TraceViewer({ trace, label = "Execution trace" }: { trace: TraceEntry[]; label?: string }) {
  return (
    <details className="lab-details lab-trace">
      <summary>
        {label} ({trace.length} entries, sanitized)
      </summary>
      <ol>
        {trace.map((t) => (
          <li key={t.seq} className={`lab-trace-${t.event}`}>
            <span className="lab-trace-meta">
              #{t.seq} {t.stage} · {t.event}
            </span>{" "}
            {t.summary}
          </li>
        ))}
      </ol>
    </details>
  );
}
