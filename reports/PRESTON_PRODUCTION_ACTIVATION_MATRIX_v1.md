# PRESTON AI OS - PRODUCTION ACTIVATION MATRIX v1 (PLAN ONLY)

Nothing in this document activates anything. Every activation is an
owner-only gate. Baseline: PRESTON_GOLDEN_STAGING_BASELINE.md
(b4f1b71). Prior art: PHASE_7_PRODUCTION_READINESS_PACKET.md (P1-P22).

Classification key: SAFE=already production-safe as designed;
PROVEN=staging-proven, production-gated; MIG=requires migration;
CRED=requires new credential; OWNER=requires owner approval;
TEST=requires additional test; OFF=should remain disabled initially.

## Matrix

A. Production Supabase project
   PROVEN+MIG+CRED+OWNER. Create prod project (or dedicated schema
   path per knowledge-layer ADR); apply 0001,0002 then the vetted
   chain to 0014 IN ORDER; owner creates auth user + owners row;
   pg_dump backup discipline from day one (LA-10 lesson). anon
   revocation pattern per 0009 on every table. TEST: run the S1-style
   verification block after each migration.

B. Production Vercel / environment
   PROVEN+CRED+OWNER. Either a second Vercel project or prod env of
   the existing one; env var set mirrors staging NAMES (values new);
   REMOTE_INTAKE_ENABLED + SSOT_STATUS_ENABLED start ABSENT (routes
   503 fail-closed = OFF). Deployment Protection + owner gate as
   staging. Known pitfalls to pre-empt: bare Supabase URL (not
   /rest/v1/), empty-value saves (verify via edit form), Fluid env
   propagation.

C. SSOT production migrations (0012-0014)
   PROVEN+MIG+OWNER. Apply after core chain; verification block
   identical to staging S1. OFF until actors minted.

D. Actor/token provisioning
   PROVEN+CRED+OWNER. Fresh prod tokens (never reuse staging), hashes
   only in DB, 64-char check (S2 lesson), 1Password entries labeled
   PROD-. Initial set: owner-remote-1 only; add chatgpt-1/claude-1
   when their prod consumers exist. codex/hermes stay absent.

E. Remote intake
   PROVEN+OWNER+TEST. Enable route flag; drill an accepted+consumed
   request with a NEUTRAL doc task (composer rejects execution-mode
   wording - by design). Evidence rule: direct API responses + DB/log
   only; never ChatGPT-relayed claims.

F. Approvals
   PROVEN (0010 lifecycle, one-time nonce, expiry, hash-binding,
   UI decision surface) + OWNER per decision. No changes needed;
   TTL 24h. Production drill: park -> approve -> resume once.

G. Real execution (bounded)
   PROVEN+CRED+OWNER+TEST. Requires: host serving prod (see H note),
   service-user CLI persisted login (interactive /login as service
   user - setup-token does NOT persist), worktree lifecycle perms
   (Gate G shape), unit TimeoutStartSec=3600, capability env + DB
   posture. OFF initially; activate only after E+F prove clean in
   prod. Level-1 kinds only (documentation/code/test/audit/
   recommendation), risk<=YELLOW, path allowlist enforced.

H. Customer/business writes
   OFF. RED gate. Business Command Center stays simulation-pinned
   (0009 CHECK pins) until owner lifts via its own RED migration +
   V3/V4/V5 rulings. No live quotes/emails/messages in any early
   phase. NOTE: current architecture has ONE staging host; a prod
   pilot can either (a) share the host with strictly separated env
   files+identities (cheapest, blast-radius caveat) or (b) add a prod
   host (cleanest). Decide at P2 entry; default recommendation: (b).

I. Hermes
   PROVEN (observe-only coded, timer disabled). OFF initially; staging
   timer activation is its own gate; prod after that. Sends = RED
   forever until explicitly gated.

J. Codex
   OFF. No actor row, no executable gate, adapter declines by design.
   Separate future gate (executable allowlist + contract + drills).

K. Telegram / remote owner interface
   OFF. Durable update_id dedup still unbound = activation blocker;
   receiver stays disabled. Phone HTTP client against intake API is
   the supported remote interface today.

L. Rollback / kill switch
   SAFE+PROVEN. Global owner_stop SQL halt (drill-proven), timer
   disable, env-flag blanking (routes 503), per-actor disable,
   migration rollback blocks (S1 packet), host re-pin to $PREV,
   Vercel deployment rollback. Production inherits all of it;
   verify owner_stop drill once in prod (P1 exit).

## Phased activation order

P0 - PROD FOUNDATION + READ-ONLY OBSERVATION (risk: low)
  Live: prod Supabase (core migrations), prod web deploy with ALL
  intake/SSOT flags absent (503s), owner login, read-only dashboards
  over empty/real reference data. Disabled: intake, SSOT surface,
  execution, hermes, telegram, business writes.
  Prereqs: A,B. Evidence: migration verification blocks, owner login,
  anon-zero checks, backup taken+verified. Rollback: delete/pause
  prod project, remove deploy. Owner: all of it (RED: new prod infra).

P1 - INTAKE + APPROVALS, EXECUTION DISABLED (risk: low-medium)
  Live: 0012-0014, owner-remote actor, intake flag on, SSOT status
  flag on, approvals drill (park/approve/resume), owner_stop drill.
  Execution posture stays SIMULATION-only (execution_enabled false).
  Prereqs: P0 + C,D,E,F. Evidence: accepted+consumed request, parked
  approval honored, kill-switch halt line. Rollback: blank flags,
  disable actors. Owner: migrations, tokens, flags, drills.

P2 - BOUNDED INTERNAL EXECUTION (risk: medium)
  Live: real executor on the prod-serving host (decision H-note (a)
  vs (b) resolved), Level-1 kinds, path allowlist, one controlled
  drill to real:*+paths_ok then a repeat. Everything customer-facing
  stays off. Prereqs: P1 + G (+host decision). Evidence: 2x
  first-attempt real passes, worktree cleanup, no sim fallback.
  Rollback: capability env off + timer disable. Owner: credential
  login, posture flips, drills.

P3 - SELECTED EXTERNAL WRITES (risk: high; RED per item)
  Live: individually gated business writes (e.g. Airtable TEST->
  real parity first, quote DRAFTS only), each behind its own owner
  packet + V-rulings (V3/V4/V5 backlog). No sends. Prereqs: P2 +
  per-write packet. Evidence: per-write audit rows + reversibility
  demo. Rollback: per-write flag/pin restore.

P4 - BROADER BUSINESS AUTOMATION (risk: high)
  Live: recommendation->action loops, hermes observe (then gated
  notify), scheduled agents. Only after P3 items individually prove
  out. Every send/publish stays a RED gate at introduction.

## Standing RED list (never crossed without explicit owner gate)

Prod DB migrations/mutations; credentials/secrets creation or
rotation; behavior-changing prod deploys; live customer sends;
payments; destructive ops; unrestricted execution; new external
service activation; RLS weakening; force pushes; allowed-path
expansion; hermes sends; codex real execution; telegram activation.
