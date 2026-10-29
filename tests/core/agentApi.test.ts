// Unit tests for the dependency-free POST /api/agent logic. server/index.mjs
// imports express/undici, so the Express adapter itself is covered by the
// vitest suite in tests/api.test.mjs instead.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain ESM server module without type declarations
import * as api from "../../server/agentApi.mjs";
import { NonRetryableProviderError, httpProvider } from "../../src/providers/llm.ts";

type Result = { status: number; json: Record<string, unknown> };
type Call = { task: string; input: unknown };

const consent = { externalProcessing: true };
const strategyInput = {
  label: "Balanced",
  equityPct: 50,
  nominalLei: 98521,
  realLei: 67727,
  targetLei: 90000,
  gapLei: 0,
  horizonYears: 7,
};
const validBody = { task: "explain-strategy", input: strategyInput, consent };
const output = { text: "An illustration, not a forecast.", citedNumbers: [] };

function harness(extra: { hasKey?: boolean; requestAgent?: (task: string, input: unknown) => Promise<unknown>; throttle?: (key: string) => boolean } = {}) {
  const calls: Call[] = [];
  const warnings: unknown[][] = [];
  const throttleKeys: string[] = [];
  const handle = (body: unknown, clientKey = "client-a"): Promise<Result> =>
    api.handleAgentRequest({
      body,
      clientKey,
      hasKey: () => extra.hasKey ?? true,
      requestAgent: async (task: string, input: unknown) => {
        calls.push({ task, input });
        return extra.requestAgent ? extra.requestAgent(task, input) : output;
      },
      throttle: (key: string) => {
        throttleKeys.push(key);
        return extra.throttle ? extra.throttle(key) : true;
      },
      warn: (...args: unknown[]) => warnings.push(args),
    });
  return { handle, calls, warnings, throttleKeys };
}

test("agent API: 403 without consent, before throttling and without calling the model", async () => {
  const h = harness();
  const { consent: _omit, ...noConsent } = validBody;
  const r = await h.handle(noConsent);
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: "Consent to external processing is required.", fallback: "deterministic" });
  assert.equal(h.calls.length, 0, "model must not be called");
  assert.equal(h.throttleKeys.length, 0, "a rejected request does not count against the throttle");
});

test("agent API: 403 when consent is false or not an explicit true", async () => {
  const h = harness();
  for (const c of [{ externalProcessing: false }, { externalProcessing: "true" }, {}, true, null, [true]]) {
    const r = await h.handle({ ...validBody, consent: c });
    assert.equal(r.status, 403, JSON.stringify(c));
    assert.equal(r.json.fallback, "deterministic");
  }
  assert.equal(h.calls.length, 0);
});

test("agent API: 400 for invalid bodies comes before the consent check", async () => {
  const h = harness();
  const invalid = [
    { task: "unknown-task", input: {}, consent },
    { task: "extract-profile", input: { text: "x".repeat(9000) }, consent },
    { task: "extract-profile", input: "not an object", consent },
    { ...validBody, input: { ...strategyInput, nominalLei: "lots" } },
    { ...validBody, input: { ...strategyInput, p50Lei: "lots" } },
    { task: "explain-objections", input: { findings: [{ id: "a", severity: "critical", message: "m" }] }, consent },
    { task: "unknown-task", input: {} },
    null,
    "text",
  ];
  for (const body of invalid) {
    const r = await h.handle(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json, { error: "Invalid agent request." });
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.throttleKeys.length, 0);
});

