-- PRESTON AI OS - Phase 2 distributed operating-state schema
-- File: supabase/migrations/0003_phase2_ai_os_core.sql
-- FILES ONLY. Applied to STAGING by the OWNER in the Supabase SQL editor.
-- Never applied to production by the AI. Non-destructive: only creates new
-- tables + owner-only RLS. Depends on 0002 (public.is_owner()).
--
-- Operational state for the multi-agent OS: agent registry, shared memory,
-- distributed locks, execution pipeline queue, and an append-only event log.
-- All owner-only via public.is_owner(). Future autonomous WORKERS use the
-- service role (which bypasses RLS by design); the service-role key is NEVER
-- placed in the dashboard app. Execution remains disabled/fail-closed in code.

-- ============================================================
-- 1. agents - central AI registry
-- ============================================================
create table if not exists agents (
  id text primary key,                        -- stable slug, e.g. 'claude-code'
  display_name text not null,
  provider text not null
    check (provider in ('anthropic','openai','preston','mcp','other')),
  model text not null,
  capabilities text[] not null default '{}',
  allowed_connectors text[] not null default '{}',
  status text not null default 'offline'
    check (status in ('offline','idle','working','blocked','error')),
  current_task_id uuid,
  last_seen timestamptz,
  version text not null default '0.0.0',
  owner text not null default 'owner',
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. agent_memory - shared structured memory (append-only, versioned)
-- ============================================================
create table if not exists agent_memory (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null
    check (memory_type in ('project','architecture','decision','task',
      'execution','deployment','connector','agent','checkpoint','conversation')),
  key text not null,
  value jsonb not null default '{}'::jsonb,   -- structured; never secrets
  actor text not null,
  source text not null,
  version integer not null default 1 check (version >= 1),
  correlation_id text not null,
  audit_ref uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_memory_type_key
  on agent_memory (memory_type, key, version desc);

-- ============================================================
-- 3. locks - distributed locks (always expire; owner recorded)
-- ============================================================
create table if not exists locks (
  id text primary key,                        -- `${scope}:${resource}`
  scope text not null
    check (scope in ('task','approval','document','repository',
      'deployment','execution')),
  resource text not null,
  owner text not null,                        -- agent id holding the lock
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null             -- no permanent locks
);
create index if not exists idx_locks_expires on locks (expires_at);

-- ============================================================
-- 4. execution_queue - the execution pipeline (fail-closed by default)
-- ============================================================
create table if not exists execution_queue (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid,                             -- links to a command packet
  stage text not null default 'requested'
    check (stage in ('requested','validation','safety_review',
      'approval_decision','execution_intent','execution_queue','worker_lease',
      'execution_attempt','execution_result','rollback','audit')),
  state text not null default 'pending'
    check (state in ('pending','advancing','blocked','done','failed','rolled_back')),
  risk_class text not null default 'GREEN'
    check (risk_class in ('GREEN','YELLOW','RED','BLACK')),
  approved boolean not null default false,
  execution_enabled boolean not null default false,  -- fail-closed default
  worker_lease text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_exec_queue_stage on execution_queue (stage, state);

-- ============================================================
-- 5. os_events - append-only event bus log
-- ============================================================
create table if not exists os_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  actor text not null,
  correlation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_os_events_created on os_events (created_at);

-- ============================================================
-- 6. Row Level Security - owner-only on every table
-- ============================================================
alter table agents enable row level security;
alter table agent_memory enable row level security;
alter table locks enable row level security;
alter table execution_queue enable row level security;
alter table os_events enable row level security;

-- Mutable control-plane tables: owner-only for all operations.
create policy agents_owner_all on agents
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy locks_owner_all on locks
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy execution_queue_owner_all on execution_queue
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Append-only tables: owner insert + select only (no update/delete policy).
create policy agent_memory_owner_insert on agent_memory
  for insert to authenticated with check (public.is_owner());
create policy agent_memory_owner_select on agent_memory
  for select to authenticated using (public.is_owner());

create policy os_events_owner_insert on os_events
  for insert to authenticated with check (public.is_owner());
create policy os_events_owner_select on os_events
  for select to authenticated using (public.is_owner());

-- Enforce append-only at the privilege level too.
revoke update, delete on agent_memory from authenticated, anon;
revoke update, delete on os_events from authenticated, anon;

-- ============================================================
-- 7. Grants for the authenticated (owner) role
-- ============================================================
-- Mutable tables: the owner dashboard needs read + write on the control plane.
grant select, insert, update, delete on agents to authenticated;
grant select, insert, update, delete on locks to authenticated;
grant select, insert, update on execution_queue to authenticated;
-- Append-only tables: insert + select only.
grant select, insert on agent_memory to authenticated;
grant select, insert on os_events to authenticated;
-- NOTE: nothing is granted to anon. Future autonomous workers use the service
-- role (bypasses RLS); the service-role key is never added to the app.
