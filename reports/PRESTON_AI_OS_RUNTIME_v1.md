# Preston AI OS - Distributed Runtime v1

Purpose: the runtime that lets multiple AI agents (Claude Code, Codex, ChatGPT,
Telegram intake, Hermes, future workers) coordinate controlled remote building
over one trusted operational state. Phase 3. Non-activating: no worker runs,
Hermes disabled, Remote Runner disabled, execution off by default.

Sources of truth (hybrid): GitHub owns code/docs/runbooks; Supabase owns
operational state (commands, jobs, leases, checkpoints, events, controls,
audit). Neither replaces the other.

## 1. Modules (apps/dashboard/src/lib/ai-os)

Foundation (Phase 2): types, pipeline, locks, memory, registry, events.
Runtime (Phase 3): controls, transport, commands, queue, leases, worktree,
checkpoint, hermes, runner, bridges/chatgpt, bridges/telegram. All PURE +
adapter-driven; every decision function is deterministic given an injected
`now` and unit-tested with no credentials.

## 2. Global controls (controls.ts / system_controls)

One canonical gate: execution_enabled, owner_stop, paused, hermes_mode,
remote_runner_enabled. Defaults are fully stopped (isHalted true, hermes
disabled, runner disabled). runtimeActive requires execution enabled AND not
stopped/paused. Everything downstream consults these.

## 3. Event transport (transport.ts / os_events)

EventEnvelope: id, type, actor, source, correlation_id, causation_id,
idempotency_key, version, payload, created_at, attempts, max_attempts,
dead_lettered. EventStore interface (Supabase later; InMemory for tests).
Append is idempotent by idempotency_key; consume() is replay-safe (skips
processed keys). Payloads reject/redact secrets. No persistent consumer runs.

## 4. Command intake (commands.ts / runtime_command_packets)

Note: the Phase 3 runtime table is `runtime_command_packets` (migration 0004),
a distinct name from the legacy `public.command_packets` (migration 0001, a
different schema). The legacy table is left untouched.


ONE CommandPacket for every source (chatgpt, telegram, dashboard, owner_cli,
claude, codex, hermes, scheduler). Provenance + idempotency + expiry.
Default-deny: execution_eligible is always false at intake; approval_required
for anything not GREEN. Risk classification is defensive (unknown => YELLOW).
Secret-bearing payloads are rejected. Commands are PROPOSALS - they never run
shell.

## 5. Job queue (queue.ts / os_jobs)

Lifecycle: proposed -> validated -> awaiting_approval -> approved -> queued ->
leased -> running -> checkpointed -> completed | failed | cancelled | expired |
dead_lettered. transition() is a fail-closed graph: entering 'running' requires
approval + an active lease + execution enabled (global AND per-job) + no cancel,
and RED/BLACK never run. Dead-letter when attempts exhaust max_attempts.

## 6. Worker leasing + recovery (leases.ts / worker_leases)

One active worker per job via a lease token; leases always expire; stale leases
are safely recoverable; renewal is owner+token bound and only before expiry.
eligibleWorker() is fail-closed and adversarial: refuses on halt/pause/cancel,
missing approval, RED/BLACK, execution disabled, stale/offline agent, missing
capability, missing connector permission, missing correlation id.

## 7. Shared repo / worktree (worktree.ts / repository_worktrees)

GitHub is canonical; per-job worktrees are isolated and lock-guarded. Claude and
Codex never edit the same worktree concurrently (isConcurrentConflict). Workers
NEVER auto-push (workerPushAllowed = false; owner-gated). No force ops. Cleanup
only after verification. Dirty/staged/untracked trees refuse silent reuse. Repo
state is part of every checkpoint.

## 8. Checkpoints + handoffs (checkpoint.ts / job_checkpoints)

Canonical resumable checkpoint: project/phase/gate/goal/job/agent/worktree/
branch/base+current commit/files/tests/validation/blockers/owner_actions/
next_action/rollback/correlation/timestamp/status. JSON + Markdown + compact
Telegram renderings. Stores conclusions/evidence/commands/status ONLY -
reasoning-shaped keys are stripped and secrets redacted. Supports Claude<->Codex
handoff and crash resumption.

## 9. Hermes orchestration (hermes.ts / orchestration_decisions)

Pure DECISION engine, DISABLED by default. Modes: disabled, observe_only,
propose_only, dispatch_eligible, paused, stopped. decide() never executes,
never bypasses approval, never runs RED/BLACK, never acts when halted/paused.
It composes command validation + eligibleWorker; a 'dispatch' decision is still
gated downstream (execution off). No daemon, no polling.

