-- 0020_runtime_service_identity.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
--
-- WHY: the production runtime (orchestrator/worker/hermes) authenticates
-- with a SEEDED HUMAN-OWNER Supabase session (SUPABASE_RUNTIME_REFRESH_TOKEN).
-- Because that session passes public.is_owner(), the unattended runtime holds
-- FULL owner authority - including execute on
-- public.decide_orchestration_approval (the sole approval-decision path) and
-- WRITE on system_controls (owner_stop / execution_enabled / paused). A
-- machine can self-approve production work and flip its own safety controls.
-- (R-2 forensics 2026-08-19, reports/p2_evidence/r2_rootcause_20260819.txt.)
--
-- FIX: a DEDICATED NON-OWNER service identity for the runtime, scoped to the
-- EXACT table surface the deployed runtime reads/writes (derived from the
-- os-runtime dependency graph: dispatcher/worker/hermes -> store.ts,
-- orchestration/{store,driver,read-model,remote-intake,composer-persist},
-- worker-service, hermes-service, orchestrator, staging-sim).
--
-- EXACT RUNTIME SURFACE (no more, no less) - 16 objects:
--   full CRUD-as-needed (owner OR runtime):
--     master_goals, goal_jobs, job_dependencies(ins+sel),
--     orchestration_approvals(INSERT pending-only + sel),
--     orchestration_decisions(ins+sel), os_jobs, worker_leases,
--     job_attempts(ins+sel), job_checkpoints(ins+sel), dead_letters(ins+sel),
--     runtime_command_packets, repository_worktrees, os_events(ins+sel)
--   narrowed to the exact ops used (least privilege, review notes 1-2):
--     agents (INSERT+UPDATE+SELECT only, no delete; staging-sim upsertAgent),
--     remote_intake_requests (SELECT+UPDATE only; consume pending->consumed)
--   READ-ONLY for the runtime:
--     system_controls (SELECT only; runtime must never write controls)
--
-- DELIBERATELY EXCLUDED (no runtime caller found - least privilege):
--   agent_contracts, locks, telegram_updates, agent_memory, execution_queue.
--
-- LEAST-PRIVILEGE BOUNDARIES KEPT (the point of the fix):
--   - public.decide_orchestration_approval stays public.is_owner()-ONLY. The
--     runtime can PROPOSE pending approvals but can NEVER decide one.
--   - orchestration_approvals: no UPDATE policy/grant for anyone (decide RPC
--     only); INSERT stays born-pending/undecided.
--   - system_controls: WRITE stays owner-only; runtime read-only.
--   - public.owners / public.runtime_services membership: owner-only.
--   - service_role NOT used (it would bypass RLS entirely).
--
-- OWNER STEPS AT PROMOTION (see the packet):
--   a. create a dedicated auth user (e.g. runtime@service.preston) NOT in
--      public.owners;
--   b. register its auth.users.id in public.runtime_services (foot of file);
--   c. re-seed the runtime with THAT user's refresh token and sign out the
--      owner user's sessions.
--
-- Depends on: 0002 (owners/is_owner), 0003 (agents/os_events),
-- 0004 (runtime tables), 0010 (orchestration tables), 0011 (remote intake).

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
-- Defense-in-depth (review note 3): writes are already default-denied (no
-- write policy), but revoke the table privileges too so a future stray policy
-- cannot silently enable them. Membership is managed only via the SQL editor /
-- bootstrap service role.
revoke insert, update, delete on public.runtime_services from authenticated;

-- 2a. mutable operational tables: widen _owner_all to (owner OR runtime) -----
drop policy if exists master_goals_owner_all on master_goals;
create policy master_goals_owner_all on master_goals
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

drop policy if exists goal_jobs_owner_all on goal_jobs;
create policy goal_jobs_owner_all on goal_jobs
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

drop policy if exists os_jobs_owner_all on os_jobs;
create policy os_jobs_owner_all on os_jobs
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

drop policy if exists worker_leases_owner_all on worker_leases;
create policy worker_leases_owner_all on worker_leases
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

drop policy if exists runtime_command_packets_owner_all on runtime_command_packets;
create policy runtime_command_packets_owner_all on runtime_command_packets
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

drop policy if exists repository_worktrees_owner_all on repository_worktrees;
create policy repository_worktrees_owner_all on repository_worktrees
  for all to authenticated
  using (public.is_owner() or public.is_runtime_service())
  with check (public.is_owner() or public.is_runtime_service());

