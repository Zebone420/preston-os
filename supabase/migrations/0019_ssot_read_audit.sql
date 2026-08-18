-- 0019_ssot_read_audit.sql
-- ChatGPT live SSOT read gate: per-read auditability.
-- OWNER-APPLIED ONLY (staging first, then production, parity discipline).
-- Status: DRAFT authored 2026-08-18 unattended; NOT yet applied to any
-- DB and NOT yet verified against a live database. Apply + verify is an
-- owner step (psql owner identity). See the go-live report.
--
-- WHY: docs/PRESTON_CENTRAL_SSOT_DESIGN_v1.md section 7 line 121 requires
-- "Every SSOT read gateway call lands one access_events/audit row". The
-- shipped read_ssot_status (0013 -> 0017) authenticates via
-- resolve_ssot_actor (which only stamps actor_registry.last_seen_at, a
-- coarse overwrite) and writes NO per-call audit row. This closes that
-- gap with the smallest bounded change: one append-only access_events
-- INSERT per SUCCESSFUL, actor-bound read.
--
-- DELIBERATE SCOPE DECISION (flag for owner/ChatGPT ruling): only
-- SUCCESSFUL (authenticated) reads are audited here. Auditing pre-auth
-- 'forbidden' calls would let any holder of the public anon key flood
-- access_events (unbounded storage / log-noise DoS). If the gate demands
-- denied-attempt auditing, add it behind a rate/dedup guard in a
-- follow-up; do not add an unguarded anon-triggerable INSERT.
--
-- BOUNDS / INVARIANTS PRESERVED:
--   - append-only: access_events already revokes update/delete (0001/0002);
--     this only INSERTs. No RLS change. No new grant.
--   - the INSERT runs inside the existing SECURITY DEFINER function, so it
--     writes despite anon/authenticated having no direct INSERT rights -
--     exactly the resolve_ssot_actor pattern.
--   - read semantics unchanged: still SELECT-only for all business data;
--     decides nothing, approves nothing, executes nothing, returns no
--     secrets or token hashes.
--   - body is byte-identical to 0017 except: (1) v_env read moved above the
--     auth branch is NOT done (kept as 0017); (2) one INSERT before the
--     final return. Nothing else changed.
--
-- Depends on 0017 (current read_ssot_status + runtime_deployment),
-- 0001 (access_events), 0012 (resolve_ssot_actor).

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
  v_result jsonb;
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

  v_result := jsonb_build_object(
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

  -- Per-read audit row (design section 7). Append-only; names/ids only,
  -- never token or business payload. event 'used' = a successful,
  -- actor-authenticated SSOT status read.
  insert into access_events (system, event, actor, environment, detail)
  values (
    'ssot-read', 'used',
    v_actor->>'actor_id',
    coalesce(v_env, 'staging'),
    jsonb_build_object(
      'actor_role', v_actor->>'actor_role',
      'schema', 'preston-ssot-status/1'));

  return v_result;
end;
$$;

revoke all on function public.read_ssot_status(text) from public;
grant execute on function public.read_ssot_status(text)
  to anon, authenticated;
