-- PRESTON AI OS - Phase 6B business foundation schema
-- File: supabase/migrations/0009_phase6b_business_foundation.sql
-- FILES ONLY. Applied to STAGING by the OWNER in the Supabase SQL editor.
-- Never applied to production by the AI. Additive: creates new tables +
-- owner-only RLS. Depends on 0001 (approvals) and 0002 (public.is_owner()).
-- Does NOT depend on 0007 or 0008 (both unapplied). Rollback SQL lives in
-- the owner packet (markdown), not here, to keep this file free of
-- destructive statements. Nothing here enables execution, sending, or any
-- live business write path.
--
-- NAMING NOTE: every table here uses a business/sales/quote/project/vendor/
-- installation/payment/communication/agent/approval prefix chosen to avoid
-- the 24 existing/authored tables (23 applied via 0001-0006 incl. owners,
-- plus runtime_roles authored in 0007; see the 0004 command_packets
-- collision incident).
--
-- SIMULATION PINS: quote_versions.simulation_state is CHECK-pinned to
-- 'simulation' and quote_draft_runs pins simulation_only=true and
-- execution_eligible=false at the DB level. Lifting these requires a later
-- owner-gated migration that alters the CHECK constraints (RED gate).

-- ============================================================
-- 1. business_clients - client master records
-- ============================================================
create table if not exists business_clients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  client_type text not null default 'residential'
    check (client_type in
      ('residential','commercial','institution','other')),
  primary_email text,
  primary_phone text,
  notes text,
  source text not null default 'manual',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. business_contacts - people attached to a client
-- ============================================================
create table if not exists business_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references business_clients (id),
  full_name text not null,
  role text,
  email text,
  phone text,
  source text not null default 'manual',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_business_contacts_client
  on business_contacts (client_id);

-- ============================================================
-- 3. business_properties - job sites / addresses
-- ============================================================
create table if not exists business_properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references business_clients (id),
  address_line text not null,
  unit text,
  city text,
  region text not null default 'NYC'
    check (region in ('NYC','NJ','OTHER')),
  postal_code text,
  lpc_review boolean not null default false,
  dob_permit boolean not null default false,
  access_notes text,
  source text not null default 'manual',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_business_properties_client
  on business_properties (client_id);

-- ============================================================
-- 4. sales_leads - pipeline records (lead through won/lost)
-- ============================================================
create table if not exists sales_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references business_clients (id),
  property_id uuid references business_properties (id),
  display_name text not null,
  stage text not null default 'lead'
    check (stage in ('lead','qualified','site_visit','quote_requested',
      'quote_drafted','quote_sent','follow_up','negotiation','won',
      'lost','deferred')),
  stage_changed_at timestamptz not null default now(),
  lead_source text,
  owner_next_action text,
  source text not null default 'manual',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sales_leads_stage
  on sales_leads (stage, stage_changed_at desc);

-- ============================================================
-- 5. quotes - quote master (versions hold the numbers)
-- ============================================================
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references business_clients (id),
  property_id uuid references business_properties (id),
  lead_id uuid references sales_leads (id),
  -- Declared bare here because projects is created later in this
  -- file; the FK is added after both tables exist (see the
  -- constraint block near the end of the file).
  project_id uuid,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','rejected',
      'superseded','archived')),
  current_version integer not null default 0,
  approval_id uuid references approvals (id),
  source text not null default 'agent_simulation',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_quotes_status on quotes (status);
create index if not exists idx_quotes_client on quotes (client_id);

