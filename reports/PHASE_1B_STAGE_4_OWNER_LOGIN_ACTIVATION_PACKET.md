# Phase 1B Stage 4 (Part A) - Owner-Login Activation Packet

Status: OWNER ACTION packet. Files-only. The AI does not perform any of
these steps, never sets env values, never creates users, and never sees
secrets. This packet is the ordered runbook for activating the Supabase
Auth owner-only login gate that is already deployed and enforcing
fail-closed setup mode.

Baseline: repo at d3c6625 (CI #19 green). The owner-login gate
(src/proxy.ts + src/lib/owner-auth.ts, 25 unit tests) is live on the
staging alias. Current live state, verified 2026-07-08:

- https://preston-os-staging.vercel.app/api/health -> {"ok":true,"mode":"setup"}
- / and /approvals -> 307 redirect to /login (fail-closed, no data served)

Scope split: Stage 4 has two parts. This packet is Part A ONLY
(Supabase Auth owner login). Part B (Google live read-only activation,
GOOGLE_OAUTH_ACCESS_TOKEN + GOOGLE_READONLY_LIVE_ENABLED) is a separate
later RED gate with its own approval wording; see
docs/PHASE_1B_GOOGLE_OAUTH_OWNER_ACTIVATION_CHECKLIST.md section L.
Do NOT set any GOOGLE_* value during Part A.

## Golden rules for this packet

- No secret, key, URL value, or token is ever pasted into the repo or
  into chat. Values live ONLY in Vercel and Supabase.
- Exactly ONE owner user. No signup flow exists by design.
- Nothing else activates in this gate: no Google, no Airtable, no
  Supabase business-data reads on the dashboard beyond what Phase 0B
  already wired, no n8n, no messaging. All eight DISABLE_* shutoff
  flags stay as they are.
- OWNER_EMAIL_ALLOWLIST is server-side only. Never create a
  NEXT_PUBLIC_ copy of it.
- The Supabase SERVICE key is never placed in any NEXT_PUBLIC_ var.

## Preflight - determine which branch you are in

History note: at Phase 0B exit (GATE_0B_REPORT.md, owner-verified),
owner login worked and /api/health said "connected", so a Supabase
staging project with migrations applied and an owner auth user existed
then. The CURRENT Vercel project (preston-os-staging, Hobby) has no env
vars set, so either the link was removed or the project was recreated.

Answer these in the Supabase dashboard before acting:

- P1: Does the Supabase staging project from Phase 0B still exist?
- P2: Table editor: do tables tasks/approvals/audit_log/briefs/
      command_packets/access_events/department_configs/owners exist?
- P3: Authentication -> Users: does the single owner user exist?
- P4: SQL editor: does `select public.is_owner();` run without error
      (function exists)?

If P1-P4 all yes -> Branch A (reconnect only). Otherwise -> Branch B.

## MIGRATION SAFETY WARNING (read before any SQL)

Never re-run 0001_phase0a_core_schema.sql on a database where
0002_phase0b_owner_rls.sql has already been applied. 0002 drops the
permissive *_auth_all policies; re-running 0001 would CREATE them
again next to the owner-only policies, and permissive policies OR
together - that silently weakens RLS back to any-authenticated access.
Apply 0001 only to a database that has never had it, and always apply
0002 after it. If unsure whether 0001 ran, check P2: if the tables
exist, do not run 0001 again.

## Branch A - reconnect existing Supabase project (no SQL needed)

- [ ] A1. Supabase dashboard -> project settings -> API: locate the
      project URL and the anon/public key. Do not copy the service key.
- [ ] A2. Confirm the owner user still exists (Authentication -> Users)
      and you know its password (reset it there if not).
- [ ] A3. Confirm the owners row exists:
      `select count(*) from owners;` should return 1.
      If it returns 0, run the bootstrap block from
      supabase/migrations/0002_phase0b_owner_rls.sql section 4
      (uncommented) once in the SQL editor.
- [ ] A4. Go to step V (Vercel env vars).

## Branch B - fresh Supabase setup

- [ ] B1. Create a new Supabase project (staging; free tier is fine).
      Region: your choice. This is STAGING, not production.
- [ ] B2. SQL editor: paste the full contents of
      supabase/migrations/0001_phase0a_core_schema.sql, run once.
      Expect success and the 10 seeded department_configs rows.
- [ ] B3. SQL editor: paste the full contents of
      supabase/migrations/0002_phase0b_owner_rls.sql, run once.
- [ ] B4. Authentication -> Add user: create the single owner user
      (your owner email + a strong password). Email confirmation:
      mark as confirmed if the dashboard offers it.
- [ ] B5. SQL editor: run the bootstrap block from 0002 section 4
      (uncomment it there; do not edit the repo file). It inserts your
      auth user into owners. Verify: `select count(*) from owners;` -> 1.
- [ ] B6. Go to step V.

## Step V - Vercel env vars (names below, values owner-only)

In the Vercel project preston-os-staging -> Settings -> Environment
Variables, set EXACTLY these three, for the Production environment
(this project labels the master-branch deploy "Production"; it is our
staging in practice):

- [ ] V1. NEXT_PUBLIC_SUPABASE_URL         (Supabase project URL)
- [ ] V2. NEXT_PUBLIC_SUPABASE_ANON_KEY    (anon/public key ONLY)
- [ ] V3. OWNER_EMAIL_ALLOWLIST            (comma-separated owner
          email(s); must include the exact email of the auth user
          from A2/B4; case does not matter, whitespace is trimmed)

Do NOT set: any GOOGLE_*, AIRTABLE_*, SUPABASE_STAGING_SERVICE_KEY,
TELEGRAM_*, N8N_*, TWILIO_*, TELNYX_*, or REMOTE_RUNNER_* value in
this gate.

- [ ] V4. Redeploy: Vercel -> Deployments -> latest -> Redeploy
      (env changes only apply to new deployments).

## Step C - verification (owner + script)

Script (read-only, prints no secrets, exits nonzero on failure), run
from the repo on any machine:

    powershell -NoProfile -File scripts\verify_stage4_owner_login.ps1

It asserts: /api/health flips to {"ok":true,"mode":"connected"}, all
protected routes still redirect unauthenticated visitors to /login,
/login itself renders, and the health body carries no extra fields.

Owner browser checks (the script cannot do these):

- [ ] C1. Open the staging alias in a private/incognito window: you
      land on /login and see NO setup-mode notice anymore.
- [ ] C2. Log in with the owner user: you reach the dashboard.
- [ ] C3. Visit /approvals, /audit, /brief, /remote while logged in:
      they render (mock/safe data), no errors.
- [ ] C4. Log out / clear cookies: protected routes redirect to /login
      again.
- [ ] C5. Wrong-password login fails with an error message.

Non-owner deny path: do NOT create a second Supabase user to test it
(one-user rule). The deny branch is covered by unit tests
(test/owner-auth.test.ts) and by the fail-closed allowlist semantics.

## Rollback

Remove the three env vars in Vercel and redeploy: the app returns to
fail-closed setup mode (only /login renders, no data). Optionally also
delete the Supabase project (Branch B installs hold no business data).

## Owner completion attestation (return this - NO values)

    STAGE 4 PART A ATTESTATION
    Branch used (A or B):            _
    Migrations 0001+0002 applied:    yes/no/already
    Exactly one owner user exists:   yes/no
    owners row count is 1:           yes/no
    Three env vars set in Vercel:    yes/no
    Redeployed after env change:     yes/no
    Script verify passed:            yes/no
    C1-C5 browser checks passed:     yes/no
    Any secret pasted anywhere:      no
    GOOGLE_* values touched:         no
