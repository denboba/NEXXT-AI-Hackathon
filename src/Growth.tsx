import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { PageIntro } from "./components/Layout";
import { Chip } from "./components/decision/WorkflowViews";
import { clearRecordedEvents, recordedEvents } from "./lib/analytics";
import { money } from "./lib/finance";
import { EVENT_NAMES, FUNNEL_STEPS, funnel, journeySteps, syntheticDemoEvents } from "./analytics/events.ts";
import type { AnalyticsEvent, EventName } from "./analytics/events.ts";

const STEP_TEXT: Record<EventName, string> = {
  journey_started: "Coaching journey started",
  journey_completed: "Journey completed",
  info_captured: "Required information captured",
  clarification_requested: "Clarification requested",
  strategy_validated: "Strategy assessment validated",
  strategy_withheld: "Strategy assessment withheld",
  stress_test_completed: "Stress test completed",
  revision_triggered: "Revision after challenge",
  followup_requested: "Follow-up requested",
  consent_requested: "Consent requested",
  consent_granted: "Consent granted",
  consent_declined: "Consent declined",
  handoff_previewed: "Adviser briefing previewed",
  handoff_exported: "Adviser briefing downloaded",
  journey_abandoned: "Journey abandoned",
  eval_run: "Evaluation run",
};

