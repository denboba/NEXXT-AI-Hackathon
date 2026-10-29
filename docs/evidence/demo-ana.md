# Decision Lab demo: Ana (synthetic demo)

- Command: `npm run demo -- --replay monthlyContribution=900 --markdown docs/evidence/demo-ana.md`
- Deterministic: fixed clock 2026-01-15T09:00:00.000Z, deterministic reasoning provider (no language model, no network), seeded simulation (seed 20260115, 1,000 paths). Running the command again gives identical output.
- Synthetic: the customer, the funds and the market assumptions ("Synthetic planning assumptions - not market data") are invented for the demo. This is an educational illustration, not investment advice and not a forecast.
- Privacy: no free text, names or user-entered labels are printed; liquidity buckets are shown by purpose.
- Node version used: v22.23.4

## Input (synthetic scenario fixture)

| Fact | Value |
| --- | --- |
| Goal | 90,000 lei in 7 years (flexible) |
| Initial capital | 35,000 lei |
| Monthly contribution | 700 lei |
| Essential monthly expenses | 4,000 lei |
| Emergency fund | 6,000 lei |
| Planned withdrawals | 15,000 lei in year 2 |
| Stated risk preference | growth |
| Maximum acceptable loss | 15.0% |
| Existing holdings | single-stock 12,000 lei |

## Run summary

| Item | Value |
| --- | --- |
| Terminal status | completed |
| Validation status | validated-with-open-issues |
| Revisions | 1 (limit 2) |
| Steps | 10 (limit 25) |
| Model calls (deterministic provider) | 5 (limit 8) |
| Deterministic tool calls | 23 (limit 60, default 60) |
| Provider fallbacks | 0 |
| Providers | reasoning deterministic-rules, market data synthetic-fixture |

## Stage timeline

| # | Stage | Pass | Execution | Reason |
| --- | --- | --- | --- | --- |
| 1 | profile (Goal & constraints) | 0 | fresh | first run |
| 2 | data (Planning assumptions) | 0 | fresh | first run |
| 3 | suitability (Suitability limits) | 0 | fresh | first run |
| 4 | strategy (Strategy proposal) | 0 | fresh | first run |
| 5 | challenger (Independent stress test) | 0 | fresh | first run |
| 6 | suitability (Suitability limits) | 1 | fresh | recomputed: directives.suitability changed |
| 7 | strategy (Strategy proposal) | 1 | fresh | recomputed: suitability, directives.strategy, revision changed |
| 8 | challenger (Independent stress test) | 1 | fresh | recomputed: suitability, challengerInput changed |
| 9 | guardrail (Validation) | 1 | fresh | first run |
| 10 | nextStep (Next step) | 1 | fresh | first run |

Transitions:

- start -> profile: always
- profile -> data: required facts present
- data -> suitability: assumptions synthetic-fixture
- suitability -> strategy: max equity 66.7%
- strategy -> challenger: every strategy is challenged before release
- challenger -> suitability: revision 1: severe-crash-loss, liquidity-need, single-stock-concentration
- suitability -> strategy: max equity 25.9%
- strategy -> challenger: every strategy is challenged before release
- challenger -> guardrail: remaining findings acknowledged or need customer input
- guardrail -> nextStep: validation validated-with-open-issues

## Tool calls (traced, numbers only)

