import { test } from "node:test";
import assert from "node:assert/strict";
import { profileAgent } from "../../src/agents/profile.ts";
import { dataAgent } from "../../src/agents/data.ts";
import { STATED_RISK_CAP, suitabilityAgent, horizonEquityCap, lossEquityCap } from "../../src/agents/suitability.ts";
import { bandUpperEdge, choiceSentence, labelForEquity, strategyAgent } from "../../src/agents/strategy.ts";
import { challengerAgent } from "../../src/agents/challenger.ts";
import { guardrailAgent, bannedClaims, unbackedSummaryNumbers } from "../../src/agents/guardrail.ts";
import { nextStepAgent } from "../../src/agents/nextStep.ts";
import { demoProfile } from "../../src/domain/demoProfile.ts";
import { normalProfile } from "../../src/eval/scenarios.ts";
import { replayProvider } from "../../src/providers/llm.ts";
import { cachedFixtureProvider, failingProvider } from "../../src/providers/marketData.ts";
import type { StageContext } from "../../src/orchestrator/context.ts";
import type { IntakeInput, Strategy } from "../../src/domain/types.ts";
import { makeContext } from "./helpers.ts";

async function pipeline(input: IntakeInput) {
  const ctx = makeContext(input);
  ctx.profile = (await profileAgent(ctx)).output;
  ctx.data = (await dataAgent(ctx)).output;
  ctx.suitability = (await suitabilityAgent(ctx)).output;
  ctx.strategy = (await strategyAgent(ctx)).output;
  const s = ctx.strategy;
  const challengerCtx: StageContext = {
    ...ctx,
    strategy: undefined,
    challengerInput: {
      strategyId: s.id,
      strategyVersion: s.version,
      weights: s.weights,
      assetMix: s.assetMix,
      liquidityBuckets: s.liquidityBuckets,
      investedInitialLei: s.investedInitialLei,
      monthlyContributionLei: s.monthlyContributionLei,
      horizonYears: s.horizonYears,
      targetLei: s.targetLei,
      projection: s.projection,
    },
  };
  ctx.challenge = (await challengerAgent(challengerCtx)).output;
  return { ctx, challengerCtx };
}

test("profile: anti-invention drops extracted numbers absent from the text", async () => {
  const provider = replayProvider({ "extract-profile": [{ targetAmount: 120000, horizonYears: 7 }] });
  const ctx = makeContext({ goal: { label: "Car" }, freeText: "I want to buy a car in 7 years.", monthlyContribution: 300, statedRisk: "steady" }, {}, provider);
  const r = await profileAgent(ctx);
  assert.equal(r.output.facts.targetAmount, undefined, "invented target must not become a fact");
  assert.ok(r.output.missing.includes("goal.targetAmount"));
  assert.deepEqual(r.output.extraction.rejected, ["targetAmount"]);
  assert.ok(r.notes.some((n) => n.summary.startsWith("rejected-extraction")));
  assert.deepEqual(r.output.facts.horizonYears, { value: 7, source: "user-text-extracted", confirmed: false });
  assert.ok(r.output.ambiguities.some((a) => a.includes("confirmation")));
});

test("profile: missing required fields produce targeted questions only", async () => {
  const r = await profileAgent(makeContext({ goal: { label: "Car" } }));
  assert.deepEqual(r.output.missing, ["goal.targetAmount", "goal.horizonYears", "monthlyContribution|initialCapital", "maxAcceptableLossPct|statedRisk"]);
  assert.deepEqual(r.output.questions.map((q) => q.field), r.output.missing);
  const complete = await profileAgent(makeContext(demoProfile));
  assert.deepEqual(complete.output.missing, []);
  assert.equal(complete.output.facts.targetAmount?.source, "scenario-fixture");
  assert.ok(complete.output.ambiguities.some((a) => a.includes("'growth'")), "growth preference vs 15% limit is flagged");
});

test("profile: risk tolerance is never inferred; request flags are classified", async () => {
  const r = await profileAgent(makeContext({ goal: { label: "x", targetAmount: 1000, horizonYears: 3 }, monthlyContribution: 10, customerRequests: ["Can you guarantee 10%?", "Please buy TSLA shares for me", "I'd like to talk to an adviser"] }));
  assert.ok(r.output.missing.includes("maxAcceptableLossPct|statedRisk"));
  assert.deepEqual([...r.output.requestFlags].sort(), ["adviser-request", "guaranteed-return", "specific-security", "trade-execution"]);
});

