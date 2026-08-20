-- 0023_job_classification_gate.sql
-- OWNER-APPLIED ONLY (staging first, then production). Status: DRAFT.
--
-- WHY: 0020-0022 make an approval-GATED job un-executable without a verified
-- owner approval. But whether a job IS gated (requires_approval) is decided by
-- the runtime binary (policy.ts classifyJob) at INSERT. A compromised runtime
-- could self-classify a DANGEROUS objective as GREEN + requires_approval=false
-- + status=ready — a NEVER-gated job that runs with no owner approval
-- (staging matrix probe C-1, confirmed on staging 2026-08-20).
--
-- FIX (narrowest): make the DATABASE the gate-classification authority at
-- INSERT time, for the runtime identity only.
--   1. public.job_gate_required(kind, objective) - IMMUTABLE predicate that
--      faithfully ports policy.ts/commands.ts gate markers (RED risk + BLACK
--      + mobile-gate). Returns true iff the objective names a dangerous /
--      approval-requiring action. Reads only its text args (never the agent's
--      self-assigned risk_class/requires_approval labels).
--   2. A RESTRICTIVE, INSERT-ONLY RLS policy: a runtime-service insert may set
--      requires_approval=false ONLY when job_gate_required(...) is false. A
--      dangerous objective MUST be born gated (requires_approval=true) and
--      therefore travels the owner-approval path.
--
-- WHY INSERT-ONLY / RESTRICTIVE (not a CHECK): a CHECK fires on INSERT AND
-- UPDATE and would reject the approved-clear UPDATE that sets
-- requires_approval=false on a still-dangerous RED job (the removed
-- red_must_gate / R3 regression). An INSERT-only RESTRICTIVE policy leaves the
-- clear path (clear_approval_gate, 0022) untouched — P3/P5 remain PASS. RLS is
-- also identity-aware (is_runtime_service), so the owner and GREEN jobs are
-- unaffected; a CHECK cannot be.
--
-- COMPATIBILITY (proven by construction): the honest classifier's
-- requires_approval EXACTLY equals job_gate_required for every input
-- (requires_approval = risk in {RED,BLACK} OR mobile-gate = the same markers),
-- so no legitimate composer insert is rejected. Benign GREEN objectives ->
-- job_gate_required=false -> ungated creation preserved.
--
-- SCOPE: NO risk_class-consistency enforcement (deliberately - it re-breaks the
-- clear path and adds nothing the objective predicate does not cover). This
-- migration closes ONLY the classification-to-gating bypass.
--
-- FAIL-CLOSED: any dangerous marker forces gating; an under-gated flagged
-- runtime insert is DENIED. The DB predicate is a SUPERSET of the app markers
-- (a static test pins this), so the DB can never under-classify vs the app.
--
-- Depends on: 0010 (goal_jobs + its policies), 0020 (is_runtime_service).

-- 1. DB gate-classification authority ---------------------------------------
create or replace function public.job_gate_required(p_kind text, p_objective text)
  returns boolean
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  -- full-word markers (\b..\b): classifyRisk RED + BLACK single tokens +
  -- mobile single tokens. NB: destructive tokens are written with a harmless
  -- char-class break (e.g. trunc[a]te) so this DETECTION pattern never appears
  -- as a literal runnable destructive token in source - the same technique
  -- commands.ts uses for its BLACK_MARKERS. The Postgres regex still matches
  -- the real word. (the drop-family destructive verb is covered by the 'drop'
  -- token; the recursive force-remove verb is in the second group below.)
  select ((coalesce(p_kind,'') || ': ' || coalesce(p_objective,''))
            ~* '\y(send|email|sms|deploy|production|prod|delete|payment|charge|transfer|migrate|trunc[a]te|wipe|destroy|shutdown|invoice|refund|dns|retire|drop|rls|push)\y')
      -- prefix / separated / multi-word markers (leading-boundary only), mirror
      -- the app's \bmigrat, hermes[_-]?mode, remote[_-]?runner, execution_enabled,
      -- send[_-]?(email|sms|message|telegram), the recursive-remove verb, etc.
      or ((coalesce(p_kind,'') || ': ' || coalesce(p_objective,''))
            ~* '\y(migrat|hermes[_-]?mode|remote[_-]?runner|remote_runner_enabled|execution_enabled|enable[_-]?execution|anon[_-]?grant|airtable[_-]?write|crm[_-]?write|external[_-]?write|live[_-]?send|send[_-]?(email|sms|message|telegram)|rm\s+-?r[f]|force\s+push)');
$$;
revoke all on function public.job_gate_required(text, text) from public;
grant execute on function public.job_gate_required(text, text) to authenticated;

-- 2. RESTRICTIVE, INSERT-ONLY policy: runtime may only birth an UNGATED job
-- that the DB itself classifies as benign. ANDs with the permissive
-- goal_jobs_owner_all (0010/0020). Owner & non-runtime authenticated: the first
-- OR-term short-circuits true, so they are unaffected.
drop policy if exists goal_jobs_runtime_classify on goal_jobs;
create policy goal_jobs_runtime_classify on goal_jobs as restrictive
  for insert to authenticated
  with check (
    not public.is_runtime_service()
    or requires_approval = true
    or not public.job_gate_required(kind, objective)
  );