| Call | Stage | Tool | Arguments | Result |
| --- | --- | --- | --- | --- |
| 1 | strategy | project-goal | initial=20000, monthly=700, years=7, grossReturn=0.042, fee=0.006, withdrawals=0 | nominal=92238.22, real=63407.94 |
| 2 | strategy | stress-loss | equityShare=0.2, equityDrawdown=0.2, bondDrawdown=0.05 | lossPct=0.08 |
| 3 | strategy | project-goal | initial=20000, monthly=700, years=7, grossReturn=0.051, fee=0.0075, withdrawals=0 | nominal=95326.12, real=65530.68 |
| 4 | strategy | stress-loss | equityShare=0.35, equityDrawdown=0.2, bondDrawdown=0.05 | lossPct=0.1025 |
| 5 | strategy | project-goal | initial=20000, monthly=700, years=7, grossReturn=0.06, fee=0.009, withdrawals=0 | nominal=98520.62, real=67726.7 |
| 6 | strategy | stress-loss | equityShare=0.5, equityDrawdown=0.2, bondDrawdown=0.05 | lossPct=0.125 |
| 7 | strategy | simulate-outcomes | initial=20000, monthly=700, years=7, equityShare=0.5, fee=0.009, target=90000, withdrawals=0, paths=1000, seed=20260115 | paths=1000, seed=20260115, p10=78924.13, p50=96603.08, p90=118115.73, reachShare=0.667 |
| 8 | strategy | solve-levers | initial=20000, monthly=700, years=7, equityShare=0.5, fee=0.009, target=90000, withdrawals=0, paths=1000, seed=20260115, thresholds=2 | currentReachShare=0.667, evaluations=13, monthlyLeiAt50=700, extraYearsAt50=0, monthlyLeiAt75=738, extraYearsAt75=1 |
| 9 | challenger | project-goal | initial=20000, monthly=700, years=7, grossReturn=0.06, fee=0.009, withdrawals=0 | nominal=98520.62, real=67726.7 |
| 10 | challenger | stress-loss | equityShare=0.5, equityDrawdown=0.35, bondDrawdown=0.08 | lossPct=0.215 |
| 11 | challenger | simulate-outcomes | initial=20000, monthly=700, years=7, equityShare=0.5, fee=0.009, target=90000, withdrawals=0, paths=1000, seed=20260115 | paths=1000, seed=20260115, p10=78924.13, p50=96603.08, p90=118115.73, reachShare=0.667 |
| 12 | strategy | project-goal | initial=14000, monthly=700, years=7, grossReturn=0.042, fee=0.006, withdrawals=0 | nominal=84552.76, real=58124.68 |
| 13 | strategy | stress-loss | equityShare=0.2, equityDrawdown=0.35, bondDrawdown=0.08 | lossPct=0.134 |
| 14 | strategy | project-goal | initial=14000, monthly=700, years=7, grossReturn=0.0436, fee=0.0063, withdrawals=0 | nominal=85030.49, real=58453.09 |
| 15 | strategy | stress-loss | equityShare=0.227, equityDrawdown=0.35, bondDrawdown=0.08 | lossPct=0.1413 |
| 16 | strategy | project-goal | initial=14000, monthly=700, years=7, grossReturn=0.0454, fee=0.0066, withdrawals=0 | nominal=85564.59, real=58820.25 |
| 17 | strategy | stress-loss | equityShare=0.257, equityDrawdown=0.35, bondDrawdown=0.08 | lossPct=0.1494 |
| 18 | strategy | simulate-outcomes | initial=14000, monthly=700, years=7, equityShare=0.257, fee=0.0066, target=90000, withdrawals=0, paths=1000, seed=20260115 | paths=1000, seed=20260115, p10=74239.48, p50=84777.65, p90=96592.5, reachShare=0.282 |
| 19 | strategy | solve-levers | initial=14000, monthly=700, years=7, equityShare=0.257, fee=0.0066, target=90000, withdrawals=0, paths=1000, seed=20260115, thresholds=2 | currentReachShare=0.282, evaluations=26, monthlyLeiAt50=755, extraYearsAt50=1, monthlyLeiAt75=824, extraYearsAt75=2 |
| 20 | challenger | project-goal | initial=14000, monthly=700, years=7, grossReturn=0.0454, fee=0.0066, withdrawals=0 | nominal=85564.59, real=58820.25 |
| 21 | challenger | stress-loss | equityShare=0.257, equityDrawdown=0.35, bondDrawdown=0.08 | lossPct=0.1494 |
| 22 | challenger | simulate-outcomes | initial=14000, monthly=700, years=7, equityShare=0.257, fee=0.0066, target=90000, withdrawals=0, paths=1000, seed=20260115 | paths=1000, seed=20260115, p10=74239.48, p50=84777.65, p90=96592.5, reachShare=0.282 |
| 23 | guardrail | simulate-outcomes | initial=14000, monthly=700, years=7, equityShare=0.257, fee=0.0066, target=90000, withdrawals=0, paths=1000, seed=20260115 | paths=1000, seed=20260115, p10=74239.48, p50=84777.65, p90=96592.5, reachShare=0.282 |

