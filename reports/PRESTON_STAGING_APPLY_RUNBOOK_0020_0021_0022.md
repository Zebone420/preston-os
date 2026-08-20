# PRESTON — STAGING APPLY + LIVE MATRIX RUNBOOK (0020/0021/0022)

STAGING ONLY. Do not target production (prod ref hiqsymsiwonmvrbbqhhe).
Staging ref: vcqtlmlaxxankxyezlul. Repo at a5588517 (= origin/master).
Rollback artifacts: reports/p2_evidence/rollback/rollback_002{0,1,2}.sql.txt
(named .sql.txt so the RED-boundary scanner does not treat intentionally-
destructive rollback SQL as committed executable code; copy the body into
psql, or `\i` after renaming to .sql, to run — OWNER-RUN only).

Two identities are used in the live matrix:
- OWNER: an owner Supabase login (in public.owners) — applies migrations
  (psql, session pooler) and DECIDES approvals.
- RUNTIME: the NEW non-owner user runtime@service.preston — proves the
  runtime-service identity is RLS/grant constrained. Tested via the REST
  API with the runtime user's own access token (its real RLS role).

## STEP 0 — pre-apply backup (bounded)

Staging DB snapshot before any DDL. Either:
- Supabase dashboard → Database → Backups → "Create backup" (staging
  project), note the timestamp; OR
- pg_dump -s (schema-only is sufficient for policy/constraint rollback
  proof): `pg_dump -h aws-0-us-east-1.pooler.supabase.com -p 5432 -U
  postgres.vcqtlmlaxxankxyezlul -d postgres -s -f staging_preapply_schema.sql`
Record which was taken. Rollback SQL restores authz state without the
backup, but the snapshot is the belt-and-suspenders restore point.

## STEP 1 — OWNER ACTION (create the runtime user) — REQUIRED FIRST

Supabase dashboard → the STAGING project (ref vcqtlmlaxxankxyezlul) →
Authentication → Users → Add user:
- email: runtime@service.preston
- password: (a strong password you keep; used once to mint the runtime
  access token for the matrix)
- Do NOT add this user to public.owners.
Copy its User UID (Authentication → Users → the row → User UID).
This is the only account-creation step; it is owner-only.

## STEP 2 — apply, in EXACT order (owner psql, session pooler, port 5432)

Password prompt = the STAGING db password. From C:\dev\preston-os:

```
psql -h aws-0-us-east-1.pooler.supabase.com -p 5432 \
     -U postgres.vcqtlmlaxxankxyezlul -d postgres -v ON_ERROR_STOP=1
```
then at the prompt:
```
\i supabase/migrations/0020_runtime_service_identity.sql
insert into public.runtime_services (user_id, note)
  values ('<RUNTIME_UID_FROM_STEP_1>', 'preston runtime (non-owner, staging)')
  on conflict (user_id) do nothing;
\i supabase/migrations/0021_decide_audit_failclosed.sql
\i supabase/migrations/0022_approval_gate_db_enforced.sql
```

## STEP 3 — verify schema/migration state (owner psql, read-only)

```
select proname from pg_proc where proname in
  ('is_runtime_service','clear_approval_gate','decide_orchestration_approval');
select conname from pg_constraint where conname='goal_jobs_gate_not_runnable';
select count(*) as runtime_services_rows from public.runtime_services;
-- goal_jobs UPDATE must NOT include requires_approval/kind/objective/title/risk_class
select string_agg(column_name,',' order by column_name)
  from information_schema.column_privileges
  where table_name='goal_jobs' and grantee='authenticated' and privilege_type='UPDATE';
```
Expect: 3 functions present; the constraint present; 1 runtime_services
row; the UPDATE column list excludes requires_approval, kind, objective,
title, risk_class.

## STEP 4 — mint the runtime access token (for the RLS-real matrix)

Public anon key from the staging project (Settings → API → anon public).
```
curl -sS "https://<STAGING>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"runtime@service.preston","password":"<STEP1_PASSWORD>"}'
```
Capture `.access_token` → $RT (runtime JWT). Do the same for an OWNER
login → $OW (owner JWT). Never paste these tokens into chat; use them
only as Bearer headers below. All calls: base URL
https://<STAGING>.supabase.co/rest/v1  with headers
`apikey: <ANON_KEY>` and `Authorization: Bearer $RT` (or $OW).

## LIVE MATRIX — capture ACTUAL responses (paste them back)

