# Preston Central SSOT Design v1

Status: DESIGN ONLY. Non-activating. No migration, route, token, or
service in this document exists or is enabled by merging it.
Date: 2026-08-10. Basis commit: 62240ce (Remote Operations V1 era).
Inventory source: read-only SSOT sweep, 2026-08-09 session.

## 1. Purpose

Give ChatGPT, Claude, Codex, Hermes, the owner phone, and the dashboard
one governed, authoritative, compact view of system state - instead of
each actor rehydrating stale conversation history or holding its own
private picture of goals, jobs, and approvals.

## 2. Decision: canonical state spine

The Phase 7/8 goal graph is the single actor-facing state lineage:

- master_goals          (goal lifecycle)
- goal_jobs             (task lifecycle, evidence_refs)
- job_dependencies      (ordering)
- orchestration_approvals (owner gate records)
- remote_intake_requests  (authenticated remote intake)
- orchestration_decisions (Hermes observations)

The Phase 3/4 lineage (runtime_command_packets, os_jobs, worker_leases,
job_attempts, job_checkpoints) is INTERNAL RUNTIME PLUMBING. It remains
load-bearing for the dispatcher but is not an actor-facing truth. No
actor-facing surface may read or join it directly; anything an actor
needs from it must be projected into the spine (evidence_refs today).

Rationale: the goal graph is the lineage with live remote-drill
evidence (Stage 11 lifecycle, Gate D approve/reject/expiry, remote
intake chain), carries the approval model, and already has a remote
read projection (read_remote_intake_status).

## 3. Actor capability matrix (target state)

Capabilities, not endpoints. R = read canonical status, W = submit
intake, A = approve, X = execute, O = observe/annotate.

| Actor       | R | W | A | X | O | Identity mechanism            |
|-------------|---|---|---|---|---|-------------------------------|
| Owner phone | x | x | x |   |   | held bearer token + phone UI  |
| Dashboard   | x | x | x |   |   | owner session cookie          |
| ChatGPT     | x | x |   |   |   | per-actor hashed bearer token |
| Claude      | x | x |   | x |   | per-actor token; exec via     |
|             |   |   |   |   |   | dispatcher capability chain   |
| Codex       | x |   |   |   | x | per-actor token; exec DEFERRED|
| Hermes      | x |   |   |   | x | service identity (host env)   |

Hard rules preserved: approval authority is owner-only, forever.
Execution flows only through the dispatcher capability chain
(SIMULATION / BOUNDED_CODE_EXECUTION), never through the SSOT surface.
The SSOT surface is staging-gated exactly like the remote routes.

## 4. Actor identity model

Replace self-declared source strings with authenticated actor rows,
reusing the proven remote_intake_config pattern (sha256 token hash in
DB, SECURITY DEFINER gateway, constant-time compare, backpressure):

- New table (draft name): actor_registry
  actor_id text pk, display_name, role enum
  (owner_remote|chatgpt|claude|codex|hermes), token_hash bytea,
  enabled bool default false, created_at, last_seen_at.
- Every intake and read gateway resolves the bearer token to ONE
  actor_registry row; the resolved actor_id is stamped on writes
  (remote_intake_requests.actor_id, decisions, audit rows).
- The source field on legacy routes stays for compatibility but is
  DERIVED from authenticated identity, never trusted from a body.
- Tokens are owner-minted, stored only as hashes, per-actor revocable
  (enabled=false), and never appear in repo, chat, or logs.

## 5. Canonical read surface

One authenticated endpoint (draft): GET /api/os/ssot/status

