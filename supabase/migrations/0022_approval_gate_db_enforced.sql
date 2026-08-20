-- 0022_approval_gate_db_enforced.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
--
-- WHY: 0020/0021 stop the runtime identity from DECIDING approvals or writing
-- system_controls. But the runtime legitimately holds UPDATE on goal_jobs (for
-- status transitions), and clearApprovalGate cleared the gate via a DIRECT
-- goal_jobs UPDATE (requires_approval=false + status=ready). A COMPROMISED
-- runtime BINARY could therefore make an approval-gated job executable without
-- any owner approval - by directly clearing requires_approval, or by setting a
-- runnable status while leaving requires_approval=true. (Gate finding,
-- reports/PRESTON_RUNTIME_SERVICE_IDENTITY_OWNER_PACKET.md.)
--
-- INVARIANT ENFORCED HERE (structural, identity-independent):
--   An approval-gated job (requires_approval=true) can NEVER be in an
--   executable status, and requires_approval can be cleared ONLY by a
--   SECURITY DEFINER RPC that verifies a genuine owner-decided approval
--   scoped to that exact job. No table UPDATE by any client role can clear it.
--
-- MECHANISMS (defense in depth):
--   1. CHECK goal_jobs_gate_not_runnable: forbids (requires_approval=true AND
--      status in the executable set) on INSERT and UPDATE, for EVERY role
--      including SECURITY DEFINER. Closes the "status-only bypass" and
--      "insert gated+runnable" structurally.
--   2. Column privilege: revoke table UPDATE on goal_jobs from authenticated;
--      grant UPDATE on every column EXCEPT requires_approval AND the action-
--      defining fields kind/objective/title/risk_class. The runtime can
--      transition status/leases/results/assignment but CANNOT flip
--      requires_approval NOR mutate the approved action after the fact.
--      Combined with (1), a gated job is stuck non-runnable until the RPC,
--      and the action a clear authorizes is the action the owner approved
--      (the action fields are immutable post-insert - closes the
--      approve-then-swap-the-action integrity gap).
--   + clear_approval_gate(): the ONLY sanctioned clearer. SECURITY DEFINER
--      (runs as table owner, so it may set requires_approval); verifies the
--      job's linked approval is owner-decided 'approved', scoped to this job
--      and goal; CAS-binds the action fields; sets requires_approval=false +
--      status=ready atomically. Rejects nonexistent/pending/denied/mismatched/
--      replayed approvals with a structured reason.
--
-- WHY NO "RED must be gated" CHECK: an owner-APPROVED RED/BLACK job must run
-- with requires_approval=false while risk_class stays RED, so a
-- "risk_class RED => requires_approval=true" CHECK would make every approved
-- high-risk job permanently un-runnable (adversarial-review R3). The gate is
-- enforced by (1)+(2)+the RPC on the requires_approval flag itself, which is
-- risk-class-independent and correct.
--
-- RESIDUAL (documented, NOT closed): assigned_role stays UPDATE-able (the
-- driver assigns a default role to unassigned jobs), so a hostile runtime
-- could substitute the EXECUTOR ROLE on an already-approved job. It cannot
-- change WHAT runs (kind/objective/title/risk_class are immutable) - only
-- which agent runs it, itself bounded by agent_contracts default-deny. Full
-- closure needs assigned_role frozen-after-set (a future trigger or an
-- insert-time default), out of scope here.
--
-- COMPATIBILITY: the composer inserts every job as status='pending'
-- (composer-persist.ts) and the driver parks gated jobs to 'awaiting_approval'
-- (never a runnable status), so the CHECKs never fire on the legitimate flow.
-- The owner does not update goal_jobs.requires_approval directly (decisions go
-- through decide_orchestration_approval + this RPC), so the column revoke is
-- safe for owner and runtime alike.
--
-- CLASSIFICATION BOUNDARY (documented residual, NOT closed here): whether a
-- job SHOULD be gated is decided by application code (policy.ts classifyJob).
-- A hostile runtime could mark a dangerous objective GREEN/ungated at INSERT.
-- Closing that requires DB-side classification - a separate, larger change.
-- 0022 fully enforces the gate for any job that IS gated.
--
-- Depends on: 0010 (goal_jobs, orchestration_approvals), 0002 (is_owner),
-- 0020 (is_runtime_service).

