# Preston ChatGPT Supervisor Bridge — Design Note v1 (NOT implemented)

Status: DESIGN ONLY (2026-08-28). Implementation begins only on owner
direction after the hardening promotion's live proof succeeds.

## Purpose

Preston emits important state transitions to ChatGPT so ChatGPT can
diagnose stuck/failed work and safely coordinate recovery — without
gaining ANY authority it does not already have through the existing
owner-gated control surface.

## Position in the architecture (reuse, not invention)

The SSOT already records every transition as envelope events
(`insertEvent`/`makeEnvelope`: JobResultRecorded, ArtifactRecorded,
approval decisions, …) and `preston_status` already derives posture +
needs_attention. The bridge is therefore two small additions:

1. **A normalized supervisor event stream** — a read-model view over the
   existing events + job/goal rows that maps raw transitions onto the
   fixed vocabulary below (no new writes on the hot path; the emitting
   side already exists).
2. **A pull surface for ChatGPT** — one new READ-ONLY control tool
   (working name `preston_poll_events`): cursor-based, bounded page size,
   idempotent, owner-authenticated exactly like the existing 10 ops.
   ChatGPT is a pull client (MCP); nothing pushes into ChatGPT, so
   "emits" means "durably queues for the supervisor's next poll". The
   dashboard reads the same stream.

## Required event vocabulary (fixed, closed set)

`queued`, `running`, `completed`, `failed`, `timed_out`, `dead_lettered`,
`blocked`, `paused`, `stopped`, `approval_required`, `kind_not_eligible`,
`task_kind_unresolved`.

Mapping notes:
- `queued`/`running`/`completed`/`failed`/`dead_lettered`: job status
  transitions (driver CAS + engine actions).
- `timed_out`: a run whose failure_reason is `timeout`-class (before the
  retry decision) — distinct from the terminal `failed`/`dead_lettered`
  that may follow, so the supervisor sees WHY.
- `blocked`: goal blocked on dependencies or lock context.
- `paused`/`stopped`: system_controls transitions (paused / owner_stop) —
  control-plane scope, not per-job.
- `approval_required`: a job parks awaiting_approval (with approval_id,
  never the approval content).
- `kind_not_eligible`: a real adapter contract refusal persisted in
  strict mode (post-remap this indicates a genuinely ineligible kind —
  e.g. UI-minted repair/migration — exactly what a supervisor should see).
- `task_kind_unresolved`: a composer REJECTION at submit (no goal row
  exists) — emitted from the submit path's rejection record so phrasing
  gaps (e.g. setup/branch wording) become visible instead of silent.

Event shape (per event): `{ event_id, kind, occurred_at, goal_id?,
job_id?, run_id?, job_kind?, failure_reason?, evidence_refs?,
correlation_id }` — static reason codes and ids only; NEVER free worker
text, env values, or secrets (the scrubber applies as everywhere else).

## Safety invariants (non-negotiable)

1. **No new write authority.** The bridge adds ONE read-only tool. Every
   ChatGPT-initiated action continues through the EXISTING tools —
   `preston_submit_goal` (full composer scans: injection markers,
   prohibited capabilities, kind resolution, policy classification),
   `preston_follow_up_goal`, `preston_cancel_goal`, `preston_decide_approval`
   (owner-only semantics unchanged).
2. **All owner gates preserved.** Production, secrets, destructive verbs,
   payment, RLS/security, deploy, push, migration-apply, external sends:
   all remain composer-rejected or RED/mobile-gated exactly as today. The
   supervisor can DIAGNOSE anything and SUBMIT only what the composer +
   policy engine already allow an owner-authenticated caller.
3. **Supervisor scope of action** (all via existing gates):
   - diagnose from events + evidence + artifacts (read-only),
   - normalize/rephrase commands (fixing `task_kind_unresolved` wording),
   - resubmit safe GREEN work as NEW goals,
   - dispatch safe repair/audit work (audit kind or GREEN code work),
   - request owner attention (surface, never decide, approvals).
4. **No autonomous loop authority.** Polling cadence and any automatic
   resubmission policy are owner-configured; default is
   notify-and-propose, not act.
5. **Bounded and idempotent.** Cursor pagination, per-poll caps, no
   replay ambiguity (event ids are deterministic); a supervisor outage
   loses nothing (durable stream, resume from cursor).
6. **Classification is data.** Event text originates from the runtime's
   static reason codes; worker/report prose stays in artifacts behind
   `preston_get_artifact` — the event stream cannot carry instruction
   text into ChatGPT unlabeled.

## Implementation sketch (for the future gate; ~3 bounded units)

1. Read-model + mapper (`supervisor-events.ts`, pure) + migration for a
   cursorable view if the events table needs an index — owner-applied.
2. `preston_poll_events` tool + OpenAPI + schemas + tests (mirrors the
   existing tool pattern; auth unchanged).
3. Submit-path rejection recording for `task_kind_unresolved` (today a
   rejection returns errors but persists nothing — smallest additive
   record, secret-screened).

Acceptance: every vocabulary event observable end-to-end in staging via
the tool; zero new write paths; full-suite green; owner gate review.
