# Preston OS - Owner Runbook (Staging-Live, Read-Only)

One page. Do these in order to reach usable staging-live. No secrets go in
chat - all values are entered only in Supabase and Vercel. Preview only.
Production is never touched. Nothing here sends, writes, or approves.

Two independent activations remain: Supabase approvals (SQL) and Airtable
TEST (env). They can be done in either order. Do the git push first so the
committed packets are on GitHub.

--------------------------------------------------------------------------
STEP 0 - Push the committed docs (one command, on your machine)
--------------------------------------------------------------------------
In the Claude Code prompt, run:

    ! git push origin master

This pushes three commits (Stage 4 closeout + calendar observability, Stage 5
SQL packet, Stage 6 Airtable packet). It updates the GitHub repo and the
Vercel Preview build only. It does not touch Production.

--------------------------------------------------------------------------
STEP 1 - Fix Approval Center (Supabase, STAGING SQL editor)
--------------------------------------------------------------------------
Full detail: reports/PHASE_1B_STAGE_5_SUPABASE_APPROVALS_OWNER_SQL_PACKET.md

1. Open Supabase (staging project) -> SQL editor.
2. Run preflight P1-P5 from the packet (read-only SELECTs).
3. Share back ONLY: row counts, policy names, grant rows, booleans.
   No keys, no tokens, no connection strings.
4. Wait for Claude to confirm the exact minimal fix (Branch B/A/C).
5. Run the confirmed fix SQL (typically:
   `grant select, insert, update on table approvals to authenticated;`
   and the owners bootstrap insert). Never disable RLS, never grant to anon,
   never re-run 0001/0002.
6. Re-run the packet's verification checklist.

--------------------------------------------------------------------------
STEP 2 - Connect Airtable TEST data (Vercel Preview env)
--------------------------------------------------------------------------
Full detail: reports/PHASE_1B_STAGE_6_AIRTABLE_TEST_ACTIVATION_PACKET.md

1. Airtable -> create a read-only PAT: scope `data.records:read` only,
   restricted to the ONE approved TEST/DEV base. No write scopes, no
   workspace-wide access.
2. Vercel -> project preston-os-staging -> Settings -> Environment Variables.
   Add these, scoped to PREVIEW only (never Production, none NEXT_PUBLIC_):
     - AIRTABLE_TEST_PAT          (the read-only PAT)
     - AIRTABLE_TEST_BASE_ID      (the TEST base id, app...)
     - AIRTABLE_TBL_APPOINTMENTS  (tbl... in that base)  <- Today card
     - AIRTABLE_TBL_LEADS         (tbl...)                <- Leads card
     - AIRTABLE_TBL_PROJECTS      (tbl...)                <- Projects card
     - AIRTABLE_TBL_QUOTES        (tbl...)                <- Quotes card
   (Cards without a table id stay safe MOCK - that is expected.)
3. Vercel -> Deployments -> current Preview -> Redeploy, with
   "Use existing Build Cache" UNCHECKED.
4. Log in and confirm the cards show `source: AIRTABLE TEST/DEV` instead of
   MOCK. No edit controls appear; reads only.

--------------------------------------------------------------------------
STEP 3 - Confirm usable staging-live
--------------------------------------------------------------------------
- [ ] Owner login works (already PASS).
- [ ] /brief shows read-only Gmail + Calendar (already PASS).
- [ ] Dashboard cards show AIRTABLE TEST/DEV (after Step 2).
- [ ] Approval Center lists rows or "No approval rows..." with no permission
      error (after Step 1).
- [ ] Production untouched; no sends/writes/approvals occurred.

--------------------------------------------------------------------------
HARD STOPS (stop and ask before proceeding)
--------------------------------------------------------------------------
- Any base id that is not the approved TEST base.
- Any PAT with production access or write/create/delete scope.
- Any request to disable RLS, grant to anon, or re-run migrations.
- Any step that appears to require Production or a service-role key in chat.
- Any prompt to send a message or write a live record.

--------------------------------------------------------------------------
WHAT CLAUDE WILL NOT DO (by design)
--------------------------------------------------------------------------
Claude does not run SQL, does not change Vercel env, does not call Airtable
live, does not push (the local safety hook blocks outbound git - you run the
push), and never handles secret values. Claude prepares exact steps; you
execute the external ones.