-- agents: the staging-sim worker cycle UPSERTs agent rows (insert+update).
-- Grant the runtime INSERT+UPDATE+SELECT ONLY - never DELETE (review note 1;
-- least privilege). The owner keeps full control via the UNCHANGED
-- agents_owner_all policy from 0003; we only ADD narrow runtime policies.
drop policy if exists agents_runtime_ins on agents;
create policy agents_runtime_ins on agents
  for insert to authenticated with check (public.is_runtime_service());
drop policy if exists agents_runtime_upd on agents;
create policy agents_runtime_upd on agents
  for update to authenticated
  using (public.is_runtime_service()) with check (public.is_runtime_service());
drop policy if exists agents_runtime_sel on agents;
create policy agents_runtime_sel on agents
  for select to authenticated using (public.is_runtime_service());

-- remote_intake_requests: the dispatcher SELECTs pending rows and UPDATEs them
-- to consumed - nothing else. Grant the runtime SELECT+UPDATE ONLY (review
-- note 2): no INSERT (rows are created by submit_remote_intake, a SECURITY
-- DEFINER path), no DELETE (already revoked in 0011). The owner policy
-- remote_intake_requests_owner (0011, role-unqualified + is_owner) is
-- UNCHANGED; we only ADD narrow runtime policies, role-unqualified to match
-- the table's 0011 convention (is_runtime_service is authenticated-only anyway).
drop policy if exists remote_intake_requests_runtime_sel on remote_intake_requests;
create policy remote_intake_requests_runtime_sel on remote_intake_requests
  for select using (public.is_runtime_service());
drop policy if exists remote_intake_requests_runtime_upd on remote_intake_requests;
create policy remote_intake_requests_runtime_upd on remote_intake_requests
  for update
  using (public.is_runtime_service()) with check (public.is_runtime_service());

-- 2b. append-only tables: widen INSERT + SELECT predicates only (no update/
--     delete grant added; 0003/0004 revokes stand) -------------------------
drop policy if exists job_dependencies_owner_ins on job_dependencies;
create policy job_dependencies_owner_ins on job_dependencies
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists job_dependencies_owner_sel on job_dependencies;
create policy job_dependencies_owner_sel on job_dependencies
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

drop policy if exists orch_decisions_owner_ins on orchestration_decisions;
create policy orch_decisions_owner_ins on orchestration_decisions
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists orch_decisions_owner_sel on orchestration_decisions;
create policy orch_decisions_owner_sel on orchestration_decisions
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

drop policy if exists job_attempts_owner_ins on job_attempts;
create policy job_attempts_owner_ins on job_attempts
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists job_attempts_owner_sel on job_attempts;
create policy job_attempts_owner_sel on job_attempts
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

drop policy if exists job_checkpoints_owner_ins on job_checkpoints;
create policy job_checkpoints_owner_ins on job_checkpoints
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists job_checkpoints_owner_sel on job_checkpoints;
create policy job_checkpoints_owner_sel on job_checkpoints
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

drop policy if exists dead_letters_owner_ins on dead_letters;
create policy dead_letters_owner_ins on dead_letters
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists dead_letters_owner_sel on dead_letters;
create policy dead_letters_owner_sel on dead_letters
  for select to authenticated
  using (public.is_owner() or public.is_runtime_service());

-- os_events: the dispatcher/hermes append observation events (insertEvent).
drop policy if exists os_events_owner_insert on os_events;
create policy os_events_owner_insert on os_events
  for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
drop policy if exists os_events_owner_select on os_events;
create policy os_events_owner_select on os_events
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
--  write path and stays is_owner()-only. The runtime CANNOT decide.)

-- 2d. system_controls: runtime gets SELECT ONLY; WRITE stays owner-only -----
-- Keep the owner _all policy as-is (owner full control from 0004). ADD a
-- separate read-only policy for the runtime service. Permissive OR semantics:
-- the runtime can SELECT but has NO insert/update/delete path here.
drop policy if exists system_controls_runtime_sel on system_controls;
create policy system_controls_runtime_sel on system_controls
  for select to authenticated
  using (public.is_runtime_service());

-- 3. OWNER: after creating the dedicated auth user, register it here.
-- Replace the uuid, then run just this statement (idempotent):
--   insert into public.runtime_services (user_id, note)
--   values ('<RUNTIME_SERVICE_USER_UUID>', 'preston runtime (non-owner)')
--   on conflict (user_id) do nothing;
