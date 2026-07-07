# Phase 4 - Remote-Live Control Surface GREEN Build Report

Repo C:\dev\preston-os, branch master. Built on baseline 612359b.
GREEN local build: files-only, fail-closed, dry-run only. Staged, not committed.

## Result: PASS (local foundation)

The safety envelope that must exist BEFORE any remote autonomy is implemented
and unit-tested: disabled-by-default runner, emergency shutoff, heartbeat,
max-runtime, owner stop, rollback, audit shaping, a dry-run simulator, and an
honest proof dashboard. The remote runner is NOT activated. Live remote
execution is blocked in Phase 4.

## What was built

- apps/dashboard/src/lib/remote-control.ts
  - remoteRunnerEnabled: double-gated (DISABLE_REMOTE_RUNNER=false AND
    REMOTE_RUNNER_ENABLED=true); disabled by default, fail-closed.
  - authorizeRemoteRun: fail-closed decision; blocks on master kill, runner
    disabled, not enabled, owner stop, bad/oversized max runtime; forces
    dry-run (a live request is downgraded, never authorized live).
  - Envelope primitives: heartbeatStale, runtimeExceeded, ownerStopRequested,
    canRollback.
  - simulateDryRun: local-only simulation that halts on owner stop, max runtime,
    or stale heartbeat; every audit event has production_touched=false.
  - controlSurfaceProof: honest status - implemented locally, proven_remotely
    = false for all until a Phase 5 drill.
- apps/dashboard/src/app/remote/page.tsx (read-only proof dashboard)
- apps/dashboard/src/app/page.tsx (Remote Control nav link)
- env.template (names only: REMOTE_RUNNER_ENABLED, OWNER_STOP; no values)
- apps/dashboard/test/remote-control.test.ts (20 tests)
- reports/PHASE_4_REMOTE_CONTROL_SURFACE_GREEN_BUILD_REPORT.md (this file)

## Safety envelope (implemented + tested)

- Disabled by default: no env => runner disabled; requires explicit double gate.
- Emergency shutoff: DISABLE_ALL_AI_WRITES and DISABLE_REMOTE_RUNNER fail-closed.
- Owner stop: OWNER_STOP=true blocks authorization and halts a simulated run.
- Max runtime: request-bounded and capped at 900s; over-cap is blocked; a run
  past its limit halts.
- Heartbeat: a stale heartbeat (beyond interval x threshold) halts the run.
- Rollback: requires a reversible change plus a non-empty rollback note.
- Audit: every decision, tick, and halt emits an audit event (no live I/O).
- Dry-run only: live remote execution is never authorized in Phase 4.

## Tests (all passing)

dashboard suite: 70 passed (was 50; +20 remote-control):
- enable gating (4), authorization incl. live-downgrade (7), envelope
  primitives (4), dry-run simulator halts + healthy (4), proof surface (1).

## Validations run

- dashboard vitest: 70/70 PASS. guards vitest: 25/25 PASS.
- tsc --noEmit: dashboard = 0.
- secret scan: 0 findings. RED boundary scan: 0 findings.

## Boundaries held

Remote runner NOT activated. No live remote execution. No production. No
credentials or .env values (env.template holds NAMES only). No sends/writes.
No commit, no push. Fail-closed, dry-run only.

## Why this is NOT yet laptop-close-safe

Every control is implemented and unit-tested locally, but none is proven under
a real remote drill. proven_remotely = false for all items. The
laptop-close-safe claim remains FORBIDDEN until Phase 5 demonstrates each proof
item on the staging host (shutoff halts a live task, heartbeat stall auto-halts,
max-runtime kill, remote audit rows, owner stop with laptop closed, rollback).

## What's left next

- Phase 5: bounded remote-live DRILL on staging (owner-gated) proving each item.
- Phase 6: 100% milestone closeout once drills pass and reports are complete.