test("agent API: 200 forwards only whitelisted fields and never the consent flag", async () => {
  const h = harness();
  const range = { paths: 1000, p10Lei: 74239, p50Lei: 84778, p90Lei: 96593, reachSharePct: 28 };
  const r = await h.handle({ ...validBody, input: { ...strategyInput, ...range, extra: "not forwarded" }, extraTop: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { output, source: "bedrock" });
  assert.deepEqual(h.calls, [{ task: "explain-strategy", input: { ...strategyInput, ...range } }]);
  assert.ok(!JSON.stringify(h.calls).includes("externalProcessing"));

  await h.handle({ task: "extract-profile", input: { text: "90,000 lei in 7 years", consent }, consent });
  assert.deepEqual(h.calls[1], { task: "extract-profile", input: { text: "90,000 lei in 7 years" } });
  assert.deepEqual(h.throttleKeys, ["client-a", "client-a"]);
});

test("agent API: 429 after the limit with an injected clock, reset after the window", async () => {
  let now = 1_000;
  const throttle = api.createThrottle(2, 60_000, () => now);
  const h = harness({ throttle });
  assert.equal((await h.handle(validBody)).status, 200);
  assert.equal((await h.handle(validBody)).status, 200);
  const limited = await h.handle(validBody);
  assert.equal(limited.status, 429);
  assert.equal(limited.json.fallback, "deterministic");
  assert.equal((await h.handle(validBody, "client-b")).status, 200, "limits are per client key");
  assert.equal(h.calls.length, 3, "throttled request does not reach the model");
  now += 59_999;
  assert.equal((await h.handle(validBody)).status, 429);
  now += 1;
  assert.equal((await h.handle(validBody)).status, 200, "a new window starts after windowMs");
});

test("agent API: 503 without a model key, model never called", async () => {
  const h = harness({ hasKey: false });
  const r = await h.handle(validBody);
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: "No model is configured on this server.", fallback: "deterministic" });
  assert.equal(h.calls.length, 0);
});

test("agent API: 503 on model failure without leaking the error text", async () => {
  const h = harness({
    requestAgent: async () => {
      throw Object.assign(new Error("private upstream details"), { status: 500 });
    },
  });
  const r = await h.handle(validBody);
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: "The model is temporarily unavailable.", fallback: "deterministic" });
  assert.ok(!JSON.stringify(r.json).includes("private upstream"));
  assert.ok(!JSON.stringify(h.warnings).includes("private upstream"), "logs carry only the status");
  assert.deepEqual(h.warnings, [["Agent model unavailable:", "HTTP 500"]]);
});

test("agent API: 503 when the model returns a non-object", async () => {
  for (const bad of ["text", [1, 2], null, 42]) {
    const h = harness({ requestAgent: async () => bad });
    const r = await h.handle(validBody);
    assert.equal(r.status, 503, JSON.stringify(bad));
    assert.equal(r.json.fallback, "deterministic");
  }
});

test("agent API: parseModelJson accepts one JSON object and rejects anything else", () => {
  assert.deepEqual(api.parseModelJson('```json\n{"text":"a","citedNumbers":[]}\n```'), { text: "a", citedNumbers: [] });
  assert.throws(() => api.parseModelJson("no json here"));
  assert.throws(() => api.parseModelJson("[1,2]"));
});

// ---------- httpProvider (browser side of the consent contract) ----------
type Sent = { url: string; body: Record<string, unknown> };
const fakeFetch = (status: number, json: unknown, sent: Sent[]) => async (url: string, init: { body: string }) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return { ok: status >= 200 && status < 300, status, json: async () => json };
};

test("httpProvider sends consent with the task and input", async () => {
  const sent: Sent[] = [];
  const provider = httpProvider(fakeFetch(200, { output, source: "bedrock" }, sent));
  const result = await provider.complete("explain-strategy", strategyInput, new AbortController().signal);
  assert.deepEqual(result, output);
  assert.deepEqual(sent, [{ url: "/api/agent", body: { task: "explain-strategy", input: strategyInput, consent: { externalProcessing: true } } }]);
});

test("httpProvider treats 403 as non-retryable, with or without a fallback body", async () => {
  for (const body of [{ error: "Consent to external processing is required.", fallback: "deterministic" }, {}]) {
    const provider = httpProvider(fakeFetch(403, body, []));
    await assert.rejects(provider.complete("explain-strategy", strategyInput, new AbortController().signal), (e: unknown) => {
      assert.ok(e instanceof NonRetryableProviderError);
      return true;
    });
  }
  const generic = httpProvider(fakeFetch(502, {}, []));
  await assert.rejects(generic.complete("explain-strategy", strategyInput, new AbortController().signal), (e: unknown) => {
    assert.ok(!(e instanceof NonRetryableProviderError), "generic upstream errors stay retryable");
    return true;
  });
});

test("httpProvider and the server agree: a provider request passes the server consent check", async () => {
  const sent: Sent[] = [];
  const provider = httpProvider(fakeFetch(200, { output }, sent));
  await provider.complete("explain-strategy", strategyInput, new AbortController().signal);
  const h = harness();
  const r = await h.handle(sent[0].body);
  assert.equal(r.status, 200);
  assert.equal(api.hasExternalProcessingConsent(sent[0].body), true);
});
