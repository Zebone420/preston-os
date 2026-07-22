# SUPABASE TRANSFER - OWNER DECISION BRIEF

Date: 2026-07-22. Decision required from you; nothing executes
until you run the gates yourself.

## DECISION OUTPUT (UPDATED after Gate 0 evidence, 2026-07-22)

GATE 0 RESULT: BLOCKED. The transfer path (Option A) is NOT
AVAILABLE: no paid organization exists on this account. The
account holds a single organization ("info@preston.nyc's Org",
Free Plan, 3 projects), and the project's Transfer dialog states
verbatim: "You do not have any organizations you can transfer
your project to." (Transfer button disabled.)

REVISED RECOMMENDATION: RECOMMEND HYBRID PG_DUMP (Option B) as
the operative plan NOW, because it needs no paid org and closes
LA-10 at $0. Option A remains the preferred END-STATE but is
gated on a NEW owner prerequisite: create/obtain a paid Supabase
organization (an owner billing decision, out of scope here). If
the owner creates a Pro org later, re-run Gate 0 and the original
conditional recommendation below applies unchanged.

--- ORIGINAL CONDITIONAL RECOMMENDATION (retained; applies only
--- AFTER a paid org exists) ---

RECOMMEND TRANSFER - CONDITIONAL (Option A: transfer the
existing preston-os-staging project into your paid Supabase
organization).

## Why

1. Data never moves: the project keeps its URL, keys, users,
   tables, RLS, and integrations in place (platform model;
   explicitly re-verified at Gate 4 because the docs are silent
   on those specifics). Vercel and the Hetzner runtime need NO
   changes.
2. It closes LA-10 properly: automatic DAILY provider backups
   with 7-day retention (Pro) replace human backup discipline,
   while the already-approved independent pg_dump remains the
   off-platform copy (provider physical backups cannot be
   downloaded).
3. It is the cheapest robust option in operational terms: one
   owner session (Gates 0-7, ~45 min total including the
   backup), then a weekly logical dump habit - versus building
   and maintaining a credentialed cron on the staging host
   (Option B), or a full data migration with total credential
   re-issue (Option C, kept as the emergency fallback).
4. It advances production readiness: staging inherits the same
   provider-backup pattern the production pilot requires (P12).

## Conditions (ALL must hold - Gate 0 evidence packet)

C1. The paid organization exists, plan Pro or better.
C2. You are OWNER of the current Free org and at least MEMBER of
    the paid org.
C3. The transfer dialog shows no blocker: no active GitHub
    integration, no project-scoped roles, no log drains.
C4. The cost preview is acceptable to you (expect: compute share
    possibly covered by org credits; ESTIMATE USD 0-10/mo -
    trust the dialog, not the estimate).
C5. Vercel integration status is known (if the integration is
    installed rather than manual env vars, note it; not a
    blocker, just a verification point).
If any condition fails -> fall back to OPTION B (hybrid pg_dump,
already approved in principle; first-backup packet unchanged).

## What stays true either way

- Gate 1 (one pg_dump before any transfer) is REQUIRED and is
  the same procedure as the existing first-backup packet.
- The scratch-project restore test within 2 weeks still applies.
- No restore ever targets preston-os-staging.
- The paused-projects decision (23/28 Sep deadlines) is
  UNAFFECTED by this brief and keeps its own schedule.

## Your sequence when you approve

Gate 0 evidence (5 min, reports/SUPABASE_TRANSFER_OWNER_
EVIDENCE_PACKET.md) -> Gate 1 backup (15-25 min, existing
packet) -> Gate 2 capture (5 min) -> Gate 3 transfer (2 min) ->
Gate 4 verification (10 min) -> Gate 5 first-backup watch
(within ~24h) -> Gate 6 smoke (10 min) -> Gate 7 records +
LA-10 closure (Claude, after your evidence).

## Approval line

"OWNER APPROVES the staging transfer plan: proceed through
Gates 0-7 as documented, date ____." (Gate 3 itself remains a
separate deliberate click by you after Gates 0-2 pass.)
