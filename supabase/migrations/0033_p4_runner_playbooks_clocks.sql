-- 0033_p4_runner_playbooks_clocks.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
-- Phase 4 (Sales Autopilot) foundations, FINAL MASTER BUILD PLAN v1
-- sections 2.5 (deterministic business runner), 9 (versioned TypeScript
-- playbooks), PHASE 4 (follow-up clocks, scheduling minimum, normalized
-- openings/scope, Andersen Knowledge Core v1 STRUCTURE).
--
-- Tables:
--   playbook_registry  - one row per (playbook_id, version); the sha256 of
--                        the canonical declaration pins what was reviewed.
--   playbook_runs      - resumable run state; the step cursor is the CAS
--                        key; evidence is append-only jsonb.
--   follow_up_clocks   - 24h / 48h / weekly touch clocks. The clock never
--                        auto-closes a deal: after max touches it lands in
--                        owner_final_call (plan PHASE 4 Follow-up).
--   openings           - normalized measure input (inch decimals). Source
--                        estimate/intake_form rows are pricing-estimate only;
--                        PO material comes from final_measure rows only
--                        (plan section 19: PO uses final measured sizes).
--   andersen_catalog   - Andersen Knowledge Core v1 STRUCTURE only. Rows
--                        carry provenance (fact_id + source_citation); this
--                        migration seeds NO product data. Only verified or
--                        authorized rows may drive a configuration violation.
--
-- RLS mirrors 0027: owner + runtime service may select/insert; update is
-- owner + runtime (runs/clocks advance from the runtime); anon fully
-- revoked; NO delete grant on any table.
--
-- Depends on: 0002 (is_owner), 0020 (is_runtime_service).
-- No foreign keys across lanes (project_id / fact_id are uuid references
-- by convention, matching 0028-0032).

-- ---------------------------------------------------------------------
-- playbook_registry
-- ---------------------------------------------------------------------
create table if not exists public.playbook_registry (
  playbook_id text not null check (playbook_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  version integer not null check (version >= 1),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  allowed_capabilities text[] not null default '{}',
  approval_classes jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  registered_at timestamptz not null default now(),
  registered_by text not null default 'runtime',
  primary key (playbook_id, version)
);

alter table public.playbook_registry enable row level security;

drop policy if exists playbook_registry_owner_runtime_sel
  on public.playbook_registry;
create policy playbook_registry_owner_runtime_sel on public.playbook_registry
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists playbook_registry_owner_runtime_ins
  on public.playbook_registry;
create policy playbook_registry_owner_runtime_ins on public.playbook_registry
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
-- Enabling a playbook is an owner decision only.
drop policy if exists playbook_registry_owner_upd on public.playbook_registry;
create policy playbook_registry_owner_upd on public.playbook_registry
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.playbook_registry from anon;
revoke all on public.playbook_registry from authenticated;
grant select, insert, update on public.playbook_registry to authenticated;

-- ---------------------------------------------------------------------
-- playbook_runs
-- ---------------------------------------------------------------------
create table if not exists public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  playbook_id text not null,
  version integer not null check (version >= 1),
  project_id uuid,
  trigger_ref text not null,
  state text not null default 'running'
    check (state in ('running','waiting','blocked','completed',
                     'failed','cancelled')),
  step_cursor integer not null default 0 check (step_cursor >= 0),
  waiting_for text,
  wait_until timestamptz,
  evidence jsonb not null default '[]'::jsonb,
  last_error text,
  idempotency_key text not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists uq_playbook_runs_idempotency_key
  on public.playbook_runs (idempotency_key);
create index if not exists idx_playbook_runs_project
  on public.playbook_runs (project_id, updated_at);
create index if not exists idx_playbook_runs_waiting
  on public.playbook_runs (state, wait_until);

alter table public.playbook_runs enable row level security;

drop policy if exists playbook_runs_owner_runtime_sel on public.playbook_runs;
create policy playbook_runs_owner_runtime_sel on public.playbook_runs
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists playbook_runs_owner_runtime_ins on public.playbook_runs;
create policy playbook_runs_owner_runtime_ins on public.playbook_runs
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists playbook_runs_owner_runtime_upd on public.playbook_runs;
create policy playbook_runs_owner_runtime_upd on public.playbook_runs
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

revoke all on public.playbook_runs from anon;
revoke all on public.playbook_runs from authenticated;
grant select, insert, update on public.playbook_runs to authenticated;

-- ---------------------------------------------------------------------
-- follow_up_clocks
-- ---------------------------------------------------------------------
create table if not exists public.follow_up_clocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  subject_type text not null
    check (subject_type in ('quote','proposal','lead','vendor_quote')),
  subject_id uuid not null,
  schedule text not null check (schedule in ('h24','h48','weekly')),
  started_at timestamptz not null default now(),
  next_due_at timestamptz,
  last_touch_at timestamptz,
  touches integer not null default 0 check (touches >= 0),
  max_touches integer not null check (max_touches >= 1 and max_touches <= 12),
  state text not null default 'armed'
    check (state in ('armed','due','paused','owner_final_call',
                     'closed_lost','closed_won','stopped')),
  stopped_reason text,
  updated_at timestamptz not null default now(),
  constraint chk_follow_up_clocks_touch_bound check (touches <= max_touches)
);

