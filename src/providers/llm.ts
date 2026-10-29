// Replaceable reasoning providers. Reasoning providers only ever produce
// (a) structured extraction candidates that are validated and checked against
// the source text, and (b) narrative text around numbers that deterministic
// code computed. They never perform arithmetic that the workflow relies on.
import { money } from "../lib/finance.ts";
import { isFiniteNonNeg, isPlainObject } from "../domain/validate.ts";

export type ReasoningTask = "extract-profile" | "explain-strategy" | "explain-objections";
export type ReasoningKind = "deterministic-rules" | "replay-fixture" | "bedrock-via-server";

export interface ReasoningProvider {
  id: string;
  kind: ReasoningKind;
  complete(task: ReasoningTask, input: object, signal: AbortSignal): Promise<unknown>;
}

// ---------- Structured output contracts ----------
export type Extraction = {
  targetAmount?: number;
  horizonYears?: number;
  monthlyContribution?: number;
  initialCapital?: number;
  mentionsEmergencyFund?: boolean;
};
export type Explanation = { text: string; citedNumbers: number[] };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type ExplainStrategyInput = {
  label: string;
  equityPct: number;
  nominalLei: number;
  realLei: number;
  targetLei: number;
  gapLei: number;
  horizonYears: number;
  /** Optional seeded synthetic outcome range (computed by the simulate-outcomes tool, rounded). */
  paths?: number;
  p10Lei?: number;
  p50Lei?: number;
  p90Lei?: number;
  reachSharePct?: number;
};
export type ExplainObjectionsInput = {
  findings: { id: string; severity: string; message: string }[];
};

const asObject = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export function parseExtraction(raw: unknown): Parsed<Extraction> {
  const value = asObject(raw);
  if (!isPlainObject(value)) return { ok: false, error: "extraction must be a JSON object" };
  const out: Extraction = {};
  for (const key of ["targetAmount", "horizonYears", "monthlyContribution", "initialCapital"] as const) {
    const v = value[key];
    if (v === undefined || v === null) continue;
    if (!isFiniteNonNeg(v)) return { ok: false, error: `${key} must be a non-negative number` };
    if (key === "horizonYears" && !Number.isInteger(v)) return { ok: false, error: "horizonYears must be whole years" };
    out[key] = v;
  }
  if (value.mentionsEmergencyFund !== undefined) {
    if (typeof value.mentionsEmergencyFund !== "boolean") return { ok: false, error: "mentionsEmergencyFund must be boolean" };
    out.mentionsEmergencyFund = value.mentionsEmergencyFund;
  }
  return { ok: true, value: out };
}

export function parseExplanation(raw: unknown): Parsed<Explanation> {
  const value = asObject(raw);
  if (!isPlainObject(value)) return { ok: false, error: "explanation must be a JSON object" };
  if (typeof value.text !== "string" || value.text.trim().length === 0 || value.text.length > 2000)
    return { ok: false, error: "text must be a non-empty string (max 2000 chars)" };
  if (!Array.isArray(value.citedNumbers) || !value.citedNumbers.every((n) => typeof n === "number" && Number.isFinite(n)))
    return { ok: false, error: "citedNumbers must be an array of finite numbers" };
  return { ok: true, value: { text: value.text, citedNumbers: value.citedNumbers as number[] } };
}

// ---------- Deterministic rules provider ----------
/** Removes thousand separators between digits: "90,000" / "90.000" / "90 000" -> "90000". */
export function normalizeDigits(text: string) {
  return text.replace(/(\d)[,.\s\u00a0](?=\d{3}(?!\d))/g, "$1");
}

/** True when `value` literally appears in the text (after separator normalization). */
export function numberAppearsIn(text: string, value: number) {
  const normalized = normalizeDigits(text);
  const literal = String(value).replace(".", "\\.");
  return new RegExp(`(^|[^\\d.])${literal}(?![\\d])`).test(normalized);
}