test("data: stale cached data falls back to synthetic with a flag; no fallback fails", async () => {
  const profile = (await profileAgent(makeContext(demoProfile))).output;
  const stale = await dataAgent(makeContext(demoProfile, { profile, marketData: cachedFixtureProvider("2025-01-01") }));
  assert.ok(stale.output.flags.includes("fallback-applied"));
  assert.ok(stale.output.flags.includes("stale-source-rejected"));
  assert.equal(stale.output.assumptions.kind, "synthetic-fixture");
  const fresh = await dataAgent(makeContext(demoProfile, { profile, marketData: cachedFixtureProvider("2026-02-01") }));
  assert.equal(fresh.output.freshness, "fresh");
  assert.equal(fresh.output.ageDays, 28);
  await assert.rejects(dataAgent(makeContext(demoProfile, { profile, marketData: failingProvider(), fallbackMarketData: null })), (e: Error & { reason?: string }) => e.reason === "market-data-unavailable");
  assert.ok(stale.output.provenance.some((p) => p.field === "capitalMarketAssumptions" && p.asOf));
  assert.ok(!fresh.output.flags.includes("default-volatility-applied"), "complete payload: no default volatility");
});

test("data: partial payload volatility is accepted with a visible, non-blocking flag and note", async () => {
  const profile = (await profileAgent(makeContext(demoProfile))).output;
  const full = cachedFixtureProvider("2026-02-01");
  const base = await full.getAssumptions(new AbortController().signal);
  const { equity, bond, cash } = base.assetClasses;
  const partial = cachedFixtureProvider("2026-02-01", {
    assetClasses: { equity, bond: { expectedReturn: bond.expectedReturn, stressDrawdown: bond.stressDrawdown }, cash: { expectedReturn: cash.expectedReturn, stressDrawdown: cash.stressDrawdown } },
  });
  const r = await dataAgent(makeContext(demoProfile, { profile, marketData: partial }));
  assert.equal(r.output.assumptions.kind, "cached");
  assert.equal(r.output.freshness, "fresh");
  assert.deepEqual(r.output.flags, ["default-volatility-applied"]);
  assert.ok(r.output.notes.some((n) => n.startsWith("Volatility missing for bond, cash")));
  assert.ok(r.notes.some((n) => n.event === "validation" && n.summary === "volatility missing for bond, cash; synthetic default applied"));
});

test("suitability: caps, reserve rule and never overriding constraints", async () => {
  assert.equal(horizonEquityCap(2), 0.2);
  assert.equal(horizonEquityCap(5), 0.4);
  assert.equal(horizonEquityCap(7), 0.7);
  assert.equal(horizonEquityCap(15), 0.9);
  assert.ok(Math.abs(lossEquityCap(0.15, { equity: 0.35, bond: 0.08 }) - 0.07 / 0.27) < 1e-12);
  const { ctx } = await pipeline(demoProfile);
  const s = ctx.suitability!;
  assert.ok(Math.abs(s.maxEquityShare - 0.1 / 0.15) < 1e-9, "planning drawdowns: (0.15-0.05)/(0.20-0.05)");
  assert.equal(s.reserveRequiredLei, 12000);
  assert.equal(s.reserveGapLei, 6000);
  assert.equal(s.liquidityRequirements.length, 1);
  assert.ok(s.conflicts.some((c) => c.id === "stated-risk-vs-loss-tolerance"));

  const short = { ...demoProfile, goal: { label: "Trip", targetAmount: 10000, horizonYears: 2 }, initialCapital: 5000, monthlyEssentialExpenses: undefined };
  const c2 = makeContext(short);
  c2.profile = (await profileAgent(c2)).output;
  c2.data = (await dataAgent(c2)).output;
  const r2 = (await suitabilityAgent(c2)).output;
  assert.equal(r2.maxEquityShare, 0.2);
  assert.equal(r2.status, "needs-clarification", "withdrawal of 15,000 within 3 years exceeds 5,000 starting capital");
  assert.ok(r2.questions.some((q) => q.field === "monthlyEssentialExpenses"));
});

