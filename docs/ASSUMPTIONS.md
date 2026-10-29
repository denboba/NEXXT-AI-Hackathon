# Assumptions sheet

Every policy number and synthetic assumption that the Decision Lab core uses, with its location in code, why it was chosen and what a bank pilot would replace it with. Values were checked against the code on the branch this file was committed with; if a value here and the code ever disagree, the code is what runs.

**Status of every number below: illustrative.** None of them is Raiffeisen policy, a regulatory threshold, a market estimate or a forecast. They are planning heuristics and synthetic fixtures chosen so that the prototype behaves plausibly and testably. A pilot would replace them with the bank's own, approved values (see the last column).

## Suitability and customer constraints

| Assumption | Value in code | Code location | Rationale | Pilot replacement |
| --- | --- | --- | --- | --- |
| Equity cap by horizon | under 3 years 20%; 3 to 5 years 40%; 6 to 10 years 70%; over 10 years 90% (whole years) | `horizonEquityCap`, `src/agents/suitability.ts` | Less time to recover from a fall means less equity. Simple monotone rule of thumb. | The bank's suitability rules and product governance (target market per product, as required for MiFID II product governance). |
| Equity cap by stated risk preference | steady 30%, balanced 60%, growth 90% | `STATED_RISK_CAP`, `suitability.ts` | Keeps the allocation consistent with what the customer said they want. | Risk profile from the bank's MiFID II suitability questionnaire. |
| Loss budget implied by a stated preference (used when no maximum loss is stated) | steady 10%, balanced 20%, growth 30% | `RISK_LOSS_BUDGET`, `src/agents/profile.ts` | A stated preference alone is weak evidence of loss tolerance; a conservative mapping is used and the customer is asked to confirm. | Loss-capacity and risk-tolerance answers from the questionnaire. |
| Equity cap by loss tolerance | largest equity share e with e x equity drawdown + (1 - e) x bond drawdown <= tolerance | `lossEquityCap`, `suitability.ts` | Turns the stated maximum loss into an allocation limit using the active drawdown basis. | Same idea with the bank's stress scenarios. |
| Conflict: stated preference vs stated loss limit | flagged when the preference's loss budget exceeds the stated limit by more than 5 percentage points | `suitability.ts`, `profile.ts` | The stricter value is applied; the customer must confirm. | Questionnaire consistency checks. |
| Conflict: growth preference with a short horizon | flagged for `growth` with a horizon of 5 years or less | `suitability.ts` | Horizon cap applies; customer must confirm. | Questionnaire consistency checks. |
| Emergency reserve rule of thumb | 3 months of essential expenses | `RESERVE_MONTHS_RULE`, `suitability.ts` | Common personal-finance heuristic; asked for, never assumed. | The bank's financial-situation assessment. |
| Liquidity window | planned withdrawals within 3 years are held in cash, outside the invested part | `LIQUIDITY_WINDOW_YEARS`, `suitability.ts` | Money needed soon must not depend on market returns. | Bank policy on short-term liquidity needs. |
| Strictest cap wins | max equity = minimum of all caps | `suitability.ts` | Conservative resolution of competing limits. | Unchanged in principle. |
| Large goal (adviser recommended) | target of 250,000 lei or more | `LARGE_GOAL_THRESHOLD_LEI`, `src/agents/nextStep.ts` | Larger stakes justify a human conversation. | Bank segmentation and advice-routing rules. |

## Challenger stress tests

| Assumption | Value in code | Code location | Rationale | Pilot replacement |
| --- | --- | --- | --- | --- |
| Severe crash scenario | equities -35%, bonds -8%, cash 0%, applied in the year before the goal | `SEVERE_CRASH`, `src/agents/challenger.ts` | Deliberately harsher than the planning drawdowns, so the Challenger is independent of the strategy's own assumptions. | The bank's risk-management stress scenarios. |
| Unexpected liquidity need | 3 months of essential expenses (10% of the target when expenses are unknown) | `challenger.ts` (test `unexpected-liquidity-need`) | Checks whether an emergency would force selling investments, possibly after a fall. | Bank liquidity-stress assumptions. |
| Single-company concentration limit | material above 20% of investable assets | `CONCENTRATION_LIMIT`, `challenger.ts` | Concentration in one employer or company is a common, avoidable risk. | Bank concentration policy. |
| Single-stock shock | -50% | `SINGLE_STOCK_SHOCK`, `challenger.ts` | Shows the size of the exposure in lei. | Bank stress scenario for single equities. |
| Contribution pause | 12 months, starting in month 13 when the horizon is at least 2 years | `PAUSE_MONTHS`, `challenger.ts` | Income interruptions are a frequent real-world deviation. | Unchanged or calibrated to customer data. |
| Goal needed earlier | 2 years earlier (when the horizon allows) | `challenger.ts` (test `goal-two-years-earlier`) | Life goals move. | Unchanged. |
| Fee and inflation sensitivity | +0.5 percentage points fees, +2 percentage points inflation | `challenger.ts` (test `fee-inflation-sensitivity`) | Shows how sensitive the result is to costs and inflation. | Bank's sensitivity scenarios. |
| Low reach share flag | material when the base case reaches the target but fewer than 50% of seeded paths do | `MIN_REACH_SHARE`, `src/domain/simulation.ts`; test `seeded-outcome-range` | A base case alone can look reassuring when most outcomes miss. | Bank's chosen confidence level for goal-based planning. |
| Projection tolerance | 0.01 lei | `LEI_TOLERANCE`, `src/domain/calculations.ts` | Independent recomputation must match exactly apart from rounding. | Unchanged. |

