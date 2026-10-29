// Pure, framework-free view helpers that turn a WorkflowState into the
// evidence shown in the Decision Lab and the Evaluation Lab. Everything here
// is derived from recorded stage outputs and executions; nothing is invented.
import type { ChallengeReport, Finding, IntakeInput, Strategy, SuitabilityReport } from "../domain/types.ts";
import { STAGE_ORDER } from "./context.ts";
import type { StageId } from "./context.ts";
import type { StageExecution, Transition, WorkflowState } from "./engine.ts";

export const STAGE_TITLES: Record<StageId, string> = {
  profile: "Goal & constraints",
  data: "Planning assumptions",
  suitability: "Suitability limits",
  strategy: "Strategy proposal",
  challenger: "Independent stress test",
  guardrail: "Validation",
  nextStep: "Next step",
};

export type StageRow = {
  stage: StageId;
  title: string;
  status: WorkflowState["stages"][StageId]["status"];
  /** recomputed = only fresh executions; reused = only reused; mixed = both. */
  execution: "recomputed" | "reused" | "mixed" | "failed" | "not-run";
  executions: { pass: number; status: StageExecution["status"]; reason: string }[];
  reason?: string;
  error?: string;
};

export function stageRows(state: WorkflowState): StageRow[] {
  return STAGE_ORDER.map((stage) => {
    const ex = state.executions.filter((e) => e.stage === stage);
    const fresh = ex.some((e) => e.status === "fresh");
    const reused = ex.some((e) => e.status === "reused");
    const failed = ex.some((e) => e.status === "failed");
    const execution: StageRow["execution"] =
      ex.length === 0 ? "not-run" : failed ? "failed" : fresh && reused ? "mixed" : fresh ? "recomputed" : "reused";
    const record = state.stages[stage];
    return {
      stage,
      title: STAGE_TITLES[stage],
      status: record.status,
      execution,
      executions: ex.map((e) => ({ pass: e.pass, status: e.status, reason: e.reason })),
      reason: record.reason,
      error: record.error,
    };
  });
}

/** Transitions that sent the workflow backwards after a challenge. */
export function revisionTransitions(state: WorkflowState): Transition[] {
  return state.transitions.filter((t) => t.from === "challenger" && (t.to === "suitability" || t.to === "strategy"));
}

