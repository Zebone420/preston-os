-- ============================================================
-- 0007_phase5h_runtime_roles.sql
-- Phase 5H: least-privilege runtime identities (OWNER-REVIEWED; apply only at
-- the identity-hardening gate, AFTER the staging drill has passed on the
-- owner-allowlisted scheme).
--
-- Replaces the owner-equivalent staging service identities with two bounded
-- roles. A runtime identity is an auth user registered in runtime_roles as
-- 'worker' or 'hermes' and NOT present in public.owners. Policies below are
-- ADDITIVE (Postgres ORs permissive policies): owners keep full access via the
-- existing is_owner() policies; runtime roles gain exactly what the dispatcher
-- code paths need and nothing else.
--
-- What each role can do:
--   worker: SELECT system_controls/os_jobs/worker_leases/job_checkpoints/agents;
--           UPDATE os_jobs; INSERT+UPDATE worker_leases; INSERT job_attempts/
--           job_checkpoints/dead_letters; upsert its agents row.
--   hermes: SELECT system_controls/os_jobs/runtime_command_packets/agents;
--           INSERT orchestration_decisions/os_events; upsert its agents row.
-- What NEITHER role can do (no policy grants it): read or write approvals,
-- owners, audit_log, agent_memory, locks, execution_queue, telegram_updates,
-- or any legacy business table; UPDATE system_controls (execution/kill stay
-- owner-only); DELETE anywhere (no delete privilege exists on these tables).
--
-- This migration also closes the audited H2 gap: without the runtime SELECT
-- policy on system_controls, a non-owner identity's db-health probe reads zero
-- rows and fails, and readSystemControls silently fails closed forever.
-- Additive-safe: new table, new function, new policies only. No existing
-- policy, grant, or row is modified or removed.
-- ============================================================

-- 1. Role registry (owner-managed).
create table if not exists runtime_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('worker','hermes')),
  created_at timestamptz not null default now()
);
alter table runtime_roles enable row level security;
create policy runtime_roles_owner_all on runtime_roles
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, delete on runtime_roles to authenticated;

-- 2. Role resolver (security definer so RLS on runtime_roles does not block
--    the lookup itself; search_path pinned).
create or replace function public.runtime_role() returns text
  language sql stable security definer set search_path = public as $$
  select r.role from public.runtime_roles r where r.user_id = auth.uid();
$$;

-- 3. READ policies required by the dispatcher code paths (H2 fix included).
create policy system_controls_runtime_sel on system_controls
  for select to authenticated
  using (public.runtime_role() in ('worker','hermes'));
create policy os_jobs_runtime_sel on os_jobs
  for select to authenticated
  using (public.runtime_role() in ('worker','hermes'));
create policy agents_runtime_sel on agents
  for select to authenticated
  using (public.runtime_role() in ('worker','hermes'));
create policy worker_leases_worker_sel on worker_leases
  for select to authenticated
  using (public.runtime_role() = 'worker');
create policy job_checkpoints_worker_sel on job_checkpoints
  for select to authenticated
  using (public.runtime_role() = 'worker');
create policy runtime_command_packets_hermes_sel on runtime_command_packets
  for select to authenticated
  using (public.runtime_role() = 'hermes');

-- 4. WRITE policies - the exact mutation set the staging simulation performs.
create policy os_jobs_worker_upd on os_jobs
  for update to authenticated
  using (public.runtime_role() = 'worker')
  with check (public.runtime_role() = 'worker' and execution_enabled = false);
create policy worker_leases_worker_ins on worker_leases
  for insert to authenticated
  with check (public.runtime_role() = 'worker');
create policy worker_leases_worker_upd on worker_leases
  for update to authenticated
  using (public.runtime_role() = 'worker')
  with check (public.runtime_role() = 'worker');
create policy job_attempts_worker_ins on job_attempts
  for insert to authenticated
  with check (public.runtime_role() = 'worker');
create policy job_checkpoints_worker_ins on job_checkpoints
  for insert to authenticated
  with check (public.runtime_role() = 'worker');
create policy dead_letters_worker_ins on dead_letters
  for insert to authenticated
  with check (public.runtime_role() = 'worker');
create policy orchestration_decisions_hermes_ins on orchestration_decisions
  for insert to authenticated
  with check (public.runtime_role() = 'hermes');
create policy os_events_hermes_ins on os_events
  for insert to authenticated
  with check (public.runtime_role() = 'hermes');
create policy agents_runtime_ins on agents
  for insert to authenticated
  with check (public.runtime_role() in ('worker','hermes'));
create policy agents_runtime_upd on agents
  for update to authenticated
  using (public.runtime_role() in ('worker','hermes'))
  with check (public.runtime_role() in ('worker','hermes'));