Legend: RT=runtime token, OW=owner token. Expect column = required result.

POSITIVE
- P1 (RT) insert a gated job pending:
  POST /rest/v1/goal_jobs {id,goal_id,kind:'documentation',title,objective,
  risk_class:'GREEN',status:'pending',requires_approval:true,approval_id:...,
  correlation_id,attempts:0}  → 201 (needs a parent goal + approval row first;
  use OW or the composer path to seed the goal/approval). Expect: row created,
  status pending.
- P2 (OW) decide its approval:
  POST /rest/v1/rpc/decide_orchestration_approval {p_approval_id,p_outcome:
  'approved',p_nonce:'stg-<uuid>'} → 200 approved; +1 access_events row.
- P3 (RT) clear the gate:
  POST /rest/v1/rpc/clear_approval_gate {p_job_id,p_from_status:'awaiting_approval'
  (or 'pending'),p_approval_id,p_goal_id,p_kind,p_objective,p_title,p_risk_class,
  p_assigned_role} → 200 {ok:true}; job now requires_approval=false,status=ready.
- P4 (RT) normal transitions: PATCH /goal_jobs?id=eq.<nongated> status ready→
  assigned→in_progress; insert job_attempts/worker_leases → all 200/201.
- P5 (RT) an owner-approved RED job (risk_class='RED') clears via P2+P3 and
  reaches ready → proves no red_must_gate liveness block.

NEGATIVE (must FAIL as noted; record the exact error)
- N1 (RT) PATCH /goal_jobs?id=eq.<gated> {requires_approval:false}
  → 403/permission denied for column requires_approval.
- N2 (RT) PATCH /goal_jobs?id=eq.<gated> {status:'ready'}
  → check violation goal_jobs_gate_not_runnable (400/409).
- N3 (RT) POST /goal_jobs {requires_approval:true,status:'ready',...}
  → check violation goal_jobs_gate_not_runnable.
- N4 (RT) clear_approval_gate with a PENDING approval → {ok:false,
  reason:'not_approved'}; with a bogus p_approval_id → job still gated.
- N5 (RT) relink approval_id to another job's approved record then
  clear_approval_gate → {ok:false,reason:'scope_mismatch'}.
- N6 (RT) clear_approval_gate again after P3 cleared it → {ok:false,
  reason:'stale_cas'}.
- N7 (a THROWAWAY non-owner/non-runtime authenticated user token)
  clear_approval_gate → error 'forbidden'.
- N8 (RT) POST /orchestration_approvals {status:'approved',...} → RLS
  with-check violation; PATCH /orchestration_approvals → permission denied.
- N9 (RT) PATCH /goal_jobs?id=eq.<any> {objective:'x'} (and title/kind/
  risk_class) → 403/permission denied for column.

0020/0021 REGRESSION (RT unless noted)
- R-a (RT) POST /rest/v1/rpc/... is_owner has no public RPC; instead prove
  via N8/decide: decide_orchestration_approval as RT → 'owner_required'.
- R-b (RT) PATCH /system_controls {owner_stop:true} → 0 rows updated
  (RLS no-op); GET /system_controls → returns the row (read allowed).
- R-c (RT) POST/PATCH/DELETE /owners → permission denied / 0 rows.
- R-d (RT) POST/PATCH/DELETE /runtime_services → permission denied.
- R-e (RT) GET /agent_contracts, /locks → 0 rows (owner-only RLS).

CLASSIFICATION-INTEGRITY PROBE (do NOT fix; document precisely)
- C-1 (RT) POST /goal_jobs a job with a DANGEROUS objective but
  risk_class:'GREEN', requires_approval:false, status:'ready' (a
  never-gated job). Does it insert? (Expected: YES — DB has no classifier.)
- C-2 trace whether it reaches CONSEQUENTIAL execution: does the dispatcher
  select it, does the real executor run it, and do the executor's
  agent_contracts / allowed-paths / capability gates bound the side effects?
  Capture: insert result, and whether a manual dispatcher tick would execute
  it, and what the executor boundary permits. This answers "could a
  compromised runtime misclassify a dangerous job and obtain consequential
  execution without owner approval," with the exact stopping layers.

## AFTER THE MATRIX
Paste all actual responses. The agent verifies each against the Expect
column, marks STAGING PASS/FAIL, and (from the classification probe)
decides READY FOR PRODUCTION vs 0023 REQUIRED. Then rollback (if any
FAIL) or leave staging in the new state per your instruction.
