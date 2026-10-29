// Shared, typed domain model for the Goal -> Strategy -> Stress-Test workflow.
// Units: all amounts are lei (currency code RON) as plain numbers in full
// precision; rates are decimals per year (0.06 = 6%/yr); horizons are whole
// years. Rounding happens only for display (whole lei) and comparisons use a
// tolerance of 0.01 lei (see calculations.ts).
import type { Risk } from "../lib/finance.ts";
import type { AdviserBriefing } from "../handoff/briefing.ts";

export type { Risk };

export type Currency = "RON";
export type AssetClass = "equity" | "bond" | "cash";
export type HoldingClass = AssetClass | "single-stock";

export type PlannedWithdrawal = { label: string; amount: number; inYears: number };
export type Holding = { label: string; assetClass: HoldingClass; value: number };

export type GoalInput = {
  label: string;
  targetAmount?: number;
  horizonYears?: number;
  targetIsInTodaysMoney?: boolean;
  flexibility?: "fixed" | "flexible";
};

export type IntakeInput = {
  goal?: GoalInput;
  initialCapital?: number;
  monthlyContribution?: number;
  monthlyEssentialExpenses?: number;
  emergencyFund?: number;
  plannedWithdrawals?: PlannedWithdrawal[];
  /** Stated maximum acceptable temporary loss, e.g. 0.15 = 15%. */
  maxAcceptableLossPct?: number;
  statedRisk?: Risk;
  holdings?: Holding[];
  freeText?: string;
  customerRequests?: string[];
  /** Where structured values came from. Defaults to 'user-form'. */
  inputSource?: "user-form" | "scenario-fixture";
};

export type FactSource = "user-form" | "user-text-extracted" | "scenario-fixture";
export type Fact<T> = { value: T; source: FactSource; confirmed: boolean };

/** Normalized facts. A missing fact is ABSENT - never defaulted. */
export type ProfileFacts = {
  goalLabel?: Fact<string>;
  targetAmount?: Fact<number>;
  horizonYears?: Fact<number>;
  targetIsInTodaysMoney?: Fact<boolean>;
  flexibility?: Fact<"fixed" | "flexible">;
  initialCapital?: Fact<number>;
  monthlyContribution?: Fact<number>;
  monthlyEssentialExpenses?: Fact<number>;
  emergencyFund?: Fact<number>;
  plannedWithdrawals?: Fact<PlannedWithdrawal[]>;
  maxAcceptableLossPct?: Fact<number>;
  statedRisk?: Fact<Risk>;
  holdings?: Fact<Holding[]>;
};

export type FactKey = keyof ProfileFacts;

export type ClarificationQuestion = { field: string; question: string; reason: string };

/** Categories derived from customer requests; the raw text is never stored downstream. */
export type RequestFlag =
  | "guaranteed-return"
  | "trade-execution"
  | "specific-security"
  | "adviser-request";

export type ValidationError = { path: string; message: string };

export type CustomerProfile = {
  currency: Currency;
  facts: ProfileFacts;
  /** field -> source, used by the data stage for provenance (values excluded). */
  sources: Partial<Record<FactKey, FactSource>>;
  missing: string[];
  ambiguities: string[];
  invalid: ValidationError[];
  questions: ClarificationQuestion[];
  requestFlags: RequestFlag[];
  extraction: { attempted: boolean; accepted: string[]; rejected: string[]; provider?: string };
};

// ---------- Market data ----------
export type MarketDataKind = "synthetic-fixture" | "cached" | "live";
export type AssetClassAssumption = { expectedReturn: number; stressDrawdown: number };
export type CapitalMarketAssumptions = {
  /** ISO date (YYYY-MM-DD). */
  asOf: string;
  kind: MarketDataKind;
  sourceLabel: string;
  assetClasses: Record<AssetClass, AssetClassAssumption>;
  inflation: number;
  units: "decimal-per-year";
};

export type ProvenanceEntry = { field: string; source: string; asOf?: string };

export type DataFlag = "synthetic-assumptions" | "fallback-applied" | "stale-source-rejected";

export type DataReport = {
  assumptions: CapitalMarketAssumptions;
  providerId: string;
  freshness: "fresh" | "stale" | "not-applicable";
  ageDays?: number;
  flags: DataFlag[];
  provenance: ProvenanceEntry[];
  notes: string[];
};

// ---------- Suitability ----------
export type DrawdownBasis = {
  label: string;
  equity: number;
  bond: number;
  cash: number;
  source: "market-data-planning" | "challenger-severe-scenario";
};