-- ============================================================
-- 6. quote_versions - immutable priced snapshots of a quote
--    All money is integer cents. Rates are integer milli-percent
--    (thousandths of a percent): 8875 = 8.875 pct, so
--    total = subtotal * (100000 + rate) / 100000, matching the
--    owner-ruled 1.08875 NYC multiplier exactly.
--    simulation_state is DB-pinned to 'simulation' in V1.
-- ============================================================
create table if not exists quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id),
  version integer not null check (version >= 1),
  product_line text not null default '',
  scope_type text not null
    check (scope_type in ('installation','product_only')),
  jurisdiction text not null check (jurisdiction in ('NYC','NJ')),
  tax_rate_milli_pct integer not null
    check (tax_rate_milli_pct >= 0),
  material_cents bigint not null default 0
    check (material_cents >= 0),
  labor_cents bigint not null default 0 check (labor_cents >= 0),
  fees_cents bigint not null default 0 check (fees_cents >= 0),
  markup_mode text not null default 'none'
    check (markup_mode in ('none','percent_milli','fixed_cents')),
  markup_value bigint not null default 0 check (markup_value >= 0),
  markup_cents bigint not null default 0 check (markup_cents >= 0),
  subtotal_cents bigint not null default 0
    check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  margin_cents bigint not null default 0,
  payment_schedule jsonb not null default '{}',
  assumptions jsonb not null default '[]',
  exclusions jsonb not null default '[]',
  missing_fields jsonb not null default '[]',
  owner_confirmation_required boolean not null default true,
  st124_tracking jsonb not null default '{}',
  draft_provenance jsonb not null default '{}',
  simulation_state text not null default 'simulation'
    check (simulation_state = 'simulation'),
  approval_id uuid references approvals (id),
  correlation_id text not null,
  created_by text not null default 'quote-draft-agent',
  created_at timestamptz not null default now(),
  unique (quote_id, version)
);
create index if not exists idx_quote_versions_quote
  on quote_versions (quote_id, version desc);

-- ============================================================
-- 7. quote_items - line items of a quote version
-- ============================================================
create table if not exists quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_version_id uuid not null references quote_versions (id),
  position integer not null default 0,
  opening_label text not null default '',
  product_line text not null default '',
  description text not null default '',
  quantity integer not null default 1 check (quantity >= 0),
  unit_material_cents bigint not null default 0
    check (unit_material_cents >= 0),
  unit_labor_cents bigint not null default 0
    check (unit_labor_cents >= 0),
  line_fees_cents bigint not null default 0
    check (line_fees_cents >= 0),
  line_total_cents bigint not null default 0
    check (line_total_cents >= 0),
  item_flags jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists idx_quote_items_version
  on quote_items (quote_version_id, position);

-- ============================================================
-- 8. projects - contracted work
-- ============================================================
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references business_clients (id),
  property_id uuid references business_properties (id),
  quote_id uuid references quotes (id),
  title text not null,
  status text not null default 'pending_contract'
    check (status in ('pending_contract','contracted','in_progress',
      'punch_list','final_inspection','closed','cancelled')),
  contract_status text not null default 'not_signed',
  deposit_status text not null default 'not_received',
  milestone_summary jsonb not null default '{}',
  source text not null default 'manual',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_status on projects (status);

-- ============================================================
-- 9. project_milestones - per-project operational steps
-- ============================================================
create table if not exists project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  kind text not null
    check (kind in ('contract','deposit','measurement','ordering',
      'permit_lpc','permit_dob','delivery','installation','punch_list',
      'final_inspection','final_payment','warranty_closeout')),
  status text not null default 'pending'
    check (status in ('pending','in_progress','blocked','done',
      'not_applicable')),
  due_date date,
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind)
);

-- ============================================================
-- 10. vendor_orders - product orders per project
-- ============================================================
create table if not exists vendor_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  vendor text not null,
  order_number text,
  order_date date,
  expected_ship_date date,
  actual_ship_date date,
  delivery_status text not null default 'not_ordered'
    check (delivery_status in ('not_ordered','ordered','in_production',
      'shipped','delivered','backordered','exception')),
  backordered boolean not null default false,
  exception_note text,
  source text not null default 'manual',
  source_record_id text,
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vendor_orders_status
  on vendor_orders (delivery_status);

-- ============================================================
-- 11. installation_events - scheduled installs per project
-- ============================================================
create table if not exists installation_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  scheduled_date date,
  crew text,
  site_ready boolean not null default false,
  status text not null default 'tentative'
    check (status in ('tentative','scheduled','in_progress','completed',
      'rescheduled','cancelled')),
  note text,
  source text not null default 'manual',
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_installation_events_date
  on installation_events (scheduled_date);

