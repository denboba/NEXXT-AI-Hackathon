// Dependency-aware orchestrator for the Goal -> Strategy -> Stress-Test
// workflow. Each stage is a separate agent with a typed output; the engine
// decides what runs next from those outputs, reuses stages whose inputs are
// unchanged (fingerprints), re-runs only invalidated stages, bounds retries,
// revisions, steps, model calls and deterministic tool calls, and records a
// sanitized trace.
import type {
  ChallengeReport,
  CustomerProfile,
  DataReport,
  Finding,
  IntakeInput,
  NextStepPlan,
  Strategy,
  SuitabilityReport,
  ValidationReport,
} from "../domain/types.ts";
import { stressLoss } from "../domain/calculations.ts";
import { NonRetryableProviderError, deterministicProvider, explainObjectionsTemplate, explainStrategyTemplate } from "../providers/llm.ts";
import { bannedClaims, unbackedSummaryNumbers } from "../agents/guardrail.ts";
import { explainStrategyInput } from "../agents/strategy.ts";
import { runTool, summarizeToolCall } from "./tools.ts";
import type { ReasoningProvider, ReasoningTask } from "../providers/llm.ts";
import { syntheticFixtureProvider } from "../providers/marketData.ts";
import type { MarketDataProvider } from "../providers/marketData.ts";
import { DEFAULT_LIMITS, STAGE_ORDER, StageError } from "./context.ts";
import type { Agent, ChallengerInput, Directives, Limits, StageContext, StageId, TraceEvent } from "./context.ts";
import { STAGES } from "./graph.ts";
import type { TerminalStatus } from "./graph.ts";
import { changedKeys, fingerprintOf, fnv1a, stableStringify } from "./fingerprint.ts";
import { createTrace } from "./trace.ts";
import type { TraceEntry } from "./trace.ts";

export type StageStatus = "pending" | "fresh" | "reused" | "invalidated" | "failed" | "skipped";
export type StageRecord = {
  status: StageStatus;
  fingerprint?: string;
  output?: unknown;
  attempts: number;
  error?: string;
  reason?: string;
};
export type StageExecution = {
  seq: number;
  stage: StageId;
  pass: number;
  fingerprint: string;
  digest: Record<string, string>;
  status: "fresh" | "reused" | "failed";
  output?: unknown;
  reason: string;
};
export type Transition = { from: StageId | "start"; to: StageId | TerminalStatus; reason: string };
export type WorkflowStatus = "running" | TerminalStatus;

export type WorkflowResult = {
  status: TerminalStatus;
  /** Present only when validation allowed the result to be shown. */
  strategy?: Strategy;
  validation?: ValidationReport;
  challenge?: ChallengeReport;
  nextStep?: NextStepPlan;
  unresolved: string[];
};

export type WorkflowState = {
  runId: string;
  previousRunId?: string;
  startedAt: string;
  input: IntakeInput;
  limits: Limits;
  providers: { reasoning: string; marketData: string; fallbackMarketData: string | null };
  stages: Record<StageId, StageRecord>;
  executions: StageExecution[];
  transitions: Transition[];
  directives: Directives;
  revisions: number;
  modelCalls: number;
  /** Deterministic tool calls made by agents in this run (bounded by limits.maxToolCalls). */
  toolCalls: number;
  fallbacks: number;
  steps: number;
  status: WorkflowStatus;
  trace: TraceEntry[];
  result?: WorkflowResult;
};

export type EngineOptions = {
  reasoning?: ReasoningProvider;
  marketData?: MarketDataProvider;
  /** Used when primary data is unavailable/stale. Default: synthetic fixture. `null` disables fallback. */
  fallbackMarketData?: MarketDataProvider | null;
  limits?: Partial<Limits>;
  clock?: () => Date;
  idFactory?: () => string;
  /** Required before any data is sent to an external (server-side model) provider. */
  externalProcessingConsent?: boolean;
  /** Replace individual agents (tests and evaluation scenarios). */
  agents?: Partial<Record<StageId, Agent<unknown>>>;
};

class LimitError extends Error {}
class ProviderTimeoutError extends Error {}

let runCounter = 0;
const defaultIdFactory = () => `run-${Date.now().toString(36)}-${(++runCounter).toString(36)}`;