## Synthetic capital market assumptions

| Assumption | Value in code | Code location | Rationale | Pilot replacement |
| --- | --- | --- | --- | --- |
| Expected annual return | equity 9%, bonds 3%, cash 2.5% | `syntheticAssumptions`, `src/providers/marketData.ts` | Reproduces the illustrative fund returns (blended steady 4.2%, balanced 6.0%, growth 8.4%) within 0.4 percentage points of the 4%/6%/8% shown in the coach. | The bank's capital market assumptions (CMA), versioned and dated. |
| Planning drawdowns (a bad year) | equity 20%, bonds 5%, cash 0% | `syntheticAssumptions` | Bad but not extreme; the Challenger applies its own harsher scenario. | Bank CMA stress drawdowns. |
| Annual volatility | equity 16%, bonds 5%, cash 0.5% | `syntheticAssumptions`; same values as `DEFAULT_VOLATILITY` in `simulation.ts` (used per asset class only when the payload has none for that class, labelled `synthetic-default`; a partial payload gives `mixed` and the defaulted classes are named) | Plausible-looking illustrative values for the seeded simulation, not estimated from market data. | Bank CMA volatilities. |
| Equity/bond correlation | 0.2 (cash uncorrelated) | `syntheticAssumptions`; `DEFAULT_EQUITY_BOND_CORRELATION` | Illustrative. | Bank CMA correlation matrix. |
| Inflation | 5.5% per year, constant | `INFLATION`, `src/lib/finance.ts` | Same value as the original coach's inflation illustration. | Bank's inflation assumption. |
| Market data freshness | cached data older than 120 days is rejected and the disclosed synthetic fallback is used | `maxDataAgeDays`, `src/orchestrator/context.ts` | Prevents stale assumptions being presented as current. | Bank's CMA review cycle. |
| Live data | not available; a payload claiming `live` is rejected | `src/agents/data.ts`, `marketData.ts` | No live provider exists in this prototype. | An approved internal CMA service. |

## Seeded outcome simulation and goal-seek solver

| Assumption | Value in code | Code location | Rationale | Pilot replacement |
| --- | --- | --- | --- | --- |
| Model | single-factor log-normal monthly growth of the blended mix, rebalanced monthly; expected growth equals the base-case rate; zero volatility reproduces `projectGoal` exactly | `src/domain/simulation.ts` | Simple, dependency-free and reproducible; makes the spread of outcomes visible. Not a forecast. | The bank's approved simulation engine (for example multi-asset, fat tails, regime changes). |
| Seed | 20260115 | `SIMULATION_SEED` | Fixed so every run of the demo, the eval suite and the guardrail is reproducible. | Fixed, recorded seed per plan for auditability. |
| Paths | 1,000 (maximum 20,000) | `SIMULATION_PATHS`, `MAX_SIMULATION_PATHS` | Keeps `npm run eval` at about 2 seconds while giving stable percentiles. | Calibrated to the engine's convergence. |
| Reported percentiles | 10th, 50th and 90th (nearest rank) | `simulateGoal` | Simple description of a bad, middle and good outcome. | Bank disclosure standard. |
| Solver reach-share thresholds | 50% and 75% | `SOLVER_THRESHOLDS` | Shows what extra contribution or time would raise the share of paths reaching the goal. | Bank's chosen confidence levels. |
| Solver bounds | monthly contribution up to 1,000,000 lei; horizon up to 50 years | `MAX_SOLVER_MONTHLY_LEI`, `MAX_SOLVER_YEARS` | Bounded search; beyond these the lever is reported as not reachable. | Unchanged. |

## Fictional products (catalogue)

