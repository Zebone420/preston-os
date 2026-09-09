-- 0032_p5_order_chain_safe_models.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 5 (Contract -> Payment -> Final Measure -> Order) SAFE units:
-- STATE MODELS AND PREDICATE EVIDENCE ONLY. FINAL_MASTER_BUILD_PLAN v1
-- PHASE 5, section 11 (STEP_UP binding) and section 19 (owner rules:
-- 50/25/25 installation, 75/25 product-only, final measure no sooner than
-- 3 business days after signing, no PO before final measure, PO uses final
-- measured sizes only, material changes trigger change order, client
-- contact never leaks into vendor material, DocuSign retained).
--
-- NOTHING in this file moves money, sends an envelope, or places an order.
-- There are NO functions, NO triggers, and NO procedures here. Every
-- consequential transition (contract completion, payment receipt, PO
-- placement) is recorded as a STATE that the owner or a verified provider
-- event drove; the application layer cannot reach a provider from these
-- rows. purchase_order_packages.placed_by_owner is a RECORD of an owner
-- action taken outside this system, never a command.
--
-- RLS mirrors 0027: owner + runtime service may select/insert. UPDATE on
-- the mutable state tables is owner or runtime (state-machine adapters run
-- in the runtime); UPDATE on contract_templates and purchase_order_packages
-- is owner-only (template approval and PO approval/placement are owner
-- decisions). contract_provider_events and order_readiness_checks are
-- append-only evidence (no update grant). No delete grant anywhere. No anon
-- access anywhere.
--
-- Depends on: 0002 (is_owner), 0009 (projects, quote_versions),
-- 0020 (is_runtime_service). documents (0029) is referenced by id only
-- (registry ref, no FK, so this file applies even if 0029 is not yet
-- applied to the target environment).

-- ============================================================
-- 1. contract_templates - approved template registry
-- ============================================================
create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null check (version >= 1),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  document_id uuid,
  required_forms text[] not null default '{}',
  approved_by text,
  approved_at timestamptz,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (name, version),
  check (is_current = false
         or (approved_by is not null and approved_at is not null))
);
create index if not exists idx_contract_templates_current
  on public.contract_templates (name, is_current);

-- ============================================================
-- 2. contracts - one row per envelope; completion requires a
--    verified provider event (DB-pinned).
-- ============================================================
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  quote_version_id uuid references public.quote_versions (id),
  template_id uuid not null references public.contract_templates (id),
  template_sha256 text not null
    check (template_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null default 'docusign'
    check (provider in ('docusign')),
  provider_envelope_id text unique,
  state text not null default 'drafted'
    check (state in ('drafted','sent','viewed','completed','voided',
                     'expired','superseded')),
  signed_at timestamptz,
  provider_event_verified boolean not null default false,
  payload_hash text not null default ''
    check (payload_hash = '' or payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'completed' or provider_event_verified),
  check (state <> 'completed' or signed_at is not null)
);
create index if not exists idx_contracts_project
  on public.contracts (project_id, created_at desc);

-- ============================================================
-- 3. contract_provider_events - append-only provider evidence.
--    provider_event_id is UNIQUE: a replayed webhook is rejected
--    at the DB, so a duplicate can never re-drive a transition.
-- ============================================================
create table if not exists public.contract_provider_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  provider_event_id text not null unique,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}',
  verified boolean not null default false,
  received_at timestamptz not null default now()
);
create index if not exists idx_contract_provider_events_contract
  on public.contract_provider_events (contract_id, occurred_at);

-- ============================================================
-- 4. payment_expectations - what is owed per milestone, bound to
--    project + contract + quote hash + amount (plan section 11).
--    Records EXPECTATION and RECEIPT state only. No money moves.
-- ============================================================
create table if not exists public.payment_expectations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  contract_id uuid not null references public.contracts (id),
  plan_type text not null
    check (plan_type in ('installation_50_25_25','product_only_75_25')),
  milestone text not null
    check (milestone in ('deposit','pre_install','final','pre_order')),
  sequence integer not null check (sequence >= 1),
  expected_amount_cents bigint not null
    check (expected_amount_cents >= 0),
  contract_amount_cents bigint not null
    check (contract_amount_cents >= 0),
  quote_hash text not null,
  state text not null default 'expected'
    check (state in ('expected','partially_received','received',
                     'waived_by_owner','overdue')),
  received_cents bigint not null default 0 check (received_cents >= 0),
  reconciliation_state text not null default 'unreconciled'
    check (reconciliation_state in
           ('unreconciled','reconciled','mismatch')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, milestone)
);
create index if not exists idx_payment_expectations_project
  on public.payment_expectations (project_id, sequence);

