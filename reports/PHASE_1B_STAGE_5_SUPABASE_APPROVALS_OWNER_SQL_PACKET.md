# Phase 1B Stage 5 - Supabase Approvals Owner-Run SQL Packet

Status: OWNER-RUN packet. Documentation and instructions ONLY. The AI did
NOT execute any SQL, did not connect to Supabase, and did not change any
database. Every statement below is for the OWNER to review and run manually
in the Supabase SQL editor against STAGING only.

Scope: fix the Approval Center error `permission denied for table approvals`
on the staging control plane, without weakening owner-only access and
without touching production.

## 0. Hard-stop safety rules (read first)

- STAGING only. Never run any of this against production.
- Run in the Supabase SQL editor (which executes as a privileged role and
  bypasses RLS) - not from the app.
- Do NOT re-run 0001_phase0a_core_schema.sql or 0002_phase0b_owner_rls.sql
  on this database. Re-running 0001 after 0002 re-creates the permissive
  `*_auth_all` policies; permissive policies OR together and silently
  weaken RLS back to any-authenticated access. This packet uses targeted
  statements, never a full migration re-run.
- Do NOT disable RLS on any table.
- Do NOT grant anything to the `anon` role.
- Do NOT use or paste the service-role key anywhere in chat.
- Do NOT broaden access beyond the `authenticated` role, and never make a
  table publicly readable.
- The owner-only gate (`public.is_owner()` + `owners` allowlist) must remain
  the effective access control after any change here.
- Every GRANT below is safe only because RLS still narrows every row to the
  owner; the grant is the table-level privilege, RLS is the row-level gate.
  Both must stay in place.

## 1. Problem statement

The Approval Center page (`/approvals`) in connected mode reads the
`approvals` table from Supabase staging as the logged-in owner. The read
fails and the page renders the raw database error instead of approval rows.
Nothing executes; this is a read-path/permissions problem only. The
fail-closed execution guard is unaffected - no live action can run
regardless.

## 2. Current observed error

    permission denied for table approvals

Surfaced verbatim by `apps/dashboard/src/app/approvals/page.tsx` (the
`live.error` branch) from `listApprovalRows()` in
`apps/dashboard/src/lib/approvals-store.ts`.

## 3. Read-only evidence from code and migrations

