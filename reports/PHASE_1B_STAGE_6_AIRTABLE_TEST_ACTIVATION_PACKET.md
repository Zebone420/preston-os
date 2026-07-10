# Phase 1B Stage 6 - Airtable TEST Activation Packet

Status: OWNER-RUN packet. Documentation and instructions ONLY. The AI did
NOT set, edit, or read any env var value, did NOT call Airtable, and did NOT
change any deployment. Every step below is for the OWNER to perform manually
in Airtable and Vercel, against the Preview (staging) environment only.

Goal: move the dashboard cards from MOCK to READ-ONLY Airtable TEST/DEV data
on the Vercel Preview deployment, with the TEST-base lock and no write path.

## 0. Hard-stop safety rules (read first)

- Preview (staging) environment only. Never set these in Production.
- Never use the production Airtable base. The base id you configure MUST be
  the approved TEST/DEV base.
- The PAT must be read-only and scoped to the single TEST base. No write
  scopes, no workspace-wide access if a narrower PAT is possible.
- Do NOT paste the PAT (or any value) into chat. Values live only in Vercel.
- Do NOT enable any Airtable write path. Writes are code-blocked (Phase 0B).
- Do NOT run n8n, SQL, or any production action as part of this gate.
- STOP and report if any of the following is true:
  - the base id is not the approved TEST base,
  - the PAT has production access or any write/create/delete scope,
  - any code path attempts an Airtable write,
  - Production env would be required.

## 1. Problem statement

The dashboard cards (Today, Leads, Projects, Quotes) render MOCK data with a
"setup mode: Airtable TEST env not configured" note, because the Airtable
TEST environment variables are not set in the Preview deployment. This is a
read-path configuration gap only; nothing is broken and nothing writes.

## 2. Exact evidence from code (read-only inspection)

Env var checks:
- `apps/dashboard/src/lib/airtable.ts`
  - line 23: `const pat = env['AIRTABLE_TEST_PAT'];`
  - line 24: `const allowed = env['AIRTABLE_TEST_BASE_ID'];`
  - line 27-29: throws `GuardError` if `AIRTABLE_TEST_PAT` is missing.
- `apps/dashboard/src/lib/cards.ts`
  - line 72: `const baseId = env['AIRTABLE_TEST_BASE_ID'];`
  - line 73: `const tableId = env[tableEnvName];` (per-card table id)

Mock fallback (why cards show MOCK):
- `cards.ts` lines 74-79:
  - if `AIRTABLE_TEST_BASE_ID` or `AIRTABLE_TEST_PAT` missing ->
    `mock(key, 'setup mode: Airtable TEST env not configured')`.
  - if the per-card table id env var is missing ->
    `mock(key, 'setup mode: <AIRTABLE_TBL_*> not configured')`.
- `cards.ts` lines 87-89: on any read error the card falls back to mock with
  `'airtable read failed: ' + message` (fail-safe, never throws to the page).

TEST-base lock (enforced, cannot be bypassed by the app):
- `airtable.ts` line 26 calls `assertAirtableTestOnly(baseId, allowed)`.
- `packages/guards/src/index.ts` lines 49-63:
  - throws if `AIRTABLE_TEST_BASE_ID` is empty, and
  - throws `'airtable guard: base is not on the TEST/DEV allowlist'` if the
    requested base id does not exactly equal `AIRTABLE_TEST_BASE_ID`.
  - Because `cards.ts` passes `AIRTABLE_TEST_BASE_ID` as BOTH the base to
    read and the allowlist value, the app can only ever read that one base.
    There is no code path that reads any other (e.g. production) base.

Read-only confirmation:
- `airtable.ts` lines 32-43: a single HTTP GET to
  `https://api.airtable.com/v0/<baseId>/<tableId>?maxRecords=...&returnFieldsByFieldId=true`
  with `Authorization: Bearer <PAT>`. No POST/PATCH/DELETE anywhere.
- `airtable.ts` lines 52-54: `writeRecords()` throws unconditionally
  (`'airtable: writes are blocked in Phase 0B'`).
- `env.template` line 14: `DISABLE_AIRTABLE_PROD_WRITES=true`.

Source rendering:
- On success, `cards.ts` returns `source: 'airtable_test'`. The dashboard
  page maps that to the label `AIRTABLE TEST/DEV`
  (`apps/dashboard/src/app/page.tsx`), replacing the MOCK label.

## 3. Exact owner-run Vercel Preview env setup

Set these in Vercel -> project `preston-os-staging` -> Settings ->
Environment Variables, scoped to **Preview** only. Do NOT tick Production.
None of these is `NEXT_PUBLIC_` - they are all server-side only.

Required for any live read:
- [ ] `AIRTABLE_TEST_PAT`      - the read-only PAT (value entered in Vercel
      only; never in chat).
