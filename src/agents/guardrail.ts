// Agent F - Guardrail / Validation. Deterministic invariants, independent
// of any narrative: allocation arithmetic, constraint compliance (stricter of
// planning and severe drawdowns), liquidity coverage, an independent
// projection recomputation, a reproducibility re-run of the seeded outcome
// simulation, data provenance, disclosures, a claim filter and a cited-number
// check on the narrative (outcome range and solver levers included), and
// unresolved blocking findings.
import type { ChallengeReport, ValidationCheck, ValidationReport } from "../domain/types.ts";
import { catalogue } from "../domain/catalogue.ts";
import { LEI_TOLERANCE, approxEqual, blendedAssumptions, projectGoal, stressLoss } from "../domain/calculations.ts";
import { missingVolatilityClasses } from "../domain/simulation.ts";
import { REQUIRED_DISCLOSURES } from "./strategy.ts";
import { SEVERE_CRASH } from "./challenger.ts";
import { StageError } from "../orchestrator/context.ts";
import type { StageContext, StageResult } from "../orchestrator/context.ts";

export const guardrailReads = ["profile", "data", "suitability", "strategy", "challenge"];

const BANNED =
  /guarantee|risk[- ]?free|will earn|will (?:definitely |certainly |surely )?(?:grow|double|increase|rise)|cannot lose|can'?t lose|no risk|sure profit|safe investment|(?:completely|totally|100%) safe/i;
const NEGATED = /\b(?:not|no|never|isn'?t|aren'?t)\s+(?:be\s+)?guarantee[a-z]*/gi;

/** Returns banned claims found in `text` (negated disclaimers such as "not guaranteed" are allowed). */
export function bannedClaims(text: string) {
  const cleaned = text.replace(NEGATED, "");
  const found: string[] = [];
  const re = new RegExp(BANNED.source, "gi");
  for (const m of cleaned.matchAll(re)) found.push(m[0].toLowerCase());
  return found;
}

export function numbersIn(text: string) {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, ""))).filter(Number.isFinite);
}

/** Every number in the narrative must match a computed value (rounded for display) within tolerance. */
export function uncitedNumbers(text: string, allowed: number[]) {
  const variants = allowed.flatMap((a) => [a, Math.round(a), Math.round(a * 10) / 10, Math.round(a * 100) / 100, Math.floor(a), Math.ceil(a)]);
  return numbersIn(text).filter((n) => !variants.some((v) => Math.abs(n - v) <= LEI_TOLERANCE));
}

const evidenceNumbers = (v: unknown): number[] =>
  typeof v === "number" && Number.isFinite(v)
    ? [v, v * 100]
    : v && typeof v === "object"
      ? Object.values(v as Record<string, unknown>).flatMap(evidenceNumbers)
      : [];

/**
 * Numbers in the challenger summary (text and citedNumbers) that are not
 * backed by `extraAllowed`, the findings' messages and evidence, or finding counts.
 */
export function unbackedSummaryNumbers(ch: ChallengeReport, extraAllowed: number[] = []) {
  const serious = ch.findings.filter((f) => f.severity !== "info").length;
  const allowed = [
    ...extraAllowed,
    ch.findings.length,
    serious,
    ...ch.findings.flatMap((f) => [...numbersIn(f.message), ...evidenceNumbers(f.evidence)]),
  ];
  const inText = uncitedNumbers(ch.summary.text, allowed);
  const cited = ch.summary.citedNumbers.filter((n) => uncitedNumbers(String(n), allowed).length > 0);
  return [...inText, ...cited];
}

