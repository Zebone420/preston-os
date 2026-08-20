-- 0021_decide_audit_failclosed.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
--
-- WHY: decide_orchestration_approval's ONLY audit was an app-level logAudit
-- call in the dashboard server action (actions.ts), whose failure is
-- swallowed (return value ignored). A real approval decision can therefore
-- leave ZERO audit rows - exactly what happened for R-2 on 2026-08-19
-- (audit_log empty across the decision window). Worse, a decision made by
-- ANY path other than that one server action (a script, a direct RPC) is
-- never audited at all.
--
-- FIX: write the decision audit row INSIDE the decide RPC transaction, so
-- EVERY successful decision - regardless of caller - lands exactly one
-- append-only access_events row atomically. If the audit insert fails, the
-- whole decision rolls back (fail-closed). The row records auth.uid() and
-- is_owner() so future decisions carry machine attribution (directly
-- addresses the R-2 attribution gap).
--
-- INVARIANTS PRESERVED (byte-identical to 0010 except the one INSERT):
--   - is_owner() gate, one-time nonce, FOR UPDATE lock, pending-only,
--     real-clock (clock_timestamp) expiry, updates ONLY decision fields.
--   - SECURITY DEFINER, fixed search_path, execute revoked from public/anon,
--     granted only to authenticated. No RLS change. No new grant.
--   - access_events stays append-only (0001/0002 revoke update/delete); the
--     INSERT runs in the definer context, same pattern as 0012/0019.
--   - NO secret/token value is written: only the nonce PREFIX (5 chars),
--     never the full nonce.
--
-- Depends on: 0010 (decide_orchestration_approval, orchestration_approvals),
-- 0001 (access_events).

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
  -- Real wall-clock AFTER the row lock (audit MAJOR): gates expiry and stamps
  -- decided_at so a decision time cannot predate the decision.
  v_now := clock_timestamp();
  if v_now >= v_row.expires_at then
    raise exception 'expired';
  end if;
  update public.orchestration_approvals
     set status = p_outcome,
         decided_at = v_now,
         nonce = p_nonce
   where approval_id = p_approval_id;

  -- FAIL-CLOSED AUDIT (0021): one append-only row per decision, atomic with
  -- the update. Records WHO decided (auth.uid) and whether they are an owner,
  -- for durable attribution. Never writes the token or the full nonce.
  insert into access_events (system, event, actor, environment, detail)
  values (
    'orchestration-approval',
    p_outcome,
    coalesce(nullif(auth.uid()::text, ''), 'unknown'),
    v_row.environment,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'goal_id', v_row.goal_id,
      'job_id', v_row.job_id,
      'is_owner', public.is_owner(),
      'nonce_prefix', left(p_nonce, 5)));

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
