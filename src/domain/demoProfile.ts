// One synthetic demo customer. Not a real person; every value is invented
// for the demonstration and marked as a scenario fixture.
import type { IntakeInput } from "./types.ts";

export const DEMO_PROFILE_NAME = "Ana (synthetic demo)";

/**
 * Tuned so the workflow shows a real challenge-and-revise loop:
 * the first proposal reaches 90,000 lei in the base case, the Challenger
 * finds material weaknesses (severe-crash loss above the 15% limit, a reserve
 * of 1.5 months vs the 3-month rule, single-company concentration), the
 * workflow routes back to Suitability, and the revised scenario changes the
 * allocation and liquidity buckets and reports the remaining gap with levers.
 * Deviation from the original brief: initial capital is 35,000 lei (not
 * 20,000) because with 20,000 lei and the 15,000 lei wedding withdrawal held
 * in cash no allowed allocation can reach the target even in the base case.
 */
export const demoProfile: IntakeInput = {
  goal: { label: "Apartment down payment", targetAmount: 90_000, horizonYears: 7, flexibility: "flexible" },
  initialCapital: 35_000,
  monthlyContribution: 700,
  monthlyEssentialExpenses: 4_000,
  emergencyFund: 6_000,
  plannedWithdrawals: [{ label: "Wedding", amount: 15_000, inYears: 2 }],
  statedRisk: "growth",
  maxAcceptableLossPct: 0.15,
  holdings: [{ label: "Employer shares (synthetic)", assetClass: "single-stock", value: 12_000 }],
  freeText: "I want to save 90,000 lei for an apartment down payment in 7 years. I keep a small emergency fund.",
  inputSource: "scenario-fixture",
};
