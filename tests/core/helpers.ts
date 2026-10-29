// Test helpers: a minimal StageContext that calls a provider directly.
import type { StageContext } from "../../src/orchestrator/context.ts";
import { DEFAULT_LIMITS } from "../../src/orchestrator/context.ts";
import { deterministicProvider } from "../../src/providers/llm.ts";
import type { ReasoningProvider } from "../../src/providers/llm.ts";
import { syntheticFixtureProvider } from "../../src/providers/marketData.ts";
import type { IntakeInput } from "../../src/domain/types.ts";

export const FIXED_NOW = new Date("2026-03-01T10:00:00Z");
export const fixedClock = () => FIXED_NOW;
export const counterIds = () => {
  let n = 0;
  return () => `id-${++n}`;
};

export function makeContext(input: IntakeInput, overrides: Partial<StageContext> = {}, provider: ReasoningProvider = deterministicProvider()): StageContext {
  return {
    input,
    directives: { suitability: [], strategy: [] },
    revision: 0,
    limits: { ...DEFAULT_LIMITS, providerTimeoutMs: 50 },
    marketData: syntheticFixtureProvider(),
    fallbackMarketData: syntheticFixtureProvider(),
    clock: fixedClock,
    idFactory: counterIds(),
    callModel: async (task, payload, parse) => {
      const parsed = parse(await provider.complete(task, payload, new AbortController().signal));
      if (!parsed.ok) throw new Error(parsed.error);
      return { value: parsed.value, providerId: provider.id, fallback: false };
    },
    withTimeout: (fn) => fn(new AbortController().signal),
    ...overrides,
  };
}