export async function guardrailAgent(ctx: StageContext): Promise<StageResult<ValidationReport>> {
  const profile = ctx.profile;
  if (!profile) throw new StageError("missing-upstream", "Guardrail needs a profile");
  const checks: ValidationCheck[] = [];
  const add = (id: string, pass: boolean, detail: string, hard = true) => checks.push({ id, pass, detail, hard });
  const requiredOk = profile.missing.length === 0 && profile.invalid.length === 0;
  add("required-inputs", requiredOk, requiredOk ? "all required inputs present" : `missing: ${[...profile.missing, ...profile.invalid.map((e) => e.path)].join(", ")}`);

  const s = ctx.strategy;
  const suit = ctx.suitability;
  const data = ctx.data;
  const ch = ctx.challenge;
  const openIssues: string[] = [];
  let narrativeFailed = false;
  if (requiredOk && (!s || !suit || !data)) add("upstream-complete", false, "strategy, suitability or data output missing");
  if (requiredOk && s && suit && data) {
    const weights = Object.values(s.weights);
    const sum = weights.reduce((a, b) => a + b, 0);
    add("weights-sum-to-one", Math.abs(sum - 1) <= 1e-9, `sum of weights = ${sum}`);
    add("weights-in-range", weights.every((w) => Number.isFinite(w) && w >= 0 && w <= 1), "each weight within 0..1");
    const unknown = Object.keys(s.weights).filter((id) => !catalogue.some((b) => b.id === id));
    add("blocks-known", unknown.length === 0, unknown.length ? `unknown blocks: ${unknown.join(", ")}` : "all blocks from the fictional catalogue");

    if (unknown.length === 0 && weights.every((w) => Number.isFinite(w) && w >= 0)) {
      const blend = blendedAssumptions(s.weights, catalogue, data.assumptions);
      add("equity-within-cap", blend.equityShare <= suit.maxEquityShare + 1e-9, `equity ${(blend.equityShare * 100).toFixed(2)}% vs cap ${(suit.maxEquityShare * 100).toFixed(2)}%`);
      const basisLoss = stressLoss(blend.assetMix, suit.drawdownBasis);
      const severeLoss = stressLoss(blend.assetMix, SEVERE_CRASH);
      const loss = Math.max(basisLoss, severeLoss);
      add(
        "stress-loss-within-tolerance",
        loss <= suit.lossTolerance + 1e-9,
        `stricter of planning (${(basisLoss * 100).toFixed(2)}%) and severe (${(severeLoss * 100).toFixed(2)}%) loss vs tolerance ${(suit.lossTolerance * 100).toFixed(2)}%`,
      );
      const recomputed = projectGoal({
        initial: s.investedInitialLei,
        monthly: s.monthlyContributionLei,
        years: s.horizonYears,
        grossReturn: blend.grossReturn,
        fee: blend.fee,
        inflation: data.assumptions.inflation,
        withdrawals: suit.laterWithdrawals.map((w) => ({ amount: w.amountLei, inYears: w.inYears })),
      });
      add("projection-recomputed", approxEqual(recomputed.nominal, s.projection.nominal), `independent ${recomputed.nominal.toFixed(2)} vs stated ${s.projection.nominal.toFixed(2)} lei`);

      // The seeded outcome range must be exactly reproducible from the plan's own inputs, seed and path count.
      const r = s.outcomeRange;
      if (!r) add("simulation-reproducible", false, "strategy has no seeded outcome range");
      else {
        const again = ctx.callTool("simulate-outcomes", {
          initial: s.investedInitialLei,
          monthly: s.monthlyContributionLei,
          years: s.horizonYears,
          assetMix: blend.assetMix,
          assumptions: data.assumptions,
          fee: blend.fee,
          inflation: data.assumptions.inflation,
          withdrawals: suit.laterWithdrawals.map((w) => ({ amount: w.amountLei, inYears: w.inYears })),
          target: s.targetLei,
          targetIsReal: profile.facts.targetIsInTodaysMoney?.value === true,
          paths: r.paths,
          seed: r.seed,
        });
        const keys = ["p10", "p50", "p90", "p10Real", "p50Real", "p90Real", "reachShare"] as const;
        const differing = keys.filter((k) => again[k] !== r[k]);
        add(
          "simulation-reproducible",
          differing.length === 0 && again.targetIsReal === r.targetIsReal,
          differing.length
            ? `re-run with seed ${r.seed} and ${r.paths} paths differs in ${differing.join(", ")}`
            : `re-run with seed ${r.seed} and ${r.paths} paths gives identical percentiles and reach share ${(r.reachShare * 100).toFixed(1)}%`,
        );
      }
    }
    const uncovered = suit.liquidityRequirements.filter(
      (r) =>
        s.liquidityBuckets
          .filter((b) => b.purpose === "planned-withdrawal" && b.label === r.label && b.neededInYears === r.neededInYears)
          .reduce((a, b) => a + b.amountLei, 0) +
          LEI_TOLERANCE <
        r.amountLei,
    );
    add("liquidity-buckets-cover-withdrawals", uncovered.length === 0, uncovered.length ? `${uncovered.length} withdrawal(s) within 3 years not in cash` : "withdrawals within 3 years held in cash");
    const allocated = s.liquidityBuckets.reduce((a, b) => a + b.amountLei, 0) + s.investedInitialLei;
    const initial = profile.facts.initialCapital?.value ?? 0;
    add("capital-conserved", approxEqual(allocated, initial), `buckets + invested = ${allocated.toFixed(2)} vs initial ${initial.toFixed(2)} lei`);

    const a = data.assumptions;
    const dataOk =
      a.kind === "synthetic-fixture"
        ? data.flags.includes("synthetic-assumptions") && s.disclosures.includes("synthetic-assumptions")
        : data.freshness === "fresh";
    add("market-data-acceptable", dataOk, `${a.kind} (${a.sourceLabel}), freshness ${data.freshness}${data.flags.includes("fallback-applied") ? ", fallback disclosed" : ""}`);
    if (data.flags.includes("fallback-applied")) openIssues.push("Market assumptions fell back to synthetic planning values.");
    if (data.flags.includes("default-volatility-applied"))
      openIssues.push(`Outcome range uses the synthetic default volatility for ${missingVolatilityClasses(a).join(", ")} (not in the market-data payload).`);

    const missingDisclosures = REQUIRED_DISCLOSURES.filter((d) => !s.disclosures.includes(d));
    add("disclosures-present", missingDisclosures.length === 0, missingDisclosures.length ? `missing: ${missingDisclosures.join(", ")}` : "all mandatory disclosures present");

    const narratives = [s.narrative.text, ch?.summary.text ?? ""].join(" ");
    const claims = bannedClaims(narratives);
    add("narrative-claims", claims.length === 0, claims.length ? `prohibited claims: ${claims.join(", ")}` : "no prohibited claims");
    const allowed = [
      s.targetLei,
      s.projection.nominal,
      s.projection.real,
      s.gapLei,
      s.investedInitialLei,
      s.monthlyContributionLei,
      s.horizonYears,
      s.equityShare * 100,
      s.projection.netReturn * 100,
      s.projection.grossReturn * 100,
      s.projection.fee * 100,
      s.projection.inflation * 100,
      suit.lossTolerance * 100,
      suit.maxEquityShare * 100,
      ...s.liquidityBuckets.map((b) => b.amountLei),
      ...s.levers.flatMap((l) => (l.value === undefined ? [] : [l.value])),
      ...s.levers.flatMap((l) => (l.reachShare === undefined ? [] : [l.reachShare * 100, s.monthlyContributionLei + (l.unit === "lei-per-month" ? (l.value ?? 0) : 0)])),
      ...(s.outcomeRange
        ? [
            s.outcomeRange.p10,
            s.outcomeRange.p50,
            s.outcomeRange.p90,
            s.outcomeRange.p10Real,
            s.outcomeRange.p50Real,
            s.outcomeRange.p90Real,
            s.outcomeRange.reachShare * 100,
            s.outcomeRange.paths,
            s.outcomeRange.seed,
          ]
        : []),
      ...s.candidates.flatMap((c) => [c.projection.nominal, c.gapLei, c.equityShare * 100]),
    ];
    const uncited = uncitedNumbers(s.narrative.text, allowed);
    const citedMismatch = s.narrative.citedNumbers.filter((n) => uncitedNumbers(String(n), allowed).length > 0);
    // Regression (eval scenario 'invented-summary-number'): the challenger's
    // summary is also customer-facing and may be model-written, so its numbers
    // must be backed by the strategy's computed values or by the challenger's
    // own findings (messages and evidence), never invented.
    const summaryUnbacked = ch ? unbackedSummaryNumbers(ch, allowed) : [];
    add(
      "narrative-numbers-match",
      uncited.length === 0 && citedMismatch.length === 0 && summaryUnbacked.length === 0,
      uncited.length || citedMismatch.length || summaryUnbacked.length
        ? `numbers not backed by calculations: ${[...uncited, ...citedMismatch, ...summaryUnbacked.map((n) => `${n} (stress-test summary)`)].join(", ")}`
        : "every cited number in the narrative and stress-test summary matches a computed value",
    );
    narrativeFailed = claims.length > 0 || uncited.length > 0 || citedMismatch.length > 0 || summaryUnbacked.length > 0;

    add("challenge-current", !!ch && ch.strategyId === s.id && ch.strategyVersion === s.version, ch ? `challenged ${ch.strategyId}` : "strategy was not challenged");
    const blocking = (ch?.findings ?? []).filter((f) => f.severity === "blocking");
    add("no-unresolved-blocking", blocking.length === 0, blocking.length ? `blocking: ${blocking.map((f) => f.id).join(", ")}` : "no blocking findings");

    for (const f of ch?.findings ?? []) if (f.severity === "material") openIssues.push(f.message);
    if (s.gapLei > LEI_TOLERANCE) openIssues.push(`Projected shortfall of about ${Math.round(s.gapLei)} lei against the target.`);
    for (const c of suit.conflicts) if (c.requiresConfirmation) openIssues.push(c.description);
  }
  for (const amb of profile.ambiguities) if (!openIssues.includes(amb)) openIssues.push(amb);

  const hardFail = checks.some((c) => c.hard && !c.pass);
  const status: ValidationReport["status"] = !requiredOk
    ? "needs-clarification"
    : hardFail
      ? "withheld"
      : openIssues.length
        ? "validated-with-open-issues"
        : "validated";
  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  return {
    output: { checks, status, openIssues, narrativeFailed },
    notes: [
      {
        event: "validation",
        summary: `guardrail ${status}: ${checks.length - failed.length}/${checks.length} checks pass${failed.length ? ` (failed: ${failed.join(", ")})` : ""}, ${openIssues.length} open issue(s)`,
        data: { status, failed },
      },
    ],
  };
}
