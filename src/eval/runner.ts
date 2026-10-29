// Shared deterministic evaluation runner used by the CLI (npm run eval) and
// the in-app Evaluation Lab. Pass/fail is computed only from assertions
// evaluated against the actual orchestrator output. Framework-free: no React,
// no node: imports (only setTimeout/Date, available in browsers and Node).
import type { IntakeInput } from "../domain/types.ts";
import { deterministicProvider, httpProvider, replayProvider } from "../providers/llm.ts";
import type { ReasoningProvider } from "../providers/llm.ts";
import {
  cachedFixtureProvider,
  failingProvider,
  malformedMarketProvider,
  slowProvider,
  syntheticAssumptions,
  syntheticFixtureProvider,
} from "../providers/marketData.ts";
import type { MarketDataProvider } from "../providers/marketData.ts";
import { STAGE_ORDER } from "../orchestrator/context.ts";
import type { Limits, StageId } from "../orchestrator/context.ts";
import { rerunWorkflow, runWorkflow } from "../orchestrator/engine.ts";
import type { EngineOptions, WorkflowState } from "../orchestrator/engine.ts";
import { GLOBAL_INVARIANTS, assertion, evaluate, visitedStages } from "./assertions.ts";
import type { Assertion, AssertionContext, AssertionOutcome } from "./assertions.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { MarketDataSpec, ReasoningSpec, Scenario } from "./scenarios.ts";

/** Fixed evaluation clock: every run of every scenario sees the same time. */
export const EVAL_NOW = new Date("2026-01-15T09:00:00Z");
export const evalClock = () => EVAL_NOW;
/** Default per-scenario guard so a run can never stall the suite. */
export const DEFAULT_SCENARIO_TIMEOUT_MS = 5000;
/** Provider timeout used by the suite unless a scenario overrides it (keeps runs fast). */
export const EVAL_PROVIDER_TIMEOUT_MS = 200;

export type StageSummaryRow = {
  stage: StageId;
  status: WorkflowState["stages"][StageId]["status"];
  /** From the executions log: recomputed (fresh), reused, failed or not-run. */
  reusedOrRecomputed: "recomputed" | "reused" | "mixed" | "failed" | "not-run";
  executions: number;
};

export type ScenarioResult = {
  scenarioId: string;
  title: string;
  category: Scenario["category"];
  passed: boolean;
  skipped?: string;
  assertions: AssertionOutcome[];
  /** Undefined only when the run itself crashed or timed out (see `error`). */
  run?: WorkflowState;
  followUpRun?: WorkflowState;
  error?: string;
  /** Excluded from determinism comparisons. */
  durationMs: number;
  stageSummary: StageSummaryRow[];
  followUpStageSummary?: StageSummaryRow[];
  providers: { reasoning: string; marketData: string };
};

export type ScenarioOverrides = {
  /** Merged into the scenario input before the first run. */
  input?: Partial<IntakeInput>;
  limits?: Partial<Limits>;
  timeoutMs?: number;
  /** Overrides the scenario's follow-up change (used by replayScenario). */
  followUp?: Partial<IntakeInput>;
};

export function describeReasoning(spec: ReasoningSpec) {
  if (spec.kind === "deterministic") return "deterministic rules";
  if (spec.kind === "replay") return `replay fixture: ${spec.description}`;
  return `external HTTP model (consent ${spec.consent ? "given" : "not given"}; recording stub, no network)`;
}

export function describeMarketData(spec: MarketDataSpec) {
  switch (spec.kind) {
    case "synthetic":
      return "synthetic fixture";
    case "cached":
      return `cached synthetic snapshot as of ${spec.asOf}`;
    case "failing":
      return `failing provider${spec.fallback ? " (synthetic fallback)" : " (no fallback)"}`;
    case "slow":
      return `slow provider (${spec.delayMs} ms)`;
    case "malformed":
      return "malformed provider";
    case "spoofed-live":
      return "cached snapshot whose payload claims 'live'";
    case "partial-volatility":
      return `cached synthetic snapshot as of ${spec.asOf} with volatility for equity only (20%)`;
  }
}

function buildReasoning(spec: ReasoningSpec, probes: AssertionContext["probes"]): { provider: ReasoningProvider; consent: boolean } {
  if (spec.kind === "deterministic") return { provider: deterministicProvider(), consent: false };
  if (spec.kind === "replay") {
    const p = replayProvider(spec.fixtures());
    // Expose the live call log (the provider appends to this array).
    probes.replayCalls = p.calls;
    return { provider: p, consent: false };
  }
  const provider = httpProvider(async () => {
    probes.externalCalls++;
    return { ok: true, status: 200, json: async () => ({ output: {} }) };
  });
  return { provider, consent: spec.consent };
}

