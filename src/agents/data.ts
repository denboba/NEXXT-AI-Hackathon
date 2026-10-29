// Agent B - Data & Assumptions. Fetches capital-market assumptions through a
// replaceable provider (with timeout and one retry), validates shape/units,
// checks freshness against the injected clock, applies the documented
// fallback policy, and records provenance for every input.
import type { CapitalMarketAssumptions, DataFlag, DataReport, ProvenanceEntry } from "../domain/types.ts";
import { missingVolatilityClasses } from "../domain/simulation.ts";
import { validateAssumptions } from "../providers/marketData.ts";
import type { MarketDataProvider } from "../providers/marketData.ts";
import { StageError } from "../orchestrator/context.ts";
import type { StageContext, StageResult, TraceNote } from "../orchestrator/context.ts";

export const dataReads = ["market.providerId", "market.fallbackId", "market.asOfDay", "profile.sources"];

const DAY_MS = 86_400_000;

async function fetchValidated(ctx: StageContext, provider: MarketDataProvider, notes: TraceNote[]) {
  let lastError = "unknown";
  for (let attempt = 0; attempt <= ctx.limits.maxRetries; attempt++) {
    try {
      const raw = await ctx.withTimeout((signal) => provider.getAssumptions(signal));
      const checked = validateAssumptions(raw);
      // No live market data adapter exists in this project, so a payload that
      // claims to be live (or contradicts its provider's declared kind) is
      // rejected rather than shown as live. Found by the 'spoofed-live-data'
      // eval scenario: previously such a payload was accepted as fresh live data.
      if (checked.ok && checked.value.kind === "live") lastError = "payload claims live market data, but no live provider is configured";
      else if (checked.ok && checked.value.kind !== provider.kind) lastError = `payload kind '${checked.value.kind}' contradicts provider kind '${provider.kind}'`;
      else if (checked.ok) return checked.value;
      else lastError = `malformed: ${checked.error}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < ctx.limits.maxRetries)
      notes.push({ event: "retry", summary: `market data from ${provider.id} failed (${lastError}); retrying`, data: { attempt: attempt + 1 } });
  }
  notes.push({ event: "error", summary: `market data from ${provider.id} unavailable: ${lastError}`, data: { provider: provider.id } });
  return undefined;
}

export async function dataAgent(ctx: StageContext): Promise<StageResult<DataReport>> {
  const notes: TraceNote[] = [];
  const flags: DataFlag[] = [];
  const reportNotes: string[] = [];
  const now = ctx.clock();
  let providerId = ctx.marketData.id;
  let assumptions: CapitalMarketAssumptions | undefined = await fetchValidated(ctx, ctx.marketData, notes);
  let freshness: DataReport["freshness"] = "not-applicable";
  let ageDays: number | undefined;

  const ageOf = (a: CapitalMarketAssumptions) => Math.floor((now.getTime() - Date.parse(a.asOf)) / DAY_MS);
  if (assumptions && assumptions.kind !== "synthetic-fixture") {
    ageDays = ageOf(assumptions);
    freshness = ageDays > ctx.limits.maxDataAgeDays ? "stale" : "fresh";
    if (freshness === "stale") {
      flags.push("stale-source-rejected");
      reportNotes.push(`${assumptions.sourceLabel} is ${ageDays} days old (limit ${ctx.limits.maxDataAgeDays}); not used.`);
      notes.push({ event: "validation", summary: `assumptions stale: ${ageDays} days > ${ctx.limits.maxDataAgeDays}`, data: { ageDays } });
      assumptions = undefined;
    }
  }
  if (!assumptions) {
    const fallback = ctx.fallbackMarketData;
    if (!fallback || fallback.id === ctx.marketData.id)
      throw new StageError("market-data-unavailable", "No valid market assumptions and no safe fallback configured", notes);
    const fb = await fetchValidated(ctx, fallback, notes);
    if (!fb) throw new StageError("market-data-unavailable", "Fallback market assumptions also unavailable", notes);
    if (fb.kind !== "synthetic-fixture") {
      const age = ageOf(fb);
      if (age > ctx.limits.maxDataAgeDays) throw new StageError("market-data-unavailable", "Fallback assumptions are stale", notes);
    }
    assumptions = fb;
    providerId = fallback.id;
    freshness = fb.kind === "synthetic-fixture" ? "not-applicable" : "fresh";
    ageDays = undefined;
    flags.push("fallback-applied");
    reportNotes.push(`Fallback applied: using ${fb.sourceLabel}.`);
    notes.push({ event: "fallback", summary: `market data fallback applied: ${fallback.id}`, data: { provider: fallback.id, kind: fb.kind } });
  }
  if (assumptions.kind === "synthetic-fixture") flags.push("synthetic-assumptions");
  // Volatility is optional in the payload. Missing classes use the labelled
  // synthetic default in the simulation; disclosed here, never blocking.
  const missingVol = missingVolatilityClasses(assumptions);
  if (missingVol.length) {
    flags.push("default-volatility-applied");
    reportNotes.push(`Volatility missing for ${missingVol.join(", ")} in ${assumptions.sourceLabel}; the outcome simulation uses the synthetic default for ${missingVol.length === 1 ? "that class" : "those classes"}.`);
    notes.push({ event: "validation", summary: `volatility missing for ${missingVol.join(", ")}; synthetic default applied`, data: { classes: missingVol } });
  }

  const provenance: ProvenanceEntry[] = [
    ...Object.entries(ctx.profile?.sources ?? {}).map(([field, source]) => ({ field, source: String(source) })),
    { field: "capitalMarketAssumptions", source: `${assumptions.kind}: ${assumptions.sourceLabel}`, asOf: assumptions.asOf },
    { field: "inflation", source: `${assumptions.kind}: ${assumptions.sourceLabel}`, asOf: assumptions.asOf },
    { field: "products", source: "fictional-demo-catalogue" },
  ];
  notes.push({
    event: "output",
    summary: `assumptions ${assumptions.kind} (${providerId}), freshness ${freshness}, flags [${flags.join(", ")}]`,
    data: { kind: assumptions.kind, asOf: assumptions.asOf, flags },
  });
  return { output: { assumptions, providerId, freshness, ageDays, flags, provenance, notes: reportNotes }, notes };
}