- [ ] `AIRTABLE_TEST_BASE_ID`  - the approved TEST/DEV base id
      (starts with `app...`). This is also the allowlist; it must be the
      TEST base, never production.

Required for the cards to leave MOCK (each card stays mock until its table
id is set - this is the step most likely to be missed):
- [ ] `AIRTABLE_TBL_APPOINTMENTS` - table id (starts with `tbl...`) for the
      Today card.
- [ ] `AIRTABLE_TBL_LEADS`        - table id for the Leads card.
- [ ] `AIRTABLE_TBL_PROJECTS`     - table id for the Projects card.
- [ ] `AIRTABLE_TBL_QUOTES`       - table id for the Quotes card.

Notes:
- All table ids must be tables INSIDE the base named by
  `AIRTABLE_TEST_BASE_ID`. Find them via the Airtable API docs page for the
  TEST base (each table's id is shown there) or the base URL.
- You may activate cards incrementally: set only the table ids you have;
  cards without a table id remain safe MOCK with a clear note.
- Do NOT set `AIRTABLE_PROD_READONLY_PAT` or any production Airtable var in
  this gate.

## 4. Airtable PAT safety requirements

When creating the Personal Access Token in Airtable
(https://airtable.com/create/tokens):
- Scope: `data.records:read` only. Optionally `schema.bases:read` if needed
  to look up table ids; nothing more.
- Do NOT grant `data.records:write`, `data.recordComments:write`,
  `schema.bases:write`, or any create/delete scope.
- Access: restrict the token to the single approved TEST/DEV base only. Do
  NOT grant "all current and future bases" or workspace-wide access.
- The token value goes ONLY into the Vercel Preview `AIRTABLE_TEST_PAT`
  variable. Never paste it into chat, code, the repo, or any doc.
- If an existing PAT is broader than read-only-single-base, create a new
  narrower one rather than reusing it.

## 5. Redeploy instructions

Env changes only apply to new builds.
- [ ] Vercel -> Deployments -> the current Preview deployment (master) ->
      the three-dot menu -> Redeploy.
- [ ] UNCHECK "Use existing Build Cache".
- [ ] Wait for status Ready.

## 6. Validation checklist (owner, authenticated browser)

- [ ] Open the dashboard on the Preview URL while logged in.
- [ ] The four cards (Today, Leads, Projects, Quotes) that have a table id
      set now show the source label `AIRTABLE TEST/DEV` instead of MOCK.
- [ ] The listed records match the TEST/DEV base content (not production).
- [ ] Any card without a table id still shows MOCK with a clear
      "setup mode: <AIRTABLE_TBL_*> not configured" note (expected).
- [ ] No write occurs and no edit control appears - the cards are read-only
      lists.
- [ ] Approval Center is unaffected by this change (it reads Supabase, a
      separate path; if the Supabase approvals fix from Stage 5 is not yet
      applied, that error is independent of Airtable).
- [ ] /brief is unaffected (Gmail/Calendar path is separate).
- [ ] Owner login gate still intact: logged-out visitor -> /login.

Optional evidence: if a card shows "airtable read failed: http 401/403",
the PAT is wrong or lacks access to the base; "base is not on the TEST/DEV
allowlist" means the base id passed does not match `AIRTABLE_TEST_BASE_ID`
(should not happen when only that one var is used). Both fail SAFE to mock.

## 7. Rollback

- Remove (or clear) the Airtable Preview env vars in Vercel and redeploy
  with build cache unchecked. The cards immediately fall back to MOCK with
  the setup-mode note. No data is affected.
- Alternatively, remove only the `AIRTABLE_TBL_*` ids to return specific
  cards to MOCK while leaving the base/PAT in place.
- No database changes are involved; there is nothing to roll back in
  Supabase or anywhere else.

## 8. Hard-stop warnings (repeat)

- STOP if `AIRTABLE_TEST_BASE_ID` is not the approved TEST/DEV base.
- STOP if the PAT carries production access or any write/create/delete
  scope.
- STOP if any code path is found attempting an Airtable write (none exists
  today; `writeRecords()` throws).
- STOP if Production env is required for any step here (it is not).

## 9. Statement of non-execution

The AI (Claude) did NOT set, edit, delete, or read any environment variable
value; did NOT create or use any Airtable PAT; did NOT call the Airtable API;
did NOT redeploy anything; and did NOT handle any secret. This packet was
prepared solely from read-only inspection of repo code
(`airtable.ts`, `cards.ts`, `packages/guards/src/index.ts`, `env.template`,
`page.tsx`). All actions above are for the OWNER to perform manually against
Preview only.

## 10. Next gate after this

With Airtable TEST reads live and the Stage 5 Supabase approvals fix applied,
the dashboard + Approval Center + /brief are all populated from real
read-only sources on staging - the "usable staging-live, read-only" milestone.
The following gate (separate, owner-approved) would be validating the
owner-decision write path on the control plane (records a decision + audit
row, executes nothing).