Query role (decisive):
- `apps/dashboard/src/lib/supabase/server.ts` - `getServerSupabase()` builds
  an SSR client from `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  and the user's session cookie. The query therefore executes as the
  Postgres `authenticated` role, subject to BOTH table GRANTs and RLS.

RLS and policies:
- `supabase/migrations/0001_phase0a_core_schema.sql`
  - line 164: `alter table approvals enable row level security;`
  - lines 173-174: `create policy approvals_auth_all on approvals for all
    to authenticated using (true) with check (true);`
  - The file contains NO explicit `grant ... on approvals to authenticated;`.
    It relies on Supabase default privileges for new public tables.
- `supabase/migrations/0002_phase0b_owner_rls.sql`
  - Drops `approvals_auth_all` and creates `approvals_owner_all` (`for all
    to authenticated using (public.is_owner()) with check (public.is_owner())`).
  - Adds the `owners` table and `public.is_owner()` (security definer).
  - Section 4 bootstrap insert into `owners` ships COMMENTED; the owner runs
    it once manually.

Error-semantics reasoning (why this narrows the cause):
- Postgres error `permission denied for table X` (SQLSTATE 42501) is a
  TABLE-LEVEL GRANT failure for the querying role. It fires before RLS row
  filtering.
- A missing `owners` row is different: `public.is_owner()` returns false,
  RLS filters every row out, and a SELECT returns ZERO ROWS with NO error.
  In that case the page shows "No approval rows in the control plane yet."
  (the `live.rows.length === 0` branch), NOT a permission error.
- Therefore the observed `permission denied` most directly indicates the
  `authenticated` role lacks the table GRANT on `approvals` (Branch B).
  Branch A (owners bootstrap) is still required for the owner to actually
  SEE rows once the grant is fixed, and Branch C is a security check for a
  possible policy regression. The preflight below settles which apply.

## 4. Preflight SQL (owner runs manually; READ-ONLY, no changes)

Run each block in the Supabase SQL editor (STAGING). None of these modify
data. Record the outputs before running any fix.

P1 - RLS is enabled on approvals (expect rowsecurity = true):

    select relname, relrowsecurity as rls_enabled
    from pg_class
    where relname = 'approvals';

P2 - policies on approvals (expect exactly one: approvals_owner_all):

    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'approvals'
    order by policyname;

P3 - table grants for the authenticated role (the decisive check):

    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'approvals'
      and grantee = 'authenticated'
    order by privilege_type;

P4 - owner allowlist contents (expect exactly the owner email):

    select count(*) as owner_rows from owners;

    select o.user_id, u.email
    from owners o
    join auth.users u on u.id = o.user_id;

P5 - is_owner() helper exists (expect one row):

    select proname
    from pg_proc
    where proname = 'is_owner';

## 5. Decision tree

Read the preflight outputs in this order:

Branch C first (security regression check) - P2:
- If P2 lists BOTH `approvals_owner_all` AND a leftover `approvals_auth_all`
  (using = true): RLS has been weakened (0001 was likely re-run after 0002).
  Go to Branch C fix. This does not cause the permission error but must be
  corrected before anything else.

Branch B (missing GRANT) - P3:
- If P3 returns NO rows for `authenticated` (the role has no privileges on
  `approvals`): this is the cause of `permission denied`. Go to Branch B fix.

Branch A (owners bootstrap) - P4:
- If P4 `owner_rows` = 0, or the joined email is not the owner's login email:
  the owner is not yet in the allowlist. After Branch B is fixed the page
  would show zero rows until this is done. Go to Branch A fix.
- If P5 returns no row, `is_owner()` is missing (0002 not fully applied) -
  STOP and report; do not patch piecemeal, the migration state is
  inconsistent and needs owner review.

Typical outcome: Branch B fixes the visible error; Branch A is then needed
for the owner to see real rows. Apply B, then A, then re-verify.

## 6. Minimal proposed owner-run SQL (per branch)

Apply ONLY the branch(es) the preflight indicates. Run one block, then
re-check, before running the next.

Branch B - grant the table privileges the app needs to `authenticated`
(RLS still restricts every row to the owner; delete is intentionally
omitted - the app never deletes approvals):

    grant select, insert, update on table approvals to authenticated;

  Note: if P3 later shows the same gap on other control-plane tables the
  dashboard reads (tasks, briefs, command_packets, department_configs,
  audit_log), grant them the same minimal privileges to `authenticated`
  only - never to `anon`. Do this only for tables the app actually reads,
  and only after confirming the gap with the P3 query re-pointed at that
  table name.

Branch A - bootstrap the owner into the allowlist (runs as the SQL editor's
privileged role, which bypasses the owners write restriction). Replace the
email ONLY if the owner login email differs from the one already in the repo
bootstrap block:

    insert into owners (user_id, note)
    select id, 'primary owner'
    from auth.users
    where email = 'info@preston.nyc'
    on conflict (user_id) do nothing;

  This is the same block shipped commented in
  supabase/migrations/0002_phase0b_owner_rls.sql section 4. Do not edit the
  repo migration file; run this ad hoc in the SQL editor.

Branch C - remove the weakening permissive policy if preflight P2 found it:

    drop policy if exists approvals_auth_all on approvals;

  Verify P2 afterward shows only `approvals_owner_all`. Do NOT drop
  `approvals_owner_all`. If other tables show the same leftover
  `*_auth_all` policy, drop each leftover permissive policy the same way,
  one at a time, re-checking P2 (re-pointed) after each.

## 7. Verification checklist (after owner runs the chosen fix)

Database-side (SQL editor, read-only):
- [ ] P3 now lists `authenticated` with SELECT (and INSERT/UPDATE) on
      approvals.
- [ ] P2 shows exactly `approvals_owner_all` (no `approvals_auth_all`).
- [ ] P4 shows exactly one owner row matching the owner login email.
- [ ] P5 shows `is_owner` present.

App-side (owner, authenticated browser, Preview URL):
- [ ] /approvals no longer shows `permission denied for table approvals`.
- [ ] The page shows either real approval rows or the benign
      "No approval rows in the control plane yet." message.
- [ ] Header still reads "CONTROL PLANE - decisions only, no execution".
- [ ] No Approve/Reject click executes anything (by design the execution
      guard blocks all live action types; a decision records control-plane
      state only).
- [ ] A logged-out / incognito visitor is still redirected to /login
      (owner gate intact).

Regression guard:
- [ ] Confirm no policy now uses `using (true)` on any business table
      (re-run P2 per table if unsure). Owner-only access must be intact.

## 8. Rollback notes

- Branch B rollback (if ever needed): `revoke select, insert, update on
  table approvals from authenticated;` returns to the permission-denied
  state. This does not expose data (it only removes access).
- Branch A rollback: `delete from owners where user_id = '<uuid-from-P4>';`
  removes owner access; the account then sees zero rows (fail-closed).
  Use the exact UUID from P4; never a broad delete.
- Branch C is itself a corrective removal; to restore a dropped permissive
  policy would REWEAKEN RLS - do not do this. There is no safe rollback that
  re-adds `*_auth_all`; leave it removed.
- None of these fixes drop data or alter rows in business tables, so there
  is no data-loss rollback to perform.

## 9. Statement of non-execution

The AI (Claude) did NOT execute any SQL, did NOT connect to Supabase, did
NOT read or handle any secret, key, token, or env value, and did NOT change
any database, policy, grant, or row. This packet is text prepared from
read-only inspection of repo migrations and application code. All SQL herein
is proposed for the OWNER to review and run manually against STAGING only.

## 10. Next gate after this fix

Once the Approval Center reads cleanly, the next control-plane step is
verifying the owner-decision write path (Approve/Reject records a decision +
audit_log row, executes nothing) on staging - a separate owner-run
validation, no production, no live sends/writes.