-- ============================================================
-- 12. payment_schedules - deterministic expected payment splits
-- ============================================================
create table if not exists payment_schedules (
  id uuid primary key default gen_random_uuid(),
  quote_version_id uuid references quote_versions (id),
  project_id uuid references projects (id),
  schedule_type text not null
    check (schedule_type in
      ('installation_50_25_25','product_only_75_25')),
  stages jsonb not null default '[]',
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 13. payment_events - append-only recorded payment facts
-- ============================================================
create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id),
  quote_id uuid references quotes (id),
  kind text not null
    check (kind in ('deposit_recorded','payment_recorded',
      'adjustment_recorded')),
  amount_cents bigint not null,
  method text,
  recorded_by text not null default 'owner',
  note text,
  correlation_id text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_events_project
  on payment_events (project_id, created_at desc);

-- ============================================================
-- 14. communication_records - display/draft history only.
--     No 'sent' state exists in V1: nothing in this phase sends.
-- ============================================================
create table if not exists communication_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references business_clients (id),
  project_id uuid references projects (id),
  channel text not null
    check (channel in ('email','sms','whatsapp','phone','in_person',
      'other')),
  direction text not null
    check (direction in ('inbound','outbound_draft')),
  subject text not null default '',
  summary text not null default '',
  occurred_at timestamptz not null default now(),
  source_link text,
  message_state text not null default 'draft'
    check (message_state in ('draft','received','logged')),
  approval_id uuid references approvals (id),
  source text not null default 'manual',
  provenance jsonb not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_communication_records_client
  on communication_records (client_id, occurred_at desc);

-- ============================================================
-- 15. business_activity_events - append-only business ledger
-- ============================================================
create table if not exists business_activity_events (
  id text primary key default gen_random_uuid()::text,
  source text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  summary text not null,
  actor text not null,
  provenance jsonb not null default '{}',
  correlation_id text not null,
  approval_id uuid references approvals (id),
  simulation_state text not null default 'simulation'
    check (simulation_state = 'simulation'),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_business_activity_entity
  on business_activity_events (entity_type, entity_id,
    created_at desc);
create index if not exists idx_business_activity_created
  on business_activity_events (created_at desc);

-- ============================================================
-- 16. agent_recommendations - AI recommendations (advice only)
-- ============================================================
create table if not exists agent_recommendations (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('quote_follow_up','missing_payment',
      'stalled_project','delayed_order','installation_risk',
      'missing_document','margin_anomaly','client_response')),
  entity_type text not null,
  entity_id text not null,
  evidence jsonb not null default '[]',
  assumptions jsonb not null default '[]',
  confidence text not null default 'low'
    check (confidence in ('low','medium','high')),
  suggested_next_step text not null,
  approval_required boolean not null default true,
  status text not null default 'open'
    check (status in ('open','acknowledged','dismissed','superseded')),
  correlation_id text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_agent_recommendations_status
  on agent_recommendations (status, created_at desc);

-- ============================================================
-- 17. quote_draft_runs - append-only agent run records.
--     simulation_only and execution_eligible are DB-pinned.
-- ============================================================
create table if not exists quote_draft_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null default 'quote-draft-agent',
  input jsonb not null default '{}',
  input_missing_fields jsonb not null default '[]',
  quote_id uuid references quotes (id),
  quote_version_id uuid references quote_versions (id),
  status text not null
    check (status in ('completed','failed_validation','failed_error')),
  failure_reason text,
  assumptions jsonb not null default '[]',
  simulation_only boolean not null default true
    check (simulation_only = true),
  execution_eligible boolean not null default false
    check (execution_eligible = false),
  correlation_id text not null,
  idempotency_key text not null unique,
  created_by text not null default 'owner',
  created_at timestamptz not null default now()
);
create index if not exists idx_quote_draft_runs_created
  on quote_draft_runs (created_at desc);

-- ============================================================
-- 18. approval_links - bridge approvals to business entities
-- ============================================================
create table if not exists approval_links (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references approvals (id),
  entity_type text not null,
  entity_id text not null,
  link_kind text not null
    check (link_kind in ('quote_draft_approval',
      'communication_approval','data_change_proposal',
      'agent_recommendation')),
  created_at timestamptz not null default now(),
  unique (approval_id, entity_type, entity_id)
);
create index if not exists idx_approval_links_entity
  on approval_links (entity_type, entity_id);

