# Pilot plan (proposal)

**Everything in this document is a proposal.** No pilot has been run, no customer or adviser has used the prototype, and no result below is observed. Numbers in this file are design parameters to be agreed with the bank, not measurements.

## Problem and target users

- **Customers:** retail customers with a concrete savings goal (for example a down payment in 5 to 10 years) who are considering investing monthly but are unsure how much risk fits their horizon, their emergency reserve and money they need soon. The synthetic demo customer Ana shows the typical pattern: a growth preference, a 15% loss limit, a near-term withdrawal, a thin reserve and concentrated employer shares.
- **Advisers:** branch or remote advisers whose conversations often start from scratch, with facts collected verbally and constraints discovered late.
- **Problem:** self-directed choices can ignore liquidity needs and loss limits, and adviser time is spent on fact-finding instead of on the decision. The value hypothesis (from `/growth`) is that stress-tested, explained plans increase qualified adviser conversations and reduce unsuitable self-directed choices. It is a hypothesis to test, not a finding.

## Where it fits in the adviser workflow

1. **Before the meeting (customer, self-service):** the customer states a goal and constraints in the Decision Lab. The workflow computes limits, a strategy, an independent stress test, a revision when needed and a guardrail validation. Missing or conflicting facts become targeted questions instead of assumptions.
2. **Handoff:** with explicit consent, the customer exports a data-minimized adviser briefing (validated or open issues, constraints, levers, open questions). Today this is a local download; a pilot would need a secure transfer into the bank's CRM.
3. **Meeting (adviser):** the adviser starts from the briefing, confirms flagged conflicts (for example stated preference versus stated loss limit), runs the bank's regulated suitability assessment and discusses the levers. The Decision Lab never replaces that assessment.
4. **After the meeting:** counterfactual replays ("what if I save 900 lei per month") show which conclusions change.

## Pilot design (proposal)

| Element | Proposal |
| --- | --- |
| Scope | A limited cohort of existing customers who start a goal-savings conversation, in a small number of branches or one remote-advice team chosen by the bank. |
| Arms | Control: the current process. Treatment: customers are offered the Decision Lab before the adviser meeting; advisers receive the briefing when the customer consents. |
| Assignment | Randomised by customer or by adviser team (to be chosen with the bank to avoid contamination between arms). |
| Duration | A fixed period agreed with the bank, long enough to observe meetings and follow-up decisions (for example one quarter). |
| Primary outcome | Qualified handoff rate (definition below), compared between arms. |
| Guardrail outcomes | Withheld rate, consent decline rate, model fallback rate, adviser-reported briefing errors. Any guardrail breach pauses the pilot. |
| Qualitative | Short adviser and customer interviews on briefing usefulness and understanding of the outcome range. |
| Success criteria | To be set with the bank before the start (pre-registered), including a minimum detectable effect and sample size based on the bank's own baseline volumes. |

## Metric definitions

Metrics use only events that exist in `EVENT_NAMES` (`src/analytics/events.ts`). Counting follows `journeySteps`: events are ordered by time, each `journey_started` opens a new journey, and an event counts once per journey. Decision Lab journeys are those whose `journey_started` has `stage: "decision"` (the coach also emits `journey_started` with `stage: "coach"`). Synthetic events (`synthetic: true`) are always excluded.

| Metric | Definition | Events |
| --- | --- | --- |
| Validated-plan rate | journeys with `strategy_validated` / Decision Lab journeys | `strategy_validated`, `journey_started` |
| Withheld rate | journeys with `strategy_withheld` / journeys with `stress_test_completed` | `strategy_withheld`, `stress_test_completed` |
| Clarification rate | journeys with `clarification_requested` / Decision Lab journeys | `clarification_requested`, `journey_started` |
| Revision rate | journeys with `revision_triggered` / journeys with `stress_test_completed` | `revision_triggered`, `stress_test_completed` |
| Adviser interest rate | journeys with `followup_requested` / Decision Lab journeys | `followup_requested`, `journey_started` |
| Consent decline rate | journeys with `consent_declined` / journeys with `consent_requested` | `consent_declined`, `consent_requested` |
| Qualified handoff rate | journeys with both `strategy_validated` and `handoff_exported` / Decision Lab journeys. Export is only possible after consent (`consent_granted`) and is blocked for withheld or failed runs; a run that needs clarification can still be handed off, which is why the definition also requires `strategy_validated`. | `handoff_exported`, `strategy_validated`, `consent_granted`, `journey_started` |
| Completion rate | journeys with `journey_completed` (`stage: "decision"`) / Decision Lab journeys | `journey_completed`, `journey_started` |
| Model fallback rate | share of model calls answered by the deterministic fallback. **Not an analytics event today:** it is available per run as `WorkflowState.fallbacks` and `fallback` trace entries, and would need a backend metric before a pilot. | none (trace only) |

`journey_abandoned` is defined but deliberately not emitted, because abandonment is not reliably observable in a client-only prototype; a pilot would derive it server-side from session timeouts. `eval_run` is for quality assurance of the evaluation suite and is not a customer metric. `info_captured`, `consent_requested` and `handoff_previewed` are funnel steps used as denominators or diagnostics.

## What must be built before a real pilot

- **Authentication and customer data:** real login, identity, and prefilled facts from bank systems instead of typed values. Consent receipts must then be bound to the authenticated session, and the consent audit trail persisted with the version of the consent text.
- **Bank capital market assumptions and products:** replace every synthetic number in [ASSUMPTIONS.md](ASSUMPTIONS.md) with approved, versioned values and the real product range with its documents and target markets.
- **Regulatory and legal review:** positioning relative to the bank's MiFID II suitability process, disclosures, record keeping, complaints handling and model-risk governance for the optional language model.
- **Backend analytics:** events are currently stored only in browser `localStorage`; a pilot needs a consented, privacy-reviewed backend event store and the fallback metric above.
- **Secure handoff:** transfer of the consented briefing into the adviser's CRM instead of a local download.
- **Operations:** monitoring, incident process, accessibility review of the rendered UI (the UI was not rendered in the build sandbox for this submission) and adviser training.

## Risks

| Risk | Mitigation in the prototype | Still needed |
| --- | --- | --- |
| Customers read the outcome range as a forecast or promise | Labelled "Seeded synthetic simulation, not a forecast"; banned-claims guardrail; disclosures mandatory | User testing of wording |
| Plan released despite failed checks | 16 mandatory guardrail checks; failed checks withhold the plan; eval invariants. `simulation-reproducible` re-runs the same seeded function, so it checks input consistency, not the simulation model | Independent model validation, including of the outcome-range model |
| Model invents facts or numbers | Model only extracts or words text; values re-validated; `narrative-numbers-match` check | Model-risk governance |
| Personal data sent externally without consent | Engine gate plus server-side 403 for requests without a valid server-issued consent receipt (signed, scoped, 30-minute expiry, revocable, audited in memory; not bound to an authenticated person); sanitized trace | Data protection impact assessment |
| Advisers over-trust the briefing | Briefing lists open issues and confirmation needs | Training; the regulated assessment stays mandatory |
| Synthetic assumptions mistaken for bank views | Every assumption labelled synthetic | Replace with bank CMA |
