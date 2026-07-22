-- PRESTON AI OS - Phase 7 orchestration data model
-- File: supabase/migrations/0010_phase7_orchestration.sql
-- FILES ONLY. Applied to STAGING by the OWNER in the Supabase SQL editor.
-- Never applied to production by the AI. Additive: new tables + owner-only
-- RLS. Depends on 0001 (approvals) and 0002 (public.is_owner()). Does NOT
-- depend on 0007/0008. Rollback SQL lives in the owner packet (markdown), not
-- here. Nothing here enables execution, sending, or any live path.
--
-- Naming: master_goals / goal_jobs / job_dependencies / agent_contracts /
-- orchestration_approvals - all new, distinct from the 24 existing tables.
--
-- SIMULATION PINS (DB-level CHECK): master_goals.simulation_only = true,
-- master_goals.environment = 'staging', goal_jobs.executed = false. Lifting
-- any of these requires a later owner-gated RED migration.

-- ============================================================
-- 1. master_goals - top-level owner-issued goals (staging, simulation)
-- ============================================================
create table if not exists master_goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  objective text not null,
  source text not null
    check (source in ('chatgpt','telegram','dashboard','owner_cli')),
  requested_by text not null,
  status text not null default 'proposed'
    check (status in ('proposed','decomposed','running','blocked',
      'completed','failed','cancelled','dead_lettered')),
  environment text not null default 'staging'
    check (environment = 'staging'),
  budget jsonb not null default '{}',
  correlation_id text not null,
  simulation_only boolean not null default true
    check (simulation_only = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_master_goals_status
  on master_goals (status, created_at desc);

-- ============================================================
-- 2. goal_jobs - decomposed, dependency-ordered jobs (simulation)
-- ============================================================
create table if not exists goal_jobs (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references master_goals (id),
  kind text not null
    check (kind in ('documentation','code','test','migration','audit',
      'repair','recommendation','unknown')),
  title text not null,
  objective text not null default '',
  risk_class text not null default 'GREEN'
    check (risk_class in ('GREEN','YELLOW','RED','BLACK')),
  assigned_role text
    check (assigned_role in ('chatgpt','claude','codex','hermes','audit')),
  status text not null default 'pending'
    check (status in ('pending','ready','assigned','in_progress',
      'awaiting_review','awaiting_approval','completed','failed',
      'cancelled','dead_lettered')),
  attempts integer not null default 0,
  requires_approval boolean not null default false,
  approval_id uuid references approvals (id),
  runtime_job_id uuid references os_jobs (id),
  correlation_id text not null,
  evidence_refs jsonb not null default '[]',
  failure_reason text,
  executed boolean not null default false
    check (executed = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_goal_jobs_goal
  on goal_jobs (goal_id, status);

-- ============================================================
-- 3. job_dependencies - explicit dependency edges (append-only)
-- ============================================================
create table if not exists job_dependencies (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references master_goals (id),
  job_id uuid not null references goal_jobs (id),
  depends_on_job_id uuid not null references goal_jobs (id),
  created_at timestamptz not null default now(),
  unique (job_id, depends_on_job_id),
  check (job_id <> depends_on_job_id)
);
create index if not exists idx_job_dependencies_job
  on job_dependencies (job_id);

-- ============================================================
-- 4. agent_contracts - default-deny capability registry (owner-managed)
-- ============================================================
create table if not exists agent_contracts (
  role text primary key
    check (role in ('chatgpt','claude','codex','hermes','audit')),
  version text not null default '1.0.0',
  capabilities jsonb not null default '[]',
  prohibitions jsonb not null default '[]',
  max_risk text not null default 'GREEN'
    check (max_risk in ('GREEN','YELLOW','RED','BLACK')),
  environment_scope text not null default 'staging'
    check (environment_scope = 'staging'),
  write_scope text not null default 'none'
    check (write_scope in ('none','worktree_only')),
  network_scope text not null default 'none'
    check (network_scope = 'none'),
  can_approve boolean not null default false
    check (can_approve = false),
  max_concurrent_jobs integer not null default 1,
  timeout_ms integer not null default 60000,
  max_retries integer not null default 1,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 5. orchestration_approvals - one-time, scoped mobile approvals
--    (distinct from the 0001 approvals table, which the Approval
--    Center uses; this holds the Phase 7 orchestration approval
--    lifecycle with hash-binding + expiry).
-- ============================================================
create table if not exists orchestration_approvals (
  approval_id text primary key,
  goal_id uuid references master_goals (id),
  job_id uuid references goal_jobs (id),
  action text not null,
  environment text not null default 'staging'
    check (environment = 'staging'),
  affected_resource text not null,
  reason text not null default '',
  risk_class text not null
    check (risk_class in ('GREEN','YELLOW','RED','BLACK')),
  evidence_refs jsonb not null default '[]',
  expected_effect text not null default '',
  rollback_plan text not null,
  action_hash text not null,
  owner_identity text not null,
  nonce text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired','more_info')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  unique (nonce)
);
create index if not exists idx_orchestration_approvals_status
  on orchestration_approvals (status, expires_at);

-- ============================================================
-- RLS: owner-only via public.is_owner(); anon fully revoked; no
-- table grants delete. master_goals/goal_jobs/agent_contracts are
-- mutable (owner). job_dependencies/orchestration_approvals are
-- insert+select append-style (approvals update status via a narrow
-- owner update policy).
-- ============================================================

alter table master_goals enable row level security;
drop policy if exists master_goals_owner_all on master_goals;
create policy master_goals_owner_all on master_goals
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on master_goals to authenticated;

alter table goal_jobs enable row level security;
drop policy if exists goal_jobs_owner_all on goal_jobs;
create policy goal_jobs_owner_all on goal_jobs
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on goal_jobs to authenticated;

alter table agent_contracts enable row level security;
drop policy if exists agent_contracts_owner_all on agent_contracts;
create policy agent_contracts_owner_all on agent_contracts
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on agent_contracts to authenticated;

alter table job_dependencies enable row level security;
drop policy if exists job_dependencies_owner_ins on job_dependencies;
create policy job_dependencies_owner_ins on job_dependencies
  for insert to authenticated with check (public.is_owner());
drop policy if exists job_dependencies_owner_sel on job_dependencies;
create policy job_dependencies_owner_sel on job_dependencies
  for select to authenticated using (public.is_owner());
grant select, insert on job_dependencies to authenticated;
revoke update, delete on job_dependencies from authenticated;

alter table orchestration_approvals enable row level security;
drop policy if exists orch_approvals_owner_ins on orchestration_approvals;
create policy orch_approvals_owner_ins on orchestration_approvals
  for insert to authenticated with check (public.is_owner());
drop policy if exists orch_approvals_owner_sel on orchestration_approvals;
create policy orch_approvals_owner_sel on orchestration_approvals
  for select to authenticated using (public.is_owner());
drop policy if exists orch_approvals_owner_upd on orchestration_approvals;
create policy orch_approvals_owner_upd on orchestration_approvals
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update on orchestration_approvals to authenticated;

-- ============================================================
-- Strip Supabase default privileges: anon gets nothing; mutable
-- tables lose the default delete privilege (records are cancelled/
-- dead-lettered by status, never hard-deleted).
-- ============================================================
revoke all on master_goals from anon;
revoke all on goal_jobs from anon;
revoke all on job_dependencies from anon;
revoke all on agent_contracts from anon;
revoke all on orchestration_approvals from anon;

revoke delete on master_goals from authenticated;
revoke delete on goal_jobs from authenticated;
revoke delete on agent_contracts from authenticated;
revoke delete on orchestration_approvals from authenticated;