-- 1. structural CHECK constraint (idempotent add) ---------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goal_jobs_gate_not_runnable') then
    alter table public.goal_jobs
      add constraint goal_jobs_gate_not_runnable
      check (not (requires_approval = true
                  and status in ('ready','assigned','in_progress')));
  end if;
end $$;

-- 2. column privilege: strip the runtime's ability to UPDATE requires_approval
-- AND the action-defining fields (kind/objective/title/risk_class), which are
-- INSERT-only in the legitimate flow. Revoke the table-wide UPDATE and re-grant
-- UPDATE on every OTHER column. (INSERT/SELECT grants are unchanged; the
-- composer still inserts requires_approval + the action fields via INSERT.
-- anon stays fully revoked. assigned_role stays updatable for the driver's
-- default-role assignment - see the RESIDUAL note in the header.)
revoke update on public.goal_jobs from authenticated;
grant update (
  id, goal_id, assigned_role, status,
  attempts, approval_id, runtime_job_id, correlation_id, evidence_refs,
  failure_reason, run_id, run_lease_expires_at, executed, created_at, updated_at
) on public.goal_jobs to authenticated;

-- 3. clear_approval_gate: the ONLY sanctioned path to clear the gate ---------
-- Runs as SECURITY DEFINER (table owner) so it can set requires_approval
-- despite the column revoke. Verifies a genuine owner approval in-transaction.
create or replace function public.clear_approval_gate(
  p_job_id text,
  p_from_status text,
  p_approval_id text,
  p_goal_id text,
  p_kind text,
  p_objective text,
  p_title text,
  p_risk_class text,
  p_assigned_role text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_job public.goal_jobs%rowtype;
  v_appr public.orchestration_approvals%rowtype;
begin
  -- caller must be the runtime service or the owner (nothing else)
  if not (public.is_runtime_service() or public.is_owner()) then
    raise exception 'forbidden';
  end if;
  if p_from_status is null or p_from_status not in ('pending','awaiting_approval') then
    return jsonb_build_object('ok', false, 'reason', 'bad_from_status');
  end if;

  -- lock the job row
  select * into v_job from public.goal_jobs
    where id = p_job_id::uuid for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'job_not_found');
  end if;

  -- CAS binding: the job must still be exactly what the caller verified, and
  -- still gated (a concurrent un-gate/action-swap loses the race).
  if v_job.status <> p_from_status
     or v_job.requires_approval is not true
     or coalesce(v_job.approval_id,'') <> coalesce(p_approval_id,'')
     or v_job.goal_id::text <> p_goal_id
     or v_job.kind <> p_kind
     or coalesce(v_job.objective,'') <> coalesce(p_objective,'')
     or v_job.title <> p_title
     or v_job.risk_class <> p_risk_class
     or coalesce(v_job.assigned_role,'') <> coalesce(p_assigned_role,'') then
    return jsonb_build_object('ok', false, 'reason', 'stale_cas');
  end if;

  -- the job's linked approval must exist, be owner-decided approved, and be
  -- scoped to THIS job and goal (blocks replay across jobs/goals).
  if v_job.approval_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_approval_linked');
  end if;
  select * into v_appr from public.orchestration_approvals
    where approval_id = v_job.approval_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'approval_not_found');
  end if;
  if v_appr.status <> 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;
  if v_appr.job_id is distinct from v_job.id
     or v_appr.goal_id is distinct from v_job.goal_id then
    return jsonb_build_object('ok', false, 'reason', 'scope_mismatch');
  end if;

  -- atomic clear: only if STILL gated + at from_status (final CAS).
  update public.goal_jobs
     set requires_approval = false,
         status = 'ready',
         updated_at = now()
   where id = v_job.id
     and status = p_from_status
     and requires_approval = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'stale_cas');
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_job.id);
end
$fn$;

revoke all on function public.clear_approval_gate(
  text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.clear_approval_gate(
  text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.clear_approval_gate(
  text, text, text, text, text, text, text, text, text) to authenticated;
