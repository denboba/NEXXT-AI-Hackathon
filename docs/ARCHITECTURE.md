# Architecture: Goal -> Strategy -> Stress test -> Revision -> Validation -> Next step

This document explains how the Decision Lab works, why it is built this way, and what it does not do. Everything described here is an educational prototype running on synthetic data. It is not an official Raiffeisen service and not a regulated suitability assessment.

## Module boundaries

| Path                      | Responsibility                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/finance.ts`      | Original financial model (inflation, end-of-month contributions, fee-adjusted returns). Reused by the new core.                                                                                                                                 |
| `src/domain/`             | Shared types (`types.ts`), input validation (`validate.ts`), projections and stress maths (`calculations.ts`), synthetic product catalogue (`catalogue.ts`), synthetic demo customer "Ana" (`demoProfile.ts`).                                  |
| `src/agents/`             | One pure module per stage: `profile`, `data`, `suitability`, `strategy`, `challenger`, `guardrail`, `nextStep`.                                                                                                                                 |
| `src/orchestrator/`       | Stage graph (`graph.ts`: `STAGES`, `EDGES`), run context and limits (`context.ts`), execution engine (`engine.ts`: `runWorkflow`, `rerunWorkflow`), fingerprints (`fingerprint.ts`), sanitized trace (`trace.ts`), UI view helpers (`view.ts`). |
| `src/providers/`          | Adapters: reasoning providers (`llm.ts`: deterministic, replay, HTTP via `/api/agent`) and market data providers (`marketData.ts`: synthetic, cached, failing, slow, malformed).                                                                |
| `src/eval/`               | Scenario catalogue (`scenarios.ts`), assertions and global invariants (`assertions.ts`), runner (`runner.ts`: `runScenario`, `replayScenario`, `runAll`).                                                                                       |
| `src/analytics/events.ts` | Event schema, property sanitization, memory/localStorage sinks, funnel helper. `src/lib/analytics.ts` is the thin browser wrapper (`track`).                                                                                                    |
| `src/handoff/`            | Adviser briefing (`briefing.ts`) and consent state machine (`consent.ts`).                                                                                                                                                                      |
| UI routes                 | `src/DecisionLab.tsx` (`/decision`), `src/EvalLab.tsx` (`/lab`), `src/Growth.tsx` (`/growth`), shared views in `src/components/decision/WorkflowViews.tsx`. Routes are registered lazily in `src/App.tsx`.                                      |
| `server/index.mjs`        | Express API: `GET /api/health`, `POST /api/coach`, `POST /api/agent` (structured model tasks, Bedrock only).                                                                                                                                    |
| `scripts/`                | `run-eval.mjs` (eval CLI), `check-syntax.mjs` (TypeScript syntax check of all `src` files), `ui-shims/` (check-only type shims for `typecheck:ui-shim`).                                                                                        |

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

Default limits (`DEFAULT_LIMITS` in `src/orchestrator/context.ts`): `maxSteps` 25, `maxRevisions` 2, `maxModelCalls` 8, `providerTimeoutMs` 8000, `maxRetries` 1, `maxDataAgeDays` 120. Exceeding `maxSteps` fails the run with an explicit reason.

## Fingerprint invalidation and reuse

Each stage declares the keys it reads (for example suitability reads horizon, loss tolerance, stated risk, expenses, emergency fund, planned withdrawals, initial capital, data assumptions and its revision directives). The fingerprint is a digest of those values. A stage is reused when any previous execution of the same stage had the same fingerprint, otherwise it is recomputed. The trace records why (`recomputed: input.monthlyContribution changed` or `reused: inputs unchanged`).

Observed in tests: changing only `monthlyContribution` recomputes profile, strategy, challenger, guardrail and nextStep and reuses data and suitability. A rerun with no change reuses every stage and makes 0 model calls.

## Provider adapters and fallbacks

- Reasoning: `deterministicProvider` (default, template text), `replayProvider` (recorded fixtures, supports hang, malformed and throwing cases for tests) and `httpProvider` (POSTs `{task, input}` to `/api/agent`). The HTTP provider is never called without explicit external-processing consent.
- Each model call has a timeout (AbortController) and one retry on timeout, malformed output or error, then falls back to the deterministic provider. A server answer of `{ "fallback": "deterministic" }` (no key, model down, throttled) or a 400 is not retried: `httpProvider` throws `NonRetryableProviderError` and the engine falls back immediately. Calls beyond `maxModelCalls` go straight to the fallback. Every fallback is recorded in the trace.
- Models only extract literally stated values or word narrative around numbers computed by code. All numbers in the plan come from deterministic code. Model answers are validated again in the browser.
- Market data: `syntheticFixtureProvider` (default), `cachedFixtureProvider(asOf)`, plus failing, slow, malformed and spoofed-live providers for tests. Data older than `maxDataAgeDays` is rejected and the fallback is disclosed. A payload claiming kind `live` is rejected because no live provider exists.

## Guardrail invariants

The guardrail (`src/agents/guardrail.ts`) runs mandatory checks before anything is released (the demo passes 15 of 15): `required-inputs`, `weights-sum-to-one`, `weights-in-range`, `blocks-known`, `equity-within-cap`, `stress-loss-within-tolerance` (stricter of the planning and severe drawdowns), `projection-recomputed` (independent recomputation), `liquidity-buckets-cover-withdrawals`, `capital-conserved`, `market-data-acceptable`, `disclosures-present`, `narrative-claims` (no guaranteed, risk-free, "safe investment" or "will grow" language in the strategy narrative or the stress-test summary, `BANNED` pattern), `narrative-numbers-match` (every number in the strategy narrative and in the stress-test summary, including `citedNumbers`, must match a computed value or a challenger finding's message or evidence), `challenge-current` and `no-unresolved-blocking`. `upstream-complete` is added only as a failing check when strategy, suitability or data output is missing. If either text fails, the orchestrator replaces it once with the deterministic template (the summary is rebuilt from the findings) and re-runs the guardrail. A failed mandatory check means the strategy is withheld, never released as validated. Requests for guaranteed returns, trade execution or a specific security are classified by the profile agent and answered with fixed safety responses. The challenger never sees the strategy object, only a reduced input, and recomputes the projection itself.

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

When two stages disagree (for example suitability's planning loss versus the challenger's severe scenario), the stricter outcome wins and a conflict event is recorded.

## Data provenance labels

Every fact carries a source. Market data has `kind` `synthetic-fixture` or `cached` (with `asOf`) and a `sourceLabel`; `live` is not produced by any provider. Profile facts record provenance entries, and the input records whether it came from the form or a scenario fixture (`inputSource`: `user-form` or `scenario-fixture`). The UI shows these labels next to the numbers.

## Privacy and consent

- No free text, names or contact details are written to the trace; `trace.ts` drops and scrubs those keys. A global eval invariant checks this.
- External model processing requires explicit consent; without it the deterministic provider is used and labelled.
- The adviser briefing is minimized. Export requires granted consent with scope `briefing-content`; the contact name is included only with scope `contact-name`. Export is blocked for withheld or failed runs.
- The handoff is a local preview and download only (`booked: false`). Nothing is sent to Raiffeisen or any external system.

## Analytics events

Defined in `EVENT_NAMES` (`src/analytics/events.ts`): `journey_started`, `journey_completed`, `info_captured`, `clarification_requested`, `strategy_validated`, `strategy_withheld`, `stress_test_completed`, `revision_triggered`, `followup_requested`, `consent_requested`, `consent_granted`, `consent_declined`, `handoff_previewed`, `handoff_exported`, `journey_abandoned`, `eval_run`. Properties are whitelisted and bucketed (amounts become ranges). Events are stored in browser `localStorage` (capped at 500). `journey_abandoned` is defined but deliberately not emitted, because abandonment is not reliably observable in a client-only prototype.

## Business mechanism

`/growth` shows the funnel from captured information to validated strategy and adviser handoff, using the events above or a clearly labelled synthetic event set. Funnel steps count journeys, not events: events are ordered by time, each `journey_started` opens a new journey, and a step counts once per journey however often it fired (repeated captures and replays do not inflate it). Percentages are relative to started journeys. Raw event counts are shown separately. The value hypothesis is that stress-tested, explained plans increase qualified adviser conversations and reduce unsuitable self-directed choices. All projections on that page are hypothetical illustrations because no real customer or conversion data exists in this prototype.

## Design decisions

- **No agent framework, no schema library (for example zod).** The core must stay dependency-free and deterministic so it runs in the browser, in Node's native test runner and in the eval CLI with no install. Agents are plain functions with typed inputs and outputs; the graph is an explicit table.
- **Deterministic numbers, optional language model.** Calculations, policy checks and validation are code. A model can only extract stated values or phrase text, and its output is validated.
- **Independent challenger.** The stress tester gets a reduced input and recomputes projections, so it cannot simply approve the strategy's own numbers.
- **Stricter wins on conflicts.** Disagreements between stages are resolved conservatively and recorded.
- **Bounded execution.** Step, revision, model call, timeout and retry limits make every run terminate with an explained status.
- **Fingerprint reuse.** Unchanged stages are reused, which makes counterfactual replays fast and shows exactly what a change affected.
- **Demo capital 35,000 lei.** With 20,000 lei and the 15,000 lei wedding cash bucket, no allowed allocation reaches the 90,000 lei target even in the base case, so the fixture uses 35,000 lei (documented in `demoProfile.ts`).

## Known limitations

- No live market data. All returns, drawdowns and inflation are synthetic fixtures.
- No real Raiffeisen, adviser booking or "Forum" integration. The handoff is a local preview and file download.
- Not a regulated suitability or appropriateness assessment. Policy numbers are illustrative rules of thumb.
- Amazon Bedrock is optional. Without `AWS_BEARER_TOKEN_BEDROCK`, `/api/agent` returns 503 with `fallback: "deterministic"` and the deterministic provider is used and labelled.
- The product catalogue (`src/domain/catalogue.ts`: steady, balanced and growth fund blocks plus an illustrative cash reserve) and the candidate mixes (Cautious, Balanced, Growth-tilted) are synthetic.
- Analytics are local to the browser; there is no backend analytics store.
- Core test files run under Node type stripping and are not type-checked by `tsconfig.core.json`.
