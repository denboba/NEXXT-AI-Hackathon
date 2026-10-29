// Hand-rolled runtime validators (no schema library is available offline).
import type { IntakeInput, ValidationError } from "./types.ts";

export type ValidationResult = { ok: boolean; errors: ValidationError[] };

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export const isFiniteNonNeg = (v: unknown): v is number => isFiniteNumber(v) && v >= 0;
export const inRange = (v: unknown, min: number, max: number): v is number =>
  isFiniteNumber(v) && v >= min && v <= max;
export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isNonEmptyString = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

const RISKS = ["steady", "balanced", "growth"];
const HOLDING_CLASSES = ["equity", "bond", "cash", "single-stock"];
/** Upper bound for any single amount: guards against unit mistakes (e.g. bani vs lei). */
export const MAX_AMOUNT_LEI = 100_000_000;

/**
 * Validates the shape, units and ranges of an intake. Absent optional fields
 * are fine (they become "missing" facts, never defaults); present fields must
 * be well-formed. Errors carry dotted field paths.
 */
export function validateIntake(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!isPlainObject(raw)) return { ok: false, errors: [{ path: "", message: "Intake must be an object" }] };
  const input = raw as Record<string, unknown>;
  const amount = (path: string, v: unknown) => {
    if (v === undefined) return;
    if (!isFiniteNonNeg(v)) err(path, "Must be a finite amount in lei >= 0");
    else if (v > MAX_AMOUNT_LEI) err(path, `Must be <= ${MAX_AMOUNT_LEI} lei`);
  };

  if (input.goal !== undefined) {
    if (!isPlainObject(input.goal)) err("goal", "Must be an object");
    else {
      const g = input.goal;
      if (!isNonEmptyString(g.label, 120)) err("goal.label", "Must be a non-empty string (max 120 chars)");
      if (g.targetAmount !== undefined) {
        if (!isFiniteNumber(g.targetAmount) || g.targetAmount <= 0)
          err("goal.targetAmount", "Must be a positive amount in lei");
        else amount("goal.targetAmount", g.targetAmount);
      }
      if (g.horizonYears !== undefined && !(Number.isInteger(g.horizonYears) && inRange(g.horizonYears, 1, 50)))
        err("goal.horizonYears", "Must be a whole number of years between 1 and 50");
      if (g.targetIsInTodaysMoney !== undefined && typeof g.targetIsInTodaysMoney !== "boolean")
        err("goal.targetIsInTodaysMoney", "Must be a boolean");
      if (g.flexibility !== undefined && g.flexibility !== "fixed" && g.flexibility !== "flexible")
        err("goal.flexibility", "Must be 'fixed' or 'flexible'");
    }
  }
  amount("initialCapital", input.initialCapital);
  amount("monthlyContribution", input.monthlyContribution);
  amount("monthlyEssentialExpenses", input.monthlyEssentialExpenses);
  amount("emergencyFund", input.emergencyFund);
  if (input.maxAcceptableLossPct !== undefined && !inRange(input.maxAcceptableLossPct, 0, 1))
    err("maxAcceptableLossPct", "Must be a decimal between 0 and 1 (0.15 = 15%)");
  if (input.statedRisk !== undefined && !RISKS.includes(input.statedRisk as string))
    err("statedRisk", "Must be one of steady, balanced, growth");

  if (input.plannedWithdrawals !== undefined) {
    if (!Array.isArray(input.plannedWithdrawals)) err("plannedWithdrawals", "Must be an array");
    else
      input.plannedWithdrawals.forEach((w, i) => {
        const p = `plannedWithdrawals[${i}]`;
        if (!isPlainObject(w)) return err(p, "Must be an object");
        if (!isNonEmptyString(w.label, 80)) err(`${p}.label`, "Must be a non-empty string");
        if (!isFiniteNumber(w.amount) || w.amount <= 0) err(`${p}.amount`, "Must be a positive amount in lei");
        else amount(`${p}.amount`, w.amount);
        if (!(Number.isInteger(w.inYears) && inRange(w.inYears, 0, 50)))
          err(`${p}.inYears`, "Must be a whole number of years between 0 and 50");
      });
  }
  if (input.holdings !== undefined) {
    if (!Array.isArray(input.holdings)) err("holdings", "Must be an array");
    else
      input.holdings.forEach((h, i) => {
        const p = `holdings[${i}]`;
        if (!isPlainObject(h)) return err(p, "Must be an object");
        if (!isNonEmptyString(h.label, 80)) err(`${p}.label`, "Must be a non-empty string");
        if (!HOLDING_CLASSES.includes(h.assetClass as string))
          err(`${p}.assetClass`, "Must be one of equity, bond, cash, single-stock");
        amount(`${p}.value`, h.value);
        if (h.value === undefined) err(`${p}.value`, "Required");
      });
  }
  if (input.freeText !== undefined && (typeof input.freeText !== "string" || input.freeText.length > 2000))
    err("freeText", "Must be a string of at most 2000 characters");
  if (input.customerRequests !== undefined) {
    if (!Array.isArray(input.customerRequests)) err("customerRequests", "Must be an array of strings");
    else
      input.customerRequests.forEach((r, i) => {
        if (typeof r !== "string" || r.length > 500) err(`customerRequests[${i}]`, "Must be a string (max 500 chars)");
      });
  }
  if (input.inputSource !== undefined && input.inputSource !== "user-form" && input.inputSource !== "scenario-fixture")
    err("inputSource", "Must be 'user-form' or 'scenario-fixture'");
  return { ok: errors.length === 0, errors };
}

/** Convenience type guard used by callers that already validated. */
export function asIntake(raw: unknown): IntakeInput | undefined {
  return validateIntake(raw).ok ? (raw as IntakeInput) : undefined;
}
