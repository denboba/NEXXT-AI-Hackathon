// Sanitized execution trace. Never contains the customer's free text,
// customer requests verbatim, names, contact details, user-entered labels or
// secrets. Amounts are kept (all demo data is synthetic).
import type { StageId, TraceEvent } from "./context.ts";

export type TraceEntry = {
  seq: number;
  at: string;
  stage: StageId | "orchestrator";
  event: TraceEvent;
  summary: string;
  data?: Record<string, unknown>;
};

const REDACTED_KEYS = new Set([
  "freetext",
  "text",
  "customerrequests",
  "name",
  "contactname",
  "email",
  "phone",
  "label",
  "goallabel",
  "apikey",
  "secret",
  "token",
  "authorization",
  "password",
  "credentials",
]);
const MAX_STRING = 200;

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createTrace(clock: () => Date, sensitiveStrings: string[] = []) {
  const entries: TraceEntry[] = [];
  const secrets = sensitiveStrings.filter((s) => s && s.trim().length >= 4);
  const scrub = (s: string) => secrets.reduce((acc, secret) => acc.split(secret).join("[redacted]"), s);
  return {
    entries,
    add(stage: TraceEntry["stage"], event: TraceEvent, summary: string, data?: Record<string, unknown>) {
      const entry: TraceEntry = { seq: entries.length + 1, at: clock().toISOString(), stage, event, summary: scrub(summary) };
      if (data) entry.data = JSON.parse(scrub(JSON.stringify(sanitize(data)))) as Record<string, unknown>;
      entries.push(entry);
      return entry;
    },
  };
}
