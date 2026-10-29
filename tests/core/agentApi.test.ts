// Unit tests for the dependency-free POST /api/agent logic. server/index.mjs
// imports express/undici, so the Express adapter itself is covered by the
// vitest suite in tests/api.test.mjs instead.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain ESM server module without type declarations
import * as api from "../../server/agentApi.mjs";
import { NonRetryableProviderError, REVOKE_TIMEOUT_MS, consentWithdrawalNotice, httpProvider } from "../../src/providers/llm.ts";

type Result = { status: number; json: Record<string, unknown> };
type Call = { task: string; input: unknown };

const SECRET = "test-secret-0123456789abcdef";
const T0 = Date.UTC(2026, 9, 29, 9, 0, 0);
const clock = { now: T0 };
const ids = () => {
  let n = 0;
  return () => `receipt-${String(++n).padStart(4, "0")}`;
};
const store = (secret = SECRET) => api.createConsentReceipts({ secret, now: () => clock.now, newId: ids() });
let receipts = store();
let consent: { receipt: string } = { receipt: receipts.issue({ scope: "external-processing" }).receipt };
const strategyInput = {
  label: "Balanced",
  equityPct: 50,
  nominalLei: 98521,
  realLei: 67727,
  targetLei: 90000,
  gapLei: 0,
  horizonYears: 7,
};
let validBody = { task: "explain-strategy", input: strategyInput, consent };
/** Fresh store, clock and receipt for each test that needs isolation. */
function resetConsent() {
  clock.now = T0;
  receipts = store();
  consent = { receipt: receipts.issue({ scope: "external-processing" }).receipt };
  validBody = { task: "explain-strategy", input: strategyInput, consent };
}
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
      receipts,
    });
  return { handle, calls, warnings, throttleKeys };
}

test("agent API: 403 without consent, before throttling and without calling the model", async () => {
  resetConsent();
  const h = harness();
  const { consent: _omit, ...noConsent } = validBody;
  const r = await h.handle(noConsent);
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: "Consent to external processing is required.", fallback: "deterministic" });
  assert.equal(h.calls.length, 0, "model must not be called");
  assert.equal(h.throttleKeys.length, 0, "a rejected request does not count against the throttle");
});

test("agent API: 403 for the bare self-declared flag and other non-receipt consent values", async () => {
  resetConsent();
  const h = harness();
  for (const c of [{ externalProcessing: true }, { externalProcessing: false }, { externalProcessing: "true" }, {}, true, null, [true], { receipt: "" }, { receipt: 42 }]) {
    const r = await h.handle({ ...validBody, consent: c });
    assert.equal(r.status, 403, JSON.stringify(c));
    assert.equal(r.json.fallback, "deterministic");
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.throttleKeys.length, 0);
});

