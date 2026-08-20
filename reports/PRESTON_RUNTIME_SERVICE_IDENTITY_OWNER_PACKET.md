# PRESTON — RUNTIME SERVICE IDENTITY + DECIDE-AUDIT FIX — OWNER PACKET

Status: DRAFT (staging-first). Closes the R-2 root cause (standing
human-owner runtime session) and the swallowed decide-audit defect.
Nothing here is applied yet. Agent verifies each step after you run it.

Fixes in this packet:
- 0020_runtime_service_identity.sql — dedicated NON-owner runtime
  identity; runtime can operate the goal graph but CANNOT decide
  approvals or write system_controls.
- 0021_decide_audit_failclosed.sql — every approval decision writes one
  append-only access_events row inside the decide transaction
  (fail-closed; records auth.uid + is_owner).
- apps/dashboard/src/app/os/orchestration/actions.ts — app-level audit
  no longer swallowed (defense in depth; rides the next dashboard deploy).

Regression tests: apps/dashboard/test/migration-0020.test.ts,
migration-0021.test.ts (17 static pins, green). Full matrix 1348 pass +
1 xfail + 5 known Windows bash-ENOENT; secret/RED scans 0/0.

---

## STAGE 1 — STAGING: create the service user

Staging Supabase project (ref vcqtlmlaxxankxyezlul), owner-only:

1. Auth → Users → Add user → create `runtime@service.preston` (or any
   address you control). Do NOT add it to the owners table.
2. Copy its user UUID (Auth → Users → the new row → User UID).

## STAGE 2 — STAGING: apply 0020 + 0021, register the service user

In a psql session against STAGING (session pooler, port 5432), owner
password at the prompt. Apply in order:

```
\i supabase/migrations/0020_runtime_service_identity.sql
\i supabase/migrations/0021_decide_audit_failclosed.sql
insert into public.runtime_services (user_id, note)
  values ('<STAGING_RUNTIME_SERVICE_USER_UUID>', 'preston runtime (non-owner)')
  on conflict (user_id) do nothing;
```

Reply "0020/0021 staging applied" — the agent verifies:
- is_runtime_service() exists; runtime_services has the one row;
- decide_orchestration_approval body contains the access_events insert;
- a dummy decide with a non-owner token still returns owner_required.

## STAGE 3 — STAGING: re-seed the runtime with the service identity

On the STAGING host (preston-agent-staging), you seed the runtime's
Supabase session from the SERVICE user instead of the owner:

1. Obtain a refresh token for `runtime@service.preston` (sign in once as
   that user; the runtime persists+refreshes it). Keep it off-chat.
2. Re-seed exactly as the runtime expects (same mechanism as today):
   `read -s SUPABASE_RUNTIME_REFRESH_TOKEN` (paste), then the runtime's
   token-store is rewritten on next tick. Then in Supabase Auth, sign
   out the OWNER user's staging sessions.
3. Run one staging orchestrator tick and confirm it still composes /
   writes goals+jobs (it should — the service identity is now allowed).

Reply "staging runtime re-seeded" — the agent runs a STAGING R-2-style
drill end to end and confirms:
- the runtime can create goals/jobs/pending approvals;
- the runtime CANNOT decide (a runtime-initiated decide → owner_required);
- a human owner dashboard approval DOES decide and lands exactly one
  access_events row with is_owner=true;
- system_controls is readable but not writable by the runtime.

## STAGE 4 — PRODUCTION PROMOTION (owner action)

Only after staging passes. Exact owner action:

1. Prod Supabase (ref hiqsymsiwonmvrbbqhhe): Auth → Users → create the
   dedicated `runtime@service.preston` PROD user (not in owners); copy UID.
2. psql against PROD (session pooler, owner password), apply in order:
   ```
   \i supabase/migrations/0020_runtime_service_identity.sql
   \i supabase/migrations/0021_decide_audit_failclosed.sql
   insert into public.runtime_services (user_id, note)
     values ('<PROD_RUNTIME_SERVICE_USER_UUID>', 'preston runtime (non-owner)')
     on conflict (user_id) do nothing;
   ```
3. On preston-agent-prod: re-seed SUPABASE_RUNTIME_REFRESH_TOKEN from the
   PROD service user (same read -s mechanism), let one tick rewrite the
   token-store, then in Supabase Auth SIGN OUT the owner user's sessions
   (this is the revocation that removes standing owner authority from the
   host).
4. Redeploy the dashboard (Vercel) to ship the actions.ts hardening
   (optional/independent; the DB audit already guarantees the record).

Reply "prod promoted" — the agent verifies the prod runtime baseline is
intact, the runtime holds a NON-owner session (cannot decide / cannot
write controls), and the decide-audit row lands on a real owner approval.

## ROLLBACK

- 0020/0021 are CREATE-OR-REPLACE / additive policies. Rollback =
  re-apply 0010's original decide function and re-run 0010's policy
  block (owner-only predicates), and `delete from public.runtime_services`.
- Re-seeding is reversible by seeding the owner refresh token again
  (not recommended — that reinstates the defect).

## AFTER PROMOTION — FRESH R-2 DRILL (new ids, fully instrumented)

New identifiers (NEVER reuse the old R-2 ids):
- request_id: `rops-prod-drill-3`
- (goal/job/approval ids are DB-generated fresh)

Required, in order, with evidence captured at each step:
1. Phone submits rops-prod-drill-3 (neutral hermes_mode doc text) →
   accepted.
2. Timer consumes → goal parks → PENDING approval visible on the phone
   dashboard (screenshot #1: the pending approval card + time).
3. Owner taps Approve on preston-os-prod.vercel.app (screenshot #2: the
   approved confirmation + visible timestamp).
4. Owner hands off ALL workstations ≥ 15 min.
5. Timer-driven tick executes the job (no manual tick).
6. Attribution recorded: the new 0021 access_events row shows
   is_owner=true + the owner auth.uid; a Vercel POST to /os/orchestration
   at the tap time is captured.
7. Final DB/log verification by the agent; drill marked PASS only if the
   full chain + both screenshots + the audit row all line up.
