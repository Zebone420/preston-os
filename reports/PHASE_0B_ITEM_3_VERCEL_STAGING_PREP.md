# Phase 0B - Item 3: Vercel Staging Prep (PREP ONLY)

Repo C:\dev\preston-os, branch master, HEAD 5654e5a
(origin/master owner-verified at 5654e5a).
Scope: prep only. No deploy, no Vercel project, no env values, no secrets.
Deploy waits for a ChatGPT Review Checkpoint.

## Build target (verified)

App: apps/dashboard, Next.js 16.2.10 (Turbopack).
Routes: / /audit /login /api/health.
Auth gate apps/dashboard/src/proxy.ts: owner login required on all routes
except /login and /api/health once Supabase env is set.
Dashboard imports guards from outside its dir:
apps/dashboard/src/lib/guards.ts -> ../../../../packages/guards/src/index.
next.config.ts sets turbopack.root to repo root so this resolves.
No repo-root package.json, no workspace, no vercel.json.

## Local validation (this run)

guards tests 20/20 PASS. dashboard tests 20/20 PASS. lint clean.
next build SUCCESS (cross-root guards import resolves; 5 routes).
secret scan 0. RED boundary scan 0.

## Vercel staging checklist (owner does; Claude does NOT)

1. Connect GitHub repo Zebone420/preston-os (private) to a NEW Vercel
   project for STAGING only.
2. Root Directory: apps/dashboard
3. REQUIRED: enable Include-source-files-outside-Root-Directory, else the
   packages/guards import breaks the build.
4. Framework: Next.js auto-detected; defaults for build and output.
5. Env var NAMES ONLY (owner enters values in Vercel UI, never in chat):
   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
   AIRTABLE_TEST_PAT, AIRTABLE_TEST_BASE_ID, AIRTABLE_TBL_APPOINTMENTS,
   AIRTABLE_TBL_LEADS, AIRTABLE_TBL_PROJECTS, AIRTABLE_TBL_QUOTES,
   DISABLE_ALL_AI_WRITES, DISABLE_CLIENT_MESSAGES, DISABLE_EMAIL_SEND,
   DISABLE_CALENDAR_WRITES, DISABLE_AIRTABLE_PROD_WRITES,
   DISABLE_N8N_ACTIVATION, DISABLE_REMOTE_RUNNER, DISABLE_PRODUCTION_DEPLOY.
   Do NOT add SUPABASE_STAGING_SERVICE_KEY (not needed by the dashboard).
6. Enable Vercel Authentication (deployment protection) plus proxy.ts gate.
7. Add the Vercel staging URL to Supabase Auth Site URL / allowed URLs.
8. Staging domain: use preston-os-staging.vercel.app or a non-production
   subdomain. Do not attach a business domain.
9. Post-deploy smoke tests (read-only):
   /api/health ok true mode connected; /login sign-in then redirect /;
   / shows 5 cards, 4 Airtable read AIRTABLE TEST/DEV, Approvals SUPABASE
   STAGING; /audit loads for owner; unauth / redirects to /login.

## Blockers / owner actions

BLOCKER: Include-files-outside-Root-Directory must be ON.
OWNER: create Vercel project, set root dir, enter env values, enable
protection. Claude is barred from all of these.
NOTE: .env.local is git-ignored and unused by Vercel; vars set in Vercel.
GATE: deploy BLOCKED until a ChatGPT Review Checkpoint approves Item 3.

## Recommendation

Item 3 PREP is GREEN: build, tests, lint, scans pass; cross-root import
resolved at build time. Recommend approving Item 3 as owner-driven Vercel
setup and deploy, with Claude limited to verifying secret-free smoke-test
output.