-- ============================================================
-- 5. final_measurements - versioned measured openings. Only a
--    source='final_measure' row can ever be approved; estimate and
--    intake dimensions are storable for comparison but can never
--    feed a PO (DB-pinned by the status/source CHECK).
-- ============================================================
create table if not exists public.final_measurements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  contract_id uuid not null references public.contracts (id),
  version integer not null check (version >= 1),
  source text not null default 'final_measure'
    check (source in ('final_measure','estimate','intake')),
  measured_at timestamptz not null,
  measured_by text not null,
  openings jsonb not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  approved_by text,
  approved_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','superseded')),
  supersedes_id uuid references public.final_measurements (id),
  created_at timestamptz not null default now(),
  unique (project_id, version),
  check (jsonb_typeof(openings) = 'array'),
  check (status <> 'approved' or source = 'final_measure'),
  check (status <> 'approved'
         or (approved_by is not null and approved_at is not null))
);

-- ============================================================
-- 6. change_orders - required whenever configuration, size,
--    material, or scope changes between measurement versions.
-- ============================================================
create table if not exists public.change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  contract_id uuid not null references public.contracts (id),
  reason text not null
    check (reason in ('configuration_change','size_change',
                      'material_change','scope_change')),
  from_measurement_id uuid references public.final_measurements (id),
  to_measurement_id uuid references public.final_measurements (id),
  delta jsonb not null default '{}',
  state text not null default 'proposed'
    check (state in ('proposed','owner_review','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_change_orders_project_state
  on public.change_orders (project_id, state);

-- ============================================================
-- 7. order_readiness_checks - append-only predicate evidence.
--    predicates: { name: { ok, reason } }. all_ok is stored, not
--    derived, so the row is exactly what the evaluator saw.
-- ============================================================
create table if not exists public.order_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  evaluated_at timestamptz not null,
  predicates jsonb not null,
  all_ok boolean not null default false,
  po_hash text,
  blocked_by text[] not null default '{}',
  created_at timestamptz not null default now(),
  check (jsonb_typeof(predicates) = 'object'),
  check (all_ok = false or cardinality(blocked_by) = 0)
);
create index if not exists idx_order_readiness_checks_project
  on public.order_readiness_checks (project_id, evaluated_at desc);

-- ============================================================
-- 8. purchase_order_packages - PREPARED vendor packages. The state
--    'placed_by_owner' records that the OWNER placed the order
--    outside this system; nothing here transmits anything.
-- ============================================================
create table if not exists public.purchase_order_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  contract_id uuid not null references public.contracts (id),
  measurement_id uuid not null
    references public.final_measurements (id),
  configuration_hash text not null
    check (configuration_hash ~ '^[0-9a-f]{64}$'),
  po_hash text not null unique check (po_hash ~ '^[0-9a-f]{64}$'),
  document_id uuid,
  vendor text not null,
  line_items jsonb not null default '[]',
  sold_to jsonb not null default '{}',
  ship_to jsonb not null default '{}',
  state text not null default 'prepared'
    check (state in ('prepared','owner_review','approved_for_placement',
                     'placed_by_owner','cancelled')),
  prepared_at timestamptz not null default now(),
  approved_by text,
  placed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(line_items) = 'array'),
  check (state <> 'placed_by_owner' or placed_at is not null),
  check (state not in ('approved_for_placement','placed_by_owner')
         or approved_by is not null)
);
create index if not exists idx_purchase_order_packages_project
  on public.purchase_order_packages (project_id, state);

-- ============================================================
-- RLS + privileges (0027 idiom). Supabase default privileges hand
-- anon/authenticated broad DML on new public tables, so every
-- table is explicitly revoked first; RLS is the second layer.
-- ============================================================

-- contract_templates: owner+runtime read/insert, owner-only update
alter table public.contract_templates enable row level security;
drop policy if exists contract_templates_owner_runtime_sel
  on public.contract_templates;
create policy contract_templates_owner_runtime_sel
  on public.contract_templates
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists contract_templates_owner_runtime_ins
  on public.contract_templates;
create policy contract_templates_owner_runtime_ins
  on public.contract_templates
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists contract_templates_owner_upd
  on public.contract_templates;
create policy contract_templates_owner_upd on public.contract_templates
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
revoke all on public.contract_templates from anon;
revoke all on public.contract_templates from authenticated;
grant select, insert, update on public.contract_templates
  to authenticated;