function lastByVersion<T>(items: T[], version: (t: T) => number): T[] {
  const map = new Map<number, T>();
  for (const item of items) map.set(version(item), item);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

/** Every strategy version proposed in this run (drafts included), oldest first. */
export function strategyVersions(state: WorkflowState): Strategy[] {
  const outputs = state.executions
    .filter((e) => e.stage === "strategy" && e.status !== "failed" && e.output)
    .map((e) => e.output as Strategy);
  return lastByVersion(outputs, (s) => s.version);
}

/** Every challenge report (one per challenged strategy version), oldest first. */
export function challengeVersions(state: WorkflowState): ChallengeReport[] {
  const outputs = state.executions
    .filter((e) => e.stage === "challenger" && e.status !== "failed" && e.output)
    .map((e) => e.output as ChallengeReport);
  return lastByVersion(outputs, (c) => c.strategyVersion);
}

export function suitabilityVersions(state: WorkflowState): SuitabilityReport[] {
  const out: SuitabilityReport[] = [];
  for (const e of state.executions)
    if (e.stage === "suitability" && e.status !== "failed" && e.output) {
      const s = e.output as SuitabilityReport;
      if (out.length === 0 || out[out.length - 1] !== s) out.push(s);
    }
  return out;
}

export const actionable = (f: Finding) => f.severity !== "info";

export type StressCase = { lossPct: number; valueAtGoalLei: number; shortfallLei: number };

/** Numbers of the Challenger's severe-crash test for one challenge report. */
export function stressCaseOf(challenge: ChallengeReport | undefined): StressCase | undefined {
  const f = challenge?.findings.find((x) => x.test === "severe-crash-before-goal");
  const c = f?.evidence.computed as Record<string, unknown> | undefined;
  if (!c || typeof c.portfolioLossPct !== "number" || typeof c.valueAtGoalLei !== "number") return undefined;
  return {
    lossPct: c.portfolioLossPct,
    valueAtGoalLei: c.valueAtGoalLei,
    shortfallLei: typeof c.shortfallLei === "number" ? c.shortfallLei : 0,
  };
}

export type Comparison = {
  initial?: Strategy;
  revised?: Strategy;
  initialChallenge?: ChallengeReport;
  finalChallenge?: ChallengeReport;
  /** Objections raised against the first version (non-info), strongest first. */
  objections: Finding[];
  /** Objections that no longer appear as actionable in the final challenge. */
  resolved: Finding[];
  /** Objections still actionable after the last challenge. */
  remaining: Finding[];
  changes: string[];
  released: boolean;
};

const SEVERITY_RANK: Record<Finding["severity"], number> = { blocking: 0, material: 1, info: 2 };
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const lei = (x: number) => `${Math.round(x).toLocaleString("en-GB")} lei`;

export function compareVersions(state: WorkflowState): Comparison {
  const versions = strategyVersions(state);
  const challenges = challengeVersions(state);
  const initial = versions[0];
  const revised = versions.length > 1 ? versions[versions.length - 1] : undefined;
  const initialChallenge = challenges[0];
  const finalChallenge = challenges.length ? challenges[challenges.length - 1] : undefined;
  const objections = (initialChallenge?.findings ?? []).filter(actionable).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const stillOpen = new Set((finalChallenge?.findings ?? []).filter(actionable).map((f) => f.id));
  const resolved = revised ? objections.filter((f) => !stillOpen.has(f.id)) : [];
  const remaining = (finalChallenge?.findings ?? []).filter(actionable);
  return {
    initial,
    revised,
    initialChallenge,
    finalChallenge,
    objections,
    resolved,
    remaining,
    changes: initial && revised ? describeChanges(initial, revised, stressCaseOf(initialChallenge), stressCaseOf(finalChallenge)) : [],
    released: state.status === "completed" && Boolean(state.result?.strategy),
  };
}

export function describeChanges(a: Strategy, b: Strategy, stressA?: StressCase, stressB?: StressCase): string[] {
  const out: string[] = [];
  if (a.label !== b.label) out.push(`Scenario label changed from ${a.label} to ${b.label}.`);
  else out.push(`Scenario label stays '${b.label}', but its contents changed as listed below.`);
  if (Math.abs(a.equityShare - b.equityShare) > 0.0005) out.push(`Equity share ${pct(a.equityShare)} -> ${pct(b.equityShare)}.`);
  const weights = (s: Strategy) =>
    Object.entries(s.weights)
      .map(([k, v]) => `${k} ${pct(v)}`)
      .join(", ");
  if (weights(a) !== weights(b)) out.push(`Building blocks ${weights(a)} -> ${weights(b)}.`);
  const bucketIds = new Set(a.liquidityBuckets.map((x) => `${x.purpose}:${Math.round(x.amountLei)}`));
  for (const bucket of b.liquidityBuckets)
    if (!bucketIds.has(`${bucket.purpose}:${Math.round(bucket.amountLei)}`))
      out.push(`Added cash bucket: ${bucket.purpose === "emergency-reserve-top-up" ? "emergency reserve top-up" : "planned withdrawal"} of ${lei(bucket.amountLei)}.`);
  if (Math.round(a.investedInitialLei) !== Math.round(b.investedInitialLei)) out.push(`Initially invested ${lei(a.investedInitialLei)} -> ${lei(b.investedInitialLei)}.`);
  if (stressA && stressB && Math.abs(stressA.lossPct - stressB.lossPct) > 0.0005) out.push(`Severe-crash loss of the invested part ${pct(stressA.lossPct)} -> ${pct(stressB.lossPct)}.`);
  if (Math.round(a.projection.nominal) !== Math.round(b.projection.nominal)) out.push(`Projected value ${lei(a.projection.nominal)} -> ${lei(b.projection.nominal)} (hypothetical, synthetic assumptions).`);
  if (Math.round(a.gapLei) !== Math.round(b.gapLei)) out.push(`Gap to target ${lei(a.gapLei)} -> ${lei(b.gapLei)}.`);
  const newLevers = b.levers.filter((l) => !a.levers.some((x) => x.id === l.id));
  if (newLevers.length) out.push(`Options added: ${newLevers.map((l) => l.description).join(" ")}`);
  return out;
}

export type RerunDelta = {
  changedFields: string[];
  recomputed: StageId[];
  reused: StageId[];
  notRun: StageId[];
  before: Snapshot;
  after: Snapshot;
};

export type Snapshot = {
  status: WorkflowState["status"];
  validation?: string;
  label?: string;
  equityShare?: number;
  projectedLei?: number;
  gapLei?: number;
  stressLossPct?: number;
  revisions: number;
  modelCalls: number;
};

export function snapshot(state: WorkflowState): Snapshot {
  const versions = strategyVersions(state);
  const last = state.result?.strategy ?? versions[versions.length - 1];
  const challenges = challengeVersions(state);
  return {
    status: state.status,
    validation: state.result?.validation?.status,
    label: last?.label,
    equityShare: last?.equityShare,
    projectedLei: last?.projection.nominal,
    gapLei: last?.gapLei,
    stressLossPct: stressCaseOf(challenges[challenges.length - 1])?.lossPct,
    revisions: state.revisions,
    modelCalls: state.modelCalls,
  };
}

/** Top-level input fields that differ between two runs (compared as JSON). */
export function changedInputFields(a: IntakeInput, b: IntakeInput): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof IntakeInput>;
  const out: string[] = [];
  for (const k of keys) {
    if (k === "goal") {
      const ga = (a.goal ?? {}) as Record<string, unknown>;
      const gb = (b.goal ?? {}) as Record<string, unknown>;
      for (const g of new Set([...Object.keys(ga), ...Object.keys(gb)])) if (JSON.stringify(ga[g]) !== JSON.stringify(gb[g])) out.push(`goal.${g}`);
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

export function rerunDelta(before: WorkflowState, after: WorkflowState): RerunDelta {
  const rows = stageRows(after);
  return {
    changedFields: changedInputFields(before.input, after.input),
    recomputed: rows.filter((r) => r.execution === "recomputed" || r.execution === "mixed").map((r) => r.stage),
    reused: rows.filter((r) => r.execution === "reused").map((r) => r.stage),
    notRun: rows.filter((r) => r.execution === "not-run").map((r) => r.stage),
    before: snapshot(before),
    after: snapshot(after),
  };
}
