// Explicit stage graph: nodes (agents + the state slices they read) and the
// conditional transitions the engine may take. The engine decides each
// transition from actual outputs; this table documents every allowed edge.
import type { Agent, StageId } from "./context.ts";
import { profileAgent, profileReads } from "../agents/profile.ts";
import { dataAgent, dataReads } from "../agents/data.ts";
import { suitabilityAgent, suitabilityReads } from "../agents/suitability.ts";
import { strategyAgent, strategyReads } from "../agents/strategy.ts";
import { challengerAgent, challengerReads } from "../agents/challenger.ts";
import { guardrailAgent, guardrailReads } from "../agents/guardrail.ts";
import { nextStepAgent, nextStepReads } from "../agents/nextStep.ts";

export type StageNode = { id: StageId; title: string; agent: Agent<unknown>; reads: string[] };

export const STAGES: Record<StageId, StageNode> = {
  profile: { id: "profile", title: "A. Goal & Profile", agent: profileAgent as Agent<unknown>, reads: profileReads },
  data: { id: "data", title: "B. Data & Assumptions", agent: dataAgent as Agent<unknown>, reads: dataReads },
  suitability: { id: "suitability", title: "C. Suitability & Constraints", agent: suitabilityAgent as Agent<unknown>, reads: suitabilityReads },
  strategy: { id: "strategy", title: "D. Strategy", agent: strategyAgent as Agent<unknown>, reads: strategyReads },
  challenger: { id: "challenger", title: "E. Independent Challenger", agent: challengerAgent as Agent<unknown>, reads: challengerReads },
  guardrail: { id: "guardrail", title: "F. Guardrail & Validation", agent: guardrailAgent as Agent<unknown>, reads: guardrailReads },
  nextStep: { id: "nextStep", title: "G. Next Step & Handoff", agent: nextStepAgent as Agent<unknown>, reads: nextStepReads },
};

export type TerminalStatus = "completed" | "needs-clarification" | "withheld" | "failed";

export type Edge = { from: StageId | "start"; to: StageId | TerminalStatus; when: string };

export const EDGES: Edge[] = [
  { from: "start", to: "profile", when: "always" },
  { from: "profile", to: "data", when: "all required facts present and valid" },
  { from: "profile", to: "nextStep", when: "required facts missing or invalid (data..guardrail skipped)" },
  { from: "data", to: "suitability", when: "valid assumptions (fresh, synthetic, or disclosed fallback)" },
  { from: "data", to: "failed", when: "no valid assumptions and no safe fallback" },
  { from: "suitability", to: "strategy", when: "constraints computed" },
  { from: "suitability", to: "nextStep", when: "constraints cannot all be met without customer input" },
  { from: "strategy", to: "challenger", when: "always (strategy is never released unchallenged)" },
  { from: "challenger", to: "suitability", when: "material/blocking finding routed to constraints, revisions < max" },
  { from: "challenger", to: "strategy", when: "material/blocking finding routed to strategy, revisions < max" },
  { from: "challenger", to: "guardrail", when: "no actionable findings, revision limit reached, or no progress (loop detected)" },
  { from: "guardrail", to: "guardrail", when: "narrative failed claim/number checks: deterministic narrative repair, once" },
  { from: "guardrail", to: "nextStep", when: "always" },
  { from: "nextStep", to: "completed", when: "validation status validated or validated-with-open-issues" },
  { from: "nextStep", to: "withheld", when: "a hard check failed" },
  { from: "nextStep", to: "needs-clarification", when: "required information missing" },
];