-- ============================================================
-- RLS: owner-only everywhere via public.is_owner() (0002).
-- Mutable tables: for-all owner policy; explicit grants, and the
-- default-privilege delete is revoked (no hard-delete path; use
-- archived flags).
-- Append-only tables: insert+select policies; update/delete
-- privileges revoked (same pattern as audit_log / os_events).
-- Supabase default privileges hand anon and authenticated broad
-- DML on every new public table, so this file explicitly revokes
-- everything from anon on every table (0001/0003/0004 idiom) -
-- RLS is then the second blocking layer, not the only one.
-- ============================================================

-- Mutable business tables
alter table business_clients enable row level security;
drop policy if exists business_clients_owner_all
  on business_clients;
create policy business_clients_owner_all on business_clients
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on business_clients to authenticated;

alter table business_contacts enable row level security;
drop policy if exists business_contacts_owner_all
  on business_contacts;
create policy business_contacts_owner_all on business_contacts
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on business_contacts to authenticated;

alter table business_properties enable row level security;
drop policy if exists business_properties_owner_all
  on business_properties;
create policy business_properties_owner_all on business_properties
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on business_properties
  to authenticated;

alter table sales_leads enable row level security;
drop policy if exists sales_leads_owner_all on sales_leads;
create policy sales_leads_owner_all on sales_leads
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on sales_leads to authenticated;

alter table quotes enable row level security;
drop policy if exists quotes_owner_all on quotes;
create policy quotes_owner_all on quotes
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on quotes to authenticated;

alter table projects enable row level security;
drop policy if exists projects_owner_all on projects;
create policy projects_owner_all on projects
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on projects to authenticated;

alter table project_milestones enable row level security;
drop policy if exists project_milestones_owner_all
  on project_milestones;
create policy project_milestones_owner_all on project_milestones
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on project_milestones
  to authenticated;

alter table vendor_orders enable row level security;
drop policy if exists vendor_orders_owner_all on vendor_orders;
create policy vendor_orders_owner_all on vendor_orders
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on vendor_orders to authenticated;

alter table installation_events enable row level security;
drop policy if exists installation_events_owner_all
  on installation_events;
create policy installation_events_owner_all
  on installation_events
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on installation_events
  to authenticated;

alter table communication_records enable row level security;
drop policy if exists communication_records_owner_all
  on communication_records;
create policy communication_records_owner_all
  on communication_records
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on communication_records
  to authenticated;

alter table agent_recommendations enable row level security;
drop policy if exists agent_recommendations_owner_all
  on agent_recommendations;
create policy agent_recommendations_owner_all
  on agent_recommendations
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on agent_recommendations
  to authenticated;

-- Append-only or insert-once tables

alter table quote_versions enable row level security;
drop policy if exists quote_versions_owner_ins on quote_versions;
create policy quote_versions_owner_ins on quote_versions
  for insert to authenticated with check (public.is_owner());
drop policy if exists quote_versions_owner_sel on quote_versions;
create policy quote_versions_owner_sel on quote_versions
  for select to authenticated using (public.is_owner());
drop policy if exists quote_versions_owner_upd on quote_versions;
create policy quote_versions_owner_upd on quote_versions
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
-- Column-level update grant: only approval_id may ever change
-- after insert. The priced numbers are immutable at the
-- privilege level, not merely by convention.
grant select, insert on quote_versions to authenticated;
revoke update on quote_versions from authenticated;
grant update (approval_id) on quote_versions to authenticated;

alter table quote_items enable row level security;
drop policy if exists quote_items_owner_ins on quote_items;
create policy quote_items_owner_ins on quote_items
  for insert to authenticated with check (public.is_owner());
drop policy if exists quote_items_owner_sel on quote_items;
create policy quote_items_owner_sel on quote_items
  for select to authenticated using (public.is_owner());
grant select, insert on quote_items to authenticated;
revoke update, delete on quote_items from authenticated;

alter table payment_schedules enable row level security;
drop policy if exists payment_schedules_owner_ins
  on payment_schedules;
create policy payment_schedules_owner_ins on payment_schedules
  for insert to authenticated with check (public.is_owner());
drop policy if exists payment_schedules_owner_sel
  on payment_schedules;
create policy payment_schedules_owner_sel on payment_schedules
  for select to authenticated using (public.is_owner());
grant select, insert on payment_schedules to authenticated;
revoke update, delete on payment_schedules from authenticated;

