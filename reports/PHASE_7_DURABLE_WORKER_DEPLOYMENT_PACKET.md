# PHASE 7 - DURABLE WORKER DEPLOYMENT + VALIDATION PACKET (owner-run)

Date: 2026-07-22. Status: the durable DRIVER + store-backed lock
are coded + fake-client tested (95 orchestration tests). NO
process is deployed and migration 0010 is NOT applied. This packet
is the exact owner-run path to a resumable durable worker and its
validation. Claude performs none of these steps.

## Preconditions

- G-D1: migration 0010 applied to staging (migration packet).
- The staging host (preston-agent-staging) and its systemd
  oneshot + token-store pattern from Phase 5 remain in place.

## What is built (verified, simulation-safe)

- orchestration/driver.ts - loadGoalState (rebuilds a GoalState
  from persisted rows => RESTART-SAFE by construction), driverStep
  (halts fail-closed on owner_stop/pause/unreadable controls;
  two-phase run marks in_progress then completes via the
  SIMULATION adapter, executed:false; every transition is CAS,
  concurrent-safe), driveGoal (bounded loop; parks on
  awaiting_owner_approval).
- orchestration/worktree-lock-store.ts - atomic acquire/release on
  the EXISTING repository_worktrees table; DB unique(id) = the
  real CAS; fence encoded in lock_id so a revived stale holder is
  fenced out; no new table, no duplicate persistence.
- Tests: orchestration-driver.test.ts (7): drive-to-completion,
  RESTART RESUME (fresh driver over persisted rows; job not
  re-run, attempts stay 1), owner_stop halt, unreadable-controls
  halt, concurrent worktree race, stale takeover + fencing, dirty/
  branch-collision rejection.

## Architecture (ChatGPT review, 2026-07-22) - SINGLE source of truth

Reuse the proven Phase 5 runtime; do NOT create a second lease/
checkpoint/dispatcher subsystem. Canonical records:
- runtime job + LEASE: os_jobs (goal_jobs.runtime_job_id links a
  Phase-7 job to its os_jobs row; the worker leases the os_jobs
  row via the EXISTING leases.ts + store lease adapters, fenced).
- restart CHECKPOINT: job_checkpoints (existing checkpoint.ts).
- worktree allocation + fence: repository_worktrees (the Phase 7
  worktree-lock-store; NOT the generic locks table).
- orchestration goal/job state: the Phase 7 goal tables (0010).
- approval state: orchestration_approvals.
The generic locks table is only for short-lived cross-cutting
mutexes without an authoritative resource row.

The durable worker therefore, per ready goal_job: enqueue/lease
an os_jobs row (reuse), acquire the repository_worktrees worktree
lock (built), simulate + checkpoint (reuse job_checkpoints),
CAS the goal_job (built), release lock + lease. Restart re-reads
os_jobs + goal_jobs status (loadGoalState) and resumes. This adds
NO new lease/checkpoint/dispatcher code - only the mapping.

## Owner-run deployment (G-D3)

1. On the host, build the dispatcher (existing
   `npm run build:os-runtime`) from the pinned Phase 7 commit.
2. Add a bounded `orchestrate-once` command to the dispatcher that
   calls driveGoal for the oldest non-terminal goal, under the
   existing SUPABASE_RUNTIME identity (owner-scoped, never
   service-role). Exit codes reuse the Phase 5 convention
   (0/75halted/70error/78config).
3. Install it as an owner-run systemd ONESHOT + timer (disabled by
   default; oneshot, LogsDirectory, no auto-start) - copy the
   proven preston-worker unit pattern.
4. Enable the timer ONLY when validating; the worker advances
   SIMULATION jobs while execution_enabled stays false.

## Owner validation (record results)

V-D1 Submit one goal (via the owner form/API once wired, or a
     seed row): it decomposes + persists (master_goals + goal_jobs
     + job_dependencies rows).
V-D2 Run the oneshot: jobs advance pending->in_progress->completed
     in SIMULATION; goal_jobs.executed stays false everywhere.
V-D3 RESTART RECOVERY: kill the oneshot mid-goal; run it again;
     completed jobs are NOT re-run; the goal still completes.
     (This is the remote proof that "durable" is real.)
V-D4 owner_stop: set system_controls.owner_stop=true (owner SQL);
     run the oneshot; it halts with exit 75, persists nothing.
V-D5 A gated (RED-objective) job parks at awaiting_approval; the
     worker never self-approves; the goal reports
     awaiting_owner_approval.
V-D6 Controls after: execution_enabled=false, remote_runner_
     enabled=false, hermes_mode=observe_only unchanged.

## Only after V-D1..V-D6 pass

May the platform state "Phase 7 durable orchestration runtime is
staging-operational, simulation-only, remotely proven." Until
then it is coded + tested only. NO real agent execution, NO push,
NO deploy by Claude; real Claude/Codex adapters remain Level-1
gates (worktree-lock owner packet).

## Rollback

Disable the timer (worker stops); additive 0010 tables inert;
the oneshot is bounded + idempotent; no external effect exists.
