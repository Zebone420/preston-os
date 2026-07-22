# PHASE 7 - PRODUCTION READINESS PACKET
# Controlled production pilot preparation (nothing here activates
# production; this is an audit + plan)

Date: 2026-07-21
Precondition: Phase 6 staging-operational gate PASS.
Rule: Claude never accesses production, applies migrations,
handles credentials, or enables execution. Every item below ends
in an owner-run gate.

## 1. Readiness scoring method

Each blocker is scored: DOCUMENTED (plan exists in this repo),
CODED (non-owner prerequisite implemented + tested), OWNER-RUN
(requires owner/production action - can only be prepared).
Production readiness percentage = weighted completion toward
"ready to begin a controlled pilot", not toward full production.

## 2. Blocker register

| # | Blocker | State | Remaining work |
|---|---|---|---|
| P1 | Production environment isolation | DOCUMENTED here | Owner creates a SEPARATE Supabase production project + separate Vercel project/env; no shared keys with staging; env naming already separates SUPABASE_STAGING_* vs production names (owner assigns) |
| P2 | Production Supabase design | DOCUMENTED | Apply 0001,0002,0009 only (business pilot does NOT need the runtime tables 0003-0006 unless the AI-OS pilot is in scope); owners allowlist bootstrap; decision recorded per migration |
| P3 | Production RLS review | DOCUMENTED | Re-run the full-coverage verification SQL (migration packet section 5) against production post-apply; owner attests |
| P4 | Credential inventory + rotation plan | DOCUMENTED | Owner inventories: Supabase anon/service keys (service key NEVER in app), Vercel envs, Airtable PATs, Google OAuth, Telegram token; rotation cadence and 1Password locations; no values in repo ever |
| P5 | Least-privilege connector identities | CODED (0007 authored) + DOCUMENTED | Migration 0007 runtime_roles applies only if the runtime deploys to production; separate gate; SEC-1 note (broad worker os_jobs UPDATE) must be tightened before production application |
| P6 | Connector intake decoupled from execution_enabled | DOCUMENTED (Phase 5 connector packet sec 9) | Code change gate: isHalted() couples ChatGPT intake to execution flag; decouple with a dedicated intake_enabled control before any production connector |
| P7 | Checkpoint append lease fencing (ARCH-2) | DOCUMENTED | Runtime hardening gate before any bounded execution; not needed for the read/draft business pilot |
| P8 | Dead-letter handling wiring | DOCUMENTED | dead_letters table exists; requeue/DL flow designed-not-wired; runtime gate, not business-pilot-blocking |
| P9 | Mid-attempt cancellation re-observation | DOCUMENTED | Runtime gate; simulation loops already observe cancel at checkpoints |
| P10 | Outbound communication approval/audit architecture | DOCUMENTED (master plan + agent contract sec 6) | RED design gate: template review, per-send approval, audit, kill switch; REQUIRED before any real quote leaves the system; not part of the pilot below |
| P11 | Dependency vulnerability review | DOCUMENTED (NEXT_GATES: 2 moderate advisories) | Owner-approved review session; no npm audit fix without approval |
| P12 | Backups + disaster recovery | DOCUMENTED here | Supabase PITR/backup tier decision (owner); repo is on GitHub; DR runbook draft: restore project -> re-apply migrations -> re-import; owner drill |
| P13 | Monitoring + alerting | DOCUMENTED | Options: Vercel monitoring + Supabase log drains + a daily owner /business check; alert on 5xx rate and auth failures; choose at pilot gate |
| P14 | Incident-response runbook | DOCUMENTED | Draft: sign out sessions (Supabase auth), pause via /os controls (staging) or Vercel deployment rollback (prod), owner contact tree; formalize at pilot gate |
| P15 | Rollback | DOCUMENTED (deployment packet + closeout) | Vercel promote-previous; additive DB; per-migration removal SQL owner-composed |
| P16 | Production smoke tests | DOCUMENTED | The staging validation gate V0-V7 IS the smoke suite; re-run against production with pilot data after owner deploy |
| P17 | Data migration/import plan | DOCUMENTED (NEXT_GATES intake gate) | Provenance-tracked import from Airtable (read-only source) into business tables; needs owner field-mapping ruling; can be CODED next as a staging feature |
| P18 | Privacy + data retention rules | DOCUMENTED here | Client PII lives in business_clients/contacts/communications; owner-only RLS; retention: keep until owner-archived; deletion policy needs an owner ruling (no delete grants exist by design - a purge would be an owner-run SQL gate) |
| P19 | Audit log retention | DOCUMENTED | audit_log/activity are append-only; growth is low at owner scale; revisit at 12 months or 100k rows |
| P20 | Client-data access boundaries | DONE for app scope | Single-owner allowlist; any staff access = new gate (roles design) |
| P21 | Performance/concurrency validation | DOCUMENTED | Single-owner scale validated by design (bounded reads); revisit before multi-user |
| P22 | Controlled pilot scope | DOCUMENTED below | Owner approves scope + entry/exit criteria |

## 3. Production readiness percentage

- Documentation coverage of all 22 blockers: 100 percent (this
  packet + referenced packets).
- Non-owner prerequisites coded/tested: the business pilot path
  (P16 smoke = staging gate; P20 boundaries) is code-complete;
  runtime-hardening blockers (P5-P9) are authored-or-designed but
  intentionally deferred; import (P17) not yet coded.
- Weighted readiness to BEGIN a controlled read+draft pilot:
  approximately 45 percent. The dominant remaining mass is
  owner-run environment work (P1-P4, P11-P14) plus the P17 import
  build. Full production (including any outbound send) sits well
  below that until P10's RED gate completes.

## 4. Recommended controlled pilot scope (owner decision)

Scope: production Supabase project with migrations 0001/0002/0009
only; Vercel production project; owner-only login; REAL client/
lead/quote data entered by the owner; quote-draft agent in
simulation mode producing drafts the owner manually transcribes
to their existing quoting flow. Explicitly OUT of scope: any
send, invoice, external write, AI-OS runtime deployment,
execution enablement, Airtable import (until P17 gate).
Entry criteria: P1-P4 done, P16 smoke PASS on production.
Exit criteria for pilot success (30 days): owner uses /business
weekly+, at least 5 real quote drafts approved/rejected, zero
security incidents, zero data-loss events, owner attests the
numbers matched their manual math every time.

## 5. Exact owner-run production pilot sequence (when approved)

1. Create production Supabase project; create owner auth user;
   run 0001 -> 0002 (bootstrap owners row) -> 0009; run the
   full-coverage verification SQL; attest.
2. Create Vercel production project (apps/dashboard root, files
   outside root enabled); set NEXT_PUBLIC_SUPABASE_URL (bare
   project URL), NEXT_PUBLIC_SUPABASE_ANON_KEY,
   OWNER_EMAIL_ALLOWLIST only. No Airtable/Google/Telegram vars.
3. Deploy the approved commit; verify commit hash.
4. Run the V0-V7 smoke suite against production (fixtures NOT
   applied - enter one real client instead).
5. Attest and start the 30-day pilot with the exit criteria above.
Stop conditions: any RLS verification mismatch, any anon
privilege, any page rendering another user's data (impossible by
design - but it is the stop condition), any 5xx pattern.

## 6. Recommended next master goals (ranked)

1. Business data intake gate (P17): coded+tested Airtable->
   business import with provenance, owner-approved mapping.
2. Real-quote gate: V3/V4 rulings + proposal/PDF generation +
   RED migration lifting the simulation CHECK pins.
3. Runtime production track (P5-P9) only if/when the AI-OS
   runtime is wanted in production.
