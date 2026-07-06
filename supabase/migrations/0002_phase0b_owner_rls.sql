-- PRESTON AI POWERSTATION - Phase 0B owner-only RLS tightening
-- File: supabase/migrations/0002_phase0b_owner_rls.sql
-- FILES ONLY. Applied to STAGING by the OWNER in the Supabase SQL editor.
-- Never applied to production by the AI. Non-destructive: swaps policies and
-- adds an owners allowlist table; no data is dropped or mutated.
-- The service role bypasses RLS by design (server-side Command Gateway).

-- ============================================================
-- 1. Owner allowlist table + is_owner() helper
-- ============================================================
create table if not exists owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

alter table owners enable row level security;

create or replace function public.is_owner()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.owners o where o.user_id = auth.uid()
  );
$$;

-- owners is readable only by an owner. No authenticated write policy exists,
-- so authenticated cannot insert/update/delete owners. The bootstrap insert
-- (section 4) runs in the SQL editor as service role and bypasses this.
drop policy if exists owners_select_owner on owners;
create policy owners_select_owner on owners
  for select
  to authenticated
  using (public.is_owner());

-- ============================================================
-- 2. Replace permissive "*_auth_all" policies with owner-only
-- ============================================================
drop policy if exists tasks_auth_all on tasks;
drop policy if exists approvals_auth_all on approvals;
drop policy if exists department_configs_auth_all on department_configs;
drop policy if exists briefs_auth_all on briefs;
drop policy if exists command_packets_auth_all on command_packets;

create policy tasks_owner_all on tasks
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy approvals_owner_all on approvals
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy department_configs_owner_all on department_configs
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy briefs_owner_all on briefs
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy command_packets_owner_all on command_packets
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ============================================================
-- 3. Append-only tables: keep insert+select only, now owner-scoped
-- ============================================================
drop policy if exists audit_log_auth_insert on audit_log;
drop policy if exists audit_log_auth_select on audit_log;

create policy audit_log_owner_insert on audit_log
  for insert
  to authenticated
  with check (public.is_owner());

create policy audit_log_owner_select on audit_log
  for select
  to authenticated
  using (public.is_owner());

drop policy if exists access_events_auth_insert on access_events;
drop policy if exists access_events_auth_select on access_events;

create policy access_events_owner_insert on access_events
  for insert
  to authenticated
  with check (public.is_owner());

create policy access_events_owner_select on access_events
  for select
  to authenticated
  using (public.is_owner());

-- update/delete on audit_log and access_events remain revoked from 0001;
-- the append-only guarantee is unchanged by this migration.

-- ============================================================
-- 4. Bootstrap (COMMENTED - owner runs manually once)
-- ============================================================
-- Create the owner auth user first: Supabase dashboard -> Authentication ->
-- Add user (email + password). Then uncomment and run the block below in the
-- SQL editor to grant that user owner access. It runs as service role and so
-- bypasses the owners RLS write restriction.
--
-- insert into owners (user_id, note)
-- select id, 'primary owner'
-- from auth.users
-- where email = 'info@preston.nyc'
-- on conflict (user_id) do nothing;
