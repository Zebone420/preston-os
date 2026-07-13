# Phase 1B Stage 8 - Approval Center Write-Path Owner-Run SQL Packet

Status: OWNER-RUN packet. Documentation and instructions ONLY. The AI did
NOT execute any SQL, did not connect to Supabase, did not create or approve
any record, and did not handle any secret. Every statement below is for the
OWNER to review and run manually in the Supabase SQL editor against STAGING
only.

Scope: enable the owner Approve/Reject decision to WRITE to the staging
control plane (a decision row update + an audit row), which recording a
decision requires. This does NOT execute any business action - the
execution guard still blocks every live action type (see section 9).

## 0. Hard-stop safety rules (read first)

- STAGING only. Never run against production.
- Grant to the `authenticated` role ONLY. Never to `anon`.
- Do NOT disable RLS. Do NOT re-run 0001/0002 migrations.
- Keep audit_log APPEND-ONLY: grant INSERT only; update/delete stay revoked
  (0001 revoked them from authenticated/anon - leave that as is).
- Do NOT grant DELETE on approvals. The app never deletes approvals.
- Do NOT use the service-role key in the app or in chat.
- The owner-only gate (public.is_owner() + owners allowlist) and the
  fail-closed execution guard must remain intact after this change.

## 1. Problem statement

Stage 5 granted only SELECT on approvals, so the READ path works. When the
owner clicks Approve or Reject, the decision path additionally UPDATEs the
approvals row and INSERTs an audit_log row. Without those table GRANTs for
the authenticated role, the click will fail with permission denied - even
though the RLS policies already allow the owner. This gate adds exactly the
two missing GRANTs and (optionally) one test row to validate end to end.

## 2. Read-only evidence from code and migrations

Decision write path:
- apps/dashboard/src/app/approvals/actions.ts - the Server Action re-checks
  owner identity (isOwnerEmail) BEFORE any write; unauthenticated/non-owner
  POSTs change nothing.
- apps/dashboard/src/lib/approvals-store.ts decideApprovalRow():
  - UPDATE approvals SET decision, decision_at, explicit_confirmation=false
    (+ optional notes) WHERE id = <uuid> AND decision = 'pending', then
    `.select('id')` (RETURNING id - needs SELECT, already granted Stage 5).
  - INSERT into audit_log (actor='owner', action='approval_decision:...',
    action_class='GREEN', environment='staging', production_touched=false,
    write_actions_performed=false, secrets_exposed=false, detail jsonb).

RLS already permits the owner (no policy change needed):
- 0002 approvals_owner_all: `for all to authenticated using is_owner() with
  check is_owner()` - covers UPDATE.
- 0002 audit_log_owner_insert: `for insert to authenticated with check
  is_owner()` - covers INSERT.

Missing piece = table-level GRANTs only (same class as the Stage 5 SELECT
gap). 0001 grants nothing explicitly and revokes update/delete on audit_log.

## 3. Preflight SQL (owner runs manually; READ-ONLY)

P1 - current grants for authenticated on the two tables:

    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('approvals','audit_log')
      and grantee = 'authenticated'
    order by table_name, privilege_type;

  Expect approvals -> SELECT present (from Stage 5). Likely MISSING:
  approvals UPDATE, audit_log INSERT. Confirm before granting.

P2 - policies still owner-only (no permissive leftovers):

    select tablename, policyname, cmd, roles
    from pg_policies
    where schemaname = 'public'
      and tablename in ('approvals','audit_log')
    order by tablename, policyname;

  Expect approvals_owner_all and audit_log_owner_insert (+ owner select on
  audit_log). If any `*_auth_all` (using true) appears, STOP - fix that per
  Stage 5 packet Branch C first.

## 4. Minimal proposed owner-run SQL

Run only what P1 shows missing. Grant to authenticated ONLY.

    grant update on public.approvals to authenticated;
    grant insert on public.audit_log to authenticated;

Notes:
- No DELETE on approvals; no UPDATE/DELETE on audit_log (append-only kept).
- RLS still narrows every write to the owner; the grant is the table-level
  privilege, RLS is the row gate. Both remain in force.

## 5. Optional test approval row (validate end to end)

The approvals table is empty, so there is nothing to Approve yet. To test,
insert ONE pending row in the SQL editor (runs as the privileged role;
task_id is nullable so this needs no tasks row):

    insert into public.approvals (requested_action, action_class)
    values ('TEST - staging control-plane decision check', 'GREEN');

Then in the browser (owner, logged in): open /approvals, click Approve on
that row. Expect the banner "Decision recorded. Nothing was executed." and
the row decision flips to approved.

## 6. Verification checklist (after grants + test row)

Database (SQL editor, read-only):
- [ ] P1 now shows approvals: SELECT+UPDATE, audit_log: INSERT for
      authenticated (still no delete on approvals; no update/delete on
      audit_log).
- [ ] `select decision, decision_at, explicit_confirmation from approvals
      where requested_action like 'TEST -%';` -> decision=approved,
      decision_at set, explicit_confirmation=false.
- [ ] `select action, action_class, production_touched,
      write_actions_performed from audit_log order by created_at desc
      limit 1;` -> action='approval_decision:approved', action_class='GREEN',
      both booleans false.

App (owner, authenticated browser):
- [ ] Approve/Reject no longer errors; banner confirms a decision recorded,
      nothing executed.
- [ ] A second click on the same row returns "not found or no longer
      pending; nothing changed" (conditional update is race-safe).
- [ ] /brief and dashboard cards unaffected. Owner login gate intact.

## 7. Rollback

- `revoke update on public.approvals from authenticated;`
- `revoke insert on public.audit_log from authenticated;`
  Returns Approve/Reject to permission-denied (no data exposed).
- Remove the test row (use its id from the select above):
  `delete from public.approvals where requested_action like 'TEST -%';`
  (Owner-run in the SQL editor; the app never deletes approvals.)
- No business data is affected; audit_log rows are append-only by design -
  leave any real ones in place.

## 8. Hard-stop warnings

- STOP if P1/P2 show a permissive `*_auth_all` policy - fix RLS first.
- STOP if asked to grant to anon, disable RLS, or use the service-role key.
- STOP if any request would run this against production.
- STOP if a decision appears to trigger a live send/write - it must not;
  see section 9.

## 9. Why recording a decision executes nothing

Recording a decision is control-plane state only. Execution is separately
governed by evaluateExecution() in apps/dashboard/src/lib/approvals.ts,
which in this phase blocks: any risk class RED/BLACK, any non-approved
effective status, production, and the DISABLE_* shutoff flags. decideApprovalRow
also sets explicit_confirmation=false on purpose, so the explicit
confirmation that RED execution would require is never satisfied by a click.
No send, no business write, no calendar/email/Airtable/n8n action occurs.

## 10. Statement of non-execution

The AI (Claude) did NOT execute any SQL, did NOT connect to Supabase, did
NOT insert/update/approve/reject any record, and did NOT handle any secret.
This packet was prepared from read-only inspection of repo code and
migrations. All SQL herein is for the OWNER to review and run manually
against STAGING only.