Building blocks are the three fictional demo funds from `src/lib/finance.ts` plus an illustrative cash reserve (`src/domain/catalogue.ts`). In the Decision Lab, returns come from the synthetic asset-class assumptions above applied to each block's asset mix; the funds' own illustrative gross returns are used by the original coach screens.

| Block | Equity share | Annual fee | Recommended minimum years | Gross return shown in the coach |
| --- | --- | --- | --- | --- |
| Cash reserve (illustrative deposit) | 0% | 0% | 0 | not shown (cash assumption 2.5% in the Decision Lab) |
| Steady Start | 20% | 0.6% | 3 | 4% |
| Balanced Future | 50% | 0.9% | 5 | 6% |
| Long-Term Growth | 90% | 1.2% | 10 | 8% |

Blocks whose recommended minimum holding period is longer than the horizon are excluded. The cash block is part of the invested mix only when the maximum equity share is below the most cautious fund (20%). Fees are modelled as a reduction of the annual return. Pilot replacement: the bank's actual product range with its key information documents, fees and target markets.

## Strategy construction and labels

| Assumption | Value in code | Code location | Rationale |
| --- | --- | --- | --- |
| Label bands (from the actual equity share) | Cautious up to 30%; Balanced above 30% up to 60%; Growth-tilted above 60% (upper-inclusive) | `LABEL_BANDS`, `labelForEquity`, `src/agents/strategy.ts` | A label must describe the allocation honestly, even after a revision lowers the equity share (Ana v2 at 25.7% is Cautious). The upper edges match `STATED_RISK_CAP` (steady 30%, balanced 60%), so a candidate at a preference's own cap is not excluded as one band too risky. |
| Candidates | most cautious eligible mix, the midpoint, the highest mix within the preferred label's band and the maximum allowed equity; candidates closer than 0.5 percentage points are merged (three in most journeys, four only when no risk is stated and the constraints allow more than 60%) | `bandUpperEdge`, `strategy.ts` | Spans the allowed range so the comparison is meaningful, and lets the default Balanced preference reach the top of its band like a stated one instead of a midpoint set by the most cautious fund. |
| Choice | highest-equity candidate whose label is not riskier than the stated preference (Balanced when none is stated) | `strategy.ts` | Respects both the constraints and the customer's preference. The rationale says which of the two limited the choice (`choiceSentence`), with equity shares and the cap at the same one-decimal precision. |

## Execution limits

`DEFAULT_LIMITS` in `src/orchestrator/context.ts`:

| Limit | Value | Purpose |
| --- | --- | --- |
| `maxSteps` | 25 | Stage executions per run. |
| `maxRevisions` | 2 | Challenger-driven revision loops. |
| `maxModelCalls` | 8 | Reasoning provider calls; further calls use the deterministic fallback. |
| `maxToolCalls` | 60 | Deterministic tool calls (the Ana demo uses 23). |
| `providerTimeoutMs` | 8000 | Timeout per model or market data call. |
| `maxRetries` | 1 | Retry after a timeout, malformed output or error. |
| `maxDataAgeDays` | 120 | Staleness limit for cached market data. |

Server limits for `POST /api/agent` (`server/agentApi.mjs`): input up to 8,000 characters, 60 requests per client per 60 seconds.

## What is deliberately excluded

- **Taxes.** Taxes on investment income or gains (in Romania, whatever rules apply to the customer and the product) are not modelled. Tax treatment depends on the product, the customer's situation and rules that change over time; modelling it without the bank's tax and legal review would give false precision. A pilot would add the bank's validated after-tax illustrations.
- **Transaction costs, entry or exit charges and spreads.** Only an annual fee is modelled, as a return reduction. Real products have their own cost disclosures.
- **Currency effects.** Everything is in lei with no exchange-rate risk, although funds holding foreign assets would be exposed to it.
- **Path dependence beyond the simulation**, such as sequence-of-contribution behaviour changes, rebalancing costs or customer reactions to falls.
- **Regulated assessments.** No suitability or appropriateness assessment, no product governance, no know-your-customer checks.

## Demo customer

`src/domain/demoProfile.ts` (Ana, synthetic): target 90,000 lei in 7 years, 35,000 lei initial capital, 700 lei per month, 4,000 lei essential monthly expenses, 6,000 lei emergency fund, a 15,000 lei withdrawal in year 2, stated preference growth, maximum loss 15%, 12,000 lei in a single company's shares. The initial capital is 35,000 lei rather than the brief's 20,000 lei because with 20,000 lei and the 15,000 lei withdrawal held in cash no allowed allocation reaches the target even in the base case.