function FunnelTable({ steps, caption }: { steps: { name: EventName; count: number }[]; caption: string }) {
  const top = steps[0]?.count ?? 0;
  return (
    <table className="lab-table lab-funnel">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Journeys</th>
          <th scope="col">Share of started journeys</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.name}>
            <th scope="row">{STEP_TEXT[s.name]}</th>
            <td>{s.count}</td>
            <td>
              {top > 0 ? (
                <span className="lab-bar">
                  <span style={{ width: `${Math.min(100, (s.count / top) * 100)}%` }} aria-hidden="true" />
                  {Math.round((s.count / top) * 100)}%
                </span>
              ) : (
                "–"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Assumptions = {
  visitors: number;
  completionPct: number;
  followUpPct: number;
  consentPct: number;
  minutesUnprepared: number;
  minutesBriefed: number;
};
const ASSUMPTION_FIELDS: { key: keyof Assumptions; label: string; max: number }[] = [
  { key: "visitors", label: "People starting the coach per month", max: 1_000_000 },
  { key: "completionPct", label: "Share who complete the assessment (%)", max: 100 },
  { key: "followUpPct", label: "Of those, share who request a follow-up (%)", max: 100 },
  { key: "consentPct", label: "Of those, share who consent to a briefing (%)", max: 100 },
  { key: "minutesUnprepared", label: "Adviser minutes for an unprepared first conversation", max: 600 },
  { key: "minutesBriefed", label: "Adviser minutes for a pre-briefed first conversation", max: 600 },
];

export default function Growth() {
  const [events, setEvents] = useState<AnalyticsEvent[]>(() => recordedEvents());
  const [showSynthetic, setShowSynthetic] = useState(false);
  const [a, setA] = useState<Assumptions>({
    visitors: 1000,
    completionPct: 40,
    followUpPct: 10,
    consentPct: 60,
    minutesUnprepared: 45,
    minutesBriefed: 30,
  });
  const real = funnel(events);
  const synthetic = syntheticDemoEvents();
  const otherCounts = EVENT_NAMES.filter((n) => !FUNNEL_STEPS.includes(n)).map((n) => ({ name: n, count: real.counts[n] }));

  const completed = a.visitors * (a.completionPct / 100);
  const followUps = completed * (a.followUpPct / 100);
  const briefed = followUps * (a.consentPct / 100);
  const minutesSaved = briefed * Math.max(0, a.minutesUnprepared - a.minutesBriefed);

  return (
    <main className="container lab-page growth-page">
      <div className="coach-page-top">
        <Link className="back-link" to="/decision">
          <ChevronLeft size={16} /> Back to the Decision Lab
        </Link>
      </div>
      <PageIntro eyebrow="GROWTH VIEW" title="From interest to an informed next step.">
        Three things are kept apart on this page: real events recorded in this browser, a synthetic sample, and hypothetical projections
        from assumptions you set. None of them is a measured business result.
      </PageIntro>

      <section className="lab-panel" aria-labelledby="mechanism-title">
        <h2 id="mechanism-title">The mechanism</h2>
        <ol className="lab-mechanism">
          <li>
            <strong>Relevant interest</strong> · a person starts the coach with their own question.
          </li>
          <li>
            <strong>Personalized education</strong> · plain-language explanations and simulations.
          </li>
          <li>
            <strong>Structured goal and constraints</strong> · horizon, contributions, liquidity needs and loss tolerance are captured
            explicitly.
          </li>
          <li>
            <strong>Informed next step</strong> · an independently stress-tested assessment, or honest questions when it cannot be given.
          </li>
          <li>
            <strong>Consent-based wealth handoff</strong> · a data-minimized briefing, only with explicit consent, so adviser time goes to
            the conversations that need it.
          </li>
        </ol>
      </section>

      <section className="lab-panel" aria-labelledby="real-title">
        <div className="lab-panel-head">
          <h2 id="real-title">Real events recorded in this browser</h2>
          <div className="lab-actions">
            <Button size="small" variant="secondary" onClick={() => setEvents(recordedEvents())}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                clearRecordedEvents();
                setEvents(recordedEvents());
              }}
            >
              <Trash2 size={14} /> Clear
            </Button>
          </div>
        </div>
        <p>
          <Chip tone="good">REAL · this browser only</Chip> {real.realEventCount} events from your own use of this prototype. They are
          stored in localStorage, contain no names, free text or exact amounts, and are never sent anywhere.
        </p>
        {real.realEventCount === 0 ? (
          <p className="lab-muted">
            No events yet. Use the <Link to="/coach">coach</Link> or the <Link to="/decision">Decision Lab</Link>, then refresh.
          </p>
        ) : (
          <FunnelTable steps={real.steps} caption="Funnel from real events: journeys that reached each step (a journey starts at each coach or Decision Lab start; not unique people)" />
        )}
        <details className="lab-details">
          <summary>Other recorded events (raw event counts)</summary>
          <ul className="lab-notes">
            {otherCounts.map((c) => (
              <li key={c.name}>
                {STEP_TEXT[c.name]}: {c.count}
              </li>
            ))}
          </ul>
          <p className="lab-muted">
            Abandonment is not recorded: leaving a page is not a reliable signal in a browser-only prototype, so it is not counted.
          </p>
        </details>
      </section>

      <section className="lab-panel" aria-labelledby="synthetic-title">
        <div className="lab-panel-head">
          <h2 id="synthetic-title">Synthetic sample</h2>
          <label className="lab-toggle">
            <input type="checkbox" checked={showSynthetic} onChange={(e) => setShowSynthetic(e.target.checked)} /> Show synthetic sample
          </label>
        </div>
        {showSynthetic ? (
          <>
            <p>
              <Chip tone="warn">Synthetic sample - not real users</Chip> {synthetic.length} generated events that show how the funnel
              reads. They are tagged synthetic and excluded from the real counts above.
            </p>
            <FunnelTable steps={journeySteps(synthetic)} caption="Synthetic sample funnel (one invented journey)" />
          </>
        ) : (
          <p className="lab-muted">Hidden. Turn it on to see how one complete invented journey appears in the funnel.</p>
        )}
      </section>

      <section className="lab-panel" aria-labelledby="calc-title">
        <h2 id="calc-title">Hypothetical capacity calculator</h2>
        <p>
          <Chip tone="warn">Hypothetical - assumptions, not measured results</Chip> Every input is an assumption you can change. The
          defaults are placeholders, not observed rates.
        </p>
        <div className="lab-form">
          {ASSUMPTION_FIELDS.map((f) => (
            <label key={f.key} className="lab-field">
              <span>{f.label}</span>
              <input
                type="number"
                min={0}
                max={f.max}
                value={a[f.key]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setA((prev) => ({ ...prev, [f.key]: Number.isFinite(v) ? Math.min(f.max, Math.max(0, v)) : 0 }));
                }}
              />
            </label>
          ))}
        </div>
        <table className="lab-table">
          <caption>Hypothetical scenario per month</caption>
          <thead>
            <tr>
              <th scope="col">Output</th>
              <th scope="col">Formula</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Completed assessments</th>
              <td>starts × completion</td>
              <td>{money(completed)}</td>
            </tr>
            <tr>
              <th scope="row">Follow-up requests</th>
              <td>completed × follow-up rate</td>
              <td>{money(followUps)}</td>
            </tr>
            <tr>
              <th scope="row">Pre-briefed adviser conversations</th>
              <td>follow-ups × consent rate</td>
              <td>{money(briefed)}</td>
            </tr>
            <tr>
              <th scope="row">Adviser hours freed</th>
              <td>pre-briefed × (unprepared − pre-briefed minutes) ÷ 60</td>
              <td>{money(minutesSaved / 60)}</td>
            </tr>
          </tbody>
        </table>
        <p className="lab-muted">
          Not modelled: revenue, product take-up, retention or any conversion to an investment. This prototype has no data that could
          support such figures.
        </p>
      </section>
    </main>
  );
}