## Challenger findings

### Pass 0: challenge of strategy-v1

Tests run: projection-recompute, severe-crash-before-goal, goal-two-years-earlier, unexpected-liquidity-need, planned-withdrawals-liquidity, contribution-pause-12m, single-stock-concentration, seeded-outcome-range, fee-inflation-sensitivity.

| Finding | Severity | Routed to | Remedy | Computed evidence | Message |
| --- | --- | --- | --- | --- | --- |
| severe-crash-loss | material | suitability | tighten-drawdown-basis | portfolioLossPct=0.215, valueBeforeShockLei=85562.35, lossLei=18395.91, valueAtGoalLei=79186.52, shortfallLei=10813.48 | A severe crash (equities -35%, bonds -8%) would cut the invested part by 21.5%, above the stated 15.0% limit. |
| crash-shortfall | info | strategy | - | portfolioLossPct=0.215, valueBeforeShockLei=85562.35, lossLei=18395.91, valueAtGoalLei=79186.52, shortfallLei=10813.48 | After a severe crash in year 6 the plan would reach about 79187 lei, 10813 lei short of the target. |
| goal-earlier | info | strategy | - | valueLei=73232.89, shortfallLei=16767.11 | If the money were needed 2 years earlier the plan would hold about 73233 lei. |
| liquidity-need | material | strategy | top-up-reserve | shortfallLei=6000, forcedSaleLossLei=1643.31 | An unexpected expense of 12000 lei exceeds the available reserve by 6000 lei, which would force selling investments, possibly after a fall. |
| contribution-pause | info | strategy | - | valueLei=87499.17, reductionLei=11021.45 | Pausing contributions for 12 months would lower the end value by about 11021 lei. |
| single-stock-concentration | material | strategy | acknowledge-external | share=0.2553, lossIfShockLei=6000 | Shares of a single company are 25.5% of investable assets; a 50% fall would cost about 6000 lei. |
| outcome-range | info | strategy | - | p10Lei=78924.13, p50Lei=96603.08, p90Lei=118115.73, reachShare=0.667 | Across 1000 seeded synthetic paths (seed 20260115) the value at the goal is about 78924 lei at the 10th percentile, 96603 lei at the median and 118116 lei at the 90th percentile; 66.7% of paths reach the target. |
| fee-inflation-sensitivity | info | strategy | - | nominalWithHigherFeeLei=96378.95, realWithHigherInflationLei=59383.79, baseRealLei=67726.7 | 0.5 points more in fees lowers the end value by about 2142 lei; 2 points more inflation lowers its value in today's money by about 8343 lei. |

### Pass 1: challenge of strategy-v2

Tests run: projection-recompute, severe-crash-before-goal, goal-two-years-earlier, unexpected-liquidity-need, planned-withdrawals-liquidity, contribution-pause-12m, single-stock-concentration, seeded-outcome-range, fee-inflation-sensitivity.