export function extractWithRules(text: string): Extraction {
  const t = normalizeDigits(text);
  const out: Extraction = {};
  const amountRe = /(\d+(?:\.\d+)?)\s*(k\b)?\s*(?:lei|ron)\b([^.\d]{0,20})/gi;
  for (const m of t.matchAll(amountRe)) {
    if (m[2]) continue; // "90k lei" is ambiguous shorthand; ask instead of guessing
    const value = Number(m[1]);
    const after = m[3].toLowerCase();
    if (/(per|a|each|\/)\s*month|monthly/.test(after)) {
      if (out.monthlyContribution === undefined) out.monthlyContribution = value;
    } else if (out.targetAmount === undefined) out.targetAmount = value;
  }
  const years = /\bin\s+(\d{1,2})\s+years?\b/i.exec(t);
  if (years) out.horizonYears = Number(years[1]);
  if (/emergency/i.test(t)) out.mentionsEmergencyFund = true;
  return out;
}

export function explainStrategyTemplate(i: ExplainStrategyInput): Explanation {
  const cited = [i.equityPct, i.nominalLei, i.horizonYears, i.realLei, i.targetLei];
  let text =
    `The ${i.label} scenario holds about ${i.equityPct}% in equities. Under synthetic planning assumptions it projects ` +
    `about ${money(i.nominalLei)} lei in ${i.horizonYears} years (about ${money(i.realLei)} lei in today's money), ` +
    `compared with a target of ${money(i.targetLei)} lei. `;
  if (i.gapLei > 0) {
    text += `The projection falls short by about ${money(i.gapLei)} lei, so the options below show what would close the gap. `;
    cited.push(i.gapLei);
  } else text += "In this illustration the projection reaches the target, but outcomes can be lower. ";
  if (i.paths !== undefined && i.p10Lei !== undefined && i.p50Lei !== undefined && i.p90Lei !== undefined && i.reachSharePct !== undefined) {
    text +=
      `Across ${money(i.paths)} seeded synthetic paths the middle outcome is about ${money(i.p50Lei)} lei; one path in ten ends below ` +
      `about ${money(i.p10Lei)} lei and one in ten above about ${money(i.p90Lei)} lei, and about ${i.reachSharePct}% of paths reach the target. `;
    cited.push(i.paths, i.p50Lei, i.p10Lei, i.p90Lei, i.reachSharePct);
  }
  text += "This is an illustration, not a forecast or a recommendation.";
  return { text, citedNumbers: cited };
}

export function explainObjectionsTemplate(i: ExplainObjectionsInput): Explanation {
  const serious = i.findings.filter((f) => f.severity !== "info");
  if (serious.length === 0)
    return { text: "The independent stress tests found no material issue with this scenario.", citedNumbers: [] };
  return {
    text: `The independent stress tests found ${serious.length} issue(s) to address: ${serious.map((f) => f.message).join(" ")}`,
    citedNumbers: [],
  };
}

export function deterministicProvider(): ReasoningProvider {
  return {
    id: "deterministic-rules",
    kind: "deterministic-rules",
    complete: async (task, input) => {
      if (task === "extract-profile") return extractWithRules(String((input as { text?: unknown }).text ?? ""));
      if (task === "explain-strategy") return explainStrategyTemplate(input as ExplainStrategyInput);
      return explainObjectionsTemplate(input as ExplainObjectionsInput);
    },
  };
}

// ---------- Replay provider (deterministic tests and evaluation) ----------
type ReplayDirective =
  | { __replay: "throw"; message: string }
  | { __replay: "hang" }
  | { __replay: "raw"; raw: string };

export const replay = {
  throwing: (message = "provider error"): ReplayDirective => ({ __replay: "throw", message }),
  hang: (): ReplayDirective => ({ __replay: "hang" }),
  malformed: (raw = "{not json"): ReplayDirective => ({ __replay: "raw", raw }),
};

