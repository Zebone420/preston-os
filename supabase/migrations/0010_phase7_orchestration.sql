-- PRESTON AI OS - Phase 7 orchestration data model
-- File: supabase/migrations/0010_phase7_orchestration.sql
-- FILES ONLY. Applied to STAGING by the OWNER in the Supabase SQL editor.
-- Never applied to production by the AI. Additive: new tables + owner-only
-- RLS. Depends on 0001 (approvals - business Approval Center), 0002
-- (public.is_owner()), and 0004 (os_jobs, referenced by goal_jobs.
-- runtime_job_id). Does NOT depend on 0007/0008. Rollback SQL lives in the
-- owner packet (markdown). Nothing here enables execution/sending/live path.
--
-- APPROVAL LIFECYCLE (authoritative decision, audit reconciliation): the
-- Phase 7 orchestration approval lifecycle is orchestration_approvals
-- (text approval_id, hash-bound, one-time, expiring). The legacy 0001
-- approvals table is the BUSINESS Approval Center and is a DIFFERENT model.
-- goal_jobs.approval_id is a SOFT text reference to
-- orchestration_approvals.approval_id (no inline FK, matching the
-- os_jobs.approval_id bare-reference precedent) to avoid a circular FK with
-- orchestration_approvals.job_id. A deferred FK is added at the end of this
-- file after both tables exist.
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
  -- Durable iteration counter (audit medium #12): the driver's loop budget
  -- survives a restart because the count lives here, not in process memory.
  iteration integer not null default 0
    check (iteration >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_master_goals_status
  on master_goals (status, created_at desc);
-- Idempotency key (audit medium #16): one goal graph per correlation key. A
-- retried submission can never duplicate the graph - the second insert fails
-- and the whole transaction (goal + jobs + deps) rolls back.
create unique index if not exists uq_master_goals_correlation
  on master_goals (correlation_id);

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
  -- SOFT text reference to orchestration_approvals.approval_id (Phase 7
  -- lifecycle), not the legacy 0001 approvals(uuid). Deferred FK added at
  -- end of file (circular with orchestration_approvals.job_id).
  approval_id text,
  runtime_job_id uuid references os_jobs (id),
  correlation_id text not null,
  evidence_refs jsonb not null default '[]',
  failure_reason text,
  executed boolean not null default false
    check (executed = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite key so job_dependencies can enforce SAME-GOAL edges via FK.
  unique (id, goal_id)
);
create index if not exists idx_goal_jobs_goal
  on goal_jobs (goal_id, status);

-- ============================================================
-- 3. job_dependencies - explicit dependency edges (append-only)
-- ============================================================
-- Cross-goal integrity (audit finding 8): both endpoints must belong to the
-- SAME goal. Enforced structurally by composite FKs into goal_jobs(id,goal_id)
-- - a dependency edge can NEVER reference a job from another goal.
create table if not exists job_dependencies (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references master_goals (id),
  job_id uuid not null,
  depends_on_job_id uuid not null,
  created_at timestamptz not null default now(),
  unique (job_id, depends_on_job_id),
  check (job_id <> depends_on_job_id),
  foreign key (job_id, goal_id) references goal_jobs (id, goal_id),
  foreign key (depends_on_job_id, goal_id) references goal_jobs (id, goal_id)
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
  -- The DECISION nonce (one-time replay guard). NULL while pending (no
  -- decision yet); set non-null exactly once when the owner decides. A
  -- PARTIAL unique index (below) enforces one-time semantics on real nonces
  -- while allowing many pending rows. (A plain unique(nonce) + NOT NULL would
  -- make it impossible to insert a pending approval.)
  nonce text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired','more_info')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  -- envelope integrity: expiry must be after creation.
  check (expires_at > created_at)
);
create index if not exists idx_orchestration_approvals_status
  on orchestration_approvals (status, expires_at);
-- Durable replay guard: a decision nonce is unique across all approvals.
-- Partial (WHERE nonce is not null) so pending rows (null nonce) never clash.
create unique index if not exists uq_orchestration_approvals_nonce
  on orchestration_approvals (nonce) where nonce is not null;

-- ============================================================
-- RLS: owner-only via public.is_owner(); anon fully revoked; no
-- table grants delete. master_goals/goal_jobs/agent_contracts are
-- mutable (owner). job_dependencies/orchestration_approvals are
-- insert+select only; an approval's status is decided EXCLUSIVELY through
-- public.decide_orchestration_approval (no update policy, no update grant).
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
-- No direct UPDATE policy and no UPDATE privilege (audit critical #17): the
-- ONLY way to decide an approval is the narrow transactional function
-- public.decide_orchestration_approval below. Even the owner session cannot
-- rewrite an approval row directly - immutability and pending-only/one-time
-- semantics are DB-enforced, not app-enforced.
drop policy if exists orch_approvals_owner_upd on orchestration_approvals;
grant select, insert on orchestration_approvals to authenticated;
revoke update on orchestration_approvals from authenticated;

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

-- ============================================================
-- Worktree lock (audit critical #1): the Phase 7 worktree lock persists on
-- the EXISTING repository_worktrees table (0004) - the authoritative worktree
-- record, per the architecture decision (no second lock table). That table
-- already carries id/repo/path/agent/job_id/base_commit/target_branch/status/
-- lock_id, but lacks the Phase 7 fencing facts. Add them ADDITIVELY. The
-- ownership token reuses the existing lock_id column; status uses the existing
-- CHECK values ('in_use' when held, 'unassigned' when released). Additive,
-- staging-safe, RLS unchanged (repository_worktrees RLS from 0004 covers new
-- columns). Rollback = owner drops these three columns.
alter table repository_worktrees
  add column if not exists fence integer not null default 0;
alter table repository_worktrees
  add column if not exists allowed_paths jsonb not null default '[]';
alter table repository_worktrees
  add column if not exists lease_expires_at timestamptz;

-- ============================================================
-- Deferred FK: goal_jobs.approval_id -> orchestration_approvals(approval_id).
-- Added after both tables exist (circular with orchestration_approvals.
-- job_id). Guarded for idempotent re-runs.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'goal_jobs_approval_fk'
  ) then
    alter table goal_jobs
      add constraint goal_jobs_approval_fk
      foreign key (approval_id) references orchestration_approvals (approval_id);
  end if;
end $$;

-- ============================================================
-- Atomic goal decomposition (audit medium #16).
-- public.submit_goal_decomposition persists master goal + goal jobs +
-- dependency edges in ONE transaction: any insert/validation/constraint
-- failure rolls the whole graph back (no partial goal). Operationally
-- idempotent: a per-correlation advisory xact lock serializes concurrent
-- submissions so a retry (sequential OR concurrent) returns the existing goal
-- id and inserts nothing; a partial id/correlation cross-match raises
-- idempotency_conflict. uq_master_goals_correlation remains the durable
-- backstop of last resort.
-- SECURITY INVOKER on purpose: the caller's own RLS policies and grants
-- (owner-only) apply unchanged; the function adds atomicity, not privilege.
-- Fixed search_path, schema-qualified, no dynamic SQL.
-- ============================================================
create or replace function public.submit_goal_decomposition(
  p_goal jsonb,
  p_jobs jsonb,
  p_deps jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_goal_id uuid;
  v_corr text;
  v_corr_of_id text;   -- correlation_id of the row whose id = v_goal_id (if any)
  v_id_of_corr uuid;   -- id of the row whose correlation_id = v_corr (if any)
  v_job jsonb;
  v_dep jsonb;
  v_count integer := 0;
begin
  if not public.is_owner() then
    raise exception 'owner_required';
  end if;
  if p_goal is null or jsonb_typeof(p_goal) <> 'object' then
    raise exception 'goal_required';
  end if;
  v_goal_id := (p_goal->>'id')::uuid;
  v_corr := nullif(trim(coalesce(p_goal->>'correlation_id', '')), '');
  if v_goal_id is null or v_corr is null then
    raise exception 'goal_identity_required';
  end if;
  -- Serialize concurrent submissions that share a correlation key so the
  -- check-then-insert below is OPERATIONALLY idempotent (audit MAJOR): a second
  -- concurrent caller blocks here until the first commits, then its lookup sees
  -- the committed row and returns {created:false} instead of a raw unique
  -- violation. hashtextextended yields a 64-bit key so distinct correlation
  -- keys effectively never collide/block one another (unlike 32-bit hashtext).
  perform pg_advisory_xact_lock(
    hashtextextended('submit_goal_decomposition:' || v_corr, 0));
  -- Deterministic idempotency (audit MAJOR): a prior submission is a match ONLY
  -- when the SAME row carries BOTH this id and this correlation_id. A partial /
  -- cross match (id and correlation pointing at different rows) is an
  -- idempotency_conflict - never a silent arbitrary pick.
  select correlation_id into v_corr_of_id from public.master_goals where id = v_goal_id;
  select id into v_id_of_corr from public.master_goals where correlation_id = v_corr;
  if v_corr_of_id is not null or v_id_of_corr is not null then
    if v_corr_of_id is not distinct from v_corr
        and v_id_of_corr is not distinct from v_goal_id then
      return jsonb_build_object('goal_id', v_goal_id, 'created', false);
    end if;
    raise exception 'idempotency_conflict';
  end if;
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array'
      or jsonb_array_length(p_jobs) = 0 then
    raise exception 'jobs_required';
  end if;
  if jsonb_array_length(p_jobs) > 1000 then
    raise exception 'too_many_jobs';
  end if;
  insert into public.master_goals
    (id, title, objective, source, requested_by, status, environment,
     budget, correlation_id, simulation_only, iteration)
  values
    (v_goal_id,
     p_goal->>'title',
     p_goal->>'objective',
     p_goal->>'source',
     p_goal->>'requested_by',
     coalesce(p_goal->>'status', 'decomposed'),
     'staging',
     coalesce(p_goal->'budget', '{}'::jsonb),
     v_corr,
     true,
     0);
  for v_job in select * from jsonb_array_elements(p_jobs) loop
    insert into public.goal_jobs
      (id, goal_id, kind, title, objective, risk_class, assigned_role,
       status, attempts, requires_approval, approval_id, runtime_job_id,
       correlation_id, evidence_refs, executed)
    values
      ((v_job->>'id')::uuid,
       v_goal_id,
       v_job->>'kind',
       v_job->>'title',
       coalesce(v_job->>'objective', ''),
       coalesce(v_job->>'risk_class', 'GREEN'),
       v_job->>'assigned_role',
       coalesce(v_job->>'status', 'pending'),
       coalesce((v_job->>'attempts')::integer, 0),
       coalesce((v_job->>'requires_approval')::boolean, false),
       v_job->>'approval_id',
       (v_job->>'runtime_job_id')::uuid,
       coalesce(nullif(v_job->>'correlation_id', ''), v_corr),
       coalesce(v_job->'evidence_refs', '[]'::jsonb),
       false);
    v_count := v_count + 1;
  end loop;
  -- A non-null p_deps of the wrong JSON type must fail closed (audit MINOR),
  -- never be silently treated as "no dependencies" (which would persist an
  -- incomplete graph for a malformed request).
  if p_deps is not null and jsonb_typeof(p_deps) <> 'array' then
    raise exception 'deps_invalid';
  end if;
  if p_deps is not null then
    for v_dep in select * from jsonb_array_elements(p_deps) loop
      insert into public.job_dependencies (goal_id, job_id, depends_on_job_id)
      values
        (v_goal_id,
         (v_dep->>'job_id')::uuid,
         (v_dep->>'depends_on_job_id')::uuid);
    end loop;
  end if;
  return jsonb_build_object('goal_id', v_goal_id, 'created', true,
                            'jobs', v_count);
end
$fn$;
revoke all on function public.submit_goal_decomposition(jsonb, jsonb, jsonb)
  from public;
revoke all on function public.submit_goal_decomposition(jsonb, jsonb, jsonb)
  from anon;
grant execute on function public.submit_goal_decomposition(jsonb, jsonb, jsonb)
  to authenticated;

-- ============================================================
-- Approval decision enforcement (audit critical #17).
-- public.decide_orchestration_approval is the ONLY write path for approval
-- decisions (direct UPDATE is revoked above). It locks the row FOR UPDATE,
-- requires pending status, a valid outcome, owner authorization, real
-- wall-clock (clock_timestamp(), taken AFTER the lock) before expiry, and
-- one-time nonce semantics; sets decided_at from that same clock_timestamp();
-- updates ONLY the decision fields; returns the authoritative
-- updated row; and fails closed under concurrent decisions (the second
-- caller blocks on the row lock, then sees status<>pending and aborts).
-- SECURITY DEFINER is required because authenticated has no UPDATE grant:
-- fixed search_path, schema-qualified references, no dynamic SQL, execute
-- revoked from public and anon, granted only to authenticated, and
-- public.is_owner() is enforced internally. No service role involved.
-- ============================================================
create or replace function public.decide_orchestration_approval(
  p_approval_id text,
  p_outcome text,
  p_nonce text
) returns setof public.orchestration_approvals
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.orchestration_approvals%rowtype;
  v_now timestamptz;
begin
  if not public.is_owner() then
    raise exception 'owner_required';
  end if;
  if p_outcome is null
      or p_outcome not in ('approved', 'rejected', 'more_info') then
    raise exception 'outcome_invalid';
  end if;
  if p_nonce is null or length(trim(p_nonce)) = 0 then
    raise exception 'nonce_required';
  end if;
  select * into v_row from public.orchestration_approvals
    where approval_id = p_approval_id
    for update;
  if not found then
    raise exception 'approval_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'not_pending';
  end if;
  if v_row.nonce is not null then
    raise exception 'already_decided';
  end if;
  -- Real wall-clock time AFTER the row lock (audit MAJOR). now() /
  -- transaction_timestamp() is fixed at transaction start, so a decider that
  -- waited on FOR UPDATE would compare an approval against a STALE time and
  -- could accept one that expired while it was blocked. clock_timestamp() is
  -- the actual time at this point; it gates expiry AND stamps decided_at so
  -- the recorded decision time cannot predate the decision.
  v_now := clock_timestamp();
  if v_now >= v_row.expires_at then
    raise exception 'expired';
  end if;
  update public.orchestration_approvals
     set status = p_outcome,
         decided_at = v_now,
         nonce = p_nonce
   where approval_id = p_approval_id;
  return query
    select * from public.orchestration_approvals
      where approval_id = p_approval_id;
end
$fn$;
revoke all on function public.decide_orchestration_approval(text, text, text)
  from public;
revoke all on function public.decide_orchestration_approval(text, text, text)
  from anon;
grant execute on function public.decide_orchestration_approval(text, text, text)
  to authenticated;
