import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  Download,
  FlaskConical,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Disclosure, PageIntro } from "./components/Layout";
import {
  Chip,
  STATUS_TEXT,
  StageTimeline,
  StrategyComparison,
  TraceViewer,
  ValidationChecklist,
  lei,
  pct1,
  statusTone,
} from "./components/decision/WorkflowViews";
import { useJourney } from "./lib/journey";
import { track } from "./lib/analytics";
import type { Risk } from "./lib/finance";
import { demoProfile, DEMO_PROFILE_NAME } from "./domain/demoProfile.ts";
import type {
  CustomerProfile,
  DataReport,
  IntakeInput,
  Lever,
  NextStepPlan,
  SuitabilityReport,
} from "./domain/types.ts";
import { rerunWorkflow, runWorkflow } from "./orchestrator/engine.ts";
import type { EngineOptions, WorkflowState } from "./orchestrator/engine.ts";
import { compareVersions, rerunDelta } from "./orchestrator/view.ts";
import type { RerunDelta, Snapshot } from "./orchestrator/view.ts";
import { deterministicProvider, httpProvider } from "./providers/llm.ts";
import {
  LOCAL_ADAPTER_LABEL,
  declineConsent,
  exportHandoff,
  grantConsent,
  initialConsent,
  prepareHandoff,
  requestConsent,
} from "./handoff/consent.ts";
import type { ConsentScope, ConsentState } from "./handoff/consent.ts";
import { goalBucket, horizonBucket } from "./analytics/events.ts";

type Form = {
  goalLabel: string;
  targetAmount: string;
  horizonYears: string;
  initialCapital: string;
  monthlyContribution: string;
  monthlyEssentialExpenses: string;
  emergencyFund: string;
  withdrawalLabel: string;
  withdrawalAmount: string;
  withdrawalInYears: string;
  maxLossPct: string;
  statedRisk: Risk | "";
  holdingLabel: string;
  singleStockValue: string;
  freeText: string;
};
type Source = "synthetic-demo" | "coach-answers" | "custom";

const emptyForm: Form = {
  goalLabel: "",
  targetAmount: "",
  horizonYears: "",
  initialCapital: "",
  monthlyContribution: "",
  monthlyEssentialExpenses: "",
  emergencyFund: "",
  withdrawalLabel: "",
  withdrawalAmount: "",
  withdrawalInYears: "",
  maxLossPct: "",
  statedRisk: "",
  holdingLabel: "",
  singleStockValue: "",
  freeText: "",
};

const str = (n: number | undefined) => (n === undefined ? "" : String(n));
function fromIntake(i: IntakeInput): Form {
  const w = i.plannedWithdrawals?.[0];
  const h = i.holdings?.find((x) => x.assetClass === "single-stock");
  return {
    goalLabel: i.goal?.label ?? "",
    targetAmount: str(i.goal?.targetAmount),
    horizonYears: str(i.goal?.horizonYears),
    initialCapital: str(i.initialCapital),
    monthlyContribution: str(i.monthlyContribution),
    monthlyEssentialExpenses: str(i.monthlyEssentialExpenses),
    emergencyFund: str(i.emergencyFund),
    withdrawalLabel: w?.label ?? "",
    withdrawalAmount: str(w?.amount),
    withdrawalInYears: str(w?.inYears),
    maxLossPct: i.maxAcceptableLossPct === undefined ? "" : String(Math.round(i.maxAcceptableLossPct * 1000) / 10),
    statedRisk: i.statedRisk ?? "",
    holdingLabel: h?.label ?? "",
    singleStockValue: str(h?.value),
    freeText: i.freeText ?? "",
  };
}

/** Empty fields stay absent (never defaulted); unreadable numbers become NaN so validation flags them. */
const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/[\s,]/g, "")));
function toIntake(f: Form, source: Source): IntakeInput {
  const target = num(f.targetAmount);
  const horizon = num(f.horizonYears);
  const withdrawal = num(f.withdrawalAmount);
  const stock = num(f.singleStockValue);
  const loss = num(f.maxLossPct);
  const hasGoal = f.goalLabel.trim() !== "" || target !== undefined || horizon !== undefined;
  return {
    goal: hasGoal
      ? { label: f.goalLabel.trim() || "My goal", targetAmount: target, horizonYears: horizon, flexibility: "flexible" }
      : undefined,
    initialCapital: num(f.initialCapital),
    monthlyContribution: num(f.monthlyContribution),
    monthlyEssentialExpenses: num(f.monthlyEssentialExpenses),
    emergencyFund: num(f.emergencyFund),
    plannedWithdrawals:
      withdrawal !== undefined
        ? [{ label: f.withdrawalLabel.trim() || "Planned withdrawal", amount: withdrawal, inYears: num(f.withdrawalInYears) ?? Number.NaN }]
        : [],
    maxAcceptableLossPct: loss === undefined ? undefined : loss / 100,
    statedRisk: f.statedRisk || undefined,
    holdings: stock !== undefined && stock > 0 ? [{ label: f.holdingLabel.trim() || "Single-company shares", assetClass: "single-stock", value: stock }] : [],
    freeText: f.freeText.trim() ? f.freeText.trim().slice(0, 1200) : undefined,
    inputSource: source === "synthetic-demo" ? "scenario-fixture" : "user-form",
  };
}

