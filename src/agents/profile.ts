// Agent A - Goal & Profile. Normalizes intake into typed facts with
// provenance, extracts candidates from free text through the reasoning
// provider (validated, anti-invention checked), and detects missing or
// ambiguous information instead of filling gaps.
import type {
  ClarificationQuestion,
  CustomerProfile,
  Fact,
  FactKey,
  FactSource,
  ProfileFacts,
  RequestFlag,
} from "../domain/types.ts";
import { validateIntake } from "../domain/validate.ts";
import { numberAppearsIn, parseExtraction } from "../providers/llm.ts";
import type { Extraction } from "../providers/llm.ts";
import type { StageContext, StageResult, TraceNote } from "../orchestrator/context.ts";

export const profileReads = [
  "input.goal",
  "input.initialCapital",
  "input.monthlyContribution",
  "input.monthlyEssentialExpenses",
  "input.emergencyFund",
  "input.plannedWithdrawals",
  "input.maxAcceptableLossPct",
  "input.statedRisk",
  "input.holdings",
  "input.freeText",
  "input.customerRequests",
  "input.inputSource",
  "reasoning.id",
];

/** Loss budgets implied by a stated risk preference (illustrative policy). */
export const RISK_LOSS_BUDGET = { steady: 0.1, balanced: 0.2, growth: 0.3 } as const;

export const REQUIRED_FIELDS: { id: string; question: string; reason: string }[] = [
  {
    id: "goal.targetAmount",
    question: "How much money (in lei) do you want to have for this goal?",
    reason: "Needed to measure any scenario against your goal.",
  },
  {
    id: "goal.horizonYears",
    question: "In how many years do you need the money?",
    reason: "The horizon limits how much short-term risk a scenario can take.",
  },
  {
    id: "monthlyContribution|initialCapital",
    question: "How much can you start with, and how much can you add each month (in lei)?",
    reason: "Without a starting amount or monthly saving there is nothing to project.",
  },
  {
    id: "maxAcceptableLossPct|statedRisk",
    question: "What is the largest temporary fall in value (in %) you could live with without selling?",
    reason: "Your own risk limit decides the maximum equity share; it is never inferred from demographics.",
  },
];

