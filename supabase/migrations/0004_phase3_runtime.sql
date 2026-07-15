-- PRESTON AI OS - Phase 3 distributed runtime schema
-- File: supabase/migrations/0004_phase3_runtime.sql
-- FILES ONLY. Applied to STAGING by the OWNER in the Supabase SQL editor.
-- Never applied to production by the AI. Additive: creates new tables + owner-
-- only RLS. Depends on 0002 (public.is_owner()) and 0003. Rollback SQL lives in
-- the owner packet (markdown), not here, to keep this file free of destructive
-- statements. Nothing here activates a worker, Hermes, or execution.
--
-- NAMING NOTE: the Phase 3 command-intake table is runtime_command_packets, a
-- DISTINCT name chosen to avoid colliding with the legacy public.command_packets
-- table created in 0001 (a different schema, no expires_at). The legacy table is
-- left completely untouched by this migration. The first 0004 attempt named this
-- table 'command_packets', so CREATE TABLE IF NOT EXISTS silently matched the
-- legacy table and the expires_at index then failed (42703). Renamed here.

-- ============================================================
-- 1. runtime_command_packets - unified command intake (all sources)
-- ============================================================
create table if not exists runtime_command_packets (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  source text not null
    check (source in ('chatgpt','telegram','dashboard','owner_cli','claude','codex','hermes','scheduler')),
  requested_action text not null,
  action_class text not null check (action_class in ('GREEN','YELLOW','RED','BLACK')),
  target_project text not null,
  target_repository text not null,
  requested_scope text not null default '',
  expected_outcome text not null default '',
  constraints text[] not null default '{}',
  approval_required boolean not null default true,
  execution_eligible boolean not null default false, -- default-deny
  correlation_id text not null,
  idempotency_key text not null unique,              -- dedup
  status text not null default 'proposed'
    check (status in ('proposed','validated','rejected','expired','superseded')),
  audit_ref uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_runtime_command_packets_status on runtime_command_packets (status, expires_at);

-- ============================================================
-- 2. os_jobs - job queue lifecycle
-- ============================================================
create table if not exists os_jobs (
  id uuid primary key default gen_random_uuid(),
  command_id uuid references runtime_command_packets (id),
  approval_id uuid,
  status text not null default 'proposed'
    check (status in ('proposed','validated','awaiting_approval','approved','queued',
      'leased','running','checkpointed','completed','failed','cancelled','expired','dead_lettered')),
  risk_class text not null default 'GREEN' check (risk_class in ('GREEN','YELLOW','RED','BLACK')),
  priority integer not null default 0,
  not_before timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  timeout_ms integer not null default 60000,
  retry_backoff_ms integer not null default 1000,
  idempotency_key text not null unique,
  correlation_id text not null,
  checkpoint_ref uuid,
  result_ref uuid,
  error_class text,
  execution_enabled boolean not null default false, -- fail-closed
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_os_jobs_status on os_jobs (status, priority desc, not_before);
create index if not exists idx_os_jobs_lease_exp on os_jobs (lease_expires_at);

-- ============================================================
-- 3. worker_leases - lease ownership (one active worker per job)
-- ============================================================
create table if not exists worker_leases (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references os_jobs (id),
  owner text not null,        -- worker/agent id
  token text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (job_id)             -- at most one lease row per job
);
create index if not exists idx_worker_leases_exp on worker_leases (expires_at);

-- ============================================================
-- 4. job_attempts - append-only attempt log
-- ============================================================
create table if not exists job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references os_jobs (id),
  attempt_no integer not null,
  worker text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('completed','failed','cancelled','timeout')),
  error_class text,
  correlation_id text not null
);
create index if not exists idx_job_attempts_job on job_attempts (job_id, attempt_no);