export type ReplayFixtures = Partial<Record<ReasoningTask, unknown[] | (() => unknown)>>;
export type ReplayProvider = ReasoningProvider & { calls: { task: ReasoningTask }[] };

/**
 * Returns queued responses per task in order. Queue items may be plain values
 * or directives created with `replay.throwing()`, `replay.hang()` (never
 * resolves until aborted) or `replay.malformed(raw)` (returns a raw string).
 * An exhausted queue throws 'replay-exhausted'.
 */
export function replayProvider(fixtures: ReplayFixtures, id = "replay-fixture"): ReplayProvider {
  const queues: Partial<Record<ReasoningTask, unknown[]>> = {};
  for (const [task, f] of Object.entries(fixtures)) if (Array.isArray(f)) queues[task as ReasoningTask] = [...f];
  const calls: { task: ReasoningTask }[] = [];
  return {
    id,
    kind: "replay-fixture",
    calls,
    complete: (task, _input, signal) => {
      calls.push({ task });
      const fixture = fixtures[task];
      let item: unknown;
      if (typeof fixture === "function") item = fixture();
      else {
        const queue = queues[task];
        if (!queue || queue.length === 0) return Promise.reject(new Error("replay-exhausted"));
        item = queue.shift();
      }
      if (isPlainObject(item) && "__replay" in item) {
        const d = item as ReplayDirective;
        if (d.__replay === "throw") return Promise.reject(new Error(d.message));
        if (d.__replay === "raw") return Promise.resolve(d.raw);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return Promise.resolve(item);
    },
  };
}

// ---------- HTTP provider (server-side model, e.g. Bedrock via /api/agent) ----------
/** Provider failure that retrying cannot fix; the engine falls back to deterministic rules immediately. */
export class NonRetryableProviderError extends Error {}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type Receipt = { receipt: string; expiresAt: number };
/**
 * Outcome of a withdrawal. Locally the receipt is always forgotten and the
 * engine gate stops further external calls; `confirmed` says whether the
 * server also acknowledged the revocation.
 */
export type RevokeResult =
  | { requested: false }
  | { requested: true; confirmed: true }
  | { requested: true; confirmed: false; status?: number; error: string };
export type HttpReasoningProvider = ReasoningProvider & {
  /** Forgets the cached consent receipt locally and asks the server to revoke it. */
  revokeConsent(): Promise<RevokeResult>;
};

/** Plain-language hint for the Decision Lab after unticking the consent box; empty when nothing needs saying. */
export function consentWithdrawalNotice(result: RevokeResult): string {
  if (!result.requested || result.confirmed) return "";
  const why = result.status === 429 ? "it is busy (HTTP 429)" : result.status ? `it answered HTTP ${result.status}` : "it could not be reached";
  return (
    `Nothing more is sent from this page, but the server did not confirm the revocation: ${why}. ` +
    "The receipt it issued expires on its own within 30 minutes."
  );
}

/** Refresh a cached receipt this long before it expires. */
export const RECEIPT_REFRESH_MARGIN_MS = 60_000;

/**
 * Sends {task, input, consent: {receipt}} to the app server, which holds any
 * credentials and rejects requests without a valid consent receipt (403).
 * The engine only calls this provider when externalProcessingConsent is true,
 * so the receipt is requested from POST /api/consent with
 * {scope: "external-processing", granted: true} only after the user made
 * that choice. The receipt is cached until shortly before it expires; one
 * 403 on a reused receipt (expired or revoked server-side) triggers exactly
 * one fresh receipt and one retry, and a rejected receipt is never reused.
 * Any failure to obtain a receipt is non-retryable, so the engine falls back
 * to deterministic rules for that task (at most one receipt request per task).
 */
export function httpProvider(
  fetchImpl: FetchLike,
  endpoint = "/api/agent",
  options: { consentEndpoint?: string; now?: () => number } = {},
): HttpReasoningProvider {
  const consentEndpoint = options.consentEndpoint ?? "/api/consent";
  const now = options.now ?? Date.now;
  let cached: Receipt | undefined;
  let pending: Promise<Receipt> | undefined;
  let generation = 0;

  const post = (url: string, body: unknown, signal: AbortSignal) =>
    fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

  async function requestReceipt(signal: AbortSignal): Promise<Receipt> {
    let res;
    try {
      res = await post(consentEndpoint, { scope: "external-processing", granted: true }, signal);
    } catch (e) {
      throw new NonRetryableProviderError(`consent receipt request failed (${e instanceof Error ? e.message : String(e)})`);
    }
    const body = res.ok ? await res.json().catch(() => undefined) : undefined;
    if (!res.ok || !isPlainObject(body) || typeof body.receipt !== "string" || typeof body.expiresAt !== "number")
      throw new NonRetryableProviderError(`consent endpoint returned ${res.status} without a receipt`);
    return { receipt: body.receipt, expiresAt: body.expiresAt };
  }
  async function revokeToken(token: string): Promise<RevokeResult> {
    try {
      const res = await post(`${consentEndpoint}/revoke`, { receipt: token }, new AbortController().signal);
      if (res.ok) return { requested: true, confirmed: true };
      return { requested: true, confirmed: false, status: res.status, error: `revoke endpoint returned ${res.status}` };
    } catch (e) {
      // The receipt still expires on its own; the caller is told it was not confirmed.
      return { requested: true, confirmed: false, error: `revoke request failed (${e instanceof Error ? e.message : String(e)})` };
    }
  }
  /** A usable receipt, and whether it was reused from the cache. */
  async function receipt(signal: AbortSignal): Promise<{ r: Receipt; reused: boolean }> {
    if (cached && cached.expiresAt - RECEIPT_REFRESH_MARGIN_MS > now()) return { r: cached, reused: true };
    // Concurrent tasks share one in-flight request. A revocation while it is
    // in flight bumps the generation: the late receipt is revoked, not used.
    const gen = generation;
    pending ??= requestReceipt(signal).then(
      (r) => {
        if (gen !== generation) {
          void revokeToken(r.receipt);
          throw new NonRetryableProviderError("consent was withdrawn while a receipt was being issued");
        }
        cached = r;
        pending = undefined;
        return r;
      },
      (e) => {
        if (gen === generation) pending = undefined;
        throw e;
      },
    );
    return { r: await pending, reused: false };
  }

  return {
    id: `http:${endpoint}`,
    kind: "bedrock-via-server",
    complete: async (task, input, signal) => {
      const first = await receipt(signal);
      let res = await post(endpoint, { task, input, consent: { receipt: first.r.receipt } }, signal);
      if (res.status === 403) {
        // The server rejected the receipt: never reuse it.
        if (cached === first.r) cached = undefined;
        if (first.reused) {
          // A reused receipt may have expired or been revoked server-side
          // (e.g. after a server restart): one fresh receipt, one retry.
          const fresh = await receipt(signal);
          res = await post(endpoint, { task, input, consent: { receipt: fresh.r.receipt } }, signal);
          if (res.status === 403 && cached === fresh.r) cached = undefined;
        }
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => undefined);
        // The server answers {fallback:"deterministic"} when the consent
        // receipt is not accepted (403), no model is configured, the model is
        // down or the caller is throttled; a 400 means the request itself is
        // invalid. Retrying cannot help in any of these cases.
        if (res.status === 400 || res.status === 403 || (isPlainObject(errBody) && errBody.fallback === "deterministic"))
          throw new NonRetryableProviderError(`agent endpoint returned ${res.status} (deterministic fallback requested)`);
        throw new Error(`agent endpoint returned ${res.status}`);
      }
      const body = await res.json();
      return isPlainObject(body) && "output" in body ? body.output : body;
    },
    revokeConsent: async () => {
      const token = cached?.receipt;
      cached = undefined;
      pending = undefined;
      generation++;
      return token ? revokeToken(token) : { requested: false };
    },
  };
}
