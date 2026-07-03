-- PRESTON AI POWERSTATION - Phase 0A core schema
-- FILES ONLY in Phase 0A. Applied to STAGING by the OWNER at Gate 0A-5.
-- Never applied to production by the AI. No destructive statements.

create extension if not exists pgcrypto;

-- 1. tasks
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  title text not null,
  description text,
  requested_by text not null
    check (requested_by in
      ('owner','staff','chatgpt','claude','codex','n8n')),
  department text,
  status text not null default 'draft'
    check (status in
      ('draft','pending_approval','approved','executing',
       'done','failed','cancelled')),
  action_class text not null default 'GREEN'
    check (action_class in ('GREEN','YELLOW','RED')),
  environment text not null default 'test_dev'
    check (environment in ('test_dev','staging','production')),
  mode text not null default 'read_only'
    check (mode in
      ('read_only','draft_only','approved_write',
       'automated_low_risk','forbidden')),
  payload jsonb,
  result jsonb,
  approval_id uuid
);
create index if not exists idx_tasks_status on tasks (status);

-- 2. approvals
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  task_id uuid references tasks (id),
  requested_action text not null,
  action_class text not null
    check (action_class in ('GREEN','YELLOW','RED')),
  approver text not null default 'owner',
  decision text not null default 'pending'
    check (decision in
      ('pending','approved','rejected','expired')),
  decision_at timestamptz,
  explicit_confirmation boolean not null default false,
  notes text
);

-- 3. audit_log (append-only: no update/delete policies)
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  actor text not null,
  actor_type text,
  action text not null,
  action_class text
    check (action_class in ('GREEN','YELLOW','RED')),
  environment text
    check (environment in ('test_dev','staging','production')),
  task_id uuid,
  production_touched boolean not null default false,
  write_actions_performed boolean not null default false,
  secrets_exposed boolean not null default false,
  rollback_note text,
  detail jsonb
);
create index if not exists idx_audit_log_created on audit_log (created_at);

-- 4. department_configs
create table if not exists department_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  name text not null unique,
  phase text,
  trigger_desc text,
  data_sources jsonb,
  model_tier text,
  token_budget integer,
  allowed_actions jsonb,
  approval_class text,
  output_contract jsonb,
  measurement_fields jsonb,
  active boolean not null default false
);

-- 5. briefs
create table if not exists briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  department text not null,
  brief_date date not null,
  content_md text,
  content_json jsonb,
  read_by_owner boolean not null default false,
  read_at timestamptz,
  tokens_used integer,
  unique (department, brief_date)
);

-- 6. command_packets (mirrors Master Plan section 5 packet shape)
create table if not exists command_packets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  task_id uuid,
  requested_by text not null
    check (requested_by in
      ('owner','staff','chatgpt','claude','codex','n8n')),
  environment text not null
    check (environment in ('test_dev','staging','production')),
  action_class text not null
    check (action_class in ('GREEN','YELLOW','RED')),
  mode text not null
    check (mode in
      ('read_only','draft_only','approved_write',
       'automated_low_risk','forbidden')),
  allowed_systems jsonb,
  forbidden_systems jsonb,
  allowed_actions jsonb,
  forbidden_actions jsonb,
  requires_owner_approval boolean not null default true,
  approval_id uuid,
  rollback_note text,
  max_runtime_seconds integer,
  production_touched boolean not null default false,
  write_actions_performed boolean not null default false,
  status text not null default 'received',
  result jsonb
);

-- 7. access_events (append-only; credential NAMES only, never values)
create table if not exists access_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  created_at timestamptz not null default now(),
  system text not null,
  credential_name text
    check (credential_name is null
           or credential_name ~ '^[A-Z0-9_]{1,64}$'),
  event text not null
    check (event in
      ('granted','used','denied','revoked','rotated')),
  actor text not null,
  environment text
    check (environment in ('test_dev','staging','production')),
  detail jsonb
);

-- Row Level Security: enabled everywhere from day one.
-- Staging-permissive policies for the authenticated role; tightened to
-- owner-only auth at Phase 0B. The service role bypasses RLS by design
-- and is used only server-side by the Command Gateway.
alter table tasks enable row level security;
alter table approvals enable row level security;
alter table audit_log enable row level security;
alter table department_configs enable row level security;
alter table briefs enable row level security;
alter table command_packets enable row level security;
alter table access_events enable row level security;

create policy tasks_auth_all on tasks
  for all to authenticated using (true) with check (true);
create policy approvals_auth_all on approvals
  for all to authenticated using (true) with check (true);
create policy department_configs_auth_all on department_configs
  for all to authenticated using (true) with check (true);
create policy briefs_auth_all on briefs
  for all to authenticated using (true) with check (true);
create policy command_packets_auth_all on command_packets
  for all to authenticated using (true) with check (true);

-- Append-only tables: insert + select only.
create policy audit_log_auth_insert on audit_log
  for insert to authenticated with check (true);
create policy audit_log_auth_select on audit_log
  for select to authenticated using (true);
create policy access_events_auth_insert on access_events
  for insert to authenticated with check (true);
create policy access_events_auth_select on access_events
  for select to authenticated using (true);

revoke update, delete on audit_log from authenticated, anon;
revoke update, delete on access_events from authenticated, anon;

-- Seed: ten departments, all inactive.
insert into department_configs (name, phase, approval_class, active) values
  ('Chief of Staff',      '1',   'GREEN brief / RED sends',      false),
  ('Money Watchdog',      '2',   'GREEN alert / RED contact',    false),
  ('Follow-Up',           '2',   'GREEN drafts / L1-L2 sends',   false),
  ('Quote Assistant',     '2',   'YELLOW (gated on V1-V5)',      false),
  ('Messaging Desk',      '3-4', 'Per messaging level',          false),
  ('LPC Department',      '3',   'GREEN research / RED filings', false),
  ('Knowledge Librarian', '2-3', 'GREEN',                        false),
  ('Optimization Analyst','4',   'YELLOW proposals only',        false),
  ('Command Gateway Monitor','0A+','GREEN alert / YELLOW config',false),
  ('Access Auditor','0A+','GREEN report / RED cred changes',     false)
on conflict (name) do nothing;