-- ============================================================
-- 5. job_checkpoints - append-only resumable checkpoints
-- ============================================================
create table if not exists job_checkpoints (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references os_jobs (id),
  agent_id text not null,
  phase text,
  gate text,
  base_commit text,
  current_commit text,
  status text not null,
  detail jsonb not null default '{}'::jsonb,  -- conclusions/evidence only; no CoT
  correlation_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_job_checkpoints_job on job_checkpoints (job_id, created_at desc);

-- ============================================================
-- 6. dead_letters - append-only terminal failures
-- ============================================================
create table if not exists dead_letters (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  command_id uuid,
  reason text not null,
  error_class text,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. repository_worktrees - shared repo / worktree coordination
-- ============================================================
create table if not exists repository_worktrees (
  id text primary key,        -- wt-<job>
  repo text not null,
  path text not null,
  agent text,
  job_id uuid,
  base_commit text not null default '',
  target_branch text not null default 'master',
  status text not null default 'unassigned'
    check (status in ('unassigned','allocated','in_use','dirty','verified','cleanup_pending')),
  dirty boolean not null default false,
  staged boolean not null default false,
  untracked boolean not null default false,
  lock_id text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 8. orchestration_decisions - append-only Hermes decision log
-- ============================================================
create table if not exists orchestration_decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  hermes_mode text not null,
  decision text not null check (decision in ('dispatch','propose','observe','reject','noop')),
  reasons text[] not null default '{}',
  correlation_id text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 9. system_controls - single-row global runtime gate (fail-closed)
-- ============================================================
create table if not exists system_controls (
  id text primary key default 'global',
  execution_enabled boolean not null default false,
  owner_stop boolean not null default false,
  paused boolean not null default false,
  hermes_mode text not null default 'disabled'
    check (hermes_mode in ('disabled','observe_only','propose_only','dispatch_eligible','paused','stopped')),
  remote_runner_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint system_controls_singleton check (id = 'global')
);

-- ============================================================
-- 10. RLS - owner-only everywhere
-- ============================================================
alter table runtime_command_packets enable row level security;
alter table os_jobs enable row level security;
alter table worker_leases enable row level security;
alter table job_attempts enable row level security;
alter table job_checkpoints enable row level security;
alter table dead_letters enable row level security;
alter table repository_worktrees enable row level security;
alter table orchestration_decisions enable row level security;
alter table system_controls enable row level security;

-- Mutable tables: owner-only, all operations.
create policy runtime_command_packets_owner_all on runtime_command_packets
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy os_jobs_owner_all on os_jobs
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy worker_leases_owner_all on worker_leases
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy repository_worktrees_owner_all on repository_worktrees
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy system_controls_owner_all on system_controls
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Append-only tables: owner insert + select only.
create policy job_attempts_owner_ins on job_attempts
  for insert to authenticated with check (public.is_owner());
create policy job_attempts_owner_sel on job_attempts
  for select to authenticated using (public.is_owner());
create policy job_checkpoints_owner_ins on job_checkpoints
  for insert to authenticated with check (public.is_owner());
create policy job_checkpoints_owner_sel on job_checkpoints
  for select to authenticated using (public.is_owner());
create policy dead_letters_owner_ins on dead_letters
  for insert to authenticated with check (public.is_owner());
create policy dead_letters_owner_sel on dead_letters
  for select to authenticated using (public.is_owner());
create policy orch_decisions_owner_ins on orchestration_decisions
  for insert to authenticated with check (public.is_owner());
create policy orch_decisions_owner_sel on orchestration_decisions
  for select to authenticated using (public.is_owner());

-- Append-only privilege enforcement.
revoke update, delete on job_attempts from authenticated, anon;
revoke update, delete on job_checkpoints from authenticated, anon;
revoke update, delete on dead_letters from authenticated, anon;
revoke update, delete on orchestration_decisions from authenticated, anon;

-- ============================================================
-- 11. Grants (authenticated/owner only; never anon)
-- ============================================================
grant select, insert, update on runtime_command_packets to authenticated;
grant select, insert, update on os_jobs to authenticated;
grant select, insert, update on worker_leases to authenticated;
grant select, insert, update on repository_worktrees to authenticated;
grant select, insert, update on system_controls to authenticated;
grant select, insert on job_attempts to authenticated;
grant select, insert on job_checkpoints to authenticated;
grant select, insert on dead_letters to authenticated;
grant select, insert on orchestration_decisions to authenticated;
-- Nothing to anon. Future workers use the service role (bypasses RLS); the
-- service-role key is never added to the dashboard app.