function buildMarketData(spec: MarketDataSpec): { primary: MarketDataProvider; fallback: MarketDataProvider | null | undefined } {
  switch (spec.kind) {
    case "synthetic":
      return { primary: syntheticFixtureProvider(), fallback: undefined };
    case "cached":
      return { primary: cachedFixtureProvider(spec.asOf), fallback: undefined };
    case "failing":
      return { primary: failingProvider(), fallback: spec.fallback ? undefined : null };
    case "slow":
      return { primary: slowProvider(spec.delayMs), fallback: undefined };
    case "malformed":
      return { primary: malformedMarketProvider(), fallback: undefined };
    case "spoofed-live":
      return {
        primary: {
          id: "cached-snapshot-unverified",
          kind: "cached",
          getAssumptions: async () => ({ ...syntheticAssumptions("2026-01-10"), kind: "live", sourceLabel: "Live market feed" }),
        },
        fallback: undefined,
      };
    case "partial-volatility": {
      const { equity, bond, cash } = syntheticAssumptions(spec.asOf).assetClasses;
      return {
        primary: cachedFixtureProvider(spec.asOf, {
          // Equity volatility differs from the 16% default, so keeping the payload value is observable.
          assetClasses: {
            equity: { ...equity, volatility: 0.2 },
            bond: { expectedReturn: bond.expectedReturn, stressDrawdown: bond.stressDrawdown },
            cash: { expectedReturn: cash.expectedReturn, stressDrawdown: cash.stressDrawdown },
          },
        }),
        fallback: undefined,
      };
    }
  }
}

const counterIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-run-${++n}`;
};

function summarize(run: WorkflowState): StageSummaryRow[] {
  return STAGE_ORDER.map((stage) => {
    const ex = run.executions.filter((e) => e.stage === stage);
    const fresh = ex.some((e) => e.status === "fresh");
    const reused = ex.some((e) => e.status === "reused");
    const failed = ex.some((e) => e.status === "failed");
    const reusedOrRecomputed: StageSummaryRow["reusedOrRecomputed"] =
      ex.length === 0 ? "not-run" : failed ? "failed" : fresh && reused ? "mixed" : fresh ? "recomputed" : "reused";
    return { stage, status: run.stages[stage].status, reusedOrRecomputed, executions: ex.length };
  });
}

/** Assertions derived from `scenario.expected`. */
export function expectedAssertions(scenario: Scenario): Assertion[] {
  const e = scenario.expected;
  const out: Assertion[] = [
    assertion("expected.terminal-status", `Terminal status is '${e.terminalStatus}'`, (run) => ({ pass: run.status === e.terminalStatus, detail: `status ${run.status}` })),
    assertion("expected.visited-stages", `Visits [${e.mustVisitStages.join(", ")}]`, (run) => {
      const visited = visitedStages(run);
      const missing = e.mustVisitStages.filter((s) => !visited.includes(s));
      return { pass: missing.length === 0, detail: `visited [${visited.join(", ")}]${missing.length ? `, missing [${missing.join(", ")}]` : ""}` };
    }),
  ];
  if (e.validationStatus)
    out.push(assertion("expected.validation-status", `Validation status is '${e.validationStatus}'`, (run) => ({ pass: run.result?.validation?.status === e.validationStatus, detail: `validation ${run.result?.validation?.status ?? "not-run"}` })));
  if (e.mustSkipStages)
    out.push(
      assertion("expected.skipped-stages", `Skips [${e.mustSkipStages.join(", ")}]`, (run) => {
        const notSkipped = e.mustSkipStages!.filter((s) => run.stages[s].status !== "skipped" || run.executions.some((x) => x.stage === s));
        return { pass: notSkipped.length === 0, detail: notSkipped.length ? `not skipped: [${notSkipped.join(", ")}]` : "all skipped with reasons" };
      }),
    );
  if (e.minRevisions !== undefined || e.maxRevisions !== undefined)
    out.push(
      assertion("expected.revisions", `Revisions within [${e.minRevisions ?? 0}, ${e.maxRevisions ?? "limit"}]`, (run) => ({
        pass: run.revisions >= (e.minRevisions ?? 0) && run.revisions <= (e.maxRevisions ?? run.limits.maxRevisions),
        detail: `revisions ${run.revisions}`,
      })),
    );
  if (e.followUpTerminalStatus)
    out.push(assertion("expected.follow-up-status", `Follow-up terminal status is '${e.followUpTerminalStatus}'`, (_run, ctx) => ({ pass: ctx.followUpRun?.status === e.followUpTerminalStatus, detail: `follow-up ${ctx.followUpRun?.status ?? "not run"}` })));
  if (e.maxDurationMs !== undefined)
    out.push(assertion("expected.duration", `Completes within ${e.maxDurationMs} ms`, (_run, ctx) => ({ pass: ctx.durationMs < e.maxDurationMs!, detail: `${Math.round(ctx.durationMs)} ms` })));
  return out;
}

class ScenarioTimeout extends Error {}

function withGuard<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScenarioTimeout(`scenario exceeded ${ms} ms guard`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** Runs one scenario (and its follow-up, if any) and evaluates every assertion. */
export async function runScenario(scenario: Scenario, overrides: ScenarioOverrides = {}): Promise<ScenarioResult> {
  const probes: AssertionContext["probes"] = { externalCalls: 0, replayCalls: [] };
  const reasoning = buildReasoning(scenario.providers.reasoning, probes);
  const market = buildMarketData(scenario.providers.marketData);
  const options: EngineOptions = {
    reasoning: reasoning.provider,
    externalProcessingConsent: reasoning.consent,
    marketData: market.primary,
    ...(market.fallback !== undefined ? { fallbackMarketData: market.fallback } : {}),
    limits: { providerTimeoutMs: EVAL_PROVIDER_TIMEOUT_MS, ...scenario.options?.limits, ...overrides.limits },
    clock: evalClock,
    idFactory: counterIds(scenario.id),
    agents: scenario.agents?.(),
  };
  const input: IntakeInput = { ...scenario.input, ...overrides.input };
  const followUpChange = overrides.followUp ?? scenario.followUp?.changedInput;
  const timeoutMs = overrides.timeoutMs ?? scenario.options?.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const base = {
    scenarioId: scenario.id,
    title: scenario.title,
    category: scenario.category,
    providers: { reasoning: describeReasoning(scenario.providers.reasoning), marketData: describeMarketData(scenario.providers.marketData) },
  };

  const started = Date.now();
  let run: WorkflowState;
  let followUpRun: WorkflowState | undefined;
  try {
    const both = (async () => {
      const first = await runWorkflow(input, options);
      const second = followUpChange ? await rerunWorkflow(first, followUpChange, options) : undefined;
      return { first, second };
    })();
    const r = await withGuard(both, timeoutMs);
    run = r.first;
    followUpRun = r.second;
  } catch (e) {
    const durationMs = Date.now() - started;
    const error = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      passed: false,
      assertions: [{ id: e instanceof ScenarioTimeout ? "runner.timeout" : "runner.crash", description: "Workflow reaches a terminal state without throwing", pass: false, detail: error }],
      error,
      durationMs,
      stageSummary: [],
    };
  }
  const durationMs = Date.now() - started;
  const ctx: AssertionContext = { followUpRun, durationMs, probes, now: EVAL_NOW };
  const all = [...expectedAssertions(scenario), ...scenario.assertions, ...GLOBAL_INVARIANTS];
  const assertions = all.map((a) => evaluate(a, run, ctx));
  return {
    ...base,
    passed: assertions.every((a) => a.pass),
    assertions,
    run,
    followUpRun,
    durationMs,
    stageSummary: summarize(run),
    followUpStageSummary: followUpRun ? summarize(followUpRun) : undefined,
  };
}

/** Re-runs a scenario with an input patch applied as a follow-up (for the UI "change one input" control). */
export function replayScenario(scenario: Scenario, inputPatch: Partial<IntakeInput>, overrides: Omit<ScenarioOverrides, "followUp"> = {}) {
  return runScenario(scenario, { ...overrides, followUp: inputPatch });
}

export type SuiteReport = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  results: ScenarioResult[];
};

/** Runs scenarios sequentially; ids not in `only` (when given) are reported as skipped. */
export async function runAll(opts: { scenarios?: Scenario[]; only?: string[]; onResult?: (r: ScenarioResult) => void } = {}): Promise<SuiteReport> {
  const scenarios = opts.scenarios ?? SCENARIOS;
  const started = Date.now();
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    let r: ScenarioResult;
    if (opts.only && opts.only.length && !opts.only.includes(s.id))
      r = {
        scenarioId: s.id,
        title: s.title,
        category: s.category,
        passed: false,
        skipped: "not selected (--only)",
        assertions: [],
        durationMs: 0,
        stageSummary: [],
        providers: { reasoning: describeReasoning(s.providers.reasoning), marketData: describeMarketData(s.providers.marketData) },
      };
    else r = await runScenario(s);
    results.push(r);
    opts.onResult?.(r);
  }
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => !r.skipped && r.passed).length;
  return { total: results.length, passed, failed: results.length - skipped - passed, skipped, durationMs: Date.now() - started, results };
}

/** Deterministic projection of a result for determinism comparisons (drops durationMs). */
export function comparableResult(r: ScenarioResult) {
  const { durationMs: _d, ...rest } = r;
  void _d;
  return JSON.parse(
    JSON.stringify({
      ...rest,
      // "finishes fast" style details contain timings; compare pass/fail only for them.
      assertions: rest.assertions.map((a) => (/\d+ ms$/.test(a.detail) ? { id: a.id, pass: a.pass } : a)),
    }),
  ) as unknown;
}
