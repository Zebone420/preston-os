# PRESTON QUOTE-DRAFT AGENT CONTRACT v1

Date: 2026-07-21
Implementation: apps/dashboard/src/lib/business/quote-agent.ts
Invocation: server action createQuoteDraft
  (apps/dashboard/src/app/business/actions.ts), owner-only.
Mode: SIMULATION ONLY. execution_eligible = false (DB-pinned).

## 1. What the agent is

A deterministic in-process service (not a background worker, not
an os_jobs consumer, not a network client). The owner submits a
normalized quote request; the agent validates fail-closed, prices
with the quote engine (see the calculation spec), persists a
versioned draft, and opens an owner approval request. It runs
only when invoked by the owner and finishes synchronously.

## 2. Input contract (QuoteDraftRequest)

Identity: title (new quotes), client_id (existing client uuid),
optional lead_id/property_id, or quote_id to draft the next
version of an existing quote.
Engine fields: scope_type, jurisdiction, items[], quote_fees,
markup_mode/value, st124_tracking, exclusions.
Control: idempotency_key (required, >= 8 chars). The owner form's
server action generates a fresh uuid per submission (double-submit
is prevented by the pending-disabled submit button; a resubmit
after a failure is a new attempt with a new key). Programmatic
callers supply their own stable key to get replay dedup. Optional
correlation_id (defaults to qd:<idempotency_key>), created_by.

## 3. Outcomes

completed         - draft persisted; result carries quote_id,
                    quote_version_id, version, approval_id,
                    total_cents, assumptions.
duplicate         - a run with this idempotency_key already
                    exists; the stored run is authoritative and
                    is returned; no new rows are written.
failed_validation - missing/invalid fields; missing_fields and
                    errors name every gap; NO quote rows are
                    written; the run row records the failure.
failed_error      - a persistence step failed (or target quote
                    not found / version CAS conflict); the run
                    row records the reason.

Every outcome (except duplicate) attempts exactly one
quote_draft_runs row with simulation_only=true and
execution_eligible=false. Two narrow completed-path exceptions
are surfaced as named warnings instead of a row: a concurrent
duplicate-race (the stored run is authoritative; audited as
quote_draft_race_detected) and a run-record write failure
(run_record_failed).

## 4. Persistence effects of a completed run (in order)

1. quotes: new master row as an unpublished draft (v0), or the
   existing quote is used (existing-quote path).
2. quote_versions: one priced snapshot (approval-pending) with
   assumptions, exclusions, payment schedule, provenance,
   correlation_id, simulation_state='simulation'. The numbers are
   privilege-immutable (only approval_id is updatable).
3. quote_items: one row per line item.
4. payment_schedules: the deterministic split for the version.
5. approvals: one pending YELLOW row - created only AFTER the
   draft fully exists, so a pending approval can never point at
   a missing draft. approval_id is then attached to the version.
6. quotes CAS bump: current_version -> N, status
   pending_approval, approval_id attached (compare-and-set on
   the previous version guards concurrent drafts).
7. approval_links: two rows (quote_version + quote) so the
   Approval Center deep-links the draft.
8. quote_draft_runs: the run record (idempotency anchor).
9. business_activity_events: quote_draft_created ledger entry.
10. audit_log: quote_draft_created (YELLOW, staging).

Partial-failure semantics: a failure mid-sequence records a
failed_error run and leaves at worst a visible, unpublished
draft (quote at v0 / a version without approval) - never a
pending approval pointing at nothing, and never a
current_version pointing at a missing version row. Follow-up
write failures after the draft is published (links, run record,
activity) do not fail the draft; they are returned as named
warnings and audited. A concurrent duplicate submit is arbitrated
by the unique run key: the loser is audited as
quote_draft_race_detected. There is no delete path by design
(append-only governance).

## 5. Hard guarantees (each has a test or DB pin)

1. Accepts structured input only; free text never reaches math.
2. Validates required fields; 3. reports missing fields by name.
4. Line totals and 5. subtotal/fees/tax/total are deterministic
   integer-cent calculations (engine spec).
6. Markup assumptions exposed (markup_rule_unverified_v4 flag);
   no default markup ever.
7. Both owner-ruled payment schedules supported.
8. Drafts are versioned (unique(quote_id, version), CAS bump).
9. Provenance recorded (draft_provenance, source, actor).
10. Correlation and idempotency identifiers on every artifact.
11. simulation_state recorded on version, run, and activity.
12. Owner approval required: every draft opens a pending
    approvals row; approval records a DECISION ONLY.
13. Never sends anything (no network surface; structural pin).
14. Never creates an invoice (no such table or code path).
15. Never touches external CRM/accounting (structural pin bans
    airtable/google/quickbooks/stripe tokens in business code).
16. Never enables execution (DB CHECK + code constant + pins).
17. Never uses Remote Runner (no runner import; pin).
18. Never invents Andersen or any product pricing: only owner
    -entered numbers are priced; missing data fails closed.
19. Fails closed on missing material inputs.
20. Output is a structured, testable object suitable for a
    future PDF/proposal gate.

## 6. What approval means in V1

Approving the draft in the Approval Center flips the approvals
row to approved (CAS, audited) - and nothing else happens.
No send, no PDF, no external write, no execution. Turning an
approved draft into a client-facing proposal is a future
owner-gated phase.
