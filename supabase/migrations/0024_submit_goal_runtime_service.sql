-- 0024_submit_goal_runtime_service.sql
-- OWNER-APPLIED ONLY (staging first, then production). Parity discipline.
--
-- Defect (found live, prod tick disp-133272, 2026-08-20 22:42Z, first
-- intake after the C-3 service-identity re-seed):
--   remote_intake n8n-20260820-01 rejected
--   "confirm:persist_failed:owner_required,goal:g1"
-- 0020 widened every runtime TABLE policy to
-- (is_owner() or is_runtime_service()) but did not re-point the
-- SECURITY INVOKER RPC submit_goal_decomposition (0010/0018), whose
-- first statement is still "if not public.is_owner() then raise
-- owner_required". composer-persist.ts:198 commits EVERY composed goal
-- graph through that RPC, so on the non-owner service identity no
-- intake can ever become a goal. Gate 1 passed only because the
-- runtime was still the owner session at the time.
--
-- Fix: EXACT copy of the 0018 function body with precisely ONE delta:
--   (a) the guard becomes
--       if not (public.is_owner() or public.is_runtime_service())
-- Everything else byte-identical to 0018 (env stamp, idempotency lock,
-- simulation pin, grants). SECURITY INVOKER is kept, so the inserts
-- remain governed by the 0020 table policies; this RPC grants nothing
-- the runtime could not already do row-by-row. decide_orchestration_
-- approval (0021) and system_controls writes stay owner-only.
-- Rollback: reports/p2_evidence/rollback/rollback_0024.sql.txt
-- (re-creates the 0018 body verbatim).

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
  v_env text;          -- 0018: deployment environment stamp
begin
  if not (public.is_owner() or public.is_runtime_service()) then
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
  -- 0018: which environment does THIS database serve (0017 row)?
  select environment into v_env
    from public.runtime_deployment where id = 'self';
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
     coalesce(v_env, 'staging'),
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
