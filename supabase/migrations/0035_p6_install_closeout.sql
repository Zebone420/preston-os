-- 0035_p6_install_closeout.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 6 (Installation -> Closeout) STATE MODELS + PREDICATE EVIDENCE +
-- document-registration references. FINAL_MASTER_BUILD_PLAN v1 PHASE 6,
-- section 5 (field/closeout artifacts register under the Project ID) and
-- section 19 (customer contact never leaks into vendor-facing material;
-- consequential execution remains Preston-controlled).
--
-- NOTHING in this file moves money, contacts anyone, or places an order.
-- There are NO functions, NO triggers, and NO procedures here.
-- closeout_packages.final_payment_eligible is an ELIGIBILITY FLAG the
-- application evaluates from recorded facts; no collection path exists.
-- warranty_registration / bdf_claims record Andersen program obligations
-- the OWNER fulfils outside this system (Register Install within 90 days
-- of install; BDF invoice upload within 3 months in the calendar year).
--
-- RLS mirrors 0027: owner + runtime service may select/insert. UPDATE on
-- the mutable state tables (crew_assignments, install_states, punch_items,
-- closeout_packages) is owner or runtime (the state-machine adapters run
-- in the runtime and are compare-and-set on the prior state).
-- receiving_events and install_readiness_checks are append-only evidence
-- (no update grant). No delete grant anywhere. No anon access anywhere.
--
-- Depends on: 0002 (is_owner), 0009 (projects), 0020 (is_runtime_service).
-- documents (0029), vendor_orders (0009) and purchase_order_packages (0032)
-- are referenced by uuid only (no FK) so this file applies independently
-- of those registries' rollout state.
-- Rollback: reports/p6_evidence/rollback/rollback_0035.sql.txt (owner packet).

-- ============================================================
-- 1. receiving_events - append-only delivery / receiving log.
--    damage_reported -> remake_requested -> remake_received is the
--    exception branch; the app folds events into a receiving state.
-- ============================================================
create table if not exists public.receiving_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  vendor_order_id uuid,
  po_package_id uuid,
  event text not null
    check (event in ('shipped','delivered','received','inspected',
      'damage_reported','remake_requested','remake_received',
      'backordered','exception')),
  occurred_at timestamptz not null,
  recorded_by text not null,
  line_items jsonb not null default '[]',
  photos_document_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_receiving_events_project
  on public.receiving_events (project_id, occurred_at);

-- ============================================================
-- 2. install_readiness_checks - append-only predicate evidence.
-- ============================================================
create table if not exists public.install_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  evaluated_at timestamptz not null default now(),
  predicates jsonb not null,
  all_ok boolean not null default false,
  blocked_by text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_install_readiness_checks_project
  on public.install_readiness_checks (project_id, evaluated_at desc);

-- ============================================================
-- 3. crew_assignments - proposal -> confirmed -> in_progress ->
--    completed | cancelled. site_access jsonb: contact role,
--    instructions, coi_required, building_rules_document_id.
-- ============================================================
create table if not exists public.crew_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  crew_id text not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  site_access jsonb not null default '{}',
  state text not null default 'proposed'
    check (state in ('proposed','confirmed','in_progress','completed',
      'cancelled')),
  confirmed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);
create index if not exists idx_crew_assignments_project
  on public.crew_assignments (project_id, scheduled_start);

-- ============================================================
-- 4. install_states - one row per project; forward-only chain.
-- ============================================================
create table if not exists public.install_states (
  project_id uuid primary key references public.projects (id),
  state text not null default 'not_ready'
    check (state in ('not_ready','ready','scheduled','in_progress',
      'installed','punch_open','punch_closed','closed_out',
      'warranty_registered','archived')),
  state_changed_at timestamptz not null default now(),
  evidence jsonb not null default '{}'
);

-- ============================================================
-- 5. punch_items - punch list. waived_by_owner is legal only for
--    cosmetic severity (enforced in app + CHECK below).
-- ============================================================
create table if not exists public.punch_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  description text not null,
  opening_code text,
  severity text not null
    check (severity in ('cosmetic','functional','safety')),
  photo_document_ids uuid[] not null default '{}',
  state text not null default 'open'
    check (state in ('open','in_progress','resolved','waived_by_owner')),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  check (state <> 'waived_by_owner' or severity = 'cosmetic')
);
create index if not exists idx_punch_items_project
  on public.punch_items (project_id, state);

