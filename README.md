# Raiffeisen AI Investment Coach

A responsive, functional concept prototype that takes a visitor from an anonymous educational conversation to a simulated monthly investment plan. It is an independent concept, not an official Raiffeisen service. All funds, customer access, and transactions are fictional.

The **Decision Lab** extends the coach into a bounded multi-stage workflow: **Goal -> Strategy -> Stress test -> Revision -> Validation -> Next step**. A profile stage captures facts, a suitability stage sets illustrative risk limits, a strategy stage proposes an allocation, an independent challenger stress-tests it and can send it back for revision, a guardrail validates it before release, and a next-step stage recommends a review or an adviser conversation with a consent-gated briefing. All numbers are computed by deterministic code; a language model is optional. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

### Judge quick path

1. `npm ci`, then `npm run dev` and open `http://localhost:5173/decision`.
2. Click **Load synthetic demo: Ana**, then **Run assessment**.
3. Inspect the stage timeline, the challenger findings and the revision (v1 vs v2 comparison).
4. Use **Replay with this change** (for example a higher monthly contribution) to see which stages are reused and which are recomputed.
5. Click **Preview adviser briefing** and walk through the consent step; export is only possible after consent and is a local download.
6. Open `/lab` and click **Run all 19 scenarios**; open any scenario and use **Replay with modified input**.
7. Open `/growth` for the funnel and business hypothesis.

No API key is needed: without one the deterministic provider is used and labelled in the UI.

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

`POST /api/agent` serves structured Decision Lab tasks (`extract-profile`, `explain-strategy`, `explain-objections`) through Bedrock. It whitelists input fields, rejects invalid, unknown or oversized (over 8,000 characters) requests with 400, throttles at 60 requests per minute (429), and returns 503 with `{ "fallback": "deterministic" }` when no key is configured or the model fails, without leaking error text. The browser only calls it after the user consents to external processing, re-validates every answer, and falls back to deterministic rules otherwise. A `fallback: "deterministic"` answer is not retried. Consent is enforced in the browser engine, not by the server. The model never computes plan numbers.

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
npm run test:core          # node --test "tests/core/**/*.test.ts" (domain, agents, orchestrator, eval, handoff, analytics, view helpers)
npm run eval               # run all evaluation scenarios, table output, exit 1 on any failure
npm run eval -- --json     # also write eval-report.json (git-ignored)
npm run eval -- --only normal-journey,loop-limit --verbose
npm run typecheck:core     # tsc -p tsconfig.core.json (strict, core modules only)
npm run check:syntax       # TypeScript syntax check of every file in src
npm run typecheck:ui-shim  # check-only UI type approximation with local shims, not a substitute for npm run typecheck
```

`tests/e2e/decision.spec.ts` adds Playwright specs for the Decision Lab, run with `npm run test:e2e`. `tests/api.test.mjs` covers `/api/agent` and runs with `npm test`.

### Evaluation scenarios

All scenarios are synthetic and deterministic (fixed clock 2026-01-15). Each checks its expected outcome plus global invariants: no validated plan when a mandatory check fails, no invented facts, synthetic data never presented as live, restricted actions need consent, a failed stage does not invalidate unrelated ones, bounded execution, projections match an independent closed-form calculation, and no free text or names in the trace.

| Scenario                  | What it shows                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `normal-journey`          | Consistent profile is validated with no material findings.                                 |
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
| `invalid-input`           | Negative contribution or out-of-range loss value: needs-clarification, no facts stored.    |

**Replay:** in `/lab`, open a scenario, change a supported input (for example monthly contribution or horizon) and click **Replay with modified input**. The result shows new assertions and which stages were reused or recomputed. In `/decision`, **Replay with this change** does the same for the current run. In code, use `replayScenario(scenario, inputPatch)` from `src/eval/runner.ts`.

### Verification status

Commands below were run in the build sandbox (Node v22.23.4, global TypeScript 5.9.2) and their output inspected:

| Command                         | Result                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `npm run eval`                  | 19 scenarios, 19 passed, 0 failed; 269/269 assertions; exit 0 |
| `npm run test:core`             | 83 tests, 83 pass, 0 fail                                     |
| `tsc -p tsconfig.core.json`     | exit 0                                                        |
| `npm run check:syntax`          | `check-syntax: 45 file(s) OK (TypeScript 5.9.2).`             |
| `npm run typecheck:ui-shim`     | exit 0                                                        |
| `node --check server/index.mjs` | exit 0                                                        |

**Not run in the build sandbox:** `npm ci` failed because the npm registry returned 403 Forbidden, so `npm run typecheck` (needs React and Vite types, and the project's TypeScript 7 devDependency), `npm test` (vitest, including the `/api/agent` tests), `npm run build`, `npm run test:e2e` (Playwright, no Chromium) and live Bedrock calls through `/api/agent` were not executed. The React UI was not rendered in a browser. Run those commands locally after `npm ci` before relying on them. Test files under `tests/core` run under Node type stripping and are not type-checked.

### Known limitations and simulated integrations

- Market data, returns, drawdowns and inflation are synthetic fixtures; there is no live market feed.
- There is no real Raiffeisen, adviser booking or Forum integration. The adviser handoff is a local preview and download (`booked: false`).
- Suitability rules are illustrative rules of thumb, not a regulated suitability or appropriateness assessment.
- Amazon Bedrock is optional; the deterministic provider is the default and fallback.
- Products, the demo customer Ana and the growth sample data are synthetic. Analytics stay in browser `localStorage`.

## Structure and design

React + TypeScript, Vite, Tailwind CSS, shadcn-style Radix primitives, Lucide, Recharts, and React Router. Fonts are bundled locally. The Node/Express API is separate from browser code. Routes are loaded on demand so the landing page does not load the chart bundle.

Reusable primitives are in `src/components/ui`, shared financial logic/state in `src/lib`, route components in `src`, and the API in `server`. The Decision Lab core is framework-free TypeScript in `src/domain`, `src/agents`, `src/orchestrator`, `src/providers`, `src/eval`, `src/analytics` and `src/handoff`, with views in `src/components/decision`. No agent framework or schema library is used, so the core stays dependency-free and deterministic. Details, stage graph, limits and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Yellow, neutral surfaces, a placeholder arrow mark, and clear typography provide the Raiffeisen-inspired concept treatment without using official brand assets.

The supplied pasted brief ended during the monthly-slider section, and the referenced overview PDF was not attached. The implementation follows its stated end-to-end journey and general requirements, with illustrative defaults for the unspecified questions, funds, and account screens. Persistence and authentication use local demo state; optional Supabase integration is not configured.