const FIELDS: { key: keyof Form; label: string; hint?: string; numeric?: boolean }[] = [
  { key: "goalLabel", label: "Goal", hint: "e.g. Apartment down payment" },
  { key: "targetAmount", label: "Target amount (lei)", numeric: true },
  { key: "horizonYears", label: "Years until you need it", numeric: true },
  { key: "initialCapital", label: "Money available now (lei)", numeric: true },
  { key: "monthlyContribution", label: "Monthly contribution (lei)", numeric: true },
  { key: "monthlyEssentialExpenses", label: "Essential expenses per month (lei)", numeric: true },
  { key: "emergencyFund", label: "Emergency fund today (lei)", numeric: true },
  { key: "withdrawalAmount", label: "Planned withdrawal (lei, optional)", numeric: true },
  { key: "withdrawalInYears", label: "Withdrawal needed in (years)", numeric: true },
  { key: "maxLossPct", label: "Largest temporary fall you could accept (%)", numeric: true },
  { key: "singleStockValue", label: "Shares of a single company you already hold (lei, optional)", numeric: true },
];

const PRIMARY_TEXT: Record<NextStepPlan["primary"], string> = {
  "answer-questions": "Answer the open questions",
  "review-scenarios": "Review the alternative scenarios",
  "talk-to-adviser": "Talk it through with an adviser",
  "review-validated-plan": "Review the validated scenario",
  none: "No action suggested",
};

type Health = { state: "checking" } | { state: "available" } | { state: "unavailable"; reason: string };

const leiOrDash = (x?: number) => (x === undefined ? "–" : lei(x));
const pctOrDash = (x?: number) => (x === undefined ? "–" : pct1(x));

function trackRun(s: WorkflowState) {
  const profile = s.stages.profile.output as CustomerProfile | undefined;
  if (s.status === "needs-clarification") track("clarification_requested", { status: s.status, findingCount: profile?.questions.length ?? 0 });
  const challenge = s.result?.challenge;
  if (s.executions.some((e) => e.stage === "challenger" && e.status !== "failed"))
    track("stress_test_completed", { findingCount: challenge?.findings.filter((f) => f.severity !== "info").length ?? 0, revisionCount: s.revisions });
  if (s.revisions > 0) track("revision_triggered", { revisionCount: s.revisions });
  const v = s.result?.validation?.status;
  if (v === "validated" || v === "validated-with-open-issues") track("strategy_validated", { status: v });
  else if (v === "withheld" || s.status === "withheld") track("strategy_withheld", { status: "withheld" });
  if (s.status === "completed") track("journey_completed", { stage: "decision", status: s.status });
}

