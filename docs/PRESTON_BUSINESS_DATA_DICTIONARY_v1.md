# PRESTON BUSINESS DATA DICTIONARY v1

Date: 2026-07-21
Source of truth: supabase/migrations/0009_phase6b_business_foundation.sql
TypeScript mirror: apps/dashboard/src/lib/business/types.ts
Conventions: snake_case; uuid pks (text pk on the activity ledger);
created_at/updated_at timestamptz; money = bigint integer cents;
rates = integer milli-percent over 100000 (8875 = 8.875 pct);
enumerations via CHECK constraints; owner-only RLS everywhere;
provenance jsonb + source + source_record_id on entity tables;
correlation_id on events/runs; unique idempotency keys on
append-style tables.

## Entities

business_clients - client master records.
  display_name, client_type (residential|commercial|institution|
  other), primary_email, primary_phone, notes, archived.

business_contacts - people at a client.
  client_id FK, full_name, role, email, phone, archived.

business_properties - job sites.
  client_id FK, address_line, unit, city, region (NYC|NJ|OTHER),
  postal_code, lpc_review bool, dob_permit bool, access_notes.

sales_leads - pipeline records.
  client_id FK?, property_id FK?, display_name, stage (lead|
  qualified|site_visit|quote_requested|quote_drafted|quote_sent|
  follow_up|negotiation|won|lost|deferred), stage_changed_at,
  lead_source, owner_next_action.

quotes - quote master; numbers live in versions.
  client_id FK, property_id FK?, lead_id FK?, project_id (bare
  uuid; projects created later - no circular FK), title, status
  (draft|pending_approval|approved|rejected|superseded|archived),
  current_version int, approval_id FK -> approvals.

quote_versions - immutable priced snapshots (insert + select;
  update policy exists only to attach approval_id).
  quote_id FK, version >= 1, unique(quote_id, version),
  product_line, scope_type (installation|product_only),
  jurisdiction (NYC|NJ), tax_rate_milli_pct,
  material_cents, labor_cents, fees_cents,
  markup_mode (none|percent_milli|fixed_cents), markup_value,
  markup_cents, subtotal_cents, tax_cents, total_cents,
  margin_cents, payment_schedule jsonb (plan object),
  assumptions/exclusions/missing_fields jsonb arrays,
  owner_confirmation_required bool,
  st124_tracking jsonb (tracking only, never a determination),
  draft_provenance jsonb, simulation_state CHECK = 'simulation',
  approval_id FK, correlation_id, created_by.

quote_items - append-only line items.
  quote_version_id FK, position, opening_label, product_line,
  description, quantity, unit_material_cents, unit_labor_cents,
  line_fees_cents, line_total_cents, item_flags jsonb.

projects - contracted work.
  client_id FK, property_id FK?, quote_id FK?, title, status
  (pending_contract|contracted|in_progress|punch_list|
  final_inspection|closed|cancelled), contract_status,
  deposit_status, milestone_summary jsonb.

project_milestones - one row per (project, kind).
  kind (contract|deposit|measurement|ordering|permit_lpc|
  permit_dob|delivery|installation|punch_list|final_inspection|
  final_payment|warranty_closeout), status (pending|in_progress|
  blocked|done|not_applicable), due_date, completed_at, note.
  unique(project_id, kind) - a V1 constraint: re-dos (a failed
  inspection repeated, a second delivery) are modeled by cycling
  status on the single row plus installation_events/vendor_orders
  rows, which allow multiples.

vendor_orders - product orders.
  project_id FK, vendor, order_number, order_date,
  expected_ship_date, actual_ship_date, delivery_status
  (not_ordered|ordered|in_production|shipped|delivered|
  backordered|exception), backordered bool, exception_note.

installation_events - install scheduling.
  project_id FK, scheduled_date, crew, site_ready bool, status
  (tentative|scheduled|in_progress|completed|rescheduled|
  cancelled), note.

payment_schedules - append-only deterministic splits.
  quote_version_id FK?, project_id FK?, schedule_type
  (installation_50_25_25|product_only_75_25), stages jsonb
  ([{label, fraction_milli, amount_cents}]), total_cents.

payment_events - append-only recorded payment facts.
  project_id FK?, quote_id FK?, kind (deposit_recorded|
  payment_recorded|adjustment_recorded), amount_cents, method,
  recorded_by, note, correlation_id, idempotency_key unique.

communication_records - display/draft history; NO sent state.
  client_id FK?, project_id FK?, channel (email|sms|whatsapp|
  phone|in_person|other), direction (inbound|outbound_draft),
  subject, summary, occurred_at, source_link, message_state
  (draft|received|logged), approval_id FK?.

business_activity_events - append-only owner-facing ledger.
  id text pk, source, entity_type, entity_id, action, summary,
  actor, provenance jsonb (secret-redacted), correlation_id,
  approval_id FK?, simulation_state, idempotency_key unique.

agent_recommendations - advice only.
  kind (quote_follow_up|missing_payment|stalled_project|
  delayed_order|installation_risk|missing_document|
  margin_anomaly|client_response), entity_type, entity_id,
  evidence/assumptions jsonb arrays, confidence (low|medium|high),
  suggested_next_step, approval_required bool default true,
  status (open|acknowledged|dismissed|superseded),
  correlation_id, idempotency_key unique.

quote_draft_runs - append-only agent run records.
  agent_name, input jsonb (normalized), input_missing_fields,
  quote_id FK?, quote_version_id FK?, status (completed|
  failed_validation|failed_error), failure_reason, assumptions,
  simulation_only CHECK = true, execution_eligible CHECK = false,
  correlation_id, idempotency_key unique, created_by.

approval_links - bridge approvals to business entities.
  approval_id FK -> approvals, entity_type, entity_id, link_kind
  (quote_draft_approval|communication_approval|
  data_change_proposal|agent_recommendation),
  unique(approval_id, entity_type, entity_id).

## Consolidation decisions

- sales_opportunities dropped: sales_leads carries the pipeline.
- agent_runs dropped: quote_draft_runs is the concrete V1 run
  record; generic runtime runs remain os_jobs territory.
- Master-plan messaging/consent tables deferred to the outbound
  communication gate (nothing sends in V1).
- business_contacts is schema-ready but has no UI in V1.

## Explicit V1 deferrals vs master plan section 10

Recorded as decisions, not omissions:
- Opening MEASUREMENTS: quote_items carries free-text description
  only; structured measurement fields arrive with the real-quote
  gate (they change pricing workflows and need owner field
  definitions).
- CLIENT decision + win/loss reason: quotes.status records the
  OWNER decision; client outcomes live in sales_leads stages
  (won/lost) without a reason field yet.
- Follow-up status: computed by the recommendation rules, not
  stored on the quote.
- Documents/photos: no document table exists; the
  missing_document recommendation directs the owner to confirm
  filings held outside the system.