test("strategy: candidates from the catalogue, never changes target/horizon", async () => {
  const { ctx } = await pipeline(demoProfile);
  const s = ctx.strategy!;
  assert.ok(s.candidates.length >= 2 && s.candidates.length <= 4);
  assert.equal(s.targetLei, 90000);
  assert.equal(s.horizonYears, 7);
  assert.equal(s.liquidityBuckets[0].amountLei, 15000);
  assert.equal(s.investedInitialLei, 20000);
  assert.equal(s.gapLei, 0, "first proposal reaches the target in the base case");
});

test("strategy: honest labels from the equity share and distinct candidates", async () => {
  assert.equal(labelForEquity(0), "Cautious");
  assert.equal(labelForEquity(0.257), "Cautious");
  // Upper-inclusive bands: Cautious up to 30%, Balanced above 30% up to 60%, Growth-tilted above 60%.
  assert.equal(labelForEquity(0.3), "Cautious");
  assert.equal(labelForEquity(0.301), "Balanced");
  assert.equal(labelForEquity(0.6), "Balanced");
  assert.equal(labelForEquity(0.601), "Growth-tilted");
  assert.equal(labelForEquity(0.9), "Growth-tilted");

  const { ctx } = await pipeline(demoProfile);
  const s = ctx.strategy!;
  const shares = s.candidates.map((c) => c.equityShare);
  assert.equal(new Set(shares.map((x) => x.toFixed(4))).size, shares.length, "candidates are distinct");
  assert.deepEqual([...shares].sort((a, b) => a - b), shares, "ascending equity");
  for (const c of s.candidates) assert.equal(c.label, labelForEquity(c.equityShare));
  assert.equal(s.label, labelForEquity(s.equityShare));
  assert.ok(s.outcomeRange.p10 <= s.outcomeRange.p50 && s.outcomeRange.p50 <= s.outcomeRange.p90);

  // A long horizon (> 10 years) makes the growth fund eligible: a Growth-tilted candidate distinct from Balanced.
  const long: IntakeInput = {
    goal: { label: "Long-term pot", targetAmount: 150000, horizonYears: 15 },
    initialCapital: 20000,
    monthlyContribution: 400,
    monthlyEssentialExpenses: 3000,
    emergencyFund: 12000,
    statedRisk: "growth",
    maxAcceptableLossPct: 0.4,
    inputSource: "scenario-fixture",
  };
  const g = (await pipeline(long)).ctx.strategy!;
  const growth = g.candidates.find((c) => c.label === "Growth-tilted");
  const bal = g.candidates.find((c) => c.label === "Balanced");
  assert.ok(growth && bal && growth.equityShare > bal.equityShare + 0.1, JSON.stringify(g.candidates.map((c) => [c.label, c.equityShare])));
  assert.equal(g.label, "Growth-tilted");
  assert.ok(g.weights.growth! > 0);
  const steadyPref = (await pipeline({ ...long, statedRisk: "steady" })).ctx.strategy!;
  assert.equal(steadyPref.label, "Cautious", "never riskier than the stated preference");
});

test("strategy: a candidate at each preference's suitability cap carries that preference's label", async () => {
  const expected = { steady: "Cautious", balanced: "Balanced", growth: "Growth-tilted" } as const;
  for (const risk of ["steady", "balanced", "growth"] as const) {
    assert.equal(labelForEquity(STATED_RISK_CAP[risk]), expected[risk], `cap ${risk}`);
    // Floating-point noise around the cap does not flip the label.
    assert.equal(labelForEquity(STATED_RISK_CAP[risk] + 1e-12), expected[risk], `cap ${risk} + eps`);
  }
  // Balanced preference with a 60% cap: the 60% candidate passes every constraint and is chosen.
  const { ctx } = await pipeline(normalProfile);
  const s = ctx.strategy!;
  assert.equal(ctx.suitability!.maxEquityShare, 0.6);
  assert.equal(s.label, "Balanced");
  assert.ok(Math.abs(s.equityShare - 0.6) < 0.005, `equity ${s.equityShare}`);
  assert.equal(s.equityShare, Math.max(...s.candidates.map((c) => c.equityShare)), "highest-equity candidate");
  assert.match(s.rationale, /is the highest-equity candidate allowed by the constraints \(max equity 60\.0%\)/);
});