-- ============================================================
-- 6. closeout_packages - one per project. Document references are
--    registry ids (documents.id) - registration under the Project ID
--    is the documents module's job. final_payment_eligible is a flag.
-- ============================================================
create table if not exists public.closeout_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  completion_certificate_document_id uuid,
  final_photos_document_ids uuid[] not null default '{}',
  warranty_registration jsonb not null default '{}',
  bdf_claims jsonb not null default '[]',
  review_survey jsonb not null default '{}',
  final_payment_eligible boolean not null default false,
  final_payment_evaluated_at timestamptz,
  archived_at timestamptz,
  state text not null default 'open'
    check (state in ('open','pending_final_payment','complete','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

-- ============================================================
-- RLS: owner + runtime service select/insert on every table (0027
-- pattern). Update policies only on the mutable state tables. Every
-- table: revoke all from anon, revoke defaults from authenticated,
-- then grant exactly what the policies allow. NO delete grant.
-- ============================================================

-- receiving_events (append-only)
alter table public.receiving_events enable row level security;
drop policy if exists receiving_events_owner_runtime_sel
  on public.receiving_events;
create policy receiving_events_owner_runtime_sel
  on public.receiving_events
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists receiving_events_owner_runtime_ins
  on public.receiving_events;
create policy receiving_events_owner_runtime_ins
  on public.receiving_events
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.receiving_events from anon;
revoke all on public.receiving_events from authenticated;
grant select, insert on public.receiving_events to authenticated;

-- install_readiness_checks (append-only)
alter table public.install_readiness_checks enable row level security;
drop policy if exists install_readiness_checks_owner_runtime_sel
  on public.install_readiness_checks;
create policy install_readiness_checks_owner_runtime_sel
  on public.install_readiness_checks
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists install_readiness_checks_owner_runtime_ins
  on public.install_readiness_checks;
create policy install_readiness_checks_owner_runtime_ins
  on public.install_readiness_checks
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.install_readiness_checks from anon;
revoke all on public.install_readiness_checks from authenticated;
grant select, insert on public.install_readiness_checks to authenticated;

-- crew_assignments (mutable state)
alter table public.crew_assignments enable row level security;
drop policy if exists crew_assignments_owner_runtime_sel
  on public.crew_assignments;
create policy crew_assignments_owner_runtime_sel
  on public.crew_assignments
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists crew_assignments_owner_runtime_ins
  on public.crew_assignments;
create policy crew_assignments_owner_runtime_ins
  on public.crew_assignments
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists crew_assignments_owner_runtime_upd
  on public.crew_assignments;
create policy crew_assignments_owner_runtime_upd
  on public.crew_assignments
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.crew_assignments from anon;
revoke all on public.crew_assignments from authenticated;
grant select, insert, update on public.crew_assignments to authenticated;

-- install_states (mutable state)
alter table public.install_states enable row level security;
drop policy if exists install_states_owner_runtime_sel
  on public.install_states;
create policy install_states_owner_runtime_sel
  on public.install_states
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists install_states_owner_runtime_ins
  on public.install_states;
create policy install_states_owner_runtime_ins
  on public.install_states
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists install_states_owner_runtime_upd
  on public.install_states;
create policy install_states_owner_runtime_upd
  on public.install_states
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.install_states from anon;
revoke all on public.install_states from authenticated;
grant select, insert, update on public.install_states to authenticated;

-- punch_items (mutable state)
alter table public.punch_items enable row level security;
drop policy if exists punch_items_owner_runtime_sel
  on public.punch_items;
create policy punch_items_owner_runtime_sel
  on public.punch_items
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists punch_items_owner_runtime_ins
  on public.punch_items;
create policy punch_items_owner_runtime_ins
  on public.punch_items
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists punch_items_owner_runtime_upd
  on public.punch_items;
create policy punch_items_owner_runtime_upd
  on public.punch_items
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.punch_items from anon;
revoke all on public.punch_items from authenticated;
grant select, insert, update on public.punch_items to authenticated;

-- closeout_packages (mutable state)
alter table public.closeout_packages enable row level security;
drop policy if exists closeout_packages_owner_runtime_sel
  on public.closeout_packages;
create policy closeout_packages_owner_runtime_sel
  on public.closeout_packages
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists closeout_packages_owner_runtime_ins
  on public.closeout_packages;
create policy closeout_packages_owner_runtime_ins
  on public.closeout_packages
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists closeout_packages_owner_runtime_upd
  on public.closeout_packages;
create policy closeout_packages_owner_runtime_upd
  on public.closeout_packages
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.closeout_packages from anon;
revoke all on public.closeout_packages from authenticated;
grant select, insert, update on public.closeout_packages to authenticated;