export type LiquidityRequirement = {
  purpose: "planned-withdrawal" | "emergency-reserve";
  label: string;
  amountLei: number;
  neededInYears: number;
};

export type SuitabilityConflict = {
  id: string;
  description: string;
  resolution: string;
  requiresConfirmation: boolean;
};

export type SuitabilityReport = {
  status: "ok" | "needs-clarification";
  maxEquityShare: number;
  equityCaps: { source: string; cap: number }[];
  lossTolerance: number;
  lossToleranceSource: "stated-max-loss" | "stated-risk-mapping";
  drawdownBasis: DrawdownBasis;
  reserveRequiredLei?: number;
  reserveGapLei?: number;
  reserveMonths?: number;
  liquidityRequirements: LiquidityRequirement[];
  laterWithdrawals: { label: string; amountLei: number; inYears: number }[];
  conflicts: SuitabilityConflict[];
  questions: ClarificationQuestion[];
  appliedDirectives: string[];
  policyNote: string;
};

// ---------- Strategy ----------
export type LiquidityBucket = {
  id: string;
  purpose: "planned-withdrawal" | "emergency-reserve-top-up";
  label: string;
  amountLei: number;
  neededInYears: number;
  blockId: string;
};

export type Lever = {
  id: "increase-contribution" | "extend-horizon" | "lower-target" | "review-concentration";
  description: string;
  value?: number;
  unit?: "lei-per-month" | "years" | "lei";
};

export type ProjectionSummary = {
  nominal: number;
  real: number;
  contributed: number;
  netReturn: number;
  grossReturn: number;
  fee: number;
  inflation: number;
  points: { year: number; nominal: number; real: number }[];
};

export type StrategyCandidate = {
  label: "Cautious" | "Balanced" | "Growth-tilted";
  weights: Record<string, number>;
  equityShare: number;
  projection: ProjectionSummary;
  gapLei: number;
  planningStressLoss: number;
};

export type Narrative = { text: string; citedNumbers: number[]; source: string; repaired?: boolean };

export type Strategy = {
  id: string;
  version: number;
  label: StrategyCandidate["label"];
  weights: Record<string, number>;
  assetMix: Record<AssetClass, number>;
  equityShare: number;
  liquidityBuckets: LiquidityBucket[];
  investedInitialLei: number;
  monthlyContributionLei: number;
  horizonYears: number;
  targetLei: number;
  assumptions: string[];
  projection: ProjectionSummary;
  gapLei: number;
  levers: Lever[];
  candidates: StrategyCandidate[];
  rationale: string;
  risks: string[];
  narrative: Narrative;
  disclosures: string[];
  addressedFindings: string[];
  acknowledgedFindings: string[];
  feasibleAtAllowedAllocation: boolean;
};

// ---------- Challenger ----------
export type FindingSeverity = "blocking" | "material" | "info";
export type Remedy =
  | { kind: "tighten-drawdown-basis"; drawdowns: { equity: number; bond: number; cash: number } }
  | { kind: "top-up-reserve"; amountLei: number }
  | { kind: "ring-fence-withdrawal"; label: string; amountLei: number; inYears: number }
  | { kind: "acknowledge-external"; topic: string }
  | { kind: "recompute-projection" }
  | { kind: "request-information"; field: string };

export type Finding = {
  id: string;
  test: string;
  severity: FindingSeverity;
  failedConstraint?: string;
  evidence: { inputs: Record<string, unknown>; computed: Record<string, unknown> };
  routeTo: "suitability" | "strategy" | "profile";
  remedy?: Remedy;
  message: string;
};

export type ChallengeReport = {
  strategyId: string;
  strategyVersion: number;
  testsRun: string[];
  findings: Finding[];
  summary: Narrative;
};

// ---------- Guardrail ----------
export type ValidationStatus =
  | "validated"
  | "validated-with-open-issues"
  | "withheld"
  | "needs-clarification";
export type ValidationCheck = { id: string; pass: boolean; detail: string; hard: boolean };
export type ValidationReport = {
  checks: ValidationCheck[];
  status: ValidationStatus;
  openIssues: string[];
  narrativeFailed: boolean;
};

// ---------- Next step ----------
export type SafetyResponse = { flag: RequestFlag; message: string };
export type NextStepPlan = {
  primary: "answer-questions" | "review-scenarios" | "talk-to-adviser" | "review-validated-plan" | "none";
  questions: ClarificationQuestion[];
  scenarioSuggestions: Lever[];
  adviser: { recommended: boolean; reasons: string[] };
  safetyResponses: SafetyResponse[];
  briefing?: AdviserBriefing;
  message: string;
};