alter table payment_events enable row level security;
drop policy if exists payment_events_owner_ins on payment_events;
create policy payment_events_owner_ins on payment_events
  for insert to authenticated with check (public.is_owner());
drop policy if exists payment_events_owner_sel on payment_events;
create policy payment_events_owner_sel on payment_events
  for select to authenticated using (public.is_owner());
grant select, insert on payment_events to authenticated;
revoke update, delete on payment_events from authenticated;

alter table business_activity_events enable row level security;
drop policy if exists business_activity_owner_ins
  on business_activity_events;
create policy business_activity_owner_ins
  on business_activity_events
  for insert to authenticated with check (public.is_owner());
drop policy if exists business_activity_owner_sel
  on business_activity_events;
create policy business_activity_owner_sel
  on business_activity_events
  for select to authenticated using (public.is_owner());
grant select, insert on business_activity_events to authenticated;
revoke update, delete on business_activity_events
  from authenticated;

alter table quote_draft_runs enable row level security;
drop policy if exists quote_draft_runs_owner_ins
  on quote_draft_runs;
create policy quote_draft_runs_owner_ins on quote_draft_runs
  for insert to authenticated with check (public.is_owner());
drop policy if exists quote_draft_runs_owner_sel
  on quote_draft_runs;
create policy quote_draft_runs_owner_sel on quote_draft_runs
  for select to authenticated using (public.is_owner());
grant select, insert on quote_draft_runs to authenticated;
revoke update, delete on quote_draft_runs from authenticated;

-- The Approval Center flow for business drafts creates approvals
-- rows from the app (owner session). The approvals table (0001)
-- has owner-only RLS (approvals_owner_all, all commands) but its
-- table privileges were granted ad hoc (select, update only -
-- Phase 1B Stages 5/8). Add the missing insert privilege here so
-- draft-approval requests can be recorded. RLS still restricts
-- every command to the owner; this weakens nothing and folds the
-- privilege history into a tracked migration.
grant insert on approvals to authenticated;

alter table approval_links enable row level security;
drop policy if exists approval_links_owner_ins on approval_links;
create policy approval_links_owner_ins on approval_links
  for insert to authenticated with check (public.is_owner());
drop policy if exists approval_links_owner_sel on approval_links;
create policy approval_links_owner_sel on approval_links
  for select to authenticated using (public.is_owner());
grant select, insert on approval_links to authenticated;
revoke update, delete on approval_links from authenticated;

-- ============================================================
-- Deferred FK: quotes.project_id -> projects(id). Added after
-- both tables exist (quotes is created before projects in this
-- file). Guarded for idempotent re-runs (0008 idiom).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'quotes_project_id_fk'
  ) then
    alter table quotes
      add constraint quotes_project_id_fk
      foreign key (project_id) references projects (id);
  end if;
end $$;

-- ============================================================
-- Privilege hardening (audit F1): strip Supabase default
-- privileges. anon gets nothing on any business table; the
-- mutable tables lose the default delete privilege (records are
-- archived, never hard-deleted). Append-only tables already had
-- update/delete revoked above.
-- ============================================================
revoke all on business_clients from anon;
revoke all on business_contacts from anon;
revoke all on business_properties from anon;
revoke all on sales_leads from anon;
revoke all on quotes from anon;
revoke all on quote_versions from anon;
revoke all on quote_items from anon;
revoke all on projects from anon;
revoke all on project_milestones from anon;
revoke all on vendor_orders from anon;
revoke all on installation_events from anon;
revoke all on payment_schedules from anon;
revoke all on payment_events from anon;
revoke all on communication_records from anon;
revoke all on business_activity_events from anon;
revoke all on agent_recommendations from anon;
revoke all on quote_draft_runs from anon;
revoke all on approval_links from anon;

revoke delete on business_clients from authenticated;
revoke delete on business_contacts from authenticated;
revoke delete on business_properties from authenticated;
revoke delete on sales_leads from authenticated;
revoke delete on quotes from authenticated;
revoke delete on quote_versions from authenticated;
revoke delete on projects from authenticated;
revoke delete on project_milestones from authenticated;
revoke delete on vendor_orders from authenticated;
revoke delete on installation_events from authenticated;
revoke delete on communication_records from authenticated;
revoke delete on agent_recommendations from authenticated;