- Auth: per-actor bearer token (section 4); staging-gated; proxy-
  excluded like /api/os/remote/*; fail-closed on any config absence.
- Backed by a SECURITY DEFINER read gateway (0011 pattern) so the web
  tier keeps no session credential.
- Response (draft shape, compact by construction):

  {
    schema: "preston-ssot-status/1",
    generated_at, environment: "staging",
    posture: { execution_level, owner_stop, paused, hermes_mode },
    goals:   [ { goal_id, status, title, created_at, updated_at } ],
    jobs:    [ { job_id, goal_id, status, kind, assigned_role,
                 evidence_refs } ],
    approvals: { open: [ { approval_id, goal_id, job_id,
                 expires_at } ], recently_decided: [...] },
    hermes:  { latest_decision_id, observed_at, reasons: [...] },
    intake:  { recent_requests: [ { request_id, status } ] }
  }

- Bounded: newest-N per collection, single round trip, no pagination
  in v1. Read-only by construction (definer fn does SELECT only).
- Per-actor projection: response filtered by actor role if needed
  later; v1 serves the same owner-scoped staging picture to all
  authenticated actors.

## 6. First implementation batch: Hermes consumer

orchestration_decisions is currently write-only (zero readers). The
cheapest high-leverage SSOT component:

1. Read adapter listOrchestrationDecisions (store.ts idiom: bounded,
   fail-closed, newest-first, filter decision=orchestration_status).
2. Surface the latest decision in the /os/orchestration read model and
   the draft ssot/status response (section 5).
3. Tests: adapter bounds, absence vs empty vs error, minute-bucket
   idempotency respected, no writes.

This makes Hermes' output land somewhere real without activating the
hermes timer (activation stays its own owner gate).

## 7. Audit and evidence

- Every SSOT read gateway call lands one access_events/audit row
  (actor_id, fn, at) - reads are observable, not silent.
- Evidence stays where it is produced: goal_jobs.evidence_refs carries
  real:* / real-audit:* / sim:* markers; the SSOT surface transports
  them verbatim and never rewrites history.
- Drill and gate evidence documents remain repo markdown under
  reports/ - the SSOT reports state, the repo proves it.

## 8. Token economy rationale

Actors currently reconstruct state by re-reading long conversations or
re-deriving from many queries. The canonical status JSON is a compact
authoritative snapshot (bounded lists, ids + statuses + refs, no
prose), so a remote actor needs ONE small fetch to re-anchor instead
of thousands of tokens of rehydration. Conversation history stops
being a truth source; it becomes commentary on state the SSOT owns.

## 9. Partitioning: what lives where

| Domain                          | Authority                        |
|---------------------------------|----------------------------------|
| Goal/job/approval/intake state  | Supabase spine (section 2)       |
| Posture and kill switches       | Supabase system_controls         |
| Hermes observations             | Supabase orchestration_decisions |
| Code, units, deploy scripts     | Git repo (pinned commits)        |
| Drill/gate evidence narratives  | repo reports/ markdown           |
| Architecture, specs, this doc   | repo docs/ markdown              |
| Prompts/commands for actors     | repo docs/ (versioned, reviewed) |
| Pricing/quote math + rulings    | repo docs/ + context/ (verified  |
|                                 | facts only, per CLAUDE.md)       |
| Business records (quotes etc.)  | Supabase business tables (0009)  |
| Secrets/tokens                  | 1Password + host env; hashes in  |
|                                 | DB; NEVER repo or chat           |

Anti-competing-truths rule: each fact class has exactly one authority
above. A surface may cache or display another authority's data but
must label provenance and never accept edits to it.

## 10. Explicit non-goals of v1 (separate later gates)

- Codex real execution (executable gate, adapter, capability probe).
- Hermes outbound sends/notifications (send channel = owner gate).
- Any production surface; everything here is staging-gated.
- Event push/subscriptions (poll-only v1; os_events reuse later).
- Merging or migrating Phase 3/4 tables (stay as plumbing).
- Per-actor row-level projections (single staging picture in v1).

## 11. Implementation sequence (each its own bounded gate)

1. B1 Hermes read adapter + read-model surfacing (section 6).
2. B2 actor_registry migration draft + owner packet (apply = owner).
3. B3 ssot/status definer fn + route, disabled-by-default env flag.
4. B4 stamp actor_id through intake paths; derive source.
5. B5 actor onboarding packets (owner mints tokens per actor).

Nothing in B1-B5 changes execution semantics, approvals, RLS
posture, or activation state; every enable remains an owner action.