test("agent API: 400 for invalid bodies comes before the consent check", async () => {
  resetConsent();
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

test("agent API: 200 forwards only whitelisted fields and never the consent receipt", async () => {
  resetConsent();
  const h = harness();
  const range = { paths: 1000, p10Lei: 74239, p50Lei: 84778, p90Lei: 96593, reachSharePct: 28 };
  const r = await h.handle({ ...validBody, input: { ...strategyInput, ...range, extra: "not forwarded" }, extraTop: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { output, source: "bedrock" });
  assert.deepEqual(h.calls, [{ task: "explain-strategy", input: { ...strategyInput, ...range } }]);
  assert.ok(!JSON.stringify(h.calls).includes(consent.receipt), "the receipt never reaches the model");
  assert.ok(!JSON.stringify(h.calls).includes("receipt-"), "nor does the receipt id");

  await h.handle({ task: "extract-profile", input: { text: "90,000 lei in 7 years", consent }, consent });
  assert.deepEqual(h.calls[1], { task: "extract-profile", input: { text: "90,000 lei in 7 years" } });
  assert.deepEqual(h.throttleKeys, ["client-a", "client-a"]);
});

test("agent API: 429 after the limit with an injected clock, reset after the window", async () => {
  resetConsent();
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
  resetConsent();
  const h = harness({ hasKey: false });
  const r = await h.handle(validBody);
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: "No model is configured on this server.", fallback: "deterministic" });
  assert.equal(h.calls.length, 0);
});

test("agent API: 503 on model failure without leaking the error text", async () => {
  resetConsent();
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
  resetConsent();
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

// ---------- Consent receipts ----------
const scope = "external-processing";

test("consent receipts: issue then use succeeds; the issue handler needs an explicit grant", async () => {
  resetConsent();
  const issued = api.handleConsentIssue({ body: { scope, granted: true }, receipts });
  assert.equal(issued.status, 200);
  assert.deepEqual(Object.keys(issued.json).sort(), ["expiresAt", "issuedAt", "receipt", "receiptId", "scope"]);
  assert.equal(issued.json.scope, scope);
  assert.equal(issued.json.issuedAt, T0);
  assert.equal(issued.json.expiresAt, T0 + api.CONSENT_RECEIPT_TTL_MS);
  assert.equal(api.CONSENT_RECEIPT_TTL_MS, 30 * 60 * 1000);
  const h = harness();
  const r = await h.handle({ ...validBody, consent: { receipt: issued.json.receipt } });
  assert.equal(r.status, 200);
  assert.equal(h.calls.length, 1);

  for (const body of [{ scope, granted: false }, { scope, granted: "true" }, { scope: "marketing", granted: true }, { granted: true }, { externalProcessing: true }, null, "yes"]) {
    const bad = api.handleConsentIssue({ body, receipts });
    assert.equal(bad.status, 400, JSON.stringify(body));
    assert.ok(!("receipt" in bad.json));
  }
});

test("consent receipts: expired receipts are rejected with an injected clock", async () => {
  resetConsent();
  const h = harness();
  clock.now = T0 + api.CONSENT_RECEIPT_TTL_MS - 1;
  assert.equal((await h.handle(validBody)).status, 200, "still valid one millisecond before expiry");
  clock.now = T0 + api.CONSENT_RECEIPT_TTL_MS;
  const r = await h.handle(validBody);
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: api.CONSENT_REQUIRED_ERROR, fallback: "deterministic" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.throttleKeys.length, 1, "the expired request was not counted");
  assert.deepEqual(receipts.verify(consent.receipt, scope), { ok: false, reason: "expired" });
});

test("consent receipts: revoked receipts are rejected; revoke needs a correctly signed receipt", async () => {
  resetConsent();
  const h = harness();
  assert.equal((await h.handle(validBody)).status, 200);
  const revoked = api.handleConsentRevoke({ body: { receipt: consent.receipt }, receipts });
  assert.deepEqual(revoked, { status: 200, json: { revoked: true, receiptId: "receipt-0001" } });
  const r = await h.handle(validBody);
  assert.equal(r.status, 403);
  assert.equal(r.json.fallback, "deterministic");
  assert.equal(h.calls.length, 1, "model not called after revocation");
  assert.equal(h.throttleKeys.length, 1, "revoked request not counted against the throttle");
  for (const body of [{ receipt: "v1.forged.external-processing.9999999999999.sig" }, { receipt: "" }, {}, null])
    assert.equal(api.handleConsentRevoke({ body, receipts }).status, 400, JSON.stringify(body));
});

test("consent receipts: tampered, forged and wrong-scope receipts are rejected", async () => {
  resetConsent();
  const h = harness();
  const [v, id, sc, exp, sig] = consent.receipt.split(".");
  const flip = (c: string) => (c === "A" ? "B" : "A");
  const other = store("another-secret-0123456789abcdef").issue({ scope }).receipt;
  const wrongScope = receipts.issue({ scope: "briefing-content" }).receipt;
  const cases: [string, string][] = [
    [[v, id, sc, String(Number(exp) + 3_600_000), sig].join("."), "invalid-signature"],
    [[v, "receipt-9999", sc, exp, sig].join("."), "invalid-signature"],
    [[v, id, sc, exp, flip(sig[0]) + sig.slice(1)].join("."), "invalid-signature"],
    [[v, id, sc, exp, sig.slice(0, -2)].join("."), "invalid-signature"],
    [other, "invalid-signature"],
    [[v, id, sc, exp].join("."), "malformed"],
    [["v2", id, sc, exp, sig].join("."), "malformed"],
    ["x".repeat(600), "malformed"],
    [wrongScope, "wrong-scope"],
  ];
  for (const [token, reason] of cases) {
    const r = await h.handle({ ...validBody, consent: { receipt: token } });
    assert.equal(r.status, 403, token);
    assert.deepEqual(receipts.verify(token, scope), { ok: false, reason }, token);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.throttleKeys.length, 0);
  assert.throws(() => api.createConsentReceipts({ secret: "short" }), /at least 16/);
});

test("consent receipts: audit log records issued, revoked and rejected without request content", async () => {
  resetConsent();
  const h = harness();
  const secretText = "My name is Ana, 90,000 lei in 7 years";
  await h.handle({ task: "extract-profile", input: { text: secretText }, consent }, "203.0.113.7");
  await h.handle({ task: "extract-profile", input: { text: secretText }, consent: { externalProcessing: true } }, "203.0.113.7");
  clock.now = T0 + 1000;
  api.handleConsentRevoke({ body: { receipt: consent.receipt }, receipts });
  clock.now = T0 + 2000;
  await h.handle({ task: "extract-profile", input: { text: secretText }, consent }, "203.0.113.7");
  const log = receipts.auditLog();
  assert.deepEqual(log, [
    { event: "issued", receiptId: "receipt-0001", scope, at: T0 },
    { event: "rejected", receiptId: null, scope: null, at: T0, reason: "missing" },
    { event: "revoked", receiptId: "receipt-0001", scope, at: T0 + 1000 },
    { event: "rejected", receiptId: "receipt-0001", scope, at: T0 + 2000, reason: "revoked" },
  ]);
  const text = JSON.stringify(log);
  for (const leaked of ["Ana", "90", "203.0.113.7", consent.receipt.split(".")[4]]) assert.ok(!text.includes(leaked), leaked);

  const bounded = api.createConsentReceipts({ secret: SECRET, now: () => T0, auditLimit: 3, newId: ids() });
  for (let i = 0; i < 5; i++) bounded.issue({ scope });
  assert.deepEqual(bounded.auditLog().map((e: { receiptId: string }) => e.receiptId), ["receipt-0003", "receipt-0004", "receipt-0005"]);
});

test("consent receipts: rejections live in their own ring and cannot evict issued or revoked events", () => {
  const bounded = api.createConsentReceipts({ secret: SECRET, now: () => T0, auditLimit: 3, rejectedAuditLimit: 2, newId: ids() });
  const first = bounded.issue({ scope });
  bounded.revoke(first.receipt);
  for (let i = 0; i < 50; i++) bounded.verify(undefined, scope);
  bounded.issue({ scope });
  const log = bounded.auditLog();
  assert.deepEqual(
    log.map((e: { event: string; receiptId: string | null }) => [e.event, e.receiptId]),
    [["issued", "receipt-0001"], ["revoked", "receipt-0001"], ["rejected", null], ["rejected", null], ["issued", "receipt-0002"]],
    "50 rejections keep only the last 2 and leave every consent event in place, in recording order",
  );
  assert.equal(api.CONSENT_REJECTED_AUDIT_LIMIT, 100);
  assert.equal(api.CONSENT_AUDIT_LIMIT, 500);
});

test("consent receipts: repeated revokes add one audit entry and expired receipts add none, still 200", () => {
  let now = T0;
  const store3 = api.createConsentReceipts({ secret: SECRET, now: () => now, auditLimit: 3, newId: ids() });
  const live = store3.issue({ scope });
  const old = store3.issue({ scope });
  const revoke = (receipt: string) => api.handleConsentRevoke({ body: { receipt }, receipts: store3 });
  const before = store3.auditLog().length;
  for (let i = 0; i < 200; i++)
    assert.deepEqual(revoke(live.receipt), { status: 200, json: { revoked: true, receiptId: live.receiptId } });
  assert.equal(store3.auditLog().length, before + 1, "200 revokes of one receipt write exactly one entry");
  assert.equal(store3.verify(live.receipt, scope).reason, "revoked");

  now = T0 + api.CONSENT_RECEIPT_TTL_MS; // `old` has expired
  const atExpiry = store3.auditLog().length;
  for (let i = 0; i < 5; i++)
    assert.deepEqual(revoke(old.receipt), { status: 200, json: { revoked: true, receiptId: old.receiptId } });
  assert.equal(store3.auditLog().length, atExpiry, "revoking an expired receipt writes nothing");
  assert.deepEqual(
    store3.auditLog().map((e: { event: string; receiptId: string }) => [e.event, e.receiptId]),
    [["issued", "receipt-0001"], ["issued", "receipt-0002"], ["revoked", "receipt-0001"], ["rejected", "receipt-0001"]],
    "both issued events survive in a consent ring of three (the rejection from verify lives in its own ring)",
  );
});

test("consent routes: 429 when throttled, checked first; withdrawal has its own, looser bucket", () => {
  resetConsent();
  assert.ok(api.CONSENT_REVOKE_THROTTLE_LIMIT > api.CONSENT_THROTTLE_LIMIT, "withdrawing is never harder than granting");
  let now = T0;
  const issueBucket = api.createThrottle(2, api.CONSENT_THROTTLE_WINDOW_MS, () => now);
  const revokeBucket = api.createThrottle(3, api.CONSENT_THROTTLE_WINDOW_MS, () => now);
  const grant = { scope, granted: true };
  const issue = () => api.handleConsentIssue({ body: grant, receipts, throttle: issueBucket, clientKey: "client-a" });
  const revoke = (receipt: string) => api.handleConsentRevoke({ body: { receipt }, receipts, throttle: revokeBucket, clientKey: "client-a" });
  const a = issue();
  const b = issue();
  assert.deepEqual([a.status, b.status], [200, 200]);
  const before = receipts.auditLog().length;
  assert.deepEqual(issue(), { status: 429, json: { error: "Please wait a moment before trying again." } });
  assert.equal(receipts.auditLog().length, before, "a throttled grant issues nothing");
  assert.equal(api.handleConsentIssue({ body: grant, receipts, throttle: issueBucket, clientKey: "client-b" }).status, 200, "per client");

  // The grant bucket is exhausted, yet withdrawal still works.
  assert.equal(revoke(a.json.receipt as string).status, 200);
  assert.equal(api.hasExternalProcessingConsent({ consent: { receipt: a.json.receipt } }, receipts), false);
  assert.equal(revoke(b.json.receipt as string).status, 200);
  assert.equal(revoke(b.json.receipt as string).status, 200);
  const limited = revoke(b.json.receipt as string);
  assert.equal(limited.status, 429);
  assert.equal(api.handleConsentRevoke({ body: { receipt: "garbage" }, receipts, throttle: revokeBucket, clientKey: "client-a" }).status, 429, "throttle before validation");
  now = T0 + api.CONSENT_THROTTLE_WINDOW_MS;
  assert.equal(revoke(b.json.receipt as string).status, 200, "reset after the window");
  assert.equal(issue().status, 200);
  // Without a throttle the handlers behave as before (used by the pure tests above).
  assert.equal(api.handleConsentIssue({ body: grant, receipts }).status, 200);
});

// ---------- httpProvider (browser side of the consent contract) ----------
type Sent = { url: string; body: Record<string, unknown> };
type Reply = { status: number; json: unknown };
/** Fake fetch that routes /api/consent, /api/consent/revoke and /api/agent to queues or handlers. */
function routedFetch(routes: Record<string, (body: Record<string, unknown>) => Reply | Promise<Reply>>, sent: Sent[]) {
  return async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    const route = routes[url];
    if (!route) throw new Error(`unexpected ${url}`);
    const { status, json } = await route(body);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
}
const issueReply = (receipt: string, expiresAt = T0 + 30 * 60 * 1000): Reply => ({ status: 200, json: { receipt, expiresAt } });
const signal = () => new AbortController().signal;

test("httpProvider requests a receipt once, reuses it and sends it with each task", async () => {
  const sent: Sent[] = [];
  const provider = httpProvider(
    routedFetch({ "/api/consent": () => issueReply("tok-1"), "/api/agent": () => ({ status: 200, json: { output, source: "bedrock" } }) }, sent),
    "/api/agent",
    { now: () => T0 },
  );
  assert.deepEqual(await provider.complete("explain-strategy", strategyInput, signal()), output);
  await provider.complete("explain-objections", { findings: [] }, signal());
  assert.deepEqual(sent, [
    { url: "/api/consent", body: { scope: "external-processing", granted: true } },
    { url: "/api/agent", body: { task: "explain-strategy", input: strategyInput, consent: { receipt: "tok-1" } } },
    { url: "/api/agent", body: { task: "explain-objections", input: { findings: [] }, consent: { receipt: "tok-1" } } },
  ]);
});

test("httpProvider refreshes a receipt near expiry and re-requests once on a 403 for a reused receipt", async () => {
  let now = T0;
  let n = 0;
  const sent: Sent[] = [];
  const valid = new Set<string>();
  const provider = httpProvider(
    routedFetch(
      {
        "/api/consent": () => {
          const token = `tok-${++n}`;
          valid.add(token);
          return issueReply(token, now + 30 * 60 * 1000);
        },
        "/api/agent": (b) =>
          valid.has((b.consent as { receipt: string }).receipt)
            ? { status: 200, json: { output } }
            : { status: 403, json: { error: api.CONSENT_REQUIRED_ERROR, fallback: "deterministic" } },
      },
      sent,
    ),
    "/api/agent",
    { now: () => now },
  );
  await provider.complete("explain-strategy", strategyInput, signal());
  now = T0 + 30 * 60 * 1000 - 60_000; // inside the refresh margin
  await provider.complete("explain-strategy", strategyInput, signal());
  assert.deepEqual(sent.filter((s) => s.url === "/api/consent").length, 2, "refreshed before expiry");

  valid.clear(); // e.g. the server restarted or revoked the receipt
  await provider.complete("explain-strategy", strategyInput, signal());
  assert.deepEqual(
    sent.slice(-3).map((s) => [s.url, (s.body.consent as { receipt?: string } | undefined)?.receipt]),
    [["/api/agent", "tok-2"], ["/api/consent", undefined], ["/api/agent", "tok-3"]],
  );
});

test("httpProvider never loops: receipt failures and repeated 403s are non-retryable", async () => {
  for (const consentRoute of [() => ({ status: 503, json: {} }), () => ({ status: 200, json: { nothing: true } }), () => Promise.reject(new Error("offline"))]) {
    const sent: Sent[] = [];
    const provider = httpProvider(routedFetch({ "/api/consent": consentRoute as () => Reply, "/api/agent": () => ({ status: 200, json: { output } }) }, sent));
    await assert.rejects(provider.complete("explain-strategy", strategyInput, signal()), (e: unknown) => e instanceof NonRetryableProviderError);
    assert.deepEqual(sent.map((s) => s.url), ["/api/consent"], "one receipt request, the agent is not called");
  }

  const sent: Sent[] = [];
  let n = 0;
  const provider = httpProvider(
    routedFetch(
      {
        "/api/consent": () => issueReply(`tok-${++n}`),
        "/api/agent": () => ({ status: 403, json: { error: api.CONSENT_REQUIRED_ERROR, fallback: "deterministic" } }),
      },
      sent,
    ),
    "/api/agent",
    { now: () => T0 },
  );
  await assert.rejects(provider.complete("explain-strategy", strategyInput, signal()), (e: unknown) => e instanceof NonRetryableProviderError);
  assert.deepEqual(sent.map((s) => s.url), ["/api/consent", "/api/agent"], "a fresh receipt rejected with 403 is not retried");
  await assert.rejects(provider.complete("explain-strategy", strategyInput, signal()));
  assert.deepEqual(sent.length, 4, "the rejected receipt was dropped: next task asks once more, still no loop");

  const generic = httpProvider(routedFetch({ "/api/consent": () => issueReply("tok"), "/api/agent": () => ({ status: 502, json: {} }) }, []));
  await assert.rejects(generic.complete("explain-strategy", strategyInput, signal()), (e: unknown) => {
    assert.ok(!(e instanceof NonRetryableProviderError), "generic upstream errors stay retryable");
    return true;
  });
});

test("httpProvider revokeConsent revokes the cached receipt and the next task needs a new one", async () => {
  const sent: Sent[] = [];
  let n = 0;
  const provider = httpProvider(
    routedFetch(
      {
        "/api/consent": () => issueReply(`tok-${++n}`),
        "/api/consent/revoke": () => ({ status: 200, json: { revoked: true } }),
        "/api/agent": () => ({ status: 200, json: { output } }),
      },
      sent,
    ),
    "/api/agent",
    { now: () => T0 },
  );
  assert.deepEqual(await provider.revokeConsent(), { requested: false });
  assert.equal(sent.length, 0, "nothing to revoke before any receipt");
  await provider.complete("explain-strategy", strategyInput, signal());
  assert.deepEqual(await provider.revokeConsent(), { requested: true, confirmed: true });
  assert.deepEqual(sent.at(-1), { url: "/api/consent/revoke", body: { receipt: "tok-1" } });
  await provider.complete("explain-strategy", strategyInput, signal());
  assert.deepEqual(sent.slice(-2).map((s) => s.url), ["/api/consent", "/api/agent"]);
  assert.equal((sent.at(-1)!.body.consent as { receipt: string }).receipt, "tok-2");
});

test("httpProvider revokeConsent reports an unconfirmed withdrawal (429, 400, offline) and still forgets the receipt", async () => {
  const cases: [string, () => Reply | Promise<Reply>, number | undefined, RegExp][] = [
    ["throttled", () => ({ status: 429, json: { error: "Please wait a moment before trying again." } }), 429, /busy \(HTTP 429\)/],
    ["rejected", () => ({ status: 400, json: { error: "Unknown or invalid consent receipt." } }), 400, /answered HTTP 400/],
    ["offline", () => Promise.reject(new Error("offline")), undefined, /could not be reached/],
  ];
  for (const [name, revokeRoute, status, notice] of cases) {
    const sent: Sent[] = [];
    let n = 0;
    const provider = httpProvider(
      routedFetch(
        {
          "/api/consent": () => issueReply(`tok-${++n}`),
          "/api/consent/revoke": revokeRoute,
          "/api/agent": () => ({ status: 200, json: { output } }),
        },
        sent,
      ),
      "/api/agent",
      { now: () => T0 },
    );
    await provider.complete("explain-strategy", strategyInput, signal());
    const result = await provider.revokeConsent();
    assert.equal(result.requested && result.confirmed, false, name);
    assert.equal(result.requested && !result.confirmed ? result.status : "n/a", status, name);
    const text = consentWithdrawalNotice(result);
    assert.match(text, notice, name);
    assert.match(text, /expires on its own within 30 minutes/, name);
    assert.ok(!text.includes("\u2014"), "no em dash");
    // The failed withdrawal is not silently treated as success, and the old receipt is never reused.
    await provider.complete("explain-strategy", strategyInput, signal());
    assert.deepEqual(sent.slice(-2).map((s) => s.url), ["/api/consent", "/api/agent"], name);
    assert.equal((sent.at(-1)!.body.consent as { receipt: string }).receipt, "tok-2", name);
  }
  assert.equal(consentWithdrawalNotice({ requested: true, confirmed: true }), "");
  assert.equal(consentWithdrawalNotice({ requested: false }), "");
});

test("httpProvider revokeConsent times out on a server that never answers and shows the unreachable notice", async () => {
  assert.equal(REVOKE_TIMEOUT_MS, 5_000);
  const sent: Sent[] = [];
  let revokeSignal: AbortSignal | undefined;
  const base = routedFetch({ "/api/consent": () => issueReply("tok-1"), "/api/agent": () => ({ status: 200, json: { output } }) }, sent);
  const hanging = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    if (url !== "/api/consent/revoke") return base(url, init);
    revokeSignal = init.signal;
    return new Promise<never>(() => {}); // never settles and ignores the abort signal
  };
  const provider = httpProvider(hanging, "/api/agent", { now: () => T0, revokeTimeoutMs: 20 });
  await provider.complete("explain-strategy", strategyInput, signal());
  const result = await provider.revokeConsent();
  assert.equal(result.requested && !result.confirmed && result.status, undefined);
  assert.match(result.requested && !result.confirmed ? result.error : "", /timed out after 20 ms/);
  assert.equal(revokeSignal?.aborted, true, "the request is aborted");
  assert.match(consentWithdrawalNotice(result), /could not be reached/);
});

test("httpProvider and the server agree end to end: issue, use, revoke, reject", async () => {
  resetConsent();
  const h = harness();
  const sent: Sent[] = [];
  const provider = httpProvider(
    routedFetch(
      {
        "/api/consent": (body) => {
          const r = api.handleConsentIssue({ body, receipts });
          return { status: r.status, json: r.json };
        },
        "/api/consent/revoke": (body) => {
          const r = api.handleConsentRevoke({ body, receipts });
          return { status: r.status, json: r.json };
        },
        "/api/agent": async (body) => {
          const r = await h.handle(body);
          return { status: r.status, json: r.json };
        },
      },
      sent,
    ),
    "/api/agent",
    { now: () => clock.now },
  );
  assert.deepEqual(await provider.complete("explain-strategy", strategyInput, signal()), output);
  assert.equal(h.calls.length, 1);
  const used = (sent.find((s) => s.url === "/api/agent")!.body.consent as { receipt: string }).receipt;
  assert.equal(api.hasExternalProcessingConsent({ consent: { receipt: used } }, receipts), true);
  await provider.revokeConsent();
  assert.equal(api.hasExternalProcessingConsent({ consent: { receipt: used } }, receipts), false, "revoked on the server");
  assert.deepEqual(
    receipts.auditLog().map((e: { event: string }) => e.event),
    ["issued", "issued", "revoked", "rejected"],
  );
});

test("httpProvider: consent withdrawn while a receipt is in flight revokes that receipt instead of using it", async () => {
  const sent: Sent[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const provider = httpProvider(
    routedFetch(
      {
        "/api/consent": async () => {
          await gate;
          return issueReply("late-tok");
        },
        "/api/consent/revoke": () => ({ status: 200, json: { revoked: true } }),
        "/api/agent": () => ({ status: 200, json: { output } }),
      },
      sent,
    ),
    "/api/agent",
    { now: () => T0 },
  );
  const call = provider.complete("explain-strategy", strategyInput, signal());
  await provider.revokeConsent();
  release();
  await assert.rejects(call, (e: unknown) => e instanceof NonRetryableProviderError);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((s) => s.url), ["/api/consent", "/api/consent/revoke"], "the agent is never called with the late receipt");
  assert.deepEqual(sent[1].body, { receipt: "late-tok" });
});
