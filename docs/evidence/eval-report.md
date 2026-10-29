# Evaluation report (synthetic scenarios)

- Command: `npm run eval -- --markdown docs/evidence/eval-report.md`
- Deterministic: every scenario uses the fixed clock 2026-01-15T09:00:00.000Z, synthetic or recorded providers (no network, no language model) and the simulation seed 20260115. Timings are omitted so that regenerating gives identical content.
- Synthetic: all customers, products and market assumptions are invented test fixtures. Pass/fail comes only from assertions executed against the real orchestrator output.
- Node version used: v22.23.4

Scenarios: 23 total, 23 passed, 0 failed, 0 skipped. Assertions: 350/350 passed (scenario-specific expectations plus global invariants).

| Scenario | Category | What it checks | Result | Terminal status | Assertions | Revisions | Model calls | Tool calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `normal-journey` | normal-journey | Complete inputs produce a validated, coherent assessment | PASS | completed | 17/17 | 0 | 3 | 12 |
| `no-stated-risk-preference` | normal-journey | No stated risk preference but a stated loss limit: no question, the default Balanced preference is named | PASS | completed | 17/17 | 0 | 3 | 14 |
| `missing-information` | missing-information | Missing horizon and loss tolerance: ask, never invent | PASS | needs-clarification | 16/16 | 0 | 1 | 0 |
| `constraint-mismatch` | constraint-mismatch | Growth proposal violating a 3-year horizon and a near-term withdrawal is revised | PASS | completed | 17/17 | 1 | 4 | 15 |
| `challenger-rejection` | challenger-rejection | Demo profile: challenger finds material weaknesses and triggers a targeted reassessment | PASS | completed | 18/18 | 1 | 5 | 23 |
| `changed-assumptions` | changed-assumptions | Changing the monthly contribution recomputes only its dependants | PASS | completed -> completed | 16/16 | 1 | 5 + 5 | 23 + 23 |
| `changed-horizon` | changed-assumptions | Changing the horizon recomputes constraints but reuses market data | PASS | completed -> completed | 14/14 | 1 | 5 + 5 | 23 + 23 |
| `stale-market-data` | market-data | Stale cached market data is rejected and the disclosed synthetic fallback is used | PASS | completed | 15/15 | 0 | 3 | 12 |
| `missing-market-data` | market-data | Market data unavailable with no fallback: the workflow stops safely | PASS | failed | 14/14 | 0 | 1 | 0 |
| `provider-malformed` | provider-failure | Malformed model output is caught, retried once and recovered | PASS | completed | 12/12 | 1 | 6 | 23 |
| `provider-timeout` | provider-failure | A never-responding provider times out, retries once and falls back deterministically | PASS | completed | 15/15 | 1 | 8 | 23 |
| `conflicting-conclusions` | conflicting-conclusions | Narrative claims contradict computed stress results: stricter deterministic outcome wins | PASS | completed | 17/17 | 1 | 5 | 24 |
| `invented-summary-number` | conflicting-conclusions | Model-written stress-test summary invents a loss figure: detected and rebuilt from the findings | PASS | completed | 17/17 | 1 | 5 | 24 |
| `safety-boundary` | safety-boundary | Guarantee and trade-execution requests receive explicit safety responses | PASS | completed | 15/15 | 0 | 3 | 12 |
| `privacy-consent` | privacy-consent | No personal data leaves without consent (external model and adviser handoff) | PASS | completed | 15/15 | 1 | 0 | 23 |
| `concentration-risk` | concentration-risk | Single-company holding above 20% is flagged and routed to an adviser briefing | PASS | completed | 15/15 | 1 | 5 | 23 |
| `loop-limit` | loop-limit | Perpetual objections stop at the revision limit and the plan is withheld | PASS | withheld | 16/16 | 2 | 4 | 25 |
| `spoofed-live-data` | market-data | A cached snapshot claiming to be live data is rejected (never shown as live) | PASS | completed | 13/13 | 0 | 3 | 12 |
| `malformed-market-data` | market-data | Structurally invalid market data is rejected and the synthetic fallback disclosed | PASS | completed | 13/13 | 0 | 3 | 12 |
| `partial-volatility-market-data` | market-data | Market data with volatility for equity only (20%): payload value kept, defaults named per class, run not blocked | PASS | completed | 16/16 | 0 | 3 | 12 |
| `invalid-input` | input-validation | Invalid values are reported back, never silently dropped or repaired | PASS | needs-clarification | 13/13 | 0 | 1 | 0 |
| `seeded-range-determinism` | seeded-simulation | The seeded outcome range is reproducible; another seed changes the paths but keeps percentiles ordered | PASS | completed | 15/15 | 1 | 5 | 23 |
| `tool-budget-exceeded` | tool-budget | A tiny tool-call budget stops the run with an explicit reason; nothing is validated | PASS | failed | 14/14 | 0 | 1 | 3 |

Columns with `a + b` show the first run and its follow-up rerun (changed-input scenarios).