export default function DecisionLab() {
  const { state: journey } = useJourney();
  const [form, setForm] = useState<Form>(emptyForm);
  const [source, setSource] = useState<Source>("custom");
  const [run, setRun] = useState<WorkflowState | null>(null);
  const [previous, setPrevious] = useState<WorkflowState | null>(null);
  const [delta, setDelta] = useState<RerunDelta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health>({ state: "checking" });
  const [provider, setProvider] = useState<"deterministic" | "bedrock">("deterministic");
  const [externalConsent, setExternalConsent] = useState(false);
  const [cf, setCf] = useState({ horizonYears: "", monthlyContribution: "", withdrawalAmount: "", maxLossPct: "" });
  const [consent, setConsent] = useState<ConsentState>(initialConsent());
  const [scopes, setScopes] = useState({ briefing: false, name: false });
  const [contactName, setContactName] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const started = useRef(false);
  const captured = useRef(false);
  const coachDone = journey.question >= 3;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch("/api/health", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("health"))))
      .then((body: { coachMode?: string }) =>
        setHealth(
          body.coachMode === "bedrock-configured"
            ? { state: "available" }
            : { state: "unavailable", reason: "The server has no Bedrock key configured, so only the deterministic rules provider is available." },
        ),
      )
      .catch(() => setHealth({ state: "unavailable", reason: "The app server could not be reached, so only the in-browser deterministic provider is available." }))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!run) return;
    const i = run.input;
    setCf({
      horizonYears: str(i.goal?.horizonYears),
      monthlyContribution: str(i.monthlyContribution),
      withdrawalAmount: str(i.plannedWithdrawals?.[0]?.amount),
      maxLossPct: i.maxAcceptableLossPct === undefined ? "" : String(Math.round(i.maxAcceptableLossPct * 1000) / 10),
    });
  }, [run]);

  function begin() {
    if (started.current) return;
    started.current = true;
    track("journey_started", { stage: "decision" });
  }
  function edit(key: keyof Form, value: string) {
    begin();
    setForm((f) => ({ ...f, [key]: value }));
    setSource("custom");
  }
  function loadDemo() {
    begin();
    setForm(fromIntake(demoProfile));
    setSource("synthetic-demo");
  }
  function applyCoachAnswers() {
    begin();
    setForm((f) => ({
      ...f,
      monthlyContribution: String(journey.monthly),
      horizonYears: String(journey.years),
      statedRisk: journey.risk,
    }));
    setSource("coach-answers");
  }

  const bedrockSelected = provider === "bedrock" && health.state === "available";
  const engineOptions = (): EngineOptions =>
    bedrockSelected
      ? { reasoning: httpProvider((url, init) => fetch(url, init)), externalProcessingConsent: externalConsent }
      : { reasoning: deterministicProvider() };

  function resetHandoff() {
    setConsent(initialConsent());
    setScopes({ briefing: false, name: false });
    setExportMessage("");
  }

  async function assess() {
    if (busy) return;
    begin();
    const input = source === "synthetic-demo" ? demoProfile : toIntake(form, source);
    if (!captured.current) {
      captured.current = true;
      const t = input.goal?.targetAmount;
      const h = input.goal?.horizonYears;
      track("info_captured", {
        stage: "intake",
        goalBucket: typeof t === "number" && Number.isFinite(t) ? goalBucket(t) : undefined,
        horizonBucket: typeof h === "number" && Number.isFinite(h) ? horizonBucket(h) : undefined,
      });
    }
    setBusy(true);
    setError("");
    try {
      const s = await runWorkflow(input, engineOptions());
      setRun(s);
      setPrevious(null);
      setDelta(null);
      resetHandoff();
      trackRun(s);
    } catch {
      setError("The assessment could not finish. Nothing was saved or sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function counterfactualPatch(base: IntakeInput): Partial<IntakeInput> {
    const patch: Partial<IntakeInput> = {};
    const h = num(cf.horizonYears);
    if (base.goal && h !== undefined && h !== base.goal.horizonYears) patch.goal = { ...base.goal, horizonYears: h };
    const m = num(cf.monthlyContribution);
    if (m !== undefined && m !== base.monthlyContribution) patch.monthlyContribution = m;
    const w = num(cf.withdrawalAmount);
    const first = base.plannedWithdrawals?.[0];
    if (first && w !== undefined && w !== first.amount)
      patch.plannedWithdrawals = [{ ...first, amount: w }, ...(base.plannedWithdrawals ?? []).slice(1)];
    const l = num(cf.maxLossPct);
    if (l !== undefined && l / 100 !== base.maxAcceptableLossPct) patch.maxAcceptableLossPct = l / 100;
    return patch;
  }

  async function replay(patchOverride?: Partial<IntakeInput>) {
    if (!run || busy) return;
    const patch = patchOverride ?? counterfactualPatch(run.input);
    if (Object.keys(patch).length === 0) {
      setError("Change at least one input before replaying.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await rerunWorkflow(run, patch, engineOptions());
      setPrevious(run);
      setDelta(rerunDelta(run, next));
      setRun(next);
      resetHandoff();
      trackRun(next);
    } catch {
      setError("The replay could not finish. The previous assessment is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  function tryLever(lever: Lever) {
    if (!run || lever.value === undefined) return;
    if (lever.id === "increase-contribution" && run.input.monthlyContribution !== undefined)
      replay({ monthlyContribution: Math.round(run.input.monthlyContribution + lever.value) });
    else if (lever.id === "extend-horizon" && run.input.goal?.horizonYears !== undefined)
      replay({ goal: { ...run.input.goal, horizonYears: run.input.goal.horizonYears + lever.value } });
    else if (lever.id === "lower-target" && run.input.goal) replay({ goal: { ...run.input.goal, targetAmount: lever.value } });
  }

  const now = () => new Date();
  function openHandoff() {
    track("followup_requested", { stage: "decision" });
    track("handoff_previewed", { status: run?.status });
    if (consent.status === "not-requested" || consent.status === "declined") {
      setConsent((c) => requestConsent(c, now()));
      track("consent_requested", { stage: "handoff" });
    }
  }
  function grant() {
    if (!scopes.briefing) return;
    const scope: ConsentScope[] = scopes.name && contactName.trim() ? ["briefing-content", "contact-name"] : ["briefing-content"];
    setConsent((c) => grantConsent(c.status === "requested" ? c : requestConsent(c, now()), scope, now()));
    track("consent_granted", { stage: "handoff" });
  }
  function decline() {
    setConsent((c) => (c.status === "requested" || c.status === "granted" ? declineConsent(c, now()) : c));
    setScopes({ briefing: false, name: false });
    track("consent_declined", { stage: "handoff" });
  }

  const profile = run?.stages.profile.output as CustomerProfile | undefined;
  const data = run?.stages.data.output as DataReport | undefined;
  const suitability = run?.stages.suitability.output as SuitabilityReport | undefined;
  const nextStep = run?.result?.nextStep;
  const validation = run?.result?.validation;
  const briefing = nextStep?.briefing;
  const handoff = briefing && run ? prepareHandoff(briefing, consent, { contactName: contactName.trim() || undefined, workflowStatus: run.status }) : undefined;
  const comparison = run ? compareVersions(run) : undefined;

  function download() {
    if (!run || !briefing) return;
    const result = exportHandoff({ briefing, consent, workflowStatus: run.status, contactName: contactName.trim() || undefined });
    if (!result.ok) {
      setExportMessage(
        result.reason === "consent-required"
          ? "Export blocked: consent for the briefing content has not been granted."
          : "Export blocked: the assessment was withheld or failed validation.",
      );
      return;
    }
    const url = URL.createObjectURL(new Blob([result.file.content], { type: result.file.mimeType }));
    const a = document.createElement("a");
    a.href = url;
    a.download = result.file.filename;
    a.click();
    URL.revokeObjectURL(url);
    track("handoff_exported", { status: run.status });
    setExportMessage(`Downloaded ${result.file.filename} to this device. Nothing was sent and no appointment was booked.`);
  }

  const workflowSteps: { label: string; value: string }[] = run
    ? [
        { label: "Goal", value: run.executions.some((e) => e.stage === "profile") ? (run.status === "needs-clarification" && !comparison?.initial ? "Needs input" : "Captured") : "Not reached" },
        { label: "Strategy", value: comparison?.initial ? `v${comparison.initial.version} proposed` : "Not reached" },
        { label: "Stress test", value: comparison?.initialChallenge ? `${comparison.objections.length} objection(s)` : "Not reached" },
        { label: "Revision", value: run.revisions > 0 ? `${run.revisions} revision(s)` : comparison?.initial ? "Not needed" : "Not reached" },
        { label: "Validation", value: validation ? STATUS_TEXT[validation.status] ?? validation.status : "Not reached" },
        { label: "Next step", value: nextStep ? PRIMARY_TEXT[nextStep.primary] : "Not reached" },
      ]
    : [];

  return (
    <main className="container lab-page decision-page">
      <div className="coach-page-top">
        <Link className="back-link" to="/coach">
          <ChevronLeft size={16} /> Back to the coach
        </Link>
        <span className="educational-pill">
          <ShieldCheck size={13} /> Educational simulation · Fictional products
        </span>
      </div>
      <PageIntro eyebrow="DECISION LAB" title="Stress-test my plan.">
        A proposal is only shown after an independent Challenger has tried to break it. See the first proposal, the objections, what
        changed, and what is still open. Every number below is computed by deterministic code from the inputs and assumptions shown.
      </PageIntro>

      <section className="lab-panel" aria-labelledby="intake-title">
        <div className="lab-panel-head">
          <h2 id="intake-title">1 · Goal and constraints</h2>
          <div className="lab-actions">
            <Button variant="secondary" size="small" onClick={loadDemo}>
              <UserRound size={15} /> Load synthetic demo: Ana
            </Button>
            {coachDone && (
              <Button variant="ghost" size="small" onClick={applyCoachAnswers}>
                Use my coach answers
              </Button>
            )}
          </div>
        </div>
        {source === "synthetic-demo" && (
          <p className="lab-banner" role="status">
            <Chip tone="info">SYNTHETIC</Chip> {DEMO_PROFILE_NAME}: an invented customer for a reproducible demo. Not a real person or real
            financial data.
          </p>
        )}
        {source === "coach-answers" && (
          <p className="lab-banner" role="status">
            Monthly amount, horizon and risk comfort were copied from your coach answers. Add the remaining fields; empty fields are never
            filled in for you.
          </p>
        )}
        <form
          className="lab-form"
          onSubmit={(e) => {
            e.preventDefault();
            assess();
          }}
        >
          {FIELDS.map((field) => (
            <label key={field.key} className="lab-field">
              <span>{field.label}</span>
              <input
                value={form[field.key]}
                inputMode={field.numeric ? "decimal" : undefined}
                placeholder={field.hint}
                onChange={(e) => edit(field.key, e.target.value)}
              />
            </label>
          ))}
          <label className="lab-field">
            <span>How do you feel about ups and downs?</span>
            <select value={form.statedRisk} onChange={(e) => edit("statedRisk", e.target.value)}>
              <option value="">Not stated</option>
              <option value="steady">I’d prefer a steadier ride</option>
              <option value="balanced">Some ups and downs are okay</option>
              <option value="growth">I can take a longer view</option>
            </select>
          </label>
          <label className="lab-field lab-field-wide">
            <span>Anything else about the goal? (optional, stays in this browser)</span>
            <textarea
              value={form.freeText}
              maxLength={1200}
              rows={2}
              onChange={(e) => edit("freeText", e.target.value)}
              placeholder="Please leave out names, account numbers and other personal details."
            />
          </label>
          <fieldset className="lab-provider lab-field-wide">
            <legend>Reasoning provider</legend>
            <label>
              <input type="radio" name="provider" checked={provider === "deterministic"} onChange={() => setProvider("deterministic")} />{" "}
              Deterministic rules in this browser (default)
            </label>
            <label>
              <input
                type="radio"
                name="provider"
                disabled={health.state !== "available"}
                checked={provider === "bedrock"}
                onChange={() => setProvider("bedrock")}
              />{" "}
              Amazon Bedrock via this app’s server (wording and extraction only; all numbers stay deterministic)
            </label>
            {health.state === "checking" && <p className="lab-muted">Checking whether the server has a model configured…</p>}
            {health.state === "unavailable" && <p className="lab-muted">{health.reason}</p>}
            {bedrockSelected && (
              <label className="lab-consent-line">
                <input type="checkbox" checked={externalConsent} onChange={(e) => setExternalConsent(e.target.checked)} /> I agree that the
                goal figures and optional text (no name) are sent to Amazon Bedrock through this app’s server for this assessment. Without
                this, the deterministic provider is used and the fallback is recorded in the trace.
              </label>
            )}
          </fieldset>
          <div className="lab-form-actions lab-field-wide">
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <FlaskConical size={17} />} Run assessment
            </Button>
            <span className="lab-muted">Runs entirely in this browser with synthetic planning assumptions. Nothing is stored on a server.</span>
          </div>
        </form>
        {error && (
          <p className="lab-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {run && (
        <>
          <section className="lab-panel" aria-labelledby="status-title" aria-live="polite">
            <div className="lab-panel-head">
              <h2 id="status-title">2 · Where the workflow stands</h2>
              <Chip tone={statusTone(run.status)}>Workflow: {STATUS_TEXT[run.status] ?? run.status}</Chip>
            </div>
            <ol className="lab-steps">
              {workflowSteps.map((s) => (
                <li key={s.label}>
                  <span className="lab-kicker">{s.label}</span>
                  <strong>{s.value}</strong>
                </li>
              ))}
            </ol>
            <p className="lab-provider-badge">
              Provider: <strong>{run.providers.reasoning}</strong> · market data: <strong>{run.providers.marketData}</strong> · model calls{" "}
              {run.modelCalls} · fallbacks {run.fallbacks} · steps {run.steps}
              {run.fallbacks > 0 && " (a fallback to deterministic rules happened; see the trace)"}
            </p>
            {run.status === "needs-clarification" && profile && (
              <div className="lab-clarify" role="note">
                <h3>Some information is missing or unclear</h3>
                <p>Nothing was assumed. Answer these and run the assessment again:</p>
                <ul>
                  {(nextStep?.questions.length ? nextStep.questions : profile.questions).map((q) => (
                    <li key={q.field}>
                      <strong>{q.question}</strong> <span className="lab-muted">({q.reason})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(run.status === "withheld" || run.status === "failed") && (
              <div className="lab-withheld" role="note">
                <h3>{run.status === "withheld" ? "No strategy is shown" : "The assessment could not complete"}</h3>
                <ul>
                  {run.result?.unresolved.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="lab-two-col">
              {profile && (
                <div>
                  <h3>Goal and constraints used</h3>
                  <dl className="lab-facts">
                    <div>
                      <dt>Goal</dt>
                      <dd>
                        {profile.facts.targetAmount ? lei(profile.facts.targetAmount.value) : "missing"} in{" "}
                        {profile.facts.horizonYears ? `${profile.facts.horizonYears.value} years` : "an unknown horizon"}
                      </dd>
                    </div>
                    <div>
                      <dt>Now · monthly</dt>
                      <dd>
                        {leiOrDash(profile.facts.initialCapital?.value)} · {leiOrDash(profile.facts.monthlyContribution?.value)}
                      </dd>
                    </div>
                    <div>
                      <dt>Emergency fund · essentials</dt>
                      <dd>
                        {leiOrDash(profile.facts.emergencyFund?.value)} · {leiOrDash(profile.facts.monthlyEssentialExpenses?.value)}/month
                      </dd>
                    </div>
                    <div>
                      <dt>Planned withdrawals</dt>
                      <dd>
                        {(profile.facts.plannedWithdrawals?.value ?? []).length === 0
                          ? "None"
                          : profile.facts.plannedWithdrawals!.value.map((w, i) => (
                              <span key={i} className="lab-line">
                                {lei(w.amount)} in {w.inYears}y
                              </span>
                            ))}
                      </dd>
                    </div>
                    <div>
                      <dt>Loss limit · stated risk</dt>
                      <dd>
                        {pctOrDash(profile.facts.maxAcceptableLossPct?.value)} · {profile.facts.statedRisk?.value ?? "not stated"}
                      </dd>
                    </div>
                    {suitability && (
                      <div>
                        <dt>Suitability limits</dt>
                        <dd>
                          max equity {pct1(suitability.maxEquityShare)} (
                          {suitability.equityCaps.map((c) => `${c.source} ${pct1(c.cap)}`).join("; ")}); loss tolerance{" "}
                          {pct1(suitability.lossTolerance)}; drawdown basis: {suitability.drawdownBasis.label}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {profile.ambiguities.length > 0 && (
                    <ul className="lab-notes">
                      {profile.ambiguities.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {data && (
                <div>
                  <h3>Planning assumptions</h3>
                  <p>
                    <Chip tone="info">{data.assumptions.kind === "synthetic-fixture" ? "SYNTHETIC" : data.assumptions.kind.toUpperCase()}</Chip>{" "}
                    {data.assumptions.sourceLabel} · as of {data.assumptions.asOf} · freshness {data.freshness}
                  </p>
                  <table className="lab-table">
                    <thead>
                      <tr>
                        <th scope="col">Asset class</th>
                        <th scope="col">Expected return/yr</th>
                        <th scope="col">Planning drawdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["equity", "bond", "cash"] as const).map((k) => (
                        <tr key={k}>
                          <th scope="row">{k}</th>
                          <td>{pct1(data.assumptions.assetClasses[k].expectedReturn)}</td>
                          <td>{pct1(data.assumptions.assetClasses[k].stressDrawdown)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="lab-muted">
                    Inflation {pct1(data.assumptions.inflation)}/yr. Flags: {data.flags.join(", ") || "none"}. These are planning
                    assumptions, not market data or a forecast.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="lab-panel" aria-labelledby="timeline-title">
            <h2 id="timeline-title">3 · Stage-by-stage execution</h2>
            <StageTimeline state={run} caption="Each stage is a separate agent with a typed output. Reused means its inputs were unchanged (same fingerprint)." />
          </section>

          <section className="lab-panel lab-signature" aria-labelledby="compare-title">
            <h2 id="compare-title">4 · Initial proposal vs. revised after the stress test</h2>
            <StrategyComparison state={run} />
          </section>

          {validation && (
            <section className="lab-panel" aria-labelledby="validation-title">
              <h2 id="validation-title">5 · Validation checklist</h2>
              <ValidationChecklist validation={validation} />
            </section>
          )}

          {comparison?.initial && (
            <section className="lab-panel" aria-labelledby="cf-title">
              <h2 id="cf-title">6 · What if one constraint changes?</h2>
              <p className="lab-muted">
                Change one or more inputs and replay. Stages whose inputs did not change are reused; only dependent stages are recomputed.
              </p>
              <form
                className="lab-form lab-cf-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  replay();
                }}
              >
                <label className="lab-field">
                  <span>Years until the goal</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={cf.horizonYears}
                    disabled={!run.input.goal}
                    onChange={(e) => setCf((c) => ({ ...c, horizonYears: e.target.value }))}
                  />
                </label>
                <label className="lab-field">
                  <span>Monthly contribution (lei)</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={cf.monthlyContribution}
                    onChange={(e) => setCf((c) => ({ ...c, monthlyContribution: e.target.value }))}
                  />
                </label>
                <label className="lab-field">
                  <span>Planned withdrawal (lei)</span>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={cf.withdrawalAmount}
                    disabled={!run.input.plannedWithdrawals?.length}
                    onChange={(e) => setCf((c) => ({ ...c, withdrawalAmount: e.target.value }))}
                  />
                </label>
                <label className="lab-field">
                  <span>Largest acceptable fall (%)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={cf.maxLossPct}
                    onChange={(e) => setCf((c) => ({ ...c, maxLossPct: e.target.value }))}
                  />
                </label>
                <div className="lab-form-actions lab-field-wide">
                  <Button type="submit" variant="secondary" disabled={busy}>
                    <RotateCcw size={15} /> Replay with this change
                  </Button>
                  {previous && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setRun(previous);
                        setPrevious(null);
                        setDelta(null);
                        resetHandoff();
                      }}
                    >
                      Restore the previous assessment
                    </button>
                  )}
                </div>
              </form>
              {delta && previous && <DeltaView delta={delta} before={previous.input} after={run.input} />}
            </section>
          )}

          {nextStep && (
            <section className="lab-panel" aria-labelledby="next-title">
              <h2 id="next-title">7 · Your available next steps</h2>
              <p>
                <Chip tone="info">{PRIMARY_TEXT[nextStep.primary]}</Chip> {nextStep.message}
              </p>
              {nextStep.safetyResponses.length > 0 && (
                <ul className="lab-notes">
                  {nextStep.safetyResponses.map((r) => (
                    <li key={r.flag}>{r.message}</li>
                  ))}
                </ul>
              )}
              {nextStep.scenarioSuggestions.length > 0 && (
                <ul className="lab-levers">
                  {nextStep.scenarioSuggestions.map((l) => (
                    <li key={l.id}>
                      <span>{l.description}</span>
                      {l.value !== undefined && l.id !== "review-concentration" && (
                        <button type="button" className="text-button" disabled={busy} onClick={() => tryLever(l)}>
                          Replay with this option <ArrowRight size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {nextStep.adviser.recommended && (
                <p className="lab-muted">Why an adviser conversation is suggested: {nextStep.adviser.reasons.join("; ")}.</p>
              )}
              <div className="lab-handoff">
                <div>
                  <h3>Optional: prepare a briefing for an adviser</h3>
                  <p className="lab-muted">
                    If you would like to talk this through, the Raiffeisen Wealth & Investment Forum could be a suitable place to bring this
                    briefing to a conversation with an adviser. This prototype is not connected to the Forum or to Raiffeisen and cannot
                    book anything.
                  </p>
                </div>
                {briefing && handoff ? (
                  <Dialog
                    title="Adviser briefing (local preview)"
                    description={LOCAL_ADAPTER_LABEL}
                    trigger={
                      <button type="button" className="button button-primary" onClick={openHandoff}>
                        Preview adviser briefing <ArrowRight size={16} />
                      </button>
                    }
                  >
                    <p>
                      This briefing is data-minimized: goal, horizon, constraints, the scenario comparison and open questions. It contains
                      no free text and no name unless you choose to add it.
                    </p>
                    <pre className="lab-pre" aria-label="Briefing preview">
                      {JSON.stringify(handoff.preview, null, 2)}
                    </pre>
                    <fieldset className="lab-consent">
                      <legend>Consent ({consent.status})</legend>
                      <label>
                        <input
                          type="checkbox"
                          checked={scopes.briefing}
                          disabled={consent.status === "granted"}
                          onChange={(e) => setScopes((s) => ({ ...s, briefing: e.target.checked }))}
                        />{" "}
                        I agree that the briefing content above is written into a file that I download to this device.
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={scopes.name}
                          disabled={consent.status === "granted"}
                          onChange={(e) => setScopes((s) => ({ ...s, name: e.target.checked }))}
                        />{" "}
                        Also include a contact name (optional)
                      </label>
                      {scopes.name && (
                        <label className="lab-field">
                          <span>Contact name</span>
                          <input
                            value={contactName}
                            maxLength={40}
                            disabled={consent.status === "granted"}
                            onChange={(e) => setContactName(e.target.value)}
                          />
                        </label>
                      )}
                      <div className="lab-form-actions">
                        {consent.status === "granted" ? (
                          <button type="button" className="text-button" onClick={decline}>
                            Withdraw consent
                          </button>
                        ) : (
                          <>
                            <Button type="button" size="small" disabled={!scopes.briefing} onClick={grant}>
                              Give consent
                            </Button>
                            <button type="button" className="text-button" onClick={decline}>
                              Decline
                            </button>
                          </>
                        )}
                      </div>
                    </fieldset>
                    <Button type="button" variant="secondary" disabled={!handoff.canExport} onClick={download}>
                      <Download size={16} /> Download briefing (JSON)
                    </Button>
                    {!handoff.canExport && (
                      <p className="lab-muted">
                        {consent.status !== "granted"
                          ? "Download is disabled until you give consent."
                          : "Download is disabled because the assessment was withheld or failed."}
                      </p>
                    )}
                    {exportMessage && <p role="status">{exportMessage}</p>}
                    <p className="lab-muted">{LOCAL_ADAPTER_LABEL}. No appointment is booked.</p>
                  </Dialog>
                ) : (
                  <p className="lab-muted">A briefing is available once the assessment reaches a next step.</p>
                )}
              </div>
            </section>
          )}

          <section className="lab-panel" aria-labelledby="trace-title">
            <h2 id="trace-title">8 · Execution trace</h2>
            <TraceViewer trace={run.trace} />
            <details className="lab-details">
              <summary>Exact inputs for reproducing this run</summary>
              <pre className="lab-pre">{JSON.stringify({ input: run.input, providers: run.providers, limits: run.limits }, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
      <Disclosure />
    </main>
  );
}

const SNAPSHOT_ROWS: { key: keyof Snapshot; label: string; format: (s: Snapshot) => string }[] = [
  { key: "status", label: "Workflow status", format: (s) => STATUS_TEXT[s.status] ?? s.status },
  { key: "validation", label: "Validation", format: (s) => (s.validation ? STATUS_TEXT[s.validation] ?? s.validation : "not run") },
  { key: "label", label: "Scenario", format: (s) => s.label ?? "–" },
  { key: "equityShare", label: "Equity share", format: (s) => pctOrDash(s.equityShare) },
  { key: "projectedLei", label: "Projected value (hypothetical)", format: (s) => leiOrDash(s.projectedLei) },
  { key: "gapLei", label: "Gap to target", format: (s) => leiOrDash(s.gapLei) },
  { key: "stressLossPct", label: "Severe-crash loss", format: (s) => pctOrDash(s.stressLossPct) },
  { key: "revisions", label: "Revisions", format: (s) => String(s.revisions) },
  { key: "modelCalls", label: "Model calls", format: (s) => String(s.modelCalls) },
];

function fieldValue(input: IntakeInput, field: string): string {
  if (field.startsWith("goal.")) return JSON.stringify((input.goal as Record<string, unknown> | undefined)?.[field.slice(5)] ?? null);
  return JSON.stringify((input as Record<string, unknown>)[field] ?? null);
}

function DeltaView({ delta, before, after }: { delta: RerunDelta; before: IntakeInput; after: IntakeInput }) {
  return (
    <div className="lab-delta" aria-live="polite">
      <h3>Replay result</h3>
      <ul className="lab-notes">
        {delta.changedFields.map((f) => (
          <li key={f}>
            <strong>{f}</strong>: {fieldValue(before, f)} → {fieldValue(after, f)}
          </li>
        ))}
      </ul>
      <p>
        Recomputed:{" "}
        {delta.recomputed.map((s) => (
          <Chip key={s} tone="info">
            {s}
          </Chip>
        ))}{" "}
        Reused:{" "}
        {delta.reused.length ? (
          delta.reused.map((s) => <Chip key={s}>{s}</Chip>)
        ) : (
          <span className="lab-muted">none</span>
        )}
        {delta.notRun.length > 0 && <span className="lab-muted"> · not run: {delta.notRun.join(", ")}</span>}
      </p>
      <table className="lab-table">
        <thead>
          <tr>
            <th scope="col">Result</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {SNAPSHOT_ROWS.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.format(delta.before)}</td>
              <td>{row.format(delta.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lab-hypothetical">Hypothetical scenarios under synthetic assumptions, not forecasts. All other inputs are unchanged.</p>
    </div>
  );
}
