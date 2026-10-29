// Data-minimized adviser briefing: goal, horizon, constraints, scenario
// comparison, open questions and the reason for the conversation. No free
// text, no customer requests verbatim, and no name/contact details unless the
// customer granted the 'contact-name' consent scope.
import type { CustomerProfile, Strategy, SuitabilityReport, ValidationStatus } from "../domain/types.ts";
import { roundLei } from "../domain/calculations.ts";

export type AdviserBriefing = {
  kind: "adviser-briefing";
  version: 1;
  createdAt: string;
  goal: { label?: string; targetLei?: number; horizonYears?: number; targetIsInTodaysMoney?: boolean };
  constraints: {
    maxEquitySharePct?: number;
    lossTolerancePct?: number;
    reserveRequiredLei?: number;
    liquidityBuckets: { purpose: string; amountLei: number; neededInYears: number }[];
  };
  selectedScenario?: string;
  scenarioComparison: { label: string; equitySharePct: number; projectedLei: number; gapLei: number }[];
  openQuestions: string[];
  reasons: string[];
  validationStatus: ValidationStatus | "not-run";
  disclaimers: string[];
  contactName?: string;
};

const pct1 = (x: number) => Math.round(x * 1000) / 10;

export function buildAdviserBriefing(args: {
  createdAt: string;
  profile: CustomerProfile;
  suitability?: SuitabilityReport;
  strategy?: Strategy;
  validationStatus: ValidationStatus | "not-run";
  reasons: string[];
  openQuestions: string[];
}): AdviserBriefing {
  const f = args.profile.facts;
  const s = args.strategy;
  const suit = args.suitability;
  return {
    kind: "adviser-briefing",
    version: 1,
    createdAt: args.createdAt,
    goal: {
      label: f.goalLabel?.value,
      targetLei: f.targetAmount?.value,
      horizonYears: f.horizonYears?.value,
      targetIsInTodaysMoney: f.targetIsInTodaysMoney?.value,
    },
    constraints: {
      maxEquitySharePct: suit ? pct1(suit.maxEquityShare) : undefined,
      lossTolerancePct: suit ? pct1(suit.lossTolerance) : undefined,
      reserveRequiredLei: suit?.reserveRequiredLei,
      liquidityBuckets: (s?.liquidityBuckets ?? []).map((b) => ({ purpose: b.purpose, amountLei: roundLei(b.amountLei), neededInYears: b.neededInYears })),
    },
    selectedScenario: s?.label,
    scenarioComparison: (s?.candidates ?? []).map((c) => ({
      label: c.label,
      equitySharePct: pct1(c.equityShare),
      projectedLei: roundLei(c.projection.nominal),
      gapLei: roundLei(c.gapLei),
    })),
    openQuestions: args.openQuestions,
    reasons: args.reasons,
    validationStatus: args.validationStatus,
    disclaimers: [
      "Prepared by an educational demo coach using synthetic assumptions and fictional products.",
      "Not investment advice; an authorised adviser must review suitability.",
    ],
  };
}
