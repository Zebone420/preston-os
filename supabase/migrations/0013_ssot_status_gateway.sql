-- 0013_ssot_status_gateway.sql
-- Central SSOT B3: canonical status read gateway.
-- OWNER-APPLIED ONLY. Staging first; never production in this phase.
--
-- Purpose: one authenticated, bounded, READ-ONLY canonical status
-- projection for every registered actor (design
-- docs/PRESTON_CENTRAL_SSOT_DESIGN_v1.md sections 5, 11 B3). The web
-- tier keeps no session credential (0011 connector-circularity fix);
-- authentication is delegated to resolve_ssot_actor (0012) so there is
-- exactly ONE token-auth path. The gateway SELECTs only; it decides
-- nothing, approves nothing, executes nothing, and never returns
-- secrets or token hashes.
--
-- Depends on 0002 (is_owner), 0004 (system_controls,
-- orchestration_decisions), 0010 (goal graph), 0011 (remote intake),
-- 0012 (actor_registry + resolve_ssot_actor).

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
begin
  -- Single auth path: the 0012 resolver (also stamps last_seen_at).
  v_actor := public.resolve_ssot_actor(p_token);
  if coalesce((v_actor->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'status', 'forbidden');
  end if;

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
    'environment', 'staging',
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