function sensitiveStrings(input: IntakeInput) {
  return [
    input.freeText ?? "",
    ...(input.customerRequests ?? []),
    input.goal?.label ?? "",
    ...(input.plannedWithdrawals ?? []).map((w) => w?.label ?? ""),
    ...(input.holdings ?? []).map((h) => h?.label ?? ""),
  ].filter((s) => typeof s === "string");
}

export function runWorkflow(input: IntakeInput, options: EngineOptions = {}): Promise<WorkflowState> {
  return execute(input, options, []);
}

/**
 * Re-runs with changed input. Stages whose fingerprint matches a previous
 * execution are reused (with an explanation); only invalidated stages run.
 */
export function rerunWorkflow(prev: WorkflowState, changedInput: Partial<IntakeInput>, options: EngineOptions = {}): Promise<WorkflowState> {
  return execute({ ...prev.input, ...changedInput }, options, prev.executions, prev.runId);
}

async function execute(input: IntakeInput, options: EngineOptions, prevExecutions: StageExecution[], previousRunId?: string): Promise<WorkflowState> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? defaultIdFactory;
  const reasoning = options.reasoning ?? deterministicProvider();
  const rules = deterministicProvider();
  const marketData = options.marketData ?? syntheticFixtureProvider();
  const fallbackMarketData = options.fallbackMarketData === undefined ? syntheticFixtureProvider() : options.fallbackMarketData;
  const trace = createTrace(clock, sensitiveStrings(input));

  const stages = Object.fromEntries(STAGE_ORDER.map((id) => [id, { status: "pending", attempts: 0 } as StageRecord])) as Record<StageId, StageRecord>;
  const state: WorkflowState = {
    runId: idFactory(),
    previousRunId,
    startedAt: clock().toISOString(),
    input,
    limits,
    providers: { reasoning: reasoning.id, marketData: marketData.id, fallbackMarketData: fallbackMarketData?.id ?? null },
    stages,
    executions: [],
    transitions: [],
    directives: { suitability: [], strategy: [] },
    revisions: 0,
    modelCalls: 0,
    toolCalls: 0,
    fallbacks: 0,
    steps: 0,
    status: "running",
    trace: trace.entries,
  };
  const out = {
    profile: undefined as CustomerProfile | undefined,
    data: undefined as DataReport | undefined,
    suitability: undefined as SuitabilityReport | undefined,
    strategy: undefined as Strategy | undefined,
    challengerInput: undefined as ChallengerInput | undefined,
    challenge: undefined as ChallengeReport | undefined,
    validation: undefined as ValidationReport | undefined,
    nextStep: undefined as NextStepPlan | undefined,
  };
  let currentStage: StageId | "orchestrator" = "orchestrator";
  let pass = 0;
  const note = (event: TraceEvent, summary: string, data?: Record<string, unknown>) => trace.add(currentStage, event, summary, data);
  const transition = (from: Transition["from"], to: Transition["to"], reason: string) => {
    state.transitions.push({ from, to, reason });
    trace.add("orchestrator", "transition", `${from} -> ${to}: ${reason}`);
  };

  const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>, ms = limits.providerTimeoutMs): Promise<T> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject first so the race settles as a timeout, then abort the provider call.
        reject(new ProviderTimeoutError(`timed out after ${ms} ms`));
        controller.abort();
      }, ms);
    });
    try {
      return await Promise.race([fn(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const callModel: StageContext["callModel"] = async (task: ReasoningTask, payload, parse) => {
    let reason = "";
    const external = reasoning.kind === "bedrock-via-server";
    if (external && !options.externalProcessingConsent) reason = "no consent for external processing";
    else
      for (let attempt = 0; attempt <= limits.maxRetries; attempt++) {
        if (state.modelCalls >= limits.maxModelCalls) {
          reason = `model-call limit (${limits.maxModelCalls}) reached`;
          break;
        }
        state.modelCalls++;
        try {
          const raw = await withTimeout((signal) => reasoning.complete(task, payload, signal));
          const parsed = parse(raw);
          if (parsed.ok) return { value: parsed.value, providerId: reasoning.id, fallback: false };
          reason = `malformed output (${parsed.error})`;
        } catch (e) {
          reason = e instanceof ProviderTimeoutError ? `timeout (${limits.providerTimeoutMs} ms)` : `provider error (${e instanceof Error ? e.message : String(e)})`;
          // The server signalled that only deterministic rules are available
          // (e.g. no model key): retrying would only burn the call budget.
          if (e instanceof NonRetryableProviderError) break;
        }
        if (attempt < limits.maxRetries) note("retry", `${task}: ${reason}; retry ${attempt + 1}/${limits.maxRetries}`, { task, attempt: attempt + 1 });
      }
    const parsed = parse(await rules.complete(task, payload, new AbortController().signal));
    if (!parsed.ok) throw new StageError("no-safe-fallback", `${task}: deterministic fallback failed (${parsed.error})`);
    state.fallbacks++;
    note("fallback", `${task}: using deterministic rules after ${reason}`, { task, provider: rules.id });
    return { value: parsed.value, providerId: rules.id, fallback: true };
  };

  // Tools are deterministic and in-process; the budget bounds the work an
  // agent can trigger, and every call is traced with numbers-only summaries.
  // Duration uses the injected clock, so traces stay deterministic in tests.
  const callTool: StageContext["callTool"] = (name, args) => {
    if (state.toolCalls >= limits.maxToolCalls) {
      note("error", `tool ${name}: tool-call limit (${limits.maxToolCalls}) reached`, { tool: name, limit: limits.maxToolCalls });
      throw new StageError("tool-budget-exceeded", `tool-call limit (${limits.maxToolCalls}) reached before ${name}`);
    }
    state.toolCalls++;
    const started = clock().getTime();
    const result = runTool(name, args);
    const summary = summarizeToolCall(name, args, result);
    const durationMs = clock().getTime() - started;
    note("tool", `${name} #${state.toolCalls}: ${Object.entries(summary.result).map(([k, v]) => `${k} ${v}`).join(", ")}`, {
      tool: name,
      call: state.toolCalls,
      args: summary.args,
      result: summary.result,
      durationMs,
    });
    return result;
  };

  const view = () => ({
    input,
    reasoning: { id: reasoning.id },
    market: { providerId: marketData.id, fallbackId: fallbackMarketData?.id ?? null, asOfDay: clock().toISOString().slice(0, 10) },
    ...out,
    directives: state.directives,
    revision: pass,
  });

  const context = (id: StageId): StageContext => ({
    input,
    profile: out.profile,
    data: out.data,
    suitability: out.suitability,
    // Independence: the Challenger never sees the strategy object (rationale/narrative).
    strategy: id === "challenger" ? undefined : out.strategy,
    challengerInput: id === "challenger" ? out.challengerInput : undefined,
    challenge: out.challenge,
    validation: out.validation,
    nextStep: out.nextStep,
    directives: state.directives,
    revision: pass,
    limits,
    marketData,
    fallbackMarketData,
    clock,
    idFactory,
    callModel,
    callTool,
    withTimeout,
  });

  const runStage = async <T>(id: StageId): Promise<{ ok: true; output: T } | { ok: false; error: string }> => {
    if (state.steps >= limits.maxSteps) throw new LimitError(`step limit (${limits.maxSteps}) reached before ${id}`);
    state.steps++;
    currentStage = id;
    const node = STAGES[id];
    const { fingerprint, digest } = fingerprintOf(view(), node.reads);
    const record = state.stages[id];
    record.attempts++;
    const all = [...prevExecutions, ...state.executions];
    const reusable = [...all].reverse().find((e) => e.stage === id && e.fingerprint === fingerprint && e.status !== "failed" && e.output !== undefined);
    if (reusable) {
      const reason = `reused: inputs unchanged (fp ${fingerprint})`;
      state.executions.push({ seq: state.executions.length + 1, stage: id, pass, fingerprint, digest, status: "reused", output: reusable.output, reason });
      Object.assign(record, { status: "reused", fingerprint, output: reusable.output, reason, error: undefined });
      note("reuse", reason, { fingerprint });
      currentStage = "orchestrator";
      return { ok: true, output: reusable.output as T };
    }
    const comparable =
      [...prevExecutions].reverse().find((e) => e.stage === id && e.pass === pass) ??
      [...all].reverse().find((e) => e.stage === id);
    const changed = comparable ? changedKeys(comparable.digest, digest) : [];
    const reason = comparable ? `recomputed: ${changed.join(", ") || "inputs"} changed` : "first run";
    note("start", `${reason} (fp ${fingerprint})`, { fingerprint, changed });
    try {
      const agent = options.agents?.[id] ?? node.agent;
      const result = await agent(context(id));
      for (const n of result.notes) note(n.event, n.summary, n.data);
      state.executions.push({ seq: state.executions.length + 1, stage: id, pass, fingerprint, digest, status: "fresh", output: result.output, reason });
      Object.assign(record, { status: "fresh", fingerprint, output: result.output, reason, error: undefined });
      return { ok: true, output: result.output as T };
    } catch (e) {
      if (e instanceof LimitError) throw e;
      const error = e instanceof StageError ? e.reason : "agent-error";
      const message = e instanceof Error ? e.message : String(e);
      // Regression (eval scenario 'missing-market-data'): retry/error notes of a
      // failing stage used to be dropped, hiding why the stage failed.
      if (e instanceof StageError) for (const n of e.notes) note(n.event, n.summary, n.data);
      state.executions.push({ seq: state.executions.length + 1, stage: id, pass, fingerprint, digest, status: "failed", reason: error });
      Object.assign(record, { status: "failed", fingerprint, error, reason: message, output: undefined });
      note("error", `${id} failed: ${error}`, { error });
      return { ok: false, error };
    } finally {
      currentStage = "orchestrator";
    }
  };

  const skip = (ids: StageId[], reason: string) => {
    for (const id of ids) {
      Object.assign(state.stages[id], { status: "skipped", reason });
      trace.add(id, "skip", `skipped: ${reason}`);
    }
  };

  const finish = (status: TerminalStatus, unresolved: string[]): WorkflowState => {
    state.status = status;
    state.result = {
      status,
      strategy: status === "completed" ? out.strategy : undefined,
      validation: out.validation,
      challenge: out.challenge,
      nextStep: out.nextStep,
      unresolved,
    };
    trace.add("orchestrator", "transition", `terminal: ${status}${unresolved.length ? ` (${unresolved.length} unresolved)` : ""}`);
    return state;
  };

  trace.add("orchestrator", "start", previousRunId ? `rerun of ${previousRunId}` : "new run", {
    reasoning: reasoning.id,
    reasoningKind: reasoning.kind,
    marketData: marketData.id,
    limits,
  });

  try {
    transition("start", "profile", "always");
    const p = await runStage<CustomerProfile>("profile");
    if (!p.ok) {
      skip(["data", "suitability", "strategy", "challenger", "guardrail", "nextStep"], "profile stage failed");
      return finish("failed", [`profile: ${p.error}`]);
    }
    out.profile = p.output;
    if (p.output.missing.length || p.output.invalid.length) {
      const why = [...p.output.missing, ...p.output.invalid.map((e) => e.path)];
      skip(["data", "suitability", "strategy", "challenger", "guardrail"], `required information missing or invalid: ${why.join(", ")}`);
      state.transitions.push({ from: "profile", to: "nextStep", reason: "clarification needed" });
      trace.add("orchestrator", "transition", "profile -> nextStep: clarification needed");
      const r = await runStage<NextStepPlan>("nextStep");
      if (r.ok) out.nextStep = r.output;
      return finish("needs-clarification", why.map((w) => `missing or invalid: ${w}`));
    }

    transition("profile", "data", "required facts present");
    const d = await runStage<DataReport>("data");
    if (!d.ok) {
      skip(["suitability", "strategy", "challenger", "guardrail", "nextStep"], `no safe result without market assumptions (${d.error})`);
      return finish("failed", [d.error]);
    }
    out.data = d.output;
    transition("data", "suitability", `assumptions ${d.output.assumptions.kind}${d.output.flags.includes("fallback-applied") ? " (fallback disclosed)" : ""}`);

    let startAt: "suitability" | "strategy" = "suitability";
    let previousCore: string | undefined;
    const challengeHashes: string[] = [];
    for (;;) {
      if (startAt === "suitability") {
        const s = await runStage<SuitabilityReport>("suitability");
        if (!s.ok) {
          skip(["strategy", "challenger", "guardrail", "nextStep"], "suitability failed");
          return finish("failed", [s.error]);
        }
        out.suitability = s.output;
        if (s.output.status === "needs-clarification") {
          skip(["strategy", "challenger", "guardrail"], "constraints cannot be met without customer input");
          state.transitions.push({ from: "suitability", to: "nextStep", reason: "clarification needed" });
          trace.add("orchestrator", "transition", "suitability -> nextStep: clarification needed");
          const r = await runStage<NextStepPlan>("nextStep");
          if (r.ok) out.nextStep = r.output;
          return finish("needs-clarification", s.output.questions.map((q) => q.question));
        }
        transition("suitability", "strategy", `max equity ${(s.output.maxEquityShare * 100).toFixed(1)}%`);
      }
      const st = await runStage<Strategy>("strategy");
      if (!st.ok) {
        skip(["challenger", "guardrail", "nextStep"], "strategy failed");
        return finish("failed", [st.error]);
      }
      out.strategy = st.output;
      out.challengerInput = {
        strategyId: st.output.id,
        strategyVersion: st.output.version,
        weights: st.output.weights,
        assetMix: st.output.assetMix,
        liquidityBuckets: st.output.liquidityBuckets,
        investedInitialLei: st.output.investedInitialLei,
        monthlyContributionLei: st.output.monthlyContributionLei,
        horizonYears: st.output.horizonYears,
        targetLei: st.output.targetLei,
        projection: st.output.projection,
      };
      transition("strategy", "challenger", "every strategy is challenged before release");
      const c = await runStage<ChallengeReport>("challenger");
      if (!c.ok) {
        skip(["guardrail", "nextStep"], "challenger failed; strategy cannot be released unchallenged");
        return finish("failed", [c.error]);
      }
      out.challenge = c.output;

      // Conflicting conclusions: suitability (planning drawdowns) vs challenger (severe scenario).
      const suit = out.suitability!;
      const severe = c.output.findings.find((f) => f.id === "severe-crash-loss");
      if (severe) {
        const planningLoss = stressLoss(st.output.assetMix, suit.drawdownBasis);
        if (planningLoss <= suit.lossTolerance + 1e-9)
          trace.add("orchestrator", "conflict", `suitability: loss ${(planningLoss * 100).toFixed(1)}% within tolerance under ${suit.drawdownBasis.source}; challenger: ${severe.message} Resolution: stricter outcome wins.`, {
            planningLoss,
            severeLoss: severe.evidence.computed.portfolioLossPct,
            tolerance: suit.lossTolerance,
          });
      }

      const serious = c.output.findings.filter((f) => f.severity !== "info");
      const needsCustomer = serious.filter((f) => f.routeTo === "profile");
      if (needsCustomer.length)
        trace.add("orchestrator", "transition", `findings needing customer input kept open: ${needsCustomer.map((f) => f.id).join(", ")}`);
      const actionable = serious.filter((f) => f.routeTo !== "profile" && !st.output.acknowledgedFindings.includes(f.id));
      if (actionable.length === 0) {
        transition("challenger", "guardrail", serious.length ? "remaining findings acknowledged or need customer input" : "no material findings");
        break;
      }
      const core = fnv1a(stableStringify({ w: st.output.weights, b: st.output.liquidityBuckets }));
      const challengeHash = fnv1a(stableStringify(c.output.findings.map((f) => [f.id, f.severity])));
      if ((previousCore !== undefined && core === previousCore) || challengeHashes.includes(`${core}:${challengeHash}`)) {
        trace.add("orchestrator", "conflict", "loop detected: revision produced no change; stopping revisions", { core });
        transition("challenger", "guardrail", "loop detected - unresolved findings go to validation");
        break;
      }
      challengeHashes.push(`${core}:${challengeHash}`);
      if (state.revisions >= limits.maxRevisions) {
        transition("challenger", "guardrail", `revision limit (${limits.maxRevisions}) reached; ${actionable.length} finding(s) unresolved`);
        break;
      }
      previousCore = core;
      state.revisions++;
      pass++;
      addDirectives(state.directives, actionable);
      startAt = actionable.some((f) => f.routeTo === "suitability") ? "suitability" : "strategy";
      const invalidated = STAGE_ORDER.slice(STAGE_ORDER.indexOf(startAt), STAGE_ORDER.indexOf("challenger") + 1);
      for (const id of invalidated) Object.assign(state.stages[id], { status: "invalidated", reason: `revision ${state.revisions}: ${actionable.map((f) => f.id).join(", ")}` });
      trace.add("orchestrator", "transition", `revision ${state.revisions}/${limits.maxRevisions}: invalidated [${invalidated.join(", ")}]`, {
        findings: actionable.map((f) => ({ id: f.id, severity: f.severity, routeTo: f.routeTo })),
      });
      if (startAt === "strategy")
        trace.add("suitability", "reuse", `kept: no finding targets constraints (fp ${state.stages.suitability.fingerprint})`);
      state.transitions.push({ from: "challenger", to: startAt, reason: `revision ${state.revisions}: ${actionable.map((f) => f.id).join(", ")}` });
      trace.add("orchestrator", "transition", `challenger -> ${startAt}: revision ${state.revisions} for ${actionable.map((f) => f.id).join(", ")}`);
    }

    let g = await runStage<ValidationReport>("guardrail");
    if (!g.ok) {
      skip(["nextStep"], "guardrail failed; nothing is released without validation");
      return finish("failed", [g.error]);
    }
    if (g.output.narrativeFailed && out.strategy && !out.strategy.narrative.repaired) {
      const s = out.strategy;
      trace.add("orchestrator", "conflict", "narrative claims vs computed numbers disagree; replacing narrative with deterministic template", {
        failed: g.output.checks.filter((x) => !x.pass).map((x) => x.id),
      });
      // Regression (eval scenario 'conflicting-conclusions'): the challenger's
      // model-written summary is also customer-facing and checked for claims.
      // Previously only the strategy narrative was repaired, so a prohibited
      // claim in the summary withheld a plan whose deterministic findings were
      // fine. The summary is rebuilt from the findings themselves.
      const ch = out.challenge;
      // Regression (eval scenario 'invented-summary-number'): numbers in the
      // summary that no finding backs also trigger the rebuild.
      if (ch && (bannedClaims(ch.summary.text).length || unbackedSummaryNumbers(ch).length)) {
        const t = explainObjectionsTemplate({ findings: ch.findings.map((f) => ({ id: f.id, severity: f.severity, message: f.message })) });
        out.challenge = { ...ch, summary: { ...t, source: rules.id, repaired: true } };
        state.stages.challenger.output = out.challenge;
        trace.add("orchestrator", "conflict", "challenger summary contained prohibited claims or unbacked numbers; replaced with deterministic summary of the findings");
      }
      const t = explainStrategyTemplate(explainStrategyInput(s));
      out.strategy = { ...s, narrative: { ...t, source: rules.id, repaired: true } };
      state.stages.strategy.output = out.strategy;
      transition("guardrail", "guardrail", "re-validate after deterministic narrative repair");
      g = await runStage<ValidationReport>("guardrail");
      if (!g.ok) {
        skip(["nextStep"], "guardrail failed");
        return finish("failed", [g.error]);
      }
    }
    out.validation = g.output;
    transition("guardrail", "nextStep", `validation ${g.output.status}`);
    const r = await runStage<NextStepPlan>("nextStep");
    if (r.ok) out.nextStep = r.output;
    const failedChecks = g.output.checks.filter((x) => !x.pass).map((x) => `check failed: ${x.id} (${x.detail})`);
    const status: TerminalStatus =
      g.output.status === "withheld" ? "withheld" : g.output.status === "needs-clarification" ? "needs-clarification" : "completed";
    return finish(status, [...failedChecks, ...g.output.openIssues]);
  } catch (e) {
    if (e instanceof LimitError) {
      trace.add("orchestrator", "error", e.message);
      for (const id of STAGE_ORDER) if (state.stages[id].status === "pending" || state.stages[id].status === "invalidated") Object.assign(state.stages[id], { status: "skipped", reason: e.message });
      return finish("failed", [e.message]);
    }
    throw e;
  }
}

function addDirectives(directives: Directives, findings: Finding[]) {
  for (const f of findings) {
    if (!f.remedy) continue;
    const list = f.routeTo === "suitability" ? directives.suitability : directives.strategy;
    const i = list.findIndex((d) => d.findingId === f.id);
    const existing = i >= 0 ? list[i] : undefined;
    if (existing && stableStringify(existing.remedy) === stableStringify(f.remedy)) continue;
    let remedy = f.remedy;
    // A remaining reserve shortfall adds to the earlier top-up instead of replacing it.
    if (existing?.remedy.kind === "top-up-reserve" && remedy.kind === "top-up-reserve")
      remedy = { kind: "top-up-reserve", amountLei: existing.remedy.amountLei + remedy.amountLei };
    if (i >= 0) list.splice(i, 1);
    list.push({ findingId: f.id, remedy });
  }
}

/** Compact per-stage status overview for UIs and CLI output. */
export function stageSummary(state: WorkflowState) {
  return STAGE_ORDER.map((id) => ({ stage: id, status: state.stages[id].status, attempts: state.stages[id].attempts, reason: state.stages[id].reason }));
}
