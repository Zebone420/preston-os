# REMOTE OWNER OPERATIONS PROOF - PRODUCTION PACKET v1 (PLAN)

Date: 2026-08-17. Status: PLAN. Gate 7 of
reports/PRESTON_FINAL_ACTIVATION_SEQUENCE_v1.md. Prereq: P2 PASS
only (uses exclusively Claude-path machinery P2 proves; independent
of the Codex/T-mode/Hermes gates and may run before them if the
owner prefers).

Objective: prove the owner can run the production loop end-to-end
from a PHONE with every workstation closed: compose -> park ->
approve -> resume -> kill -> restore, all attributed to
owner-remote-1, with laptop-closed evidence.

Staging precedent: Phase 7 remote-live evidence (phone compose/
approve + laptop-off + owner_stop) - this packet is the prod mirror.

## Hard rules (from staging lessons, do not relearn)

- Submissions go by DIRECT call from the phone (curl shortcut /
  HTTP client app). NEVER via a ChatGPT relay - relayed acceptance
  claims were twice fabricated on staging; drill evidence never
  rests on relayed claims.
- Drill text must be NEUTRAL (composer rejects execution-mode
  markers): "Create one task to document the remote owner
  operations drill." Nothing like "real execution"/"live run".
- request_id is the idempotency key: rops-prod-drill-<n>.
- The owner-remote-1 bearer token stays in the phone's secure
  store/1Password; never pasted into chat; hash-prefix comparison
  (p1_diagnose pattern) is the only permitted debugging aid.

## Drill R-1: phone compose (laptop may be open for observation)

1. From the phone, submit ONE neutral doc goal via the intake route
   with the owner-remote-1 token.
2. Expect: accepted + request_id echoed; on next orchestrator tick
   the request is consumed; master_goals row environment='production'
   with owner-remote-1 attribution; approval parked if policy
   requires.
   Evidence: scripts/p2/p2_drill_verify.ps1 -Label rops-r1
   (reports/p2_evidence/) + phone screenshot of the response.

## Drill R-2: phone approve + laptop-closed completion

1. ALL owner workstations closed/locked from this point.
2. On the phone: open preston-os-prod.vercel.app, log in as owner,
   approve the parked approval on the dashboard approvals surface.
3. Wait >= 2 timer cadences. Do not touch any computer.
4. Reopen laptop ONLY afterwards; capture evidence:
   goal completed; approval status approved decided one-time;
   driver resume tick in orchestrator.log happened while
   workstations were closed (log tick id + DB decided_at vs your
   attested closed window).
   Evidence: p2_drill_verify.ps1 -Label rops-r2 + log excerpt.

## Drill R-3: phone kill switch + restore

1. From the phone (Supabase SQL editor or a saved owner shortcut),
   set the global owner_stop row true.
2. Expect next tick: single-line halt, exit 75, no goal read.
3. Restore false; expect clean resume on the following tick.
   Evidence: p2_drill_verify.ps1 -Label rops-r3 (posture before/
   after) + the two log lines.

## PASS criteria (all)

- R-1 accepted + consumed + production env + owner-remote-1
  attribution preserved end-to-end.
- R-2 approval decided from the phone, one-time (a second decide
  attempt refuses not_pending), goal completed with no workstation
  involvement in the window.
- R-3 halt exit 75 with no goal read, then clean resume.
- Safety invariants re-checked after (gate template section 3
  checklist applies unchanged).
- No credential value appears in any evidence artifact.

## Rollback

Nothing new is enabled by this gate. owner_stop remains the
universal kill; a bad drill goal is cancelled/dead-lettered via the
existing owner path. Close with the standard CLAUDE.md gate block.
