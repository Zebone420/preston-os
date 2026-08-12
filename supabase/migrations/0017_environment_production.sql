-- 0017_environment_production.sql
-- P2 environment generalization (DB layer). OWNER-APPLIED ONLY, at the
-- P2 gate, to BOTH staging and production (parity discipline).
--
-- Widens the Phase 7 literal-staging CHECK pins to the two-value
-- allowlist. The application layer (ceec304+P2 line) enforces the
-- stronger invariant: every row must equal THE deployment's single
-- pinned environment; these CHECKs are the schema backstop that no
-- third value can ever appear. Defaults stay 'staging' so a row that
-- never states its environment can never claim production.
--
-- Also adds runtime_deployment: one owner-seeded row naming which
-- environment THIS database serves, and re-creates read_ssot_status's
-- hardcoded environment field to report it (fallback 'staging'
-- preserves current staging behavior until the row is seeded).
--
-- NOT touched: goal_jobs.executed CHECK, simulation_only pins,
-- business-layer 0009 pins, approvals lifecycle, any grant.
--
-- Owner seeding (run the matching ONE line after this file):
--   staging:    insert into runtime_deployment (id, environment)
--               values ('self', 'staging')
--               on conflict (id) do update set environment = 'staging';
--   production: insert into runtime_deployment (id, environment)
--               values ('self', 'production')
--               on conflict (id) do update set environment = 'production';

-- 1. widen the three 0010 environment CHECKs (names are the Postgres
--    auto-generated column-check names; guarded drop keeps this
--    re-run-safe).
alter table master_goals
  drop constraint if exists master_goals_environment_check;
alter table master_goals
  add constraint master_goals_environment_check
    check (environment in ('staging', 'production'));

alter table agent_contracts
  drop constraint if exists agent_contracts_environment_scope_check;
alter table agent_contracts
  add constraint agent_contracts_environment_scope_check
    check (environment_scope in ('staging', 'production'));

alter table orchestration_approvals
  drop constraint if exists orchestration_approvals_environment_check;
alter table orchestration_approvals
  add constraint orchestration_approvals_environment_check
    check (environment in ('staging', 'production'));

-- 2. deployment identity row (owner-only RLS, anon zero, no deletes).
create table if not exists runtime_deployment (
  id text primary key check (id = 'self'),
  environment text not null
    check (environment in ('staging', 'production')),
  updated_at timestamptz not null default now()
);
alter table runtime_deployment enable row level security;
drop policy if exists runtime_deployment_owner on runtime_deployment;
create policy runtime_deployment_owner on runtime_deployment
  for all using (public.is_owner()) with check (public.is_owner());
revoke all on runtime_deployment from anon;
grant select, insert, update on runtime_deployment to authenticated;
revoke delete on runtime_deployment from authenticated;

-- 3. read_ssot_status reports the actual deployment environment.
--    EXACT copy of the 0013 body with precisely three deltas:
--    (a) declare v_env, (b) select it from runtime_deployment,
--    (c) 'environment' field uses coalesce(v_env,'staging') instead of
--    the literal. Everything else byte-identical to 0013.
create or replace function public.read_ssot_status(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor jsonb;
  v_posture jsonb;
  v_goals jsonb := '[]'::jsonb;
  v_jobs jsonb := '[]'::jsonb;
  v_open_approvals jsonb := '[]'::jsonb;
  v_decided jsonb := '[]'::jsonb;
  v_hermes jsonb := null;
  v_intake jsonb := '[]'::jsonb;
  v_env text;
begin
  -- Single auth path: the 0012 resolver (also stamps last_seen_at).
  v_actor := public.resolve_ssot_actor(p_token);
  if coalesce((v_actor->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'status', 'forbidden');
  end if;

  select environment into v_env
    from runtime_deployment where id = 'self';

  select jsonb_build_object(
      'execution_enabled', sc.execution_enabled,
      'remote_runner_enabled', sc.remote_runner_enabled,
      'hermes_mode', sc.hermes_mode,
      'owner_stop', sc.owner_stop,
      'paused', sc.paused)
    into v_posture
    from system_controls sc where sc.id = 'global';

  select coalesce(jsonb_agg(jsonb_build_object(
      'goal_id', g.id,
      'title', left(g.title, 200),
      'status', g.status,
      'created_at', g.created_at,
      'updated_at', g.updated_at) order by g.created_at desc),
      '[]'::jsonb)
    into v_goals
    from (select * from master_goals
            order by created_at desc limit 10) g;

  select coalesce(jsonb_agg(jsonb_build_object(
      'job_id', j.id,
      'goal_id', j.goal_id,
      'kind', j.kind,
      'title', left(j.title, 200),
      'status', j.status,
      'requires_approval', j.requires_approval,
      'evidence_refs', j.evidence_refs) order by j.created_at desc),
      '[]'::jsonb)
    into v_jobs
    from (select gj.* from goal_jobs gj
            where gj.goal_id in
              (select id from master_goals
                 order by created_at desc limit 10)
            order by gj.created_at desc limit 50) j;

  select coalesce(jsonb_agg(jsonb_build_object(
      'approval_id', a.approval_id,
      'goal_id', a.goal_id,
      'job_id', a.job_id,
      'status', a.status,
      'expires_at', a.expires_at) order by a.created_at desc),
      '[]'::jsonb)
    into v_open_approvals
    from (select * from orchestration_approvals
            where status = 'pending'
            order by created_at desc limit 10) a;

  select coalesce(jsonb_agg(jsonb_build_object(
      'approval_id', a.approval_id,
      'status', a.status,
      'decided_at', a.decided_at) order by a.created_at desc),
      '[]'::jsonb)
    into v_decided
    from (select * from orchestration_approvals
            where status <> 'pending'
            order by created_at desc limit 5) a;

  select jsonb_build_object(
      'decision_id', d.id,
      'hermes_mode', d.hermes_mode,
      'reasons', to_jsonb(d.reasons),
      'created_at', d.created_at)
    into v_hermes
    from orchestration_decisions d
    where d.id like 'od-orchstatus-%'
    order by d.created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'request_id', r.request_id,
      'status', r.status,
      'created_at', r.created_at) order by r.created_at desc),
      '[]'::jsonb)
    into v_intake
    from (select * from remote_intake_requests
            order by created_at desc limit 10) r;

  return jsonb_build_object(
    'ok', true,
    'status', 'ok',
    'schema', 'preston-ssot-status/1',
    'generated_at', now(),
    'environment', coalesce(v_env, 'staging'),
    'actor', jsonb_build_object(
      'actor_id', v_actor->>'actor_id',
      'actor_role', v_actor->>'actor_role'),
    'posture', coalesce(v_posture,
      jsonb_build_object('unreadable', true)),
    'goals', v_goals,
    'jobs', v_jobs,
    'approvals', jsonb_build_object(
      'open', v_open_approvals,
      'recently_decided', v_decided),
    'hermes', v_hermes,
    'intake', jsonb_build_object('recent_requests', v_intake)
  );
end;
$$;

revoke all on function public.read_ssot_status(text) from public;
grant execute on function public.read_ssot_status(text)
  to anon, authenticated;
