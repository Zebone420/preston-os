# Preston AI OS - Runtime Status v2 (coded vs specified + DR runbooks)

Truthful status of the distributed runtime after the wiring increment. Staging
only; nothing activated; Hermes/Runner/execution disabled. This file states
exactly what is CODED, what is SPECIFIED-only, what is owner-run, and whether
laptop-closed continuation is ready (it is NOT).

## 1. Coded and tested (this + prior increments)

- Contracts + pure logic: types, pipeline, locks, memory, registry, events,
  controls, transport, commands, queue, leases, worktree, checkpoint, hermes,
  runner, bridges/chatgpt, bridges/telegram.
- Supabase adapters (store.ts) for ALL runtime tables: runtime_command_packets,
  os_jobs, worker_leases, job_attempts, dead_letters, orchestration_decisions,
  agents, agent_memory, locks, execution_queue, repository_worktrees, os_events,
  job_checkpoints, system_controls. Injectable, RLS-bound, no service-role,
  idempotent, fail-closed; execution_enabled forced false on writes; memory
  redacted; conditional (CAS) job status change.
- Orchestrators (orchestrator.ts): runWorkerCycleSimulation (guard chain +
  simulate; executed always false) and runHermesObserveOnce (observe-only
  decisions recorded + HermesObserved event; never leases/executes).
- Control-plane handlers (controlplane.ts): submitCommandProposal (owner-checked,
  validated, default-deny, production-rejected, audited), requestControl
  (pause/resume/stop; never enables execution/runner; audited), readStatus
  (fail-closed).
- Migrations 0003 + 0004 (owner-applied; 0004 uses runtime_command_packets;
  legacy command_packets untouched).
- Tests: 242 total, credential-free. Lint + tsc + secret + RED scans clean.

## 2. Specified but NOT coded (remaining thin wiring)

- HTTP surface: Next Server Actions / route handlers that call the control-plane
  handlers + bridges (the LOGIC is done + tested; the route files are not).
  Pattern to follow: apps/dashboard/src/app/approvals/actions.ts (owner re-check
  inside the action).
- Telegram transport: webhook/polling receiver that feeds parseTelegram/
  intakeTelegram (parser + intake done + tested; the transport receiver is not).
- ChatGPT HTTP intake endpoint (intake contract done; endpoint not built).
- Owner control-center page rendering agents/jobs/leases/checkpoints/controls
  (data layer done via adapters + readStatus; the page is not built).
- Worker runtime PROCESS/CLI and Hermes observe SERVICE (the one-shot logic is
  done in orchestrator.ts; a long-running executable is not, by design).
- Shared-repo dry-run shell scripts (worktree planning/validation is coded +
  tested; the git-driving scripts are not).

None of the above is activated; all are owner-gated.

## 3. Owner-run only (packets exist)

Apply migrations; seed system_controls; remote server prep; Hermes observe-only
mode flip; runner simulation; bounded remote build (RED); global stop. See
reports/PHASE_3_RUNTIME_OWNER_PACKETS.md and
reports/PRESTON_AI_OS_SCHEMA_ALIGNMENT_v1.md.

## 4. Disaster-recovery runbooks

Restart recovery:
- On restart, read system_controls (fail-closed if unreadable). Do NOT resume
  execution automatically. Rebuild agent view from agents + heartbeats; treat
  stale agents as offline. Resume jobs only from their last job_checkpoint.

Stale-lease recovery:
- A lease past expires_at is recoverable by any worker (leases.canLease). The DB
  unique(job_id) + conditional write is the mutual-exclusion guard. To force-
  free: owner sets the lease row expires_at to now (or deletes it) in the SQL
  editor; the job returns to 'queued'.

Worktree recovery:
- A dirty/staged/untracked worktree refuses silent reuse (worktree.refusesDirty
  Reuse). Recovery: capture a checkpoint, then the owner inspects/commits or
  discards on the server; cleanup only after status 'verified'. No worker auto-
  pushes; no force ops.

Dead-letter handling:
- Jobs exhausting max_attempts move to dead_letters (append-only) with reason +
  correlation_id. Owner reviews dead_letters; requeue is a fresh command.

Global kill switch (always available, no deploy):
    update system_controls set owner_stop=true, execution_enabled=false,
      remote_runner_enabled=false, hermes_mode='disabled', paused=true,
      updated_at=now() where id='global';
Effect: isHalted true everywhere; every eligibility/transition/dispatch fails
closed. Verify via readStatus / the control center.

Database rollback:
- Drop the additive Phase 3/2 tables (owner packet) - never the legacy
  command_packets. Non-destructive to business data.

Git rollback:
- git revert <hash> for any commit; tests guard against regressions. Never force
  push; never rewrite shared history.

Remote-server rollback:
- Remove the checkout + worktrees + service identity; no daemon was installed.

## 5. Laptop-closed continuation drill - readiness

NOT READY / NOT PASSED. Laptop-closed continuation requires a deployed worker
process + Hermes service on the staging server, an owner-provisioned least-
privilege identity, and configured bridge transport - none of which exist yet.
The decision logic (leases, eligibility, worker-cycle simulation, Hermes
observe) is coded and tested, so the drill is DESIGN-ready but cannot be claimed
as passed until the owner deploys the service and runs it with the laptop
closed. Drill definition (owner-run, later): enable Hermes observe_only, submit
one approved GREEN command, close the laptop, confirm the server-side worker
simulates + checkpoints + records + releases with kill switch verified.

## 6. Verdict

Runtime engineering (contracts + adapters + orchestrators + control-plane
handlers) is complete and tested. Remaining work is thin HTTP/transport/CLI/UI
wiring plus owner-run deployment + activation. No autonomous or remote-live
operation exists; the laptop-closed drill has not been run.