test("strategy: rationale names the limit that actually bound the choice", async () => {
  const cands = [
    { label: "Cautious" as const, equityShare: 0.2 },
    { label: "Balanced" as const, equityShare: 0.45 },
    { label: "Growth-tilted" as const, equityShare: 0.7 },
  ];
  const byConstraints = choiceSentence(cands[2], cands, true, 0.7, "Growth-tilted");
  assert.match(byConstraints, /highest-equity candidate allowed by the constraints \(max equity 70\.0%\)/);
  const byPreference = choiceSentence(cands[1], cands, true, 0.7, "Balanced");
  assert.doesNotMatch(byPreference, /allowed by the constraints \(max equity 70\.0%\) and not riskier/);
  assert.match(byPreference, /highest-equity candidate not riskier than your stated preference \(Balanced\)/);
  assert.match(byPreference, /^Balanced \(about 45\.0% equity\)/);
  assert.match(byPreference, /Growth-tilted \(about 70\.0% equity\) is allowed by the constraints \(max equity 70\.0%\) but is riskier than that preference/);
  const noMatch = choiceSentence(cands[1], cands.slice(1), false, 0.7, "Cautious");
  assert.match(noMatch, /most cautious candidate allowed by the constraints .* no candidate matches your stated preference \(Cautious\)/);

  // End to end: without a stated preference the default Balanced preference binds. The engine
  // adds a candidate at the Balanced band edge, so it picks the highest Balanced mix the
  // constraints allow (60%, like a stated Balanced preference), not the midpoint, and names
  // the 70% Growth-tilted candidate that met the constraints as skipped.
  const s = (await pipeline({ ...normalProfile, statedRisk: undefined })).ctx.strategy!;
  assert.equal(s.label, "Balanced");
  assert.ok(Math.abs(s.equityShare - bandUpperEdge("Balanced")) < 0.005, `equity ${s.equityShare}`);
  assert.ok(s.candidates.some((c) => c.label === "Growth-tilted" && c.equityShare > s.equityShare));
  assert.match(
    s.rationale,
    /^Balanced \(about 60\.0% equity\) is the highest-equity candidate not riskier than the default preference \(Balanced, no risk preference stated\); Growth-tilted \(about 70\.0% equity\) is allowed by the constraints \(max equity 70\.0%\) but is riskier than that preference\./,
  );
  assert.doesNotMatch(s.rationale, /stated preference \(Balanced\)/);
  const stated = (await pipeline({ ...normalProfile, statedRisk: "balanced" })).ctx.strategy!;
  assert.equal(stated.equityShare, s.equityShare, "default preference behaves like a stated Balanced preference");
});

test("strategy: the equity shown in the rationale is never above the cap shown", async () => {
  // Ana v2 case: chosen 25.7% under a 25.9% cap used to render as "about 26% equity".
  const cands = [{ label: "Cautious" as const, equityShare: 0.257 }];
  const sentence = choiceSentence(cands[0], cands, true, 0.259, "Growth-tilted");
  assert.match(sentence, /^Cautious \(about 25\.7% equity\) is the highest-equity candidate allowed by the constraints \(max equity 25\.9%\)/);

  const check = (rationale: string) => {
    const m = /^\S+ \(about ([\d.]+)% equity\).*?\(max equity ([\d.]+)%[;)]/.exec(rationale);
    assert.ok(m, rationale);
    assert.ok(Number(m[1]) <= Number(m[2]), rationale);
  };
  const { ctx } = await pipeline(demoProfile);
  check(ctx.strategy!.rationale);
  // Ana v1: the 66.7% cap is above what the eligible funds reach (50%), and the sentence says so.
  assert.match(ctx.strategy!.rationale, /^Balanced \(about 50\.0% equity\) is the highest-equity candidate allowed by the constraints \(max equity 66\.7%; eligible funds reach at most 50\.0%\)/);
  for (const risk of ["steady", "balanced", "growth", undefined] as const) check((await pipeline({ ...normalProfile, statedRisk: risk })).ctx.strategy!.rationale);
  for (let eq = 0.2; eq <= 0.9; eq += 0.0137) check(choiceSentence({ label: labelForEquity(eq), equityShare: eq }, [{ label: labelForEquity(eq), equityShare: eq }], true, eq + 0.0004, "Growth-tilted"));
});

