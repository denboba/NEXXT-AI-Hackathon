// Replaceable capital-market-assumption providers. There is NO live market
// data provider in this project: every implementation is synthetic or a
// cached synthetic snapshot and says so in `kind` and `sourceLabel`.
import type { CapitalMarketAssumptions, MarketDataKind } from "../domain/types.ts";
import { INFLATION } from "../lib/finance.ts";
import { inRange, isPlainObject } from "../domain/validate.ts";

export interface MarketDataProvider {
  id: string;
  kind: MarketDataKind;
  getAssumptions(signal: AbortSignal): Promise<CapitalMarketAssumptions>;
}

export const SYNTHETIC_LABEL = "Synthetic planning assumptions - not market data";

/**
 * Synthetic planning assumptions. Expected returns (equity 9%, bonds 3%,
 * cash 2.5%) reproduce the illustrative 4%/6%/8% gross returns of the demo
 * funds within 0.4 percentage points (steady 4.2%, balanced 6.0%, growth
 * 8.4%). Planning stress drawdowns describe a bad-but-not-extreme year
 * (equity -20%, bonds -5%); the Challenger applies its own, harsher scenario.
 * Inflation matches INFLATION (5.5%) from finance.ts.
 */
export function syntheticAssumptions(asOf = "2026-01-01"): CapitalMarketAssumptions {
  return {
    asOf,
    kind: "synthetic-fixture",
    sourceLabel: SYNTHETIC_LABEL,
    assetClasses: {
      equity: { expectedReturn: 0.09, stressDrawdown: 0.2 },
      bond: { expectedReturn: 0.03, stressDrawdown: 0.05 },
      cash: { expectedReturn: 0.025, stressDrawdown: 0 },
    },
    inflation: INFLATION,
    units: "decimal-per-year",
  };
}

export function syntheticFixtureProvider(): MarketDataProvider {
  return {
    id: "synthetic-fixture",
    kind: "synthetic-fixture",
    getAssumptions: async () => syntheticAssumptions(),
  };
}

/** A cached synthetic snapshot with an explicit as-of date (used for staleness tests). */
export function cachedFixtureProvider(asOf: string, overrides: Partial<CapitalMarketAssumptions> = {}): MarketDataProvider {
  return {
    id: `cached-fixture-${asOf}`,
    kind: "cached",
    getAssumptions: async () => ({
      ...syntheticAssumptions(asOf),
      kind: "cached",
      sourceLabel: `Cached synthetic snapshot as of ${asOf} - not live market data`,
      ...overrides,
    }),
  };
}

export function failingProvider(message = "market data source unavailable"): MarketDataProvider {
  return {
    id: "failing-provider",
    kind: "cached",
    getAssumptions: async () => {
      throw new Error(message);
    },
  };
}

/** Resolves after `delayMs` unless aborted first (for timeout tests). */
export function slowProvider(delayMs: number, inner: MarketDataProvider = syntheticFixtureProvider()): MarketDataProvider {
  return {
    id: `slow-${inner.id}`,
    kind: inner.kind,
    getAssumptions: (signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => inner.getAssumptions(signal).then(resolve, reject), delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      }),
  };
}

/** Returns a structurally invalid object (for malformed-data tests). */
export function malformedMarketProvider(): MarketDataProvider {
  return {
    id: "malformed-provider",
    kind: "cached",
    getAssumptions: async () => ({ asOf: "yesterday", assetClasses: { equity: { expectedReturn: "9%" } } }) as unknown as CapitalMarketAssumptions,
  };
}

/** Runtime shape check for anything a provider returns. */
export function validateAssumptions(raw: unknown): { ok: true; value: CapitalMarketAssumptions } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "not an object" };
  const a = raw as Record<string, unknown>;
  if (typeof a.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.asOf) || Number.isNaN(Date.parse(a.asOf)))
    return { ok: false, error: "asOf must be an ISO date" };
  if (a.kind !== "synthetic-fixture" && a.kind !== "cached" && a.kind !== "live") return { ok: false, error: "invalid kind" };
  if (typeof a.sourceLabel !== "string" || !a.sourceLabel) return { ok: false, error: "sourceLabel required" };
  if (a.units !== "decimal-per-year") return { ok: false, error: "units must be decimal-per-year" };
  if (!inRange(a.inflation, -0.5, 1)) return { ok: false, error: "inflation out of range" };
  if (!isPlainObject(a.assetClasses)) return { ok: false, error: "assetClasses required" };
  for (const cls of ["equity", "bond", "cash"]) {
    const c = (a.assetClasses as Record<string, unknown>)[cls];
    if (!isPlainObject(c) || !inRange(c.expectedReturn, -0.5, 0.5) || !inRange(c.stressDrawdown, 0, 1))
      return { ok: false, error: `assetClasses.${cls} invalid` };
  }
  return { ok: true, value: raw as CapitalMarketAssumptions };
}
