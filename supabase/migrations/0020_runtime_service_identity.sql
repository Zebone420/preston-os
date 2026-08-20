-- 0020_runtime_service_identity.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
--
-- WHY: the production runtime (orchestrator/worker/hermes) authenticates
-- with a SEEDED HUMAN-OWNER Supabase session (SUPABASE_RUNTIME_REFRESH_TOKEN).
-- Because that session passes public.is_owner(), the unattended runtime holds
-- FULL owner authority - including execute on
-- public.decide_orchestration_approval, the sole approval-decision path, and
-- WRITE on system_controls (owner_stop / execution_enabled / paused). That
-- violates least privilege: a machine can self-approve production work and
-- flip its own safety controls. (R-2 forensics 2026-08-19,
-- reports/p2_evidence/r2_rootcause_20260819.txt.)
--
-- FIX: a DEDICATED NON-OWNER service identity for the runtime.
--   1. public.runtime_services allowlist (owner-managed, like public.owners)
--   2. public.is_runtime_service() helper (mirrors is_owner)
--   3. widen the tables the runtime OPERATES to (is_owner OR is_runtime_service)
--   4. system_controls: runtime gets SELECT ONLY (read controls) - it can
--      NEVER write owner_stop/execution_enabled/paused.
--
-- LEAST-PRIVILEGE BOUNDARIES DELIBERATELY KEPT (the point of the fix):
--   - public.decide_orchestration_approval stays public.is_owner()-ONLY.
--     is_runtime_service() is NOT added to it -> the runtime can PROPOSE
--     pending approvals but can NEVER decide one.
--   - orchestration_approvals: no UPDATE policy/grant for anyone (decide RPC
--     only); INSERT stays born-pending/undecided.
--   - system_controls: WRITE stays owner-only; runtime read-only.
--   - public.owners, public.runtime_services membership: owner-only.
--   - Phase-2 legacy tables (agents, agent_memory, execution_queue, locks,
--     os_events) are NOT widened - the Phase-7 runtime does not use them.
--
-- NOTE ON service_role: a Supabase service_role key is deliberately NOT used
-- - it bypasses RLS and could UPDATE orchestration_approvals / system_controls
-- directly. A dedicated NON-owner AUTHENTICATED USER stays subject to RLS.
--
-- OWNER STEPS AT PROMOTION (also in the go-live report handoff):
--   a. create a dedicated auth user (e.g. runtime@service.preston) - NOT in
--      public.owners;
--   b. register its auth.users.id in public.runtime_services (statement at
--      the foot of this file);
--   c. re-seed the runtime with THAT user's refresh token and revoke the
--      owner session.
--
-- Depends on: 0002 (owners/is_owner), 0004 (runtime tables + policies),
-- 0010 (orchestration tables + policies).

-- 1. allowlist + helper -----------------------------------------------------
create table if not exists public.runtime_services (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);
alter table public.runtime_services enable row level security;

create or replace function public.is_runtime_service()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.runtime_services s where s.user_id = auth.uid()
  );
$$;

drop policy if exists runtime_services_select_owner on public.runtime_services;
create policy runtime_services_select_owner on public.runtime_services
  for select to authenticated using (public.is_owner());
revoke all on public.runtime_services from anon;

-- 2a. mutable operational tables: widen _owner_all to (owner OR runtime) -----
-- master_goals
drop policy if exists master_goals_owner_all on master_goals;
create policy master_goals_owner_all on master_goals
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- goal_jobs
drop policy if exists goal_jobs_owner_all on goal_jobs;
create policy goal_jobs_owner_all on goal_jobs
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- agent_contracts
drop policy if exists agent_contracts_owner_all on agent_contracts;
create policy agent_contracts_owner_all on agent_contracts
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- os_jobs
drop policy if exists os_jobs_owner_all on os_jobs;
create policy os_jobs_owner_all on os_jobs
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- worker_leases
drop policy if exists worker_leases_owner_all on worker_leases;
create policy worker_leases_owner_all on worker_leases
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- runtime_command_packets
drop policy if exists runtime_command_packets_owner_all on runtime_command_packets;
create policy runtime_command_packets_owner_all on runtime_command_packets
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- repository_worktrees
drop policy if exists repository_worktrees_owner_all on repository_worktrees;
create policy repository_worktrees_owner_all on repository_worktrees
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- 2b. append-only tables: widen the INSERT + SELECT predicates only ---------
-- (no update/delete grant is added; revokes from 0004/0010 stand)
-- job_dependencies
drop policy if exists job_dependencies_owner_ins on job_dependencies;
create policy job_dependencies_owner_ins on job_dependencies
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists job_dependencies_owner_sel on job_dependencies;
create policy job_dependencies_owner_sel on job_dependencies
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

-- orchestration_decisions
drop policy if exists orch_decisions_owner_ins on orchestration_decisions;
create policy orch_decisions_owner_ins on orchestration_decisions
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists orch_decisions_owner_sel on orchestration_decisions;
create policy orch_decisions_owner_sel on orchestration_decisions
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

-- job_attempts
drop policy if exists job_attempts_owner_ins on job_attempts;
create policy job_attempts_owner_ins on job_attempts
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists job_attempts_owner_sel on job_attempts;
create policy job_attempts_owner_sel on job_attempts
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

-- job_checkpoints
drop policy if exists job_checkpoints_owner_ins on job_checkpoints;
create policy job_checkpoints_owner_ins on job_checkpoints
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists job_checkpoints_owner_sel on job_checkpoints;
create policy job_checkpoints_owner_sel on job_checkpoints
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

-- dead_letters
drop policy if exists dead_letters_owner_ins on dead_letters;
create policy dead_letters_owner_ins on dead_letters
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists dead_letters_owner_sel on dead_letters;
create policy dead_letters_owner_sel on dead_letters
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

-- 2c. orchestration_approvals: PROPOSE (insert pending) + read; NEVER decide
drop policy if exists orch_approvals_owner_ins on orchestration_approvals;
create policy orch_approvals_owner_ins on orchestration_approvals
  for insert to authenticated with check (
    (public.is_owner() or public.is_runtime_service())
    and status = 'pending'
    and nonce is null
    and decided_at is null
  );
drop policy if exists orch_approvals_owner_sel on orchestration_approvals;
create policy orch_approvals_owner_sel on orchestration_approvals
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
-- (No UPDATE policy / no UPDATE grant - unchanged. decide RPC is the only
--  write path and it stays is_owner()-only. The runtime CANNOT decide.)

-- 2d. system_controls: runtime gets SELECT ONLY; WRITE stays owner-only -----
-- Keep the owner _all policy as-is (owner full control). ADD a separate
-- read-only policy for the runtime service. Permissive OR semantics mean the
-- runtime can SELECT but has NO insert/update/delete path here -> it can read
-- owner_stop/execution_enabled/paused but can never flip them.
drop policy if exists system_controls_runtime_sel on system_controls;
create policy system_controls_runtime_sel on system_controls
  for select to authenticated
  using (public.is_runtime_service());

-- 3. OWNER: after creating the dedicated auth user, register it here.
-- Replace the uuid, then run just this statement (idempotent):
--   insert into public.runtime_services (user_id, note)
--   values ('<RUNTIME_SERVICE_USER_UUID>', 'preston runtime (non-owner)')
--   on conflict (user_id) do nothing;