| Finding | Severity | Routed to | Remedy | Computed evidence | Message |
| --- | --- | --- | --- | --- | --- |
| crash-shortfall | info | strategy | - | portfolioLossPct=0.1494, valueBeforeShockLei=74135.87, lossLei=11075.16, valueAtGoalLei=74059.17, shortfallLei=15940.83 | After a severe crash in year 6 the plan would reach about 74059 lei, 15941 lei short of the target. |
| goal-earlier | info | strategy | - | valueLei=63134.55, shortfallLei=26865.45 | If the money were needed 2 years earlier the plan would hold about 63135 lei. |
| liquidity-need | info | strategy | - | shortfallLei=0, forcedSaleLossLei=0 | The reserve covers an unexpected expense of 12000 lei. |
| contribution-pause | info | strategy | - | valueLei=75221.36, reductionLei=10343.23 | Pausing contributions for 12 months would lower the end value by about 10343 lei. |
| single-stock-concentration | material | strategy | acknowledge-external | share=0.2553, lossIfShockLei=6000 | Shares of a single company are 25.5% of investable assets; a 50% fall would cost about 6000 lei. |
| outcome-range | info | strategy | - | p10Lei=74239.48, p50Lei=84777.65, p90Lei=96592.5, reachShare=0.282 | Across 1000 seeded synthetic paths (seed 20260115) the value at the goal is about 74239 lei at the 10th percentile, 84778 lei at the median and 96593 lei at the 90th percentile; 28.2% of paths reach the target. |
| fee-inflation-sensitivity | info | strategy | - | nominalWithHigherFeeLei=83797.71, realWithHigherInflationLei=51574.48, baseRealLei=58820.25 | 0.5 points more in fees lowers the end value by about 1767 lei; 2 points more inflation lowers its value in today's money by about 7246 lei. |

## Strategy v1 vs v2