export function classifyRequests(requests: string[] = []): RequestFlag[] {
  const flags = new Set<RequestFlag>();
  for (const r of requests) {
    if (/guarant|risk[- ]?free|can'?t lose|cannot lose|sure (?:return|profit)/i.test(r)) flags.add("guaranteed-return");
    if (/\b(buy|sell|execute|trade|place an? order|invest (?:it|the money) for me)\b/i.test(r)) flags.add("trade-execution");
    // The last alternative catches named companies ("Buy Tesla stock"); found by
    // the 'safety-boundary' eval scenario (previously only tickers were matched).
    if (
      /\b(stocks?|shares?|etfs?)\s+(?:of|in)\s+\w+|\b[A-Z]{2,5}\b\s+(?:stock|shares?)|\bticker\b|\b(?:[Bb]uy|[Ss]ell|[Pp]urchase)\s+(?:some\s+|more\s+)?[A-Z][\w.&-]*\s+(?:stocks?|shares?|etfs?)\b/.test(r)
    )
      flags.add("specific-security");
    if (/advis|human|talk to|speak (?:to|with)|call me|meeting|appointment/i.test(r)) flags.add("adviser-request");
  }
  return [...flags];
}

const EXTRACTABLE: { key: keyof Extraction & FactKey; label: string }[] = [
  { key: "targetAmount", label: "goal amount" },
  { key: "horizonYears", label: "horizon" },
  { key: "monthlyContribution", label: "monthly contribution" },
  { key: "initialCapital", label: "starting amount" },
];

export async function profileAgent(ctx: StageContext): Promise<StageResult<CustomerProfile>> {
  const input = ctx.input;
  const notes: TraceNote[] = [];
  const validation = validateIntake(input);
  const invalidPaths = validation.errors.map((e) => e.path);
  const isInvalid = (path: string) => invalidPaths.some((p) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[`));
  if (!validation.ok)
    notes.push({ event: "validation", summary: `intake has ${validation.errors.length} invalid field(s)`, data: { paths: invalidPaths } });

  const source: FactSource = input.inputSource === "scenario-fixture" ? "scenario-fixture" : "user-form";
  const facts: ProfileFacts = {};
  const sources: CustomerProfile["sources"] = {};
  const set = <K extends FactKey>(key: K, path: string, value: unknown) => {
    if (value === undefined || isInvalid(path)) return;
    (facts as Record<string, Fact<unknown>>)[key] = { value, source, confirmed: true };
    sources[key] = source;
  };
  if (input.goal && !invalidPaths.includes("goal")) set("goalLabel", "goal.label", input.goal.label);
  if (input.goal) {
    set("targetAmount", "goal.targetAmount", input.goal.targetAmount);
    set("horizonYears", "goal.horizonYears", input.goal.horizonYears);
    set("targetIsInTodaysMoney", "goal.targetIsInTodaysMoney", input.goal.targetIsInTodaysMoney);
    set("flexibility", "goal.flexibility", input.goal.flexibility);
  }
  set("initialCapital", "initialCapital", input.initialCapital);
  set("monthlyContribution", "monthlyContribution", input.monthlyContribution);
  set("monthlyEssentialExpenses", "monthlyEssentialExpenses", input.monthlyEssentialExpenses);
  set("emergencyFund", "emergencyFund", input.emergencyFund);
  set("plannedWithdrawals", "plannedWithdrawals", input.plannedWithdrawals);
  set("maxAcceptableLossPct", "maxAcceptableLossPct", input.maxAcceptableLossPct);
  set("statedRisk", "statedRisk", input.statedRisk);
  set("holdings", "holdings", input.holdings);

  const ambiguities: string[] = [];
  const questions: ClarificationQuestion[] = [];
  const extraction: CustomerProfile["extraction"] = { attempted: false, accepted: [], rejected: [] };

  const text = typeof input.freeText === "string" && !isInvalid("freeText") ? input.freeText.trim() : "";
  if (text) {
    extraction.attempted = true;
    const result = await ctx.callModel("extract-profile", { text }, parseExtraction);
    extraction.provider = result.providerId;
    for (const { key, label } of EXTRACTABLE) {
      const value = result.value[key];
      if (value === undefined) continue;
      // Anti-invention rule: an extracted number must literally appear in the text.
      if (!numberAppearsIn(text, value)) {
        extraction.rejected.push(key);
        notes.push({
          event: "validation",
          summary: `rejected-extraction: ${key} not present in the customer's text`,
          data: { field: key, reason: "number-not-in-source-text" },
        });
        continue;
      }
      const existing = facts[key] as Fact<number> | undefined;
      if (!existing) {
        (facts as Record<string, Fact<number>>)[key] = { value, source: "user-text-extracted", confirmed: false };
        sources[key] = "user-text-extracted";
        extraction.accepted.push(key);
        ambiguities.push(`The ${label} was taken from your description and needs your confirmation.`);
      } else if (Math.abs(existing.value - value) > 0.01) {
        ambiguities.push(`The ${label} in the form differs from the one in your description; the form value is used.`);
        extraction.accepted.push(key);
      } else extraction.accepted.push(key);
    }
    if (result.value.mentionsEmergencyFund && !facts.emergencyFund)
      questions.push({
        field: "emergencyFund",
        question: "You mentioned an emergency fund. How much is in it today (in lei)?",
        reason: "The reserve decides whether a sudden expense would force selling investments.",
      });
  }

  const missing: string[] = [];
  const has = (k: FactKey) => facts[k] !== undefined;
  const satisfied: Record<string, boolean> = {
    "goal.targetAmount": has("targetAmount"),
    "goal.horizonYears": has("horizonYears"),
    "monthlyContribution|initialCapital": has("monthlyContribution") || has("initialCapital"),
    "maxAcceptableLossPct|statedRisk": has("maxAcceptableLossPct") || has("statedRisk"),
  };
  for (const req of REQUIRED_FIELDS)
    if (!satisfied[req.id]) {
      missing.push(req.id);
      questions.push({ field: req.id, question: req.question, reason: req.reason });
    }
  for (const e of validation.errors)
    if (!missing.includes(e.path))
      questions.push({ field: e.path, question: `Please check the value for ${e.path}: ${e.message}.`, reason: "The value could not be used as entered." });

  const risk = facts.statedRisk?.value;
  const loss = facts.maxAcceptableLossPct?.value;
  if (risk !== undefined && loss !== undefined && RISK_LOSS_BUDGET[risk] > loss + 0.05)
    ambiguities.push(
      `Stated preference '${risk}' usually implies accepting larger temporary falls than the stated limit; the stricter stated limit is applied and should be confirmed.`,
    );

  const requestFlags = classifyRequests(input.customerRequests);
  notes.push({
    event: "output",
    summary: `profile: ${Object.keys(facts).length} facts, ${missing.length} missing, ${ambiguities.length} ambiguities, ${requestFlags.length} request flags`,
    data: { missing, requestFlags, extractionAccepted: extraction.accepted, extractionRejected: extraction.rejected },
  });
  return {
    output: { currency: "RON", facts, sources, missing, ambiguities, invalid: validation.errors, questions, requestFlags, extraction },
    notes,
  };
}
