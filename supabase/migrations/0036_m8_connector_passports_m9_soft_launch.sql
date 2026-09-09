-- 0036_m8_connector_passports_m9_soft_launch.sql
-- OWNER-APPLIED ONLY (staging first). Status: DRAFT.
-- M8 makes connector authorization/data freshness explicit and fail-closed.
-- M9 persists read-only readiness assessments; it cannot deploy, promote,
-- enable capabilities, or mark production ready.

create table if not exists public.connector_passports (
  connector_id text primary key,
  provider text not null,
  environment text not null check (environment in ('staging','production')),
  mode text not null check (mode in ('sandbox_only','read_only','read_write')),
  health text not null check (health in ('ready','degraded','offline','revoked')),
  account_ref text not null,
  allowed_capabilities text[] not null default '{}',
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  data_as_of timestamptz not null,
  max_age_seconds integer not null
    check (max_age_seconds between 1 and 86400),
  expires_at timestamptz,
  evidence_ref text not null,
  revision integer not null default 1 check (revision >= 1),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (provider, environment, account_ref),
  constraint connector_passport_expiry_order
    check (expires_at is null or expires_at > observed_at)
);
create index if not exists idx_connector_passports_lookup
  on public.connector_passports (provider, environment, observed_at desc);

create table if not exists public.soft_launch_assessments (
  id uuid primary key default gen_random_uuid(),
  build_revision text not null check (build_revision ~ '^[0-9a-f]{7,64}$'),
  status text not null
    check (status in ('BLOCKED','REPOSITORY_READY','STAGING_READY_OWNER_GATED')),
  repository_ready boolean not null,
  staging_ready boolean not null,
  production_ready boolean not null default false
    check (production_ready = false),
  blockers text[] not null default '{}',
  owner_gates text[] not null default '{}',
  evidence_refs text[] not null,
  evaluated_at timestamptz not null,
  evaluated_by text not null,
  created_at timestamptz not null default now(),
  constraint soft_launch_evidence_required
    check (cardinality(evidence_refs) > 0),
  constraint soft_launch_status_consistent check (
    (status = 'BLOCKED' and repository_ready = false and staging_ready = false)
    or (status = 'REPOSITORY_READY' and repository_ready = true and staging_ready = false)
    or (status = 'STAGING_READY_OWNER_GATED' and repository_ready = true and staging_ready = true)
  )
);
create index if not exists idx_soft_launch_assessments_time
  on public.soft_launch_assessments (evaluated_at desc);

alter table public.connector_passports enable row level security;
alter table public.soft_launch_assessments enable row level security;

create policy connector_passports_owner_runtime_sel on public.connector_passports
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
create policy connector_passports_owner_runtime_ins on public.connector_passports
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
create policy connector_passports_owner_runtime_upd on public.connector_passports
  for update to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

create policy soft_launch_assessments_owner_runtime_sel on public.soft_launch_assessments
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
create policy soft_launch_assessments_owner_runtime_ins on public.soft_launch_assessments
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());

revoke all on public.connector_passports from anon;
revoke all on public.connector_passports from authenticated;
grant select, insert, update on public.connector_passports to authenticated;
revoke all on public.soft_launch_assessments from anon;
revoke all on public.soft_launch_assessments from authenticated;
grant select, insert on public.soft_launch_assessments to authenticated;