|  | v1 | v2 |
| --- | --- | --- |
| Label (from actual equity share) | Balanced | Cautious |
| Equity share | 50.0% | 25.7% |
| Building blocks | balanced 100% | steady 81%, balanced 19% |
| Liquidity buckets (cash, outside the invested part) | planned-withdrawal 15,000 lei (year 2) | planned-withdrawal 15,000 lei (year 2); emergency-reserve-top-up 6,000 lei |
| Invested initial capital | 20,000 lei | 14,000 lei |
| Monthly contribution | 700 lei | 700 lei |
| Base-case projection (nominal) | 98,521 lei | 85,565 lei |
| Base-case projection (today's money) | 67,727 lei | 58,820 lei |
| Gap to target | none | 4,435 lei |
| Seeded outcome range p10 / p50 / p90 | 78,924 lei / 96,603 lei / 118,116 lei | 74,239 lei / 84,778 lei / 96,593 lei |
| Share of seeded paths reaching the target | 66.7% | 28.2% |
| Portfolio volatility (synthetic) | 8.8%/yr | 6.1%/yr |
| Candidates considered | Cautious 20.0%, Balanced 35.0%, Balanced 50.0% | Cautious 20.0%, Cautious 22.7%, Cautious 25.7% |
| Findings addressed / acknowledged | none / none | liquidity-need / single-stock-concentration |

## Guardrail checks

16 of 16 checks pass. Status: validated-with-open-issues.

| Check | Result | Detail |
| --- | --- | --- |
| required-inputs | pass | all required inputs present |
| weights-sum-to-one | pass | sum of weights = 1 |
| weights-in-range | pass | each weight within 0..1 |
| blocks-known | pass | all blocks from the fictional catalogue |
| equity-within-cap | pass | equity 25.70% vs cap 25.93% |
| stress-loss-within-tolerance | pass | stricter of planning (14.94%) and severe (14.94%) loss vs tolerance 15.00% |
| projection-recomputed | pass | independent 85564.59 vs stated 85564.59 lei |
| simulation-reproducible | pass | re-run with seed 20260115 and 1000 paths gives identical percentiles and reach share 28.2% |
| liquidity-buckets-cover-withdrawals | pass | withdrawals within 3 years held in cash |
| capital-conserved | pass | buckets + invested = 35000.00 vs initial 35000.00 lei |
| market-data-acceptable | pass | synthetic-fixture (Synthetic planning assumptions - not market data), freshness not-applicable |
| disclosures-present | pass | all mandatory disclosures present |
| narrative-claims | pass | no prohibited claims |
| narrative-numbers-match | pass | every cited number in the narrative and stress-test summary matches a computed value |
| challenge-current | pass | challenged strategy-v2 |
| no-unresolved-blocking | pass | no blocking findings |

Open issues:

- Shares of a single company are 25.5% of investable assets; a 50% fall would cost about 6000 lei.
- Projected shortfall of about 4435 lei against the target.
- Stated preference 'growth' implies accepting falls of about 30%, but the stated limit is 15.0%.
- Stated preference 'growth' usually implies accepting larger temporary falls than the stated limit; the stricter stated limit is applied and should be confirmed.

## Levers (target and horizon are never changed silently)

- `increase-contribution`: Add about 47 lei per month (to about 747 lei).
- `extend-horizon`: Allow about 1 more year(s).
- `lower-target`: Or aim for about 85,565 lei instead.
- `contribution-for-reach-share`: About 755 lei per month (55 more) gives a target reach share of 50% across 1,000 seeded synthetic paths (not a forecast).
- `horizon-for-reach-share`: About 1 more year(s) at the current contribution gives a target reach share of 50% across 1,000 seeded synthetic paths (not a forecast).
- `contribution-for-reach-share`: About 824 lei per month (124 more) gives a target reach share of 75% across 1,000 seeded synthetic paths (not a forecast).
- `horizon-for-reach-share`: About 2 more year(s) at the current contribution gives a target reach share of 75% across 1,000 seeded synthetic paths (not a forecast).
- `review-concentration`: Existing single-company shares are outside this plan; reviewing that concentration with an adviser is suggested.

## Next step

- Primary: `talk-to-adviser`
- A conversation with an adviser is suggested: unresolved gap to the goal; single-company concentration; conflicting constraints need confirmation.
- Adviser recommended: yes (unresolved gap to the goal; single-company concentration; conflicting constraints need confirmation)
- The adviser briefing is not exported here: export needs the customer's consent in the UI and is a local download only (nothing is booked or sent).

## Counterfactual replay: monthlyContribution=900

The rerun starts from the previous executions; a stage is reused when its input fingerprint matches an earlier execution, otherwise it is recomputed.

| # | Stage | Pass | Execution | Reason |
| --- | --- | --- | --- | --- |
| 1 | profile (Goal & constraints) | 0 | fresh | recomputed: input.monthlyContribution changed |
| 2 | data (Planning assumptions) | 0 | reused | reused: inputs unchanged (fp 81ac2d69) |
| 3 | suitability (Suitability limits) | 0 | reused | reused: inputs unchanged (fp 783cdc98) |
| 4 | strategy (Strategy proposal) | 0 | fresh | recomputed: profile.facts changed |
| 5 | challenger (Independent stress test) | 0 | fresh | recomputed: profile.facts, challengerInput changed |
| 6 | suitability (Suitability limits) | 1 | reused | reused: inputs unchanged (fp 10a3551a) |
| 7 | strategy (Strategy proposal) | 1 | fresh | recomputed: profile.facts changed |
| 8 | challenger (Independent stress test) | 1 | fresh | recomputed: profile.facts, challengerInput changed |
| 9 | guardrail (Validation) | 1 | fresh | recomputed: profile, strategy, challenge changed |
| 10 | nextStep (Next step) | 1 | fresh | recomputed: profile, strategy, challenge, validation changed |

| Item | Original run | Replay |
| --- | --- | --- |
| Terminal status | completed | completed |
| Validation status | validated-with-open-issues | validated-with-open-issues |
| Revisions | 1 | 1 |
| Model calls | 5 | 5 |
| Tool calls | 23 | 23 |
| Released strategy | Cautious 25.7% | Cautious 25.7% |
| Base-case projection (nominal) | 85,565 lei | 104,789 lei |
| Gap to target | 4,435 lei | none |
| Share of seeded paths reaching the target | 28.2% | 91.7% |
| Next step | talk-to-adviser | talk-to-adviser |