test("challenger: seeded-outcome-range uses its own inputs; material only when the base case reaches but most paths miss", async () => {
  const { ctx, challengerCtx } = await pipeline(demoProfile);
  const info = ctx.challenge!.findings.find((f) => f.test === "seeded-outcome-range");
  assert.equal(info?.id, "outcome-range");
  assert.equal(info?.severity, "info");
  for (const k of ["p10Lei", "p50Lei", "p90Lei", "reachShare"]) assert.equal(typeof info?.evidence.computed[k], "number", k);
  assert.equal(info?.evidence.inputs.seed, ctx.strategy!.outcomeRange.seed);
  // Tampering with the strategy's own outcome range does not change the Challenger's numbers.
  const again = await challengerAgent({ ...challengerCtx, strategy: { ...ctx.strategy!, outcomeRange: { ...ctx.strategy!.outcomeRange, reachShare: 1, p10: 1 } } });
  assert.deepEqual(again.output.findings.find((f) => f.test === "seeded-outcome-range")?.evidence, info?.evidence);

  // Target set exactly to the base-case value: the base case reaches it, but volatility drag puts most paths below.
  const input = challengerCtx.challengerInput!;
  const tight = await challengerAgent({ ...challengerCtx, challengerInput: { ...input, targetLei: input.projection.nominal - 1 } });
  const low = tight.output.findings.find((f) => f.test === "seeded-outcome-range")!;
  assert.ok((low.evidence.computed.reachShare as number) < 0.5);
  assert.equal(low.id, "outcome-range-low-reach");
  assert.equal(low.severity, "material");
  assert.equal(low.routeTo, "strategy");
  assert.deepEqual(low.remedy, { kind: "acknowledge-external", topic: "outcome-range" });
});

test("challenger: independent stress tests with evidence; no access to rationale", async () => {
  const { ctx, challengerCtx } = await pipeline(demoProfile);
  assert.equal(challengerCtx.strategy, undefined);
  const ch = ctx.challenge!;
  const crash = ch.findings.find((f) => f.id === "severe-crash-loss");
  assert.ok(crash, "severe crash loss above 15% must be found");
  assert.equal(crash.severity, "material");
  assert.equal(crash.routeTo, "suitability");
  assert.ok(Math.abs((crash.evidence.computed.portfolioLossPct as number) - 0.215) < 1e-9);
  assert.equal(crash.evidence.inputs.equityShock, 0.35);
  const liquidity = ch.findings.find((f) => f.id === "liquidity-need");
  assert.equal(liquidity?.severity, "material");
  assert.equal(liquidity?.evidence.computed.shortfallLei, 6000);
  assert.ok(ch.findings.some((f) => f.id === "single-stock-concentration" && f.severity === "material"));
  for (const t of ["severe-crash-before-goal", "goal-two-years-earlier", "unexpected-liquidity-need", "contribution-pause-12m", "single-stock-concentration", "fee-inflation-sensitivity"])
    assert.ok(ch.testsRun.includes(t), t);

  const tampered = await challengerAgent({ ...challengerCtx, challengerInput: { ...challengerCtx.challengerInput!, projection: { ...challengerCtx.challengerInput!.projection, nominal: 120000 } } });
  assert.ok(tampered.output.findings.some((f) => f.id === "projection-mismatch" && f.severity === "blocking"));
});

async function guardrailWith(mutate: (s: Strategy) => Strategy) {
  const { ctx } = await pipeline(demoProfile);
  return (await guardrailAgent({ ...ctx, strategy: mutate(ctx.strategy!) })).output;
}

