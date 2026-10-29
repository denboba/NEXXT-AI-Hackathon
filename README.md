# Raiffeisen AI Investment Coach

A responsive, functional concept prototype that takes a visitor from an anonymous educational conversation to a simulated monthly investment plan. It is an independent concept, not an official Raiffeisen service. All funds, customer access, and transactions are fictional.

The **Decision Lab** extends the coach into a bounded multi-stage workflow: **Goal -> Strategy -> Stress test -> Revision -> Validation -> Next step**. A profile stage captures facts, a suitability stage sets illustrative risk limits, a strategy stage proposes an allocation, an independent challenger stress-tests it and can send it back for revision, a guardrail validates it before release, and a next-step stage recommends a review or an adviser conversation with a consent-gated briefing. All numbers are computed by deterministic code; a language model is optional. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

### Judge quick path

**Without installing anything** (Node.js with native TypeScript type stripping: Node 24 as declared in `engines`; verified on Node 24.22.1 and Node 22.23.4; no `npm ci`, no network, no API key):

1. `npm run demo -- --replay monthlyContribution=900` prints the full Ana journey: stage timeline (fresh or reused, with the reason), every traced tool call, the challenger findings with severity and evidence, the v1 vs v2 strategy comparison (label, equity, buckets, projection, seeded outcome range, reach share, and the rationale sentence that names which limit bound the choice), the 16 guardrail checks, levers, the next step and a counterfactual replay showing which stages were reused or recomputed.
2. `npm run eval` runs all 23 evaluation scenarios against the real orchestrator (exit 1 on any failure).
3. `npm run test:core` runs the dependency-free unit and integration tests.
4. Read the committed evidence: [docs/evidence/demo-ana.md](docs/evidence/demo-ana.md) and [docs/evidence/eval-report.md](docs/evidence/eval-report.md). Both are generated output (fixed clock, fixed seed, synthetic data); `npm run evidence:check` regenerates them in memory and fails if they differ, and `npm run evidence` rewrites them.
5. Domain and business documents: [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) (every policy number and synthetic assumption with its code location and pilot replacement) and [docs/PILOT.md](docs/PILOT.md) (pilot proposal, metric definitions mapped to the analytics events, risks).

**With the UI** (needs `npm ci`):

1. `npm ci`, then `npm run dev` and open `http://localhost:5173/decision`.
2. Click **Load synthetic demo: Ana**, then **Run assessment**.
3. Inspect the stage timeline (with tool-call chips), the challenger findings and the revision (v1 vs v2 comparison, including the seeded range of outcomes).
4. Use **Replay with this change** (for example a higher monthly contribution) to see which stages are reused and which are recomputed.
5. Click **Preview adviser briefing** and walk through the consent step; export is only possible after consent and is a local download.
6. Open `/lab` and click **Run all 23 scenarios**; open any scenario and use **Replay with modified input**.
7. Open `/growth` for the funnel and business hypothesis.

No API key is needed: without one the deterministic provider is used and labelled in the UI. The UI steps have not been rendered in the build sandbox (see Verification status).

## Run

Requires **Node.js 24+** and npm (`engines: >=24`). No database or Supabase project is required. The dependency-free core scripts (`test:core`, `eval`, `check:syntax`) rely on Node's native TypeScript type stripping and were also verified on Node 22.23.4.

```sh
npm ci
npm run dev
```

The development command starts Vite on port **5173** and the server API on port **3001**. Vite forwards `/api` to the backend. Keep both processes running. Stop them before reinstalling dependencies, then restart them to refresh module caches. In this cloud workspace, use `npm ci --cache /workspace/.cache/npm` to keep the npm cache writable.

For a production build and a single-server workflow:

```sh
npm run build
npm start
```

The production server serves both the built app and API on port **3001** (or `PORT`). These commands build and start the prototype; they do not publish or deploy it.

## Amazon Bedrock

The server supports a Bedrock API key through the environment. The browser never receives the key. Configure these values in cloud environment settings:

| Variable                                                 | Purpose                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_BEARER_TOKEN_BEDROCK`                               | Secret Bedrock API key, delivered through the environment's supported secret binding.                                                             |
| `AWS_REGION`                                             | Defaults to `us-west-2`.                                                                                                                          |
| `BEDROCK_MODEL_ID`                                       | Defaults to `us.amazon.nova-lite-v1:0`, an inference profile used with the Converse API. Choose an accessible compatible model/profile if needed. |
| `PORT`                                                   | Optional backend port, default `3001`. For development, keep 3001 unless you also update the Vite proxy.                                          |
| `AWS_CA_BUNDLE` / `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` | Optional CA bundle for managed proxies (see below).                                                                                               |
| `HTTPS_PROXY`                                            | Optional, inherited outbound proxy.                                                                                                               |

All variables are optional. Without `AWS_BEARER_TOKEN_BEDROCK` the coach uses its deterministic guide and the Decision Lab uses the deterministic reasoning provider; both are labelled in the UI. Never commit a key or put it in a `VITE_` variable.

The configured secret and network policy must permit **`bedrock-runtime.us-west-2.amazonaws.com`**. Changing region also requires updating the endpoint permission and secret destination in environment settings. `.env.example` documents configuration; the server inherits environment variables and does not automatically load `.env` files.

The server retains the inherited HTTPS proxy and uses `AWS_CA_BUNDLE`, `SSL_CERT_FILE`, or `REQUESTS_CA_BUNDLE` to trust the managed environment CA. TLS verification remains enabled.

`GET /api/health` reports whether a key is configured; it does not prove live model access. `POST /api/coach` validates conversation/context and invokes Bedrock server-side. With no key, it provides a labeled deterministic educational guide. If a configured live request fails or times out, the frontend explains that it is using the guide. No conversation or credential values are logged by the server.

`POST /api/agent` serves structured Decision Lab tasks (`extract-profile`, `explain-strategy`, `explain-objections`) through Bedrock. The request body is `{ "task": ..., "input": { ...whitelisted fields }, "consent": { "receipt": "<token>" } }`, where the token is a consent receipt issued by this server. The handler logic lives in the dependency-free `server/agentApi.mjs` (`handleAgentRequest`, `createConsentReceipts`, `handleConsentIssue`, `handleConsentRevoke`, unit-tested in `tests/core/agentApi.test.ts`); `server/index.mjs` is a thin Express adapter.

Consent receipts:

- `POST /api/consent` with `{ "scope": "external-processing", "granted": true }` returns 200 `{ "receipt", "receiptId", "scope", "issuedAt", "expiresAt" }` (times in ms since epoch); any other body returns 400. The receipt is an HMAC-SHA256 signed token over its id, scope and expiry, valid for 30 minutes. The signing secret is `CONSENT_RECEIPT_SECRET` (at least 16 characters) or, if unset, a random per-process secret, so receipts do not survive a server restart.
- `POST /api/consent/revoke` with `{ "receipt" }` revokes a correctly signed receipt (200 `{ "revoked": true, "receiptId" }`, otherwise 400). It is idempotent: an already revoked or expired receipt also gets 200. The browser calls it when the user unticks the external-processing box. Unticking always stops further external calls from that page; if the server does not confirm the revocation (for example a 429, a 400, no connection or no answer within 5 seconds, after which the request is aborted), the Decision Lab says so and that the receipt lapses at its 30-minute expiry instead.
- Both consent routes use the 32 kb JSON limit and per-client throttles in separate buckets: 30 grants per minute for `/api/consent` and a looser 120 withdrawals per minute for `/api/consent/revoke`, so withdrawing is never harder than granting. A throttled call returns 429 `{ "error" }`.
- The server keeps a bounded in-memory audit log with receipt id, scope, time and rejection reason only; it stores no request text, goal data or client address. `issued` and `revoked` events are kept in one ring (last 500) and `rejected` events in a separate ring (last 100), so a flood of requests with bad or missing receipts cannot evict consent events. Only the first revocation of a live receipt is recorded; repeated or late revokes of the same receipt write nothing, so the withdrawal route cannot flood the consent ring either. No route, log line or export reads it: in this prototype the audit log is test-observable only (`receipts.auditLog()` in `tests/core/agentApi.test.ts` and `tests/api.test.mjs`), not an operational audit trail.

`POST /api/agent` checks run in this order:

1. 400 `{ "error": "Invalid agent request." }` for invalid, unknown or oversized (over 8,000 characters) requests.
2. 403 `{ "error": "Consent to external processing is required.", "fallback": "deterministic" }` when the receipt is missing, malformed, wrongly signed, expired, for another scope or revoked. The bare flag `consent: { "externalProcessing": true }` is no longer accepted. This check runs before throttling counts and before any model call.
3. 429 with `fallback: "deterministic"` above 60 requests per client per minute.
4. 503 with `fallback: "deterministic"` when no key is configured or the model fails (only an HTTP status or a generic failure is logged, never error text).
5. 200 `{ "output": ..., "source": "bedrock" }`.

Consent is enforced twice: the browser engine never calls the HTTP provider unless the user ticked the external-processing box, and the server rejects requests without a valid receipt. Ticking the box sends nothing by itself: the provider requests a receipt only on its first consented call (the next run with Bedrock selected), caches it until one minute before expiry, requests a fresh one once if a reused receipt is rejected (for example after a server restart), and falls back to deterministic rules if no receipt can be obtained; it never retries in a loop. Neither the consent object nor the receipt is forwarded to the model.

**What the receipt does and does not prove.** It proves that an explicit consent step for this scope was recorded by this server, that it is recent (30 minutes) and that it was not withdrawn. It does **not** authenticate a person or prove that a human, rather than a script, asked for it: any client can still call `POST /api/consent` with `granted: true`. The audit log is in memory and lost on restart. A real deployment would bind the receipt to an authenticated session, persist the audit trail and show the consent text version that was agreed to. The browser re-validates every answer and falls back to deterministic rules otherwise; 400, 403 and any `fallback: "deterministic"` answer are not retried. The model never computes plan numbers.

A live educational question was successfully answered using the configured `us-west-2` Bedrock endpoint and default Nova Lite inference profile during implementation. Live responses can still depend on key expiry, model permissions, service availability, and quotas.

## The journey

| Route                     | Experience                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                       | Campaign landing, interactive inflation illustration, questions, four-stage overview.                                                   |
| `/coach`                  | Three questions, free-text educational chat, quick replies, live contribution/horizon controls and charts.                              |
| `/onboarding`             | New-customer or existing-customer demo choice.                                                                                          |
| `/onboarding/new-account` | Two-step illustrated profile flow; no real identity verification.                                                                       |
| `/onboarding/login`       | Demo customer access; no password or bank login collected.                                                                              |
| `/account/invest`         | Fictional funds with allocation, illustrative fees, risk, liquidity details, and horizon requirements.                                  |
| `/account/plan`           | Review, illustrative contribution day, and explicit risk/demo acknowledgment.                                                           |
| `/account/success`        | Simulated confirmation, downloadable plan, and educational next steps.                                                                  |
| `/decision`               | Decision Lab: goal intake, staged run, stress test, revision comparison, counterfactual replay, consent-gated adviser briefing preview. |
| `/lab`                    | Evaluation Lab: run all scenarios, inspect assertions and traces, replay a scenario with modified input.                                |
| `/growth`                 | Funnel from recorded browser events, a labelled synthetic sample, and hypothetical business projections.                                |

The shared journey, conversation, and demo display name are saved in browser `localStorage`. They survive refresh and route changes, but do not sync across devices. Storage failures fall back to memory with a visible notice. **Reset demo** clears the saved journey. Changing an activated scenario requires reviewing and activating a new demo plan. Funds are examples, not suitability recommendations.

Do not enter real banking credentials, identity documents, or sensitive personal information. When the live coach is available, free-text questions and simulation context are sent to Bedrock. A real banking service would require actual authentication, identity checks, suitability assessment, product documents, and a separately designed backend; none is claimed here.

## Financial model

`src/lib/finance.ts` keeps calculations separate from the UI.

- Inflation: purchasing power = initial amount / `(1 + inflation)^years`. The reference example is 10,000 lei / `1.055^5` ≈ **7,651 lei**.
- Contributions happen at the **end of each month**.
- Annual fees are approximated as a reduction in assumed annual return. The equivalent monthly rate is `(1 + gross annual return − annual fee)^(1/12) − 1`.
- The chart shows contributions, the illustrative value after fees, and an optional view in today's purchasing power.
- Example returns are constant assumptions, not forecasts. A losing-market example and an alternative stronger-return example illustrate sensitivity; they are not bounds.
- Taxes, transaction charges, and other costs are excluded. Investment capital and returns are not guaranteed.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Unit/API tests cover the financial model, malformed saved state, request validation, the guide, and provider failures. Browser tests run the full journey at desktop/mobile sizes, including both account paths, saved progress, risk acknowledgment, downloads, fund eligibility, chat fallback, route guards, and automated WCAG accessibility checks. Browser provider responses are mocked for repeatability; live Bedrock was verified separately.

Playwright uses system Chromium at `/usr/bin/chromium` in the cloud environment. Set `CHROMIUM_PATH` for another local installation. Browser tests can start the development server or reuse an existing one. Test reports and build outputs are ignored by Git.

### Decision Lab core checks (no `npm install` needed)

```sh
npm run demo               # Ana journey as Markdown on stdout (deterministic, synthetic)
npm run demo -- --replay monthlyContribution=900   # plus a counterfactual rerun with reuse/recompute per stage
npm run demo -- --markdown out.md                  # also write the output to a file
npm run test:core          # node --test "tests/core/**/*.test.ts" (domain, simulation, agents, orchestrator, eval, handoff, analytics, view helpers, agent API, evidence)
npm run eval               # run all evaluation scenarios, table output, exit 1 on any failure
npm run eval -- --json     # also write eval-report.json (git-ignored)
npm run eval -- --markdown out.md                  # also write a Markdown table without timings
npm run eval -- --only normal-journey,loop-limit --verbose
npm run evidence           # regenerate docs/evidence/demo-ana.md and docs/evidence/eval-report.md
npm run evidence:check     # regenerate both in memory, exit 1 if the committed files differ
npm run typecheck:core     # tsc -p tsconfig.core.json (strict, core modules only)
npm run check:syntax       # TypeScript syntax check of every file in src, plus node --check of server/*.mjs
npm run typecheck:ui-shim  # check-only UI type approximation with local shims, not a substitute for npm run typecheck
```

Supported `--replay` keys: `monthlyContribution`, `initialCapital`, `emergencyFund`, `monthlyEssentialExpenses`, `maxAcceptableLossPct`, `targetAmount`, `horizonYears` (comma-separated `key=value` pairs). The evidence files state the exact command, the fixed clock and seed, and the Node version used; the `--check` comparison ignores only the Node version line. `tests/core/evidence.test.ts` runs both checks, so `npm run test:core` fails when the evidence drifts from the code.

`tests/e2e/decision.spec.ts` adds Playwright specs for the Decision Lab, run with `npm run test:e2e`. `tests/api.test.mjs` covers the Express adapter for `/api/agent`, `/api/consent` and `/api/consent/revoke` and runs with `npm test` (updated for consent receipts in this revision, not run in the build sandbox).

### Tool layer and seeded outcome range

Agents call deterministic tools through `ctx.callTool` (`src/orchestrator/tools.ts`): `project-goal`, `stress-loss`, `simulate-outcomes` and `solve-levers`. Each call is counted against `maxToolCalls` (default 60; the Ana demo uses 23) and recorded in the trace with a numbers-only summary of arguments and result. Exceeding the budget fails the run with `tool-budget-exceeded`.

`simulate-outcomes` (`src/domain/simulation.ts`) runs a seeded synthetic Monte Carlo simulation (seed 20260115, 1,000 paths, single-factor log-normal monthly model using the synthetic volatilities equity 16%, bonds 5%, cash 0.5% and equity/bond correlation 0.2) and reports the 10th, 50th and 90th percentile value at the goal and the share of paths reaching the target. Strategy, Challenger and Guardrail each run it: the strategy attaches the range, the Challenger recomputes it independently (test `seeded-outcome-range`, material when the base case reaches the target but fewer than 50% of paths do), and the guardrail check `simulation-reproducible` requires an identical rerun (an input-consistency check, since it runs the same function and seed; it does not validate the model itself). `solve-levers` finds the extra monthly contribution or years needed for a 50% and 75% reach share. Strategy labels follow the actual equity share: Cautious up to 30%, Balanced above 30% up to 60%, Growth-tilted above 60% (upper edges match the stated-risk caps, so a mix at a preference's own cap keeps that preference's label). For Ana, v1 is Balanced (50% equity, 66.7% of paths reach 90,000 lei) and v2 after the severe-crash revision is Cautious (25.7% equity, gap about 4,435 lei, 28.2% of paths reach the target). This is a simulation on synthetic assumptions, not a forecast. All numbers and their pilot replacements: [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).

### Evaluation scenarios

All scenarios are synthetic and deterministic (fixed clock 2026-01-15). Each checks its expected outcome plus global invariants: no validated plan when a mandatory check fails, no invented facts, synthetic data never presented as live, restricted actions need consent, a failed stage does not invalidate unrelated ones, bounded execution, projections match an independent closed-form calculation, validated strategies have an ordered seeded outcome range and stay within the tool-call budget, and no free text or names in the trace.

| Scenario                  | What it shows                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `normal-journey`          | Consistent profile is validated with no material findings.                                 |
| `no-stated-risk-preference` | Same customer without a risk preference: no question (the loss limit suffices), the default Balanced preference is named, all 16 checks pass. |
| `missing-information`     | Facts invented by the model are rejected; targeted questions, needs-clarification.         |
| `constraint-mismatch`     | Over-aggressive draft for a 3-year goal is challenged and revised; v1 never released.      |
| `challenger-rejection`    | Ana demo: severe-crash and liquidity findings trigger a revision.                          |
| `changed-assumptions`     | Higher monthly contribution recomputes only affected stages; data and suitability reused.  |
| `changed-horizon`         | Longer horizon recomputes suitability onward; data reused.                                 |
| `stale-market-data`       | Stale cached data rejected; fallback applied and disclosed.                                |
| `missing-market-data`     | No market data and no fallback: run fails explicitly, later stages skipped.                |
| `provider-malformed`      | Malformed model output retried once, then accepted after validation.                       |
| `provider-timeout`        | Hanging provider: timeouts, retries and deterministic fallbacks within the call limit.     |
| `conflicting-conclusions` | Guarantee language and conflicting stages: stricter outcome wins, narrative repaired.      |
| `invented-summary-number` | Model summary invents a loss figure and text says "safe investment": both rebuilt.         |
| `safety-boundary`         | Guaranteed-return, trade and specific-stock requests get safety responses; nothing booked. |
| `privacy-consent`         | No external calls without consent; export only after consent; minimized briefing.          |
| `concentration-risk`      | 42.9% single-stock exposure flagged, adviser conversation recommended.                     |
| `loop-limit`              | Challenger that always objects: stops at the revision limit, withheld with explanation.    |
| `spoofed-live-data`       | Payload claiming live data is rejected; synthetic fallback used.                           |
| `malformed-market-data`   | Malformed market payload rejected; fallback used.                                          |
| `partial-volatility-market-data` | Fresh payload with volatility for equity only (20%): equity value kept, bond and cash use the named synthetic default (`mixed`), disclosed as an open issue, not blocking. |
| `invalid-input`           | Negative contribution or out-of-range loss value: needs-clarification, no facts stored.    |
| `seeded-range-determinism` | Same seed gives a byte-identical outcome range; another seed changes paths, percentiles stay ordered; simulation traced as tool calls. |
| `tool-budget-exceeded`    | `maxToolCalls` 3: run fails with `tool-budget-exceeded`, later stages skipped, nothing validated. |

**Replay:** in `/lab`, open a scenario, change a supported input (for example monthly contribution or horizon) and click **Replay with modified input**. The result shows new assertions and which stages were reused or recomputed. In `/decision`, **Replay with this change** does the same for the current run. In code, use `replayScenario(scenario, inputPatch)` from `src/eval/runner.ts`.

### Verification status

Commands below were run in the build sandbox for this revision with global TypeScript 5.9.2 on both Node v22.23.4 (default) and Node v24.22.1 (the `engines` version), and their output inspected. Results were identical on both versions:

| Command                                   | Node v22.23.4                                                                               | Node v24.22.1 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------- |
| `npm run demo`                            | Ana journey printed (completed, validated-with-open-issues, 1 revision, 23 tool calls, 16 of 16 guardrail checks, primary `talk-to-adviser`); exit 0 | same output apart from the Node version line; exit 0 |
| `npm run eval`                            | 23 scenarios, 23 passed, 0 failed, 0 skipped; 350/350 assertions; exit 0                    | same; exit 0 |
| `npm run test:core`                       | 139 tests, 139 pass, 0 fail (includes the consent receipt tests in `tests/core/agentApi.test.ts` and `tests/core/orchestrator.test.ts`) | same; exit 0 |
| `npm run evidence:check`                  | both `docs/evidence` files match freshly generated output; exit 0                           | same; exit 0 |
| `npm run typecheck:core`                  | exit 0                                                                                      | exit 0 |
| `npm run check:syntax`                    | `check-syntax: 49 file(s) OK (47 src via TypeScript 5.9.2, 2 server/*.mjs via node --check).` | same |
| `npm run typecheck:ui-shim`               | exit 0 (hand-written approximations of the UI library types, see [docs/evidence/ui-static-review.md](docs/evidence/ui-static-review.md)) | exit 0 |
| `node --check` on `server/index.mjs`, `server/agentApi.mjs`, `scripts/run-demo.mjs`, `scripts/run-eval.mjs`, `scripts/check-syntax.mjs` | exit 0 | exit 0 |
| `git diff --exit-code main -- package-lock.json` | no changes; exit 0                                                                   | not repeated (independent of Node) |

**Not run in the build sandbox:** `npm ci` failed because the npm registry returned 403 Forbidden, so `npm run typecheck` (needs React and Vite types, and the project's TypeScript 7 devDependency), `npm test` (vitest, including the Express-level `/api/agent` and `/api/consent` tests in `tests/api.test.mjs`, which were updated for consent receipts but not run), `npm run build`, `npm run test:e2e` (Playwright; no React bundle could be built) and live Bedrock calls through `/api/agent` were not executed. The React UI was not compiled against the real type packages, bundled or rendered in a browser (a Chromium binary is present in the sandbox, but there is no bundle to load); [docs/evidence/ui-static-review.md](docs/evidence/ui-static-review.md) lists what the static review covered instead. Run those commands locally after `npm ci` before relying on them. Test files under `tests/core` run under Node type stripping and are not type-checked.

### Known limitations and simulated integrations

- Market data, returns, drawdowns and inflation are synthetic fixtures; there is no live market feed.
- There is no real Raiffeisen, adviser booking or Forum integration. The adviser handoff is a local preview and download (`booked: false`).
- Suitability rules are illustrative rules of thumb, not a regulated suitability or appropriateness assessment.
- Amazon Bedrock is optional; the deterministic provider is the default and fallback.
- Products, the demo customer Ana and the growth sample data are synthetic. Analytics stay in browser `localStorage`.
- The seeded outcome range is a single-factor simulation on synthetic volatilities and correlation; it is not a forecast. Taxes, transaction costs and currency effects are excluded (see [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)).
- No pilot has been run; [docs/PILOT.md](docs/PILOT.md) is a proposal and contains no observed results.

## Structure and design

React + TypeScript, Vite, Tailwind CSS, shadcn-style Radix primitives, Lucide, Recharts, and React Router. Fonts are bundled locally. The Node/Express API is separate from browser code. Routes are loaded on demand so the landing page does not load the chart bundle.

Reusable primitives are in `src/components/ui`, shared financial logic/state in `src/lib`, route components in `src`, and the API in `server`. The Decision Lab core is framework-free TypeScript in `src/domain`, `src/agents`, `src/orchestrator`, `src/providers`, `src/eval`, `src/analytics` and `src/handoff`, with views in `src/components/decision`. No agent framework or schema library is used, so the core stays dependency-free and deterministic. Details, stage graph, limits and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Policy numbers and synthetic assumptions: [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md). Pilot proposal and metric definitions: [docs/PILOT.md](docs/PILOT.md). Generated evidence: [docs/evidence/](docs/evidence/). Yellow, neutral surfaces, a placeholder arrow mark, and clear typography provide the Raiffeisen-inspired concept treatment without using official brand assets.

The supplied pasted brief ended during the monthly-slider section, and the referenced overview PDF was not attached. The implementation follows its stated end-to-end journey and general requirements, with illustrative defaults for the unspecified questions, funds, and account screens. Persistence and authentication use local demo state; optional Supabase integration is not configured.
