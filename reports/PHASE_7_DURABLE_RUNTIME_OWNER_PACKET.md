# PHASE 7 - DURABLE ORCHESTRATION RUNTIME OWNER PACKET

Date: 2026-07-22. Status: the durable STORE ADAPTERS + STATE-
TRANSITION CONTRACTS are coded + tested (pure, fake-client);
NO durable worker process exists yet and NO persistence is
applied. This packet defines the exact owner-gated path from
"tested store abstractions" to "resumable durable worker".

## What is built (verified, simulation-safe)

- orchestration/store.ts - RLS-bound adapters reusing the
  existing RuntimeClient idiom (no duplicate persistence): insert
  goal/job/dependency/approval (simulation pins FORCED on write:
  simulation_only=true, environment=staging, executed=false),
  CAS status transitions guarded by the transition graph, one-time
  approval decide with durable nonce replay, fail-closed reads.
- orchestration/transitions.ts - authoritative legal-transition
  graphs for goals and jobs; illegal edges rejected before any
  write.
- Tests: orchestration-durable.test.ts (32) - forced pins,
  idempotency, CAS races, illegal-transition rejection, one-time
  approval, nonce replay.

## What is NOT built (honest gates)

- No process observes a persistent queue, holds a lease, or
  resumes after restart. The completion engine is still a pure
  step() function.
- Migration 0010 is NOT applied, so nothing persists yet.

## Owner-gated path to a durable worker

G-D1 (OWNER): apply migration 0010 to staging
   (reports/PHASE_7_MIGRATION_0010_OWNER_PACKET.md). Until then
   the store adapters have no tables to write.

G-D2 (CLAUDE, after G-D1, still simulation-only execution): build
   the durable driver as a bounded oneshot that:
   1. reads persisted decomposed goals (listGoals/listJobsForGoal);
   2. for each ready job, acquires an EXISTING os_jobs lease
      (reuse leases.ts + store.acquireLease - NOT a new lease
      system) fenced by lease token;
   3. runs the SIMULATION adapter (executed:false), writes a
      job_checkpoints row (reuse checkpoint.ts), and CAS-
      transitions the job;
   4. on restart, resolveResume (existing) skips completed work
      and re-observes cancellation;
   5. dead-letters past the retry budget; honors owner_stop/pause
      via readSystemControlsChecked (fail-closed).
   This runs under the EXISTING dispatcher (os-runtime/dispatcher
   .ts) as a new bounded command, deployed to the staging host as
   an owner-run oneshot - reusing the proven Phase 5 systemd
   oneshot + token-store pattern. Execution stays disabled
   (execution_enabled=false); the worker only advances SIMULATION
   jobs, exactly like the Phase 5 staging simulation cycle.

G-D3 (OWNER): deploy the dispatcher build to the staging host and
   run the oneshot; verify: goals decompose+persist, jobs advance
   in simulation, checkpoints written, restart resumes, owner_stop
   halts. THIS is when "continuous"/"durable" becomes true and
   remotely proven - not before.

## Hard stops (unchanged)

No execution enablement, no remote runner, no Hermes mode change,
no push/deploy by Claude, no SQL by Claude, no credential access.
The durable worker advances SIMULATION jobs only; real agent work
is a separate activation-ladder gate (Level 1+).

## Rollback

Additive tables (0010); the oneshot is bounded and idempotent;
stopping the timer halts the worker; no external effect exists.