test("guardrail: deterministic checks decide status", async () => {
  const base = await guardrailWith((s) => s);
  // The first demo proposal breaks the stated loss limit under the severe scenario.
  assert.equal(base.status, "withheld");
  assert.equal(base.checks.find((c) => c.id === "stress-loss-within-tolerance")?.pass, false);

  const badWeights = await guardrailWith((s) => ({ ...s, weights: { steady: 0.3, balanced: 0.6 } }));
  assert.equal(badWeights.checks.find((c) => c.id === "weights-sum-to-one")?.pass, false);
  assert.equal(badWeights.status, "withheld");

  const guaranteed = await guardrailWith((s) => ({ ...s, narrative: { ...s.narrative, text: "This plan is guaranteed to reach 90,000 lei." } }));
  assert.equal(guaranteed.checks.find((c) => c.id === "narrative-claims")?.pass, false);
  assert.equal(guaranteed.narrativeFailed, true);

  const wrongNumber = await guardrailWith((s) => ({ ...s, narrative: { ...s.narrative, text: "It projects about 123,456 lei in 7 years." } }));
  assert.equal(wrongNumber.checks.find((c) => c.id === "narrative-numbers-match")?.pass, false);
  const okNumber = await guardrailWith((s) => s);
  assert.equal(okNumber.checks.find((c) => c.id === "narrative-numbers-match")?.pass, true);
  assert.equal(okNumber.checks.find((c) => c.id === "simulation-reproducible")?.pass, true);

  // Numbers from the outcome range and the solver levers are backed.
  const rangeText = await guardrailWith((s) => ({
    ...s,
    narrative: { ...s.narrative, text: `Median about ${Math.round(s.outcomeRange.p50)} lei; ${Math.round(s.outcomeRange.reachShare * 100)}% of ${s.outcomeRange.paths} paths reach the target.` },
  }));
  assert.equal(rangeText.checks.find((c) => c.id === "narrative-numbers-match")?.pass, true);
  const tamperedRange = await guardrailWith((s) => ({ ...s, outcomeRange: { ...s.outcomeRange, reachShare: Math.min(1, s.outcomeRange.reachShare + 0.1) } }));
  assert.equal(tamperedRange.checks.find((c) => c.id === "simulation-reproducible")?.pass, false);
  assert.equal(tamperedRange.status, "withheld");

  assert.deepEqual(bannedClaims("Returns are not guaranteed."), []);
  assert.deepEqual(bannedClaims("You cannot lose and it is risk-free"), ["cannot lose", "risk-free"]);
  assert.deepEqual(bannedClaims("A safe investment that will grow."), ["safe investment", "will grow"]);
  assert.deepEqual(bannedClaims("Values can fall as well as grow."), []);
});

test("guardrail: numbers in the stress-test summary must be backed by findings or calculations", async () => {
  const { ctx } = await pipeline(demoProfile);
  const ch = ctx.challenge!;
  const backed = (await guardrailAgent(ctx)).output;
  assert.equal(backed.checks.find((c) => c.id === "narrative-numbers-match")?.pass, true);
  assert.deepEqual(unbackedSummaryNumbers(ch), []);

  const invented = { ...ch, summary: { ...ch.summary, text: "A crash could cost you 43,217 lei.", citedNumbers: [] } };
  assert.deepEqual(unbackedSummaryNumbers(invented), [43217]);
  const g = (await guardrailAgent({ ...ctx, challenge: invented })).output;
  const check = g.checks.find((c) => c.id === "narrative-numbers-match");
  assert.equal(check?.pass, false);
  assert.match(check!.detail, /43217 \(stress-test summary\)/);
  assert.equal(g.narrativeFailed, true);

  const fromFinding = ch.findings.find((f) => /\d/.test(f.message));
  if (fromFinding) {
    const quoted = { ...ch, summary: { ...ch.summary, text: fromFinding.message, citedNumbers: [] } };
    assert.deepEqual(unbackedSummaryNumbers(quoted), []);
  }
});

test("nextStep: safety responses and data-minimized briefing", async () => {
  const input = { ...demoProfile, customerRequests: ["Can you guarantee the return?", "Execute the trade for me"] };
  const { ctx } = await pipeline(input);
  ctx.validation = (await guardrailAgent(ctx)).output;
  const r = (await nextStepAgent(ctx)).output;
  assert.deepEqual(r.safetyResponses.map((s) => s.flag).sort(), ["guaranteed-return", "trade-execution"]);
  assert.equal(r.primary, "talk-to-adviser");
  const text = JSON.stringify(r.briefing);
  assert.ok(!text.includes("emergency fund."), "no free text in briefing");
  assert.ok(!text.includes("guarantee the return"), "no customer request text in briefing");
  assert.equal(r.briefing?.contactName, undefined);
});
