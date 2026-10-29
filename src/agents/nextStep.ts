// Agent G - Next Step & Handoff. Chooses what the customer should do next
// from the validated state: answer targeted questions, review counterfactual
// scenarios, or talk to an adviser (with a data-minimized briefing). Requests
// for guaranteed returns, trade execution or specific real securities get an
// explicit explanation of the coach's limits.
import type { ClarificationQuestion, NextStepPlan, RequestFlag, SafetyResponse } from "../domain/types.ts";
import { buildAdviserBriefing } from "../handoff/briefing.ts";
import { StageError } from "../orchestrator/context.ts";
import type { StageContext, StageResult } from "../orchestrator/context.ts";

export const nextStepReads = ["profile", "suitability", "strategy", "challenge", "validation"];

export const LARGE_GOAL_THRESHOLD_LEI = 250_000;

export const SAFETY_MESSAGES: Record<RequestFlag, string> = {
  "guaranteed-return":
    "No one can guarantee investment returns. The coach only shows illustrative scenarios based on synthetic assumptions, and values can fall.",
  "trade-execution": "The coach cannot buy, sell or execute anything. It only prepares illustrations and an optional briefing for a conversation.",
  "specific-security": "The coach does not recommend specific real securities. It only uses fictional demo building blocks.",
  "adviser-request": "You asked to talk to a person. You can prepare a briefing for an adviser conversation below.",
};

export async function nextStepAgent(ctx: StageContext): Promise<StageResult<NextStepPlan>> {
  const profile = ctx.profile;
  if (!profile) throw new StageError("missing-upstream", "Next step needs a profile");
  const suit = ctx.suitability;
  const s = ctx.strategy;
  const v = ctx.validation;
  const ch = ctx.challenge;

  const questions: ClarificationQuestion[] = [];
  const addQ = (q: ClarificationQuestion) => {
    if (!questions.some((x) => x.field === q.field)) questions.push(q);
  };
  profile.questions.forEach(addQ);
  suit?.questions.forEach(addQ);
  for (const f of ch?.findings ?? [])
    if (f.remedy?.kind === "request-information")
      addQ({ field: f.remedy.field, question: `Could you tell us your ${f.remedy.field === "emergencyFund" ? "emergency fund amount (in lei)" : f.remedy.field}?`, reason: f.message });

  const safetyResponses: SafetyResponse[] = profile.requestFlags.map((flag) => ({ flag, message: SAFETY_MESSAGES[flag] }));

  const reasons: string[] = [];
  if (profile.requestFlags.includes("adviser-request")) reasons.push("explicit customer request");
  if (s && s.gapLei > 0) reasons.push("unresolved gap to the goal");
  if (ch?.findings.some((f) => f.id === "single-stock-concentration" && f.severity !== "info")) reasons.push("single-company concentration");
  if (suit?.conflicts.some((c) => c.requiresConfirmation)) reasons.push("conflicting constraints need confirmation");
  const target = profile.facts.targetAmount?.value;
  if (target !== undefined && target >= LARGE_GOAL_THRESHOLD_LEI) reasons.push("large goal");
  if (v?.status === "withheld") reasons.push("plan withheld by validation - needs human review");

  const needsClarification = profile.missing.length > 0 || profile.invalid.length > 0 || suit?.status === "needs-clarification" || v?.status === "needs-clarification";
  const scenarioSuggestions = s && s.gapLei > 0 ? s.levers.filter((l) => l.id !== "review-concentration") : [];
  const adviserRecommended = reasons.length > 0;
  const primary: NextStepPlan["primary"] = needsClarification
    ? "answer-questions"
    : v?.status === "withheld" || adviserRecommended
      ? "talk-to-adviser"
      : scenarioSuggestions.length
        ? "review-scenarios"
        : v
          ? "review-validated-plan"
          : "none";

  const openQuestions = [...questions.map((q) => q.question), ...(v?.openIssues ?? [])];
  const briefing = buildAdviserBriefing({
    createdAt: ctx.clock().toISOString(),
    profile,
    suitability: suit,
    strategy: v?.status === "withheld" ? undefined : s,
    validationStatus: v?.status ?? "not-run",
    reasons,
    openQuestions,
  });

  const message = {
    "answer-questions": `A few answers are needed before any scenario can be shown (${questions.length} question(s)).`,
    "talk-to-adviser": `A conversation with an adviser is suggested: ${reasons.join("; ")}.`,
    "review-scenarios": "Review the options that would close the gap; your target and horizon were not changed.",
    "review-validated-plan": "The illustrative scenario passed all checks. Review it and the stress tests.",
    none: "No next step available.",
  }[primary];

  return {
    output: { primary, questions, scenarioSuggestions, adviser: { recommended: adviserRecommended, reasons }, safetyResponses, briefing, message },
    notes: [
      {
        event: "output",
        summary: `next step: ${primary}; ${questions.length} question(s), ${scenarioSuggestions.length} lever(s), adviser ${adviserRecommended ? "recommended" : "not needed"}, ${safetyResponses.length} safety response(s)`,
        data: { primary, reasons, safetyFlags: profile.requestFlags },
      },
    ],
  };
}
