# PHASE 6 - STAGING DEPLOYMENT OWNER PACKET
# Business Command Center V1 (owner-run; Claude deploys nothing)

Date: 2026-07-21
Applies to: the Phase 6 commit range starting at 04c3c75 (exact
final commit listed in the Phase 6 closeout report).
Deployment surfaces: (a) Vercel Preview dashboard, (b) staging
host preston-agent-staging /srv/preston-os (only if the owner
wants the dashboard served there; the os-runtime dispatchers are
UNCHANGED by Phase 6 and do not need redeployment).

## 0. Preconditions

1. Owner has pushed the Phase 6 commits to origin/master
   (Claude does not push).
2. Migration 0009 applied to Supabase STAGING per
   reports/PHASE_6_MIGRATION_0009_OWNER_PACKET.md.
3. Optional: fixtures applied per
   supabase/fixtures/business_staging_fixtures.sql.
No new environment variables are required. No credential changes.
Execution, Hermes, and Remote Runner settings are untouched.

## 1. Vercel Preview (primary review surface)

1. Push to origin/master (or the Preview branch you use).
2. Vercel builds automatically (Root Directory apps/dashboard,
   files-outside-root enabled - unchanged settings).
3. Verify the deployment used the intended commit hash.

## 2. Owner verification checklist (read-only, ~10 minutes)

A. Sign in as owner. Confirm /business shows the CONNECTED badge
   (SUPABASE STAGING), not SETUP MODE.
B. /business: stat tiles render; with fixtures expect 4 active
   leads, 1 active project, exceptions 0.
C. /business/pipeline: leads bucketed by stage.
D. /business/quotes: run the quote-draft agent once with the
   fixture client (e.g. 1 window, qty 1, material 1000, labor
   500, NYC installation). Expect redirect to the new quote page
   with SIMULATION badges, totals, schedule, assumptions, and
   an entry in /business/activity plus a pending row in
   /approvals with a "view quote draft" link.
E. /approvals: approve the draft. Expect "Decision recorded.
   Nothing was executed." and an audit_log row
   (approval_decision:approved) on /audit.
F. /business/agents: quote-draft run listed; safety posture shows
   execution_enabled false, runner false, hermes observe_only or
   disabled (whatever the current owner-set staging state is).
G. Confirm /, /approvals, /os, /brief still behave as before
   (no regression).
H. Signed-out browser: every /business URL redirects to /login.

## 3. Staging host (optional, only if serving the dashboard there)

The Phase 6 change is dashboard + library code; the compiled
os-runtime dispatcher subtree is untouched (verified by
`npm run build:os-runtime` and dispatcher health exit 78 with no
env). If the host serves the dashboard, deploy per the standing
process in reports/PHASE_4B1_STAGING_DEPLOYMENT_OWNER_PACKET.md
sections 8 (build) using the Phase 6 commit; no systemd, timer,
identity, or token changes are part of this phase.

## 4. Rollback

Vercel: promote the previous deployment (instant). Git: the
Phase 6 range is additive; reverting = owner-run revert commits.
Database: migration 0009 tables can remain in place harmlessly if
the app is rolled back (unused tables; owner-only RLS).

## 5. Stop conditions

Stop and report: any 500 on a /business page in connected mode;
any page showing fixture-labeled data while CONNECTED; any
approval decision reporting execution; any regression on the
pre-Phase-6 pages; any RLS error other than the documented
read-failure notes.
