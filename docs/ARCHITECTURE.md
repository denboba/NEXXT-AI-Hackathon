# Architecture: Goal -> Strategy -> Stress test -> Revision -> Validation -> Next step

This document explains how the Decision Lab works, why it is built this way, and what it does not do. Everything described here is an educational prototype running on synthetic data. It is not an official Raiffeisen service and not a regulated suitability assessment.

## Module boundaries

| Path                      | Responsibility                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/finance.ts`      | Original financial model (inflation, end-of-month contributions, fee-adjusted returns). Reused by the new core.                                                                                                                                 |
| `src/domain/`             | Shared types (`types.ts`), input validation (`validate.ts`), projections and stress maths (`calculations.ts`), seeded outcome simulation and goal-seek solver (`simulation.ts`: `simulateGoal`, `solveLevers`), synthetic product catalogue (`catalogue.ts`), synthetic demo customer "Ana" (`demoProfile.ts`). |
| `src/agents/`             | One pure module per stage: `profile`, `data`, `suitability`, `strategy`, `challenger`, `guardrail`, `nextStep`.                                                                                                                                 |
| `src/orchestrator/`       | Stage graph (`graph.ts`: `STAGES`, `EDGES`), run context and limits (`context.ts`), execution engine (`engine.ts`: `runWorkflow`, `rerunWorkflow`, `callTool`), tool registry (`tools.ts`: `project-goal`, `stress-loss`, `simulate-outcomes`, `solve-levers`), fingerprints (`fingerprint.ts`), sanitized trace (`trace.ts`), UI view helpers (`view.ts`). |
| `src/providers/`          | Adapters: reasoning providers (`llm.ts`: deterministic, replay, HTTP via `/api/agent`) and market data providers (`marketData.ts`: synthetic, cached, failing, slow, malformed).                                                                |
| `src/eval/`               | Scenario catalogue (`scenarios.ts`), assertions and global invariants (`assertions.ts`), runner (`runner.ts`: `runScenario`, `replayScenario`, `runAll`).                                                                                       |
| `src/analytics/events.ts` | Event schema, property sanitization, memory/localStorage sinks, funnel helper. `src/lib/analytics.ts` is the thin browser wrapper (`track`).                                                                                                    |
| `src/handoff/`            | Adviser briefing (`briefing.ts`) and consent state machine (`consent.ts`).                                                                                                                                                                      |
| UI routes                 | `src/DecisionLab.tsx` (`/decision`), `src/EvalLab.tsx` (`/lab`), `src/Growth.tsx` (`/growth`), shared views in `src/components/decision/WorkflowViews.tsx`. Routes are registered lazily in `src/App.tsx`.                                      |
| `server/index.mjs`        | Express API: `GET /api/health`, `POST /api/coach`, `POST /api/consent`, `POST /api/consent/revoke`, `POST /api/agent` (structured model tasks, Bedrock only). These routes are thin adapters around `server/agentApi.mjs`.                                                              |
| `server/agentApi.mjs`     | Dependency-free `/api/agent` logic: `validateAgentRequest` (field whitelist, 8,000 character limit), `createConsentReceipts` and `hasExternalProcessingConsent` (signed, expiring, revocable consent receipts), `handleConsentIssue` / `handleConsentRevoke`, `createThrottle` (60 requests per client per 60 seconds), `parseModelJson`, `handleAgentRequest` (status order and fallback answers). Unit-tested in `tests/core/agentApi.test.ts`. |
| `scripts/`                | `run-demo.mjs` (no-install CLI demo of the Ana journey, `--replay`, `--markdown`, `--check`), `run-eval.mjs` (eval CLI, `--json`, `--markdown`, `--check`), `check-syntax.mjs` (TypeScript syntax check of all `src` files and `node --check` of `server/*.mjs`), `ui-shims/` (check-only type shims for `typecheck:ui-shim`). |
| `docs/evidence/`          | Generated, committed evidence: `demo-ana.md` (`npm run demo -- --replay monthlyContribution=900 --markdown docs/evidence/demo-ana.md`) and `eval-report.md` (`npm run eval -- --markdown docs/evidence/eval-report.md`). `tests/core/evidence.test.ts` fails when they differ from freshly generated output. |

The core directories (`src/domain`, `src/agents`, `src/orchestrator`, `src/providers`, `src/eval`, `src/analytics`, `src/handoff`) import only relative `.ts` modules and `src/lib/finance.ts`. They have no React, Node or npm dependencies, so the same code runs in the browser, in `node --test` and in the eval CLI.

## Stage graph

```
start -> profile -> data -> suitability -> strategy -> challenger -> guardrail -> nextStep
              |        |          |                        |   ^         |
              |        |          +-> nextStep             |   |         +-> narrative repair (once) -> guardrail
              |        +-> failed (no safe fallback)       +---+-> suitability | strategy (revision)
              +-> nextStep (missing or invalid facts: needs-clarification)
```

- `profile` missing or invalid required facts: data to guardrail are skipped, the run ends `needs-clarification` with targeted questions. Invalid values are treated like missing ones, never silently dropped.
- `data` failure with no safe fallback: run `failed` (`market-data-unavailable`), later stages skipped.
- `suitability` returns needs-clarification when withdrawals within 3 years exceed initial capital.
- `challenger` routes back to `suitability` or `strategy` for material findings that the strategy has not acknowledged. The earliest target wins. Revising stops when there are no actionable findings, when `maxRevisions` is reached, or when a loop is detected (same weights and buckets, or same strategy plus findings seen before).
- `guardrail` narrative failure triggers one deterministic narrative repair, recorded as a conflict event.
- Terminal status: `completed` (validated or validated-with-open-issues), `withheld`, `needs-clarification`, or `failed`.

Default limits (`DEFAULT_LIMITS` in `src/orchestrator/context.ts`): `maxSteps` 25, `maxRevisions` 2, `maxModelCalls` 8, `maxToolCalls` 60, `providerTimeoutMs` 8000, `maxRetries` 1, `maxDataAgeDays` 120. Exceeding `maxSteps` fails the run with an explicit reason; exceeding `maxToolCalls` fails the stage with `tool-budget-exceeded` and the run ends `failed` (eval scenario `tool-budget-exceeded`).

### Tool calls

Inside a stage, key computations go through `ctx.callTool(name, args)`, which runs a named pure function from `src/orchestrator/tools.ts`, counts it in `WorkflowState.toolCalls` and adds a `tool` trace event `{ tool, call, args, result, durationMs }` with numbers only (no labels or free text). `durationMs` comes from the injected clock, so it is 0 under the fixed eval clock and traces stay deterministic. Per pass, the strategy makes 8 calls with three candidates (3 `project-goal` and 3 `stress-loss`, 1 `simulate-outcomes`, 1 `solve-levers`), or 10 when a fourth candidate is added (see below), the challenger 3 (`project-goal`, `stress-loss` for the severe crash, `simulate-outcomes`) and the guardrail 1 (`simulate-outcomes`). The Ana demo makes 23 calls; the worst case with 2 revisions and four candidates is about 40, well under the default budget of 60. Because tools are pure, fingerprint reuse stays valid: a reused stage makes no tool calls.

## Fingerprint invalidation and reuse

Each stage declares the keys it reads (for example suitability reads horizon, loss tolerance, stated risk, expenses, emergency fund, planned withdrawals, initial capital, data assumptions and its revision directives). The fingerprint is a digest of those values. A stage is reused when any previous execution of the same stage had the same fingerprint, otherwise it is recomputed. The trace records why (`recomputed: input.monthlyContribution changed` or `reused: inputs unchanged`).

Observed in tests: changing only `monthlyContribution` recomputes profile, strategy, challenger, guardrail and nextStep and reuses data and suitability. A rerun with no change reuses every stage and makes 0 model calls and 0 tool calls. `npm run demo -- --replay monthlyContribution=900` prints such a replay for Ana: data and suitability (both passes) are reused, the other stages are recomputed, and the reach share of the released strategy rises from 28.2% to 91.7%.

## Provider adapters and fallbacks

- Reasoning: `deterministicProvider` (default, template text), `replayProvider` (recorded fixtures, supports hang, malformed and throwing cases for tests) and `httpProvider` (obtains a consent receipt from `POST /api/consent`, then POSTs `{ task, input, consent: { receipt } }` to `/api/agent`). The engine never calls the HTTP provider without explicit external-processing consent (`EngineOptions.externalProcessingConsent`).
- Each model call has a timeout (AbortController) and one retry on timeout, malformed output or error, then falls back to the deterministic provider. A server answer of `{ "fallback": "deterministic" }` (no key, model down, throttled, consent receipt not accepted), a 400 or a 403 is not retried: `httpProvider` throws `NonRetryableProviderError` and the engine falls back immediately. Calls beyond `maxModelCalls` go straight to the fallback. Every fallback is recorded in the trace.
- Models only extract literally stated values or word narrative around numbers computed by code. All numbers in the plan come from deterministic code. Model answers are validated again in the browser.
- Market data: `syntheticFixtureProvider` (default), `cachedFixtureProvider(asOf)`, plus failing, slow, malformed and spoofed-live providers for tests. Data older than `maxDataAgeDays` is rejected and the fallback is disclosed. A payload claiming kind `live` is rejected because no live provider exists.

## Guardrail invariants

The guardrail (`src/agents/guardrail.ts`) runs 16 mandatory checks on a full run before anything is released (the Ana demo passes 16 of 16, see [evidence/demo-ana.md](evidence/demo-ana.md)): `required-inputs`, `weights-sum-to-one`, `weights-in-range`, `blocks-known`, `equity-within-cap`, `stress-loss-within-tolerance` (stricter of the planning and severe drawdowns), `projection-recomputed` (independent recomputation), `simulation-reproducible` (re-running the seeded simulation with the strategy's seed and path count must give exactly the same p10/p50/p90, nominal and real, and reach share; this is an input-consistency check, because the guardrail runs the same function and seed as the strategy, not an independent validation of the simulation model), `liquidity-buckets-cover-withdrawals`, `capital-conserved`, `market-data-acceptable`, `disclosures-present`, `narrative-claims` (no guaranteed, risk-free, "safe investment" or "will grow" language in the strategy narrative or the stress-test summary, `BANNED` pattern), `narrative-numbers-match` (every number in the strategy narrative and in the stress-test summary, including `citedNumbers`, must match a computed value or a challenger finding's message or evidence), `challenge-current` and `no-unresolved-blocking`. `upstream-complete` is added only as a failing check when strategy, suitability or data output is missing. If either text fails, the orchestrator replaces it once with the deterministic template (the summary is rebuilt from the findings) and re-runs the guardrail. A failed mandatory check means the strategy is withheld, never released as validated. Requests for guaranteed returns, trade execution or a specific security are classified by the profile agent and answered with fixed safety responses. The challenger never sees the strategy object, only a reduced input, and recomputes the projection itself. `narrative-numbers-match` also accepts the outcome-range numbers (percentiles, paths, seed, reach share) and the solver lever values.

## Challenger tests

`src/agents/challenger.ts` runs these named tests, each with explicit inputs and computed evidence: `projection-recompute` (blocking on mismatch), `severe-crash-before-goal` (equities -35%, bonds -8% in the year before the goal; material when the loss exceeds the stated tolerance, remedy: tighten the suitability drawdown basis), `goal-two-years-earlier`, `unexpected-liquidity-need` (3 months of expenses; material when the reserve is short, remedy: reserve top-up), `planned-withdrawals-liquidity` (blocking when a withdrawal within 3 years is not in cash), `contribution-pause-12m`, `single-stock-concentration` (material above 20% of investable assets, -50% shock), `seeded-outcome-range` and `fee-inflation-sensitivity`.

`seeded-outcome-range` runs the challenger's own simulation from its recomputed inputs (not the strategy's range). It is an info finding `outcome-range` with evidence `{ seed, paths, p10Lei, p50Lei, p90Lei, reachShare }`, and becomes the material finding `outcome-range-low-reach` only when the base case reaches the target but fewer than 50% of paths do (`MIN_REACH_SHARE`). Its remedy is an acknowledgement, so it can never cause a revision loop; the strategy pre-acknowledges it when its own simulation shows the same condition and discloses it in the risks, and it stays an open issue.

## Seeded simulation and strategy labels

`src/domain/simulation.ts` treats the blended mix as one asset rebalanced monthly with annual volatility from the synthetic per-asset-class volatilities (equity 16%, bonds 5%, cash 0.5%) and equity/bond correlation 0.2, and draws monthly log-normal growth from a seeded mulberry32 generator with Box-Muller normals. Expected growth equals the base-case rate of `projectGoal`, and zero volatility reproduces `projectGoal` exactly (tested). Defaults: seed 20260115 (`SIMULATION_SEED`), 1,000 paths (`SIMULATION_PATHS`). Each path has its own generator seeded from the seed and the path index. `solveLevers` searches, on the same paths, for the minimum whole-lei monthly contribution (doubling then bisection, up to 1,000,000 lei) and the minimum extra whole years (up to 50 years in total) for reach shares of 50% and 75% (`SOLVER_THRESHOLDS`). Volatility provenance is per asset class (`volatilityByClassSource`): a class without a payload volatility uses the labelled synthetic default with the same value, and the overall `volatilitySource` is `market-data-payload` (none defaulted), `synthetic-default` (all defaulted) or `mixed` (some defaulted). A partial payload is never discarded: with volatility for equity only, the payload equity value is kept and the outcome-range assumption names the defaulted classes ("default volatility for bond, cash"). The data stage flags `default-volatility-applied` with a trace note and the guardrail lists it as an open issue; it does not block the run (eval scenario `partial-volatility-market-data`).

Strategy candidates are the most cautious eligible mix, the midpoint, the highest mix within the preferred label's band (`bandUpperEdge`, capped at the maximum allowed) and the maximum allowed equity, merged when closer than 0.5 percentage points. The band-edge candidate only adds a fourth candidate when the preference sets no cap of its own: with no stated risk the default Balanced preference then picks the highest Balanced mix the constraints allow (60% for `normalProfile` without `statedRisk`, the same as a stated Balanced preference), not the midpoint. With a stated preference the cap already equals the band edge, so it merges with the maximum. Labels follow the actual equity share (`LABEL_BANDS` in `strategy.ts`): Cautious up to 30%, Balanced above 30% up to 60%, Growth-tilted above 60% (upper edges match the stated-risk caps, so a mix at a preference's own cap keeps that preference's label). The chosen candidate is the highest-equity one whose label is not riskier than the stated preference (Balanced when none is stated). The first rationale sentence names the limit that actually bound the choice: the constraints, the stated (or default) preference when a higher-equity candidate within the constraints was skipped, or no candidate matching the preference (`choiceSentence`). The chosen and skipped equity shares use the same one-decimal precision as the cap, so a share inside the cap never reads as above it (Ana v2: "about 25.7% equity" with "max equity 25.9%"), and when the eligible funds stop below the cap the sentence names that ceiling too (Ana v1: "max equity 66.7%; eligible funds reach at most 50.0%"). `npm run demo` prints this sentence as the "Why this mix" row, so `evidence:check` pins it. For Ana, v1 is Balanced at 50% equity and v2, after the severe-crash revision, is Cautious at 25.7% equity.

## Suitability policy numbers (illustrative rules of thumb)

These values are illustrative planning heuristics chosen for the prototype. They are not Raiffeisen policy and not regulatory thresholds.

| Rule                         | Value                                                                                                   | Source                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Horizon equity cap           | <3y 20%, 3-5y 40%, 6-10y 70%, >10y 90%                                                                  | `horizonEquityCap`, `suitability.ts`                               |
| Stated-risk equity cap       | steady 30%, balanced 60%, growth 90%                                                                    | `STATED_RISK_CAP`                                                  |
| Emergency reserve            | 3 months of essential expenses                                                                          | `RESERVE_MONTHS_RULE`                                              |
| Liquidity window             | withdrawals within 3 years held in cash                                                                 | `LIQUIDITY_WINDOW_YEARS`                                           |
| Severe stress scenario       | equity -35%, bonds -8%, cash 0%                                                                         | `SEVERE_CRASH`, `challenger.ts`                                    |
| Single-company concentration | material above 20% of investable assets; single-stock shock -50%                                        | `CONCENTRATION_LIMIT`, `SINGLE_STOCK_SHOCK`                        |
| Synthetic assumptions        | expected return equity 9%, bonds 3%, cash 2.5%; planning drawdowns equity 20%, bonds 5%; inflation 5.5% | `src/providers/marketData.ts`, `INFLATION` in `src/lib/finance.ts` |
| Synthetic volatility         | equity 16%, bonds 5%, cash 0.5%; equity/bond correlation 0.2                                            | `syntheticAssumptions`, `src/providers/marketData.ts`              |
| Outcome range                | seed 20260115, 1,000 paths; low-reach flag below 50%; solver thresholds 50% and 75%                     | `src/domain/simulation.ts`                                         |

The complete list, with rationale and what a bank pilot would replace each value with, is in [ASSUMPTIONS.md](ASSUMPTIONS.md).

When two stages disagree (for example suitability's planning loss versus the challenger's severe scenario), the stricter outcome wins and a conflict event is recorded.

## Data provenance labels

Every fact carries a source. Market data has `kind` `synthetic-fixture` or `cached` (with `asOf`) and a `sourceLabel`; `live` is not produced by any provider. Profile facts record provenance entries, and the input records whether it came from the form or a scenario fixture (`inputSource`: `user-form` or `scenario-fixture`). The UI shows these labels next to the numbers.

## Privacy and consent

- No free text, names or contact details are written to the trace; `trace.ts` drops and scrubs those keys. A global eval invariant checks this.
- External model processing requires explicit consent; without it the deterministic provider is used and labelled. Consent is enforced twice: the engine never calls the HTTP provider without `externalProcessingConsent`, and `POST /api/agent` (`handleAgentRequest` in `server/agentApi.mjs`) answers 403 `{ "error": "Consent to external processing is required.", "fallback": "deterministic" }` unless the body carries `consent: { receipt }` with a valid server-issued consent receipt. The bare self-declared flag `consent: { externalProcessing: true }` is rejected. Status order: 400 invalid request, then 403 consent, then 429 throttle, then 503 no key or model failure, then 200. The consent check runs before the throttle counts and before any model call, and neither the consent object nor the receipt is forwarded to the model.
- Consent receipts (`createConsentReceipts` in `server/agentApi.mjs`): `POST /api/consent` with `{ scope: "external-processing", granted: true }` issues an HMAC-SHA256 signed token over receipt id, scope and expiry (TTL 30 minutes; secret from `CONSENT_RECEIPT_SECRET` or random per process). `POST /api/consent/revoke` adds the id to an in-memory revocation set. Verification checks format, signature (timing-safe compare), scope, expiry and revocation. A bounded in-memory audit log (500 events) records `issued`, `revoked` and `rejected` with receipt id, scope, time and reason only, no request content or client address. Clock, secret and id generator are injectable, so `tests/core/agentApi.test.ts` covers expired, revoked, tampered, forged and wrong-scope receipts deterministically. In the browser, `httpProvider` requests a receipt on its first consented call, caches it until one minute before expiry, requests one fresh receipt if a reused one is rejected, and exposes `revokeConsent()`, which the Decision Lab calls when the user unticks the consent box. Failure to get a receipt is non-retryable, so the engine falls back to deterministic rules.
- Limits of the receipt: it shows that an explicit, scoped, expiring and revocable consent step was recorded by this server. It does not authenticate the user or prove that a human gave the consent, because any client can request a receipt. A production deployment would bind receipts to an authenticated session and persist the audit trail.
- The adviser briefing is minimized. Export requires granted consent with scope `briefing-content`; the contact name is included only with scope `contact-name`. Export is blocked for withheld or failed runs.
- The handoff is a local preview and download only (`booked: false`). Nothing is sent to Raiffeisen or any external system.

## Analytics events

Defined in `EVENT_NAMES` (`src/analytics/events.ts`): `journey_started`, `journey_completed`, `info_captured`, `clarification_requested`, `strategy_validated`, `strategy_withheld`, `stress_test_completed`, `revision_triggered`, `followup_requested`, `consent_requested`, `consent_granted`, `consent_declined`, `handoff_previewed`, `handoff_exported`, `journey_abandoned`, `eval_run`. Properties are whitelisted and bucketed (amounts become ranges). Events are stored in browser `localStorage` (capped at 500). `journey_abandoned` is defined but deliberately not emitted, because abandonment is not reliably observable in a client-only prototype.

## Business mechanism

`/growth` shows the funnel from captured information to validated strategy and adviser handoff, using the events above or a clearly labelled synthetic event set. Funnel steps count journeys, not events: events are ordered by time, each `journey_started` opens a new journey, and a step counts once per journey however often it fired (repeated captures and replays do not inflate it). Percentages are relative to started journeys. Raw event counts are shown separately. The value hypothesis is that stress-tested, explained plans increase qualified adviser conversations and reduce unsuitable self-directed choices. All projections on that page are hypothetical illustrations because no real customer or conversion data exists in this prototype. [PILOT.md](PILOT.md) proposes how to test the hypothesis and defines the pilot metrics in terms of these event names.

## Design decisions

- **No agent framework, no schema library (for example zod).** The core must stay dependency-free and deterministic so it runs in the browser, in Node's native test runner and in the eval CLI with no install. Agents are plain functions with typed inputs and outputs; the graph is an explicit table.
- **Deterministic numbers, optional language model.** Calculations, policy checks and validation are code. A model can only extract stated values or phrase text, and its output is validated.
- **Independent challenger.** The stress tester gets a reduced input and recomputes projections, so it cannot simply approve the strategy's own numbers.
- **Stricter wins on conflicts.** Disagreements between stages are resolved conservatively and recorded.
- **Bounded execution.** Step, revision, model call, timeout and retry limits make every run terminate with an explained status.
- **Fingerprint reuse.** Unchanged stages are reused, which makes counterfactual replays fast and shows exactly what a change affected.
- **Explicit, traced tools.** Key computations are named tool calls with a budget and numbers-only trace events, so a reviewer can see what each stage computed without reading code.
- **Seeded simulation instead of a single base case.** A fixed seed makes the outcome range reproducible (the guardrail re-runs it), while still showing that a plan that reaches the target in the base case can miss it in many paths.
- **Honest labels.** The label is derived from the actual equity share, so a revision that lowers equity also changes the label.
- **Evidence that cannot drift.** The committed demo and eval reports are generated by scripts and checked by a test.
- **Demo capital 35,000 lei.** With 20,000 lei and the 15,000 lei wedding cash bucket, no allowed allocation reaches the 90,000 lei target even in the base case, so the fixture uses 35,000 lei (documented in `demoProfile.ts`).

## Known limitations

- No live market data. All returns, drawdowns and inflation are synthetic fixtures.
- No real Raiffeisen, adviser booking or "Forum" integration. The handoff is a local preview and file download.
- Not a regulated suitability or appropriateness assessment. Policy numbers are illustrative rules of thumb.
- Amazon Bedrock is optional. Without `AWS_BEARER_TOKEN_BEDROCK`, `/api/agent` returns 503 with `fallback: "deterministic"` and the deterministic provider is used and labelled.
- The product catalogue (`src/domain/catalogue.ts`: steady, balanced and growth fund blocks plus an illustrative cash reserve) and the candidate mixes (Cautious, Balanced, Growth-tilted) are synthetic.
- Analytics are local to the browser; there is no backend analytics store. Model fallbacks are visible in the run state and trace but are not an analytics event.
- The outcome simulation is a single-factor log-normal approximation on synthetic volatilities and correlation (no fat tails, regime changes or currency risk). It is a simulation, not a forecast. Taxes, transaction costs and currency effects are not modelled (see [ASSUMPTIONS.md](ASSUMPTIONS.md)).
- Base-case levers (`increase-contribution`, `extend-horizon`, `lower-target`) use closed-form or stepwise projections directly rather than the traced tool layer; the solver levers and all simulations are traced.
- The server-side consent check proves only that the caller set the flag; there is no authenticated user or stored consent record behind it.
- The React UI (including the new outcome-range and tool-call views) was type-checked only with local shims in the build sandbox and has not been rendered there.
- Core test files run under Node type stripping and are not type-checked by `tsconfig.core.json`.
