# SUPABASE PAID-ORGANIZATION TRANSFER ASSESSMENT

Date: 2026-07-22. Read-only assessment. Nothing was transferred,
changed, or executed. Sources are labeled: [DOC] = current
official Supabase documentation (project-transfer and backups
guides, fetched 2026-07-22), [REPO] = verified repository fact,
[INFER] = inference the docs do not state explicitly, [OWNER] =
evidence only the owner can supply.

## 1. Platform facts

Transfer mechanics [DOC]:
- Control lives in the project's general settings ("Transfer
  project").
- Requirements: OWNER role in the SOURCE organization; at least
  MEMBER in the TARGET organization.
- Blockers: "No active GitHub integration connection"; "No
  project-scoped roles pointing to the project (Team/Enterprise
  plan)"; "No log drains configured".
- Downtime: "a short 1-2 minute downtime if you're moving a
  project from a paid to a Free Plan" - our direction is Free ->
  paid, for which no downtime is documented [DOC]; treat brief
  disruption as possible anyway [INFER].
- Region transfers are not supported (irrelevant here: the
  project stays us-east-1; a transfer is not a region move).
- Billing: source org is charged for usage up to the transfer;
  target org billing picks up afterward at cycle boundaries.

Backup facts [DOC]:
- Pro/Team/Enterprise: automatic DAILY backups; retention 7/14/
  up-to-30 days respectively. Free: none (manual export only).
- Projects on Postgres 15.8.1.079+ use PHYSICAL backups, which
  are NOT downloadable; downloadable copies require manual
  logical backups (pg_dump / CLI) regardless of plan.
- Backups cover schema+data only; Storage objects excluded;
  custom role passwords excluded.
- PITR is a paid add-on requiring at least Small compute
  (~USD 100/mo for 7 days) - NOT proposed for staging.
- First-backup timing after eligibility: not explicitly
  documented; expect it within the first daily cycle (~24h)
  [INFER]; Gate 5 verifies rather than assumes.

## 2. What the docs do NOT state (verify at Gate 4, do not assume)

The transfer guide is silent on project ref, URL, API keys, DB
credentials, Auth users, Storage, and Edge Functions persistence.
The transfer model (organizations are billing/ownership
boundaries; the project's infrastructure is untouched) implies
ALL of these remain unchanged [INFER, high confidence], and
nothing in the guide suggests otherwise - but every one of them
is explicitly re-verified in the post-validation packet instead
of being trusted.

## 3. Repository impact audit summary

Full classification: reports/SUPABASE_PROJECT_TRANSFER_IMPACT_
MATRIX.md. Headline [REPO]: Preston OS references the project
ONLY through env-named values (NEXT_PUBLIC_SUPABASE_URL, anon
key, SUPABASE_RUNTIME_* on the staging host), all keyed to the
project ref - which a transfer does not change [INFER->Gate 4].
The app uses NO service-role key, NO Edge Functions, NO Storage
buckets, NO Supabase webhooks, NO log drains, and NO
Supabase-GitHub integration is known to be configured (env vars
were set manually per the Phase 0B/1B packets; Vercel-Supabase
integration believed absent [OWNER verify]). Migrations and RLS
live inside the database and are untouched by an ownership
transfer.

## 4. Assessment against the default preference

Default under test: transfer the EXISTING project rather than
migrate data into another paid project. Evidence supports the
default: a transfer keeps ref/URL/keys/Auth/data in place
(pending Gate 4 verification) with zero re-configuration of
Vercel or the Hetzner runtime, while a data migration (Option C)
would change the project ref and REQUIRE re-issuing every env
var, re-creating the owner + runtime identities, re-running
bootstrap, and re-validating everything - strictly more risk for
no additional benefit. Option B (stay Free + build pg_dump
infrastructure) remains viable but leaves staging on manual
backup discipline and adds a credential-bearing cron to the
host.

## 5. Decision (see decision brief for the full argument)

GATE 0 COLLECTED 2026-07-22 -> RESULT BLOCKED for Option A: NO
paid organization exists. Only "info@preston.nyc's Org" (Free)
is present; the Transfer dialog reports no eligible target org
and disables the Transfer button. [OWNER-VERIFIED in dashboard]

OPERATIVE DECISION NOW: RECOMMEND HYBRID PG_DUMP (Option B) - it
requires no paid org and closes LA-10 at $0. Option A stays the
preferred end-state, gated on the owner first creating/obtaining
a Pro (or better) organization (a billing decision). All the
clean Gate 0 checks were also captured (no GitHub integration,
no Vercel integration, no log drains, 0 storage buckets, owner
of the Free org) - so IF a paid org is created later, transfer
eligibility is otherwise clear and only the cost preview + role
in the new org need confirming.

Independent-backup requirement PRESERVED in every branch: one
pg_dump (first-backup packet) is REQUIRED, and periodic logical
dumps remain the off-platform copy because provider physical
backups are not downloadable [DOC].