create index if not exists idx_follow_up_clocks_due
  on public.follow_up_clocks (state, next_due_at);
create index if not exists idx_follow_up_clocks_subject
  on public.follow_up_clocks (subject_type, subject_id);

alter table public.follow_up_clocks enable row level security;

drop policy if exists follow_up_clocks_owner_runtime_sel
  on public.follow_up_clocks;
create policy follow_up_clocks_owner_runtime_sel on public.follow_up_clocks
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists follow_up_clocks_owner_runtime_ins
  on public.follow_up_clocks;
create policy follow_up_clocks_owner_runtime_ins on public.follow_up_clocks
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists follow_up_clocks_owner_runtime_upd
  on public.follow_up_clocks;
create policy follow_up_clocks_owner_runtime_upd on public.follow_up_clocks
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

revoke all on public.follow_up_clocks from anon;
revoke all on public.follow_up_clocks from authenticated;
grant select, insert, update on public.follow_up_clocks to authenticated;

-- ---------------------------------------------------------------------
-- openings (normalized measure input)
-- ---------------------------------------------------------------------
create table if not exists public.openings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  opening_code text not null check (opening_code ~ '^[A-Z]{1,3}[0-9]{2,3}$'),
  room text,
  location_note text,
  width_in numeric(8,3) not null check (width_in > 0),
  height_in numeric(8,3) not null check (height_in > 0),
  unit_type text not null,
  joined_units text not null default 'single'
    check (joined_units in ('single','double','triple')),
  configuration jsonb not null default '{}'::jsonb,
  source text not null
    check (source in ('estimate','intake_form','site_visit','final_measure')),
  not_for_po boolean not null default true,
  measured_at timestamptz,
  measured_by text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  -- Only a final_measure row may be PO material (plan section 19).
  constraint chk_openings_po_source
    check (not_for_po = true or source = 'final_measure')
);

create unique index if not exists uq_openings_project_code_version
  on public.openings (project_id, opening_code, version);

alter table public.openings enable row level security;

drop policy if exists openings_owner_runtime_sel on public.openings;
create policy openings_owner_runtime_sel on public.openings
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists openings_owner_runtime_ins on public.openings;
create policy openings_owner_runtime_ins on public.openings
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
-- Openings are versioned, not edited: a re-measure inserts version+1.
-- No update policy and no update grant.

revoke all on public.openings from anon;
revoke all on public.openings from authenticated;
grant select, insert on public.openings to authenticated;

-- ---------------------------------------------------------------------
-- andersen_catalog (structure only; NO product data seeded here)
-- ---------------------------------------------------------------------
create table if not exists public.andersen_catalog (
  id uuid primary key default gen_random_uuid(),
  series text not null,
  unit_type text not null,
  attribute text not null,
  value text not null,
  constraint_kind text not null
    check (constraint_kind in ('availability','size_min','size_max',
                               'compatibility','hardware','glass',
                               'grille','color')),
  constraint_value jsonb not null default '{}'::jsonb,
  fact_id uuid,
  source_citation jsonb not null default '{}'::jsonb,
  state text not null default 'candidate'
    check (state in ('candidate','verified','authorized')),
  created_at timestamptz not null default now(),
  -- A verified/authorized row must point at the knowledge fact that
  -- carries its citation; candidates may be pending linkage.
  constraint chk_andersen_catalog_provenance
    check (state = 'candidate' or fact_id is not null)
);

create unique index if not exists uq_andersen_catalog_key
  on public.andersen_catalog (series, unit_type, attribute, value,
                              constraint_kind);
create index if not exists idx_andersen_catalog_series
  on public.andersen_catalog (series, unit_type);

alter table public.andersen_catalog enable row level security;

drop policy if exists andersen_catalog_owner_runtime_sel
  on public.andersen_catalog;
create policy andersen_catalog_owner_runtime_sel on public.andersen_catalog
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
drop policy if exists andersen_catalog_owner_runtime_ins
  on public.andersen_catalog;
create policy andersen_catalog_owner_runtime_ins on public.andersen_catalog
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
-- State promotion (candidate -> verified -> authorized) is owner-only.
drop policy if exists andersen_catalog_owner_upd on public.andersen_catalog;
create policy andersen_catalog_owner_upd on public.andersen_catalog
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.andersen_catalog from anon;
revoke all on public.andersen_catalog from authenticated;
grant select, insert, update on public.andersen_catalog to authenticated;
