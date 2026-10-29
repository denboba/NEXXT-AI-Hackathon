// Privacy-safe product analytics. Events carry only whitelisted, coarse
// properties (no names, no free text, no exact amounts). The funnel is
// computed from REAL recorded events only; synthetic demo events are tagged
// `synthetic: true` and are never counted as real usage.

export const EVENT_NAMES = [
  "journey_started",
  "journey_completed",
  "info_captured",
  "clarification_requested",
  "strategy_validated",
  "strategy_withheld",
  "stress_test_completed",
  "revision_triggered",
  "followup_requested",
  "consent_requested",
  "consent_granted",
  "consent_declined",
  "handoff_previewed",
  "handoff_exported",
  "journey_abandoned",
  "eval_run",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export type EventProps = {
  stage?: string;
  status?: string;
  goalBucket?: "<25k" | "25k-100k" | "100k-250k" | ">=250k";
  horizonBucket?: "<3y" | "3-5y" | "6-10y" | ">10y";
  findingCount?: number;
  revisionCount?: number;
  scenarioCount?: number;
  passCount?: number;
};
export type AnalyticsEvent = { name: EventName; at: string; props: EventProps; synthetic: boolean };

const PROP_RULES: Record<keyof EventProps, (v: unknown) => boolean> = {
  stage: (v) => typeof v === "string" && /^[a-z-]{1,24}$/i.test(v),
  status: (v) => typeof v === "string" && /^[a-z-]{1,32}$/.test(v),
  goalBucket: (v) => ["<25k", "25k-100k", "100k-250k", ">=250k"].includes(v as string),
  horizonBucket: (v) => ["<3y", "3-5y", "6-10y", ">10y"].includes(v as string),
  findingCount: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000,
  revisionCount: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 100,
  scenarioCount: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000,
  passCount: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000,
};

/** Keeps only whitelisted keys with valid values; everything else is dropped. */
export function sanitizeProps(raw: Record<string, unknown>): EventProps {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const rule = PROP_RULES[k as keyof EventProps];
    if (rule && rule(v)) out[k] = v;
  }
  return out as EventProps;
}

export function goalBucket(lei: number): EventProps["goalBucket"] {
  if (lei < 25_000) return "<25k";
  if (lei < 100_000) return "25k-100k";
  if (lei < 250_000) return "100k-250k";
  return ">=250k";
}
export function horizonBucket(years: number): EventProps["horizonBucket"] {
  if (years < 3) return "<3y";
  if (years <= 5) return "3-5y";
  if (years <= 10) return "6-10y";
  return ">10y";
}

export interface EventSink {
  record(event: AnalyticsEvent): void;
  list(): AnalyticsEvent[];
  clear(): void;
}

export function createEvent(name: EventName, props: Record<string, unknown> = {}, now: Date = new Date(), synthetic = false): AnalyticsEvent {
  if (!EVENT_NAMES.includes(name)) throw new Error(`Unknown event ${name}`);
  return { name, at: now.toISOString(), props: sanitizeProps(props), synthetic };
}

export function memorySink(): EventSink {
  let events: AnalyticsEvent[] = [];
  return {
    record: (e) => {
      events.push({ ...e, props: sanitizeProps(e.props as Record<string, unknown>) });
    },
    list: () => [...events],
    clear: () => {
      events = [];
    },
  };
}

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export const STORAGE_KEY = "investment-coach-events-v1";
export const STORAGE_CAP = 500;

/** Persists events locally (capped); storage failures never break the app. */
export function localStorageSink(storage: StorageLike | undefined = globalThis.localStorage as StorageLike | undefined): EventSink {
  const read = (): AnalyticsEvent[] => {
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(parsed)
        ? parsed.filter((e) => e && EVENT_NAMES.includes(e.name) && typeof e.at === "string").map((e) => ({ ...e, props: sanitizeProps(e.props), synthetic: e.synthetic === true }))
        : [];
    } catch {
      return [];
    }
  };
  return {
    record: (e) => {
      try {
        const events = [...read(), { ...e, props: sanitizeProps(e.props as Record<string, unknown>) }].slice(-STORAGE_CAP);
        storage?.setItem(STORAGE_KEY, JSON.stringify(events));
      } catch {
        // storage unavailable or full: analytics is best-effort
      }
    },
    list: read,
    clear: () => {
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    },
  };
}

export const FUNNEL_STEPS: EventName[] = [
  "journey_started",
  "info_captured",
  "stress_test_completed",
  "strategy_validated",
  "followup_requested",
  "consent_granted",
  "handoff_exported",
];

/**
 * Journeys that reached each funnel step. Events are ordered by time and each
 * `journey_started` opens a new journey (events before the first one form one
 * implicit journey). A step counts once per journey however often its event
 * fired, so repeated captures or replays cannot inflate or invert the funnel.
 */
export function journeySteps(events: AnalyticsEvent[]) {
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i);
  const journeys: Set<EventName>[] = [];
  for (const { e } of ordered) {
    if (e.name === "journey_started" || journeys.length === 0) journeys.push(new Set());
    journeys[journeys.length - 1].add(e.name);
  }
  return FUNNEL_STEPS.map((name) => ({ name, count: journeys.filter((j) => j.has(name)).length }));
}

/** Funnel from real events only (synthetic events are excluded). `steps` counts journeys, `counts` raw events. */
export function funnel(events: AnalyticsEvent[]) {
  const real = events.filter((e) => !e.synthetic);
  const counts = Object.fromEntries(EVENT_NAMES.map((n) => [n, 0])) as Record<EventName, number>;
  for (const e of real) counts[e.name]++;
  return {
    realEventCount: real.length,
    excludedSyntheticCount: events.length - real.length,
    steps: journeySteps(real),
    counts,
  };
}

/** Clearly synthetic sample events for demonstrating the dashboard; never mixed into real counts. */
export function syntheticDemoEvents(now: Date = new Date("2026-01-01T00:00:00Z")): AnalyticsEvent[] {
  const names: EventName[] = ["journey_started", "info_captured", "stress_test_completed", "revision_triggered", "strategy_validated", "followup_requested", "consent_requested", "consent_granted", "handoff_previewed"];
  return names.map((name, i) => createEvent(name, { stage: "demo" }, new Date(now.getTime() + i * 1000), true));
}
