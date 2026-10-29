// Contracts shared by the orchestrator and the agents.
import type {
  ChallengeReport,
  CustomerProfile,
  DataReport,
  IntakeInput,
  LiquidityBucket,
  NextStepPlan,
  ProjectionSummary,
  Remedy,
  Strategy,
  SuitabilityReport,
  ValidationReport,
  AssetClass,
} from "../domain/types.ts";
import type { MarketDataProvider } from "../providers/marketData.ts";
import type { Parsed, ReasoningTask } from "../providers/llm.ts";

export type StageId = "profile" | "data" | "suitability" | "strategy" | "challenger" | "guardrail" | "nextStep";
export const STAGE_ORDER: StageId[] = ["profile", "data", "suitability", "strategy", "challenger", "guardrail", "nextStep"];

export type TraceEvent =
  | "start"
  | "output"
  | "validation"
  | "transition"
  | "retry"
  | "fallback"
  | "conflict"
  | "skip"
  | "reuse"
  | "error";

export type TraceNote = { event: TraceEvent; summary: string; data?: Record<string, unknown> };
export type StageResult<T> = { output: T; notes: TraceNote[] };

export type Limits = {
  maxSteps: number;
  maxRevisions: number;
  maxModelCalls: number;
  providerTimeoutMs: number;
  maxRetries: number;
  /** Cached/live market data older than this is stale. */
  maxDataAgeDays: number;
};
export const DEFAULT_LIMITS: Limits = {
  maxSteps: 25,
  maxRevisions: 2,
  maxModelCalls: 8,
  providerTimeoutMs: 8000,
  maxRetries: 1,
  maxDataAgeDays: 120,
};

export type DirectiveEntry = { findingId: string; remedy: Remedy };
export type Directives = { suitability: DirectiveEntry[]; strategy: DirectiveEntry[] };

/**
 * What the Challenger is allowed to see: profile facts, constraints and the
 * strategy's weights/buckets/projection. Deliberately NOT the rationale,
 * narrative, risks or the candidate comparison.
 */
export type ChallengerInput = {
  strategyId: string;
  strategyVersion: number;
  weights: Record<string, number>;
  assetMix: Record<AssetClass, number>;
  liquidityBuckets: LiquidityBucket[];
  investedInitialLei: number;
  monthlyContributionLei: number;
  horizonYears: number;
  targetLei: number;
  projection: ProjectionSummary;
};

export type ModelCallResult<T> = { value: T; providerId: string; fallback: boolean };

export type StageContext = {
  input: IntakeInput;
  profile?: CustomerProfile;
  data?: DataReport;
  suitability?: SuitabilityReport;
  strategy?: Strategy;
  challengerInput?: ChallengerInput;
  challenge?: ChallengeReport;
  validation?: ValidationReport;
  nextStep?: NextStepPlan;
  directives: Directives;
  revision: number;
  limits: Limits;
  marketData: MarketDataProvider;
  fallbackMarketData: MarketDataProvider | null;
  clock: () => Date;
  idFactory: () => string;
  /** Bounded, timed, validated model call with retry and deterministic fallback. */
  callModel<T>(task: ReasoningTask, input: object, parse: (raw: unknown) => Parsed<T>): Promise<ModelCallResult<T>>;
  /** Runs `fn` with an AbortSignal that fires after the provider timeout. */
  withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms?: number): Promise<T>;
};

export type Agent<T> = (ctx: StageContext) => Promise<StageResult<T>>;

/** Failure that the engine records as the stage's error reason. */
export class StageError extends Error {
  reason: string;
  /** Trace notes gathered before the failure (retries, rejected sources); recorded by the engine. */
  notes: TraceNote[];
  constructor(reason: string, message: string, notes: TraceNote[] = []) {
    super(message);
    this.reason = reason;
    this.notes = notes;
  }
}