-- contracts: owner+runtime read/insert/update (state adapters)
alter table public.contracts enable row level security;
drop policy if exists contracts_owner_runtime_sel on public.contracts;
create policy contracts_owner_runtime_sel on public.contracts
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists contracts_owner_runtime_ins on public.contracts;
create policy contracts_owner_runtime_ins on public.contracts
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists contracts_owner_runtime_upd on public.contracts;
create policy contracts_owner_runtime_upd on public.contracts
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.contracts from anon;
revoke all on public.contracts from authenticated;
grant select, insert, update on public.contracts to authenticated;

-- contract_provider_events: append-only evidence
alter table public.contract_provider_events enable row level security;
drop policy if exists contract_provider_events_owner_runtime_sel
  on public.contract_provider_events;
create policy contract_provider_events_owner_runtime_sel
  on public.contract_provider_events
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists contract_provider_events_owner_runtime_ins
  on public.contract_provider_events;
create policy contract_provider_events_owner_runtime_ins
  on public.contract_provider_events
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.contract_provider_events from anon;
revoke all on public.contract_provider_events from authenticated;
grant select, insert on public.contract_provider_events
  to authenticated;

-- payment_expectations: owner+runtime read/insert/update
alter table public.payment_expectations enable row level security;
drop policy if exists payment_expectations_owner_runtime_sel
  on public.payment_expectations;
create policy payment_expectations_owner_runtime_sel
  on public.payment_expectations
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists payment_expectations_owner_runtime_ins
  on public.payment_expectations;
create policy payment_expectations_owner_runtime_ins
  on public.payment_expectations
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists payment_expectations_owner_runtime_upd
  on public.payment_expectations;
create policy payment_expectations_owner_runtime_upd
  on public.payment_expectations
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.payment_expectations from anon;
revoke all on public.payment_expectations from authenticated;
grant select, insert, update on public.payment_expectations
  to authenticated;

-- final_measurements: owner+runtime read/insert/update
alter table public.final_measurements enable row level security;
drop policy if exists final_measurements_owner_runtime_sel
  on public.final_measurements;
create policy final_measurements_owner_runtime_sel
  on public.final_measurements
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists final_measurements_owner_runtime_ins
  on public.final_measurements;
create policy final_measurements_owner_runtime_ins
  on public.final_measurements
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists final_measurements_owner_runtime_upd
  on public.final_measurements;
create policy final_measurements_owner_runtime_upd
  on public.final_measurements
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.final_measurements from anon;
revoke all on public.final_measurements from authenticated;
grant select, insert, update on public.final_measurements
  to authenticated;

-- change_orders: owner+runtime read/insert/update
alter table public.change_orders enable row level security;
drop policy if exists change_orders_owner_runtime_sel
  on public.change_orders;
create policy change_orders_owner_runtime_sel on public.change_orders
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists change_orders_owner_runtime_ins
  on public.change_orders;
create policy change_orders_owner_runtime_ins on public.change_orders
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists change_orders_owner_runtime_upd
  on public.change_orders;
create policy change_orders_owner_runtime_upd on public.change_orders
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.change_orders from anon;
revoke all on public.change_orders from authenticated;
grant select, insert, update on public.change_orders to authenticated;

-- order_readiness_checks: append-only evidence
alter table public.order_readiness_checks enable row level security;
drop policy if exists order_readiness_checks_owner_runtime_sel
  on public.order_readiness_checks;
create policy order_readiness_checks_owner_runtime_sel
  on public.order_readiness_checks
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists order_readiness_checks_owner_runtime_ins
  on public.order_readiness_checks;
create policy order_readiness_checks_owner_runtime_ins
  on public.order_readiness_checks
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.order_readiness_checks from anon;
revoke all on public.order_readiness_checks from authenticated;
grant select, insert on public.order_readiness_checks to authenticated;

-- purchase_order_packages: owner+runtime read/insert, owner-only
-- update (approval for placement and the placed-by-owner record
-- are owner decisions).
alter table public.purchase_order_packages enable row level security;
drop policy if exists purchase_order_packages_owner_runtime_sel
  on public.purchase_order_packages;
create policy purchase_order_packages_owner_runtime_sel
  on public.purchase_order_packages
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists purchase_order_packages_owner_runtime_ins
  on public.purchase_order_packages;
create policy purchase_order_packages_owner_runtime_ins
  on public.purchase_order_packages
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists purchase_order_packages_owner_upd
  on public.purchase_order_packages;
create policy purchase_order_packages_owner_upd
  on public.purchase_order_packages
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
revoke all on public.purchase_order_packages from anon;
revoke all on public.purchase_order_packages from authenticated;
grant select, insert, update on public.purchase_order_packages
  to authenticated;