## 10. Remote Runner (runner.ts)

Structured ExecutionEnvelope: explicit repo_root, allowlisted executable,
explicit arg list (NO shell string), cwd within root, bounded timeout, network
off by default. validateEnvelope rejects non-allowlisted executables, shell
metacharacters, path traversal, destructive args, network, cwd escape, bad
timeout. runPermitted requires remote_runner_enabled AND runtimeActive (both
default false). simulate() plans only - wouldRun is always false. Launches
nothing.

## 11. Bridges (bridges/chatgpt.ts, bridges/telegram.ts)

ChatGPT: authenticated request -> owner-allowlist check -> normalized
default-deny command packet; halted/paused yield status-only responses. Never
executes. Telegram: parser for /status../checkpoint; owner identity + chat
allowlist + replay protection + freshness; state-changing commands flagged for
confirmation. Never sends a message; never runs shell. Both remain disabled
until an owner activation gate.

## 12. Threat model (Stream M) - assessment + mitigations

- Prompt injection into commands: commands are data; risk-classified;
  default-deny; secret payloads rejected; no command text is executed as shell.
- Secret exfiltration: memory + event + checkpoint + envelope redaction;
  secret-shaped keys rejected/redacted; env names only in repo.
- Command injection: runner uses structured executable + arg list, blocks shell
  metacharacters; no free-form shell.
- Path traversal / symlink: args and cwd rejected on '..'; cwd must be within
  repo_root; worktrees namespaced per job.
- Worktree collision: lock-guarded allocation; concurrent-share refusal.
- Lease theft: lease requires owner+token; renewal owner+token bound; stale
  recovery only after expiry.
- Stale-agent dispatch: heartbeat liveness -> stale = offline -> ineligible.
- Telegram replay / forged ChatGPT: message-id replay set + freshness window;
  owner chat/user allowlist; ChatGPT owner-allowlist. (Transport auth is an
  owner-run activation prerequisite.)
- Approval replay / idempotency bypass: unique idempotency keys on commands +
  jobs; conditional lease/transition; append-only attempt log.
- Audit tampering / event spoofing: append-only tables (revoked update/delete);
  owner-only RLS; correlation ids throughout.
- SSRF / unsafe URLs: no arbitrary outbound; runner network off by default;
  connectors allowlisted.
- Log injection / output flooding / DoS / runaway retries: bounded output +
  timeout in runner; bounded max_attempts + dead-letter; rate-limit expectation
  on bridges.
- Runner escape / privilege escalation / service-role misuse: no shell,
  allowlisted executables, timeout ceiling; service-role key never in the app;
  workers use least-privilege identity (owner-provisioned, future gate).
- Owner impersonation / cross-project / production-target injection: owner
  allowlist + RLS; target_project/target_repository explicit; production
  blocked by risk class + no production connector.

Residual (owner-gated): real transport authentication for ChatGPT/Telegram;
least-privilege worker identity + encrypted token storage; rate-limit
enforcement; runtime activation drills.

## 13. Disaster recovery

- Crash recovery: expiring leases free stuck jobs; checkpoints resume work at
  the last committed conclusion; idempotency keys prevent double-apply.
- Queue recovery: dead-letter terminal failures; requeue while attempts remain.
- State recovery: Supabase is the durable operational state; GitHub is durable
  code. Rebuild a worker from registry + controls + last checkpoint, no chat
  history needed.
- Rollback: additive migrations are droppable; commits are revertible; controls
  can hard-stop everything (owner_stop / execution_enabled=false).

## 14. Global stop / kill switch runbook

- Soft pause: system_controls.paused = true -> Hermes noop, no new dispatch.
- Hard stop: system_controls.owner_stop = true OR execution_enabled = false ->
  isHalted true -> every eligibility/transition/dispatch fails closed.
- Runner off: remote_runner_enabled = false -> runPermitted false.
- Hermes off: hermes_mode = 'disabled' -> decide() noop.
All are single-row updates to system_controls (owner-run SQL / dashboard); no
deploy needed. Verify via the control center reading system_controls.

## 15. Engineering-complete vs owner-gated

Complete (code + schema + tests + docs): all 11 runtime modules, migration
0004, this spec. Owner-gated (packets): apply 0004; configure remote server +
least-privilege worker; enable Hermes observe_only; runner simulation drill;
bounded remote build activation; transport auth for bridges. Non-activating:
nothing runs until the owner flips controls in a dedicated gate.
