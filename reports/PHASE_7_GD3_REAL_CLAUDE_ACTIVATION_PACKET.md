# PHASE 7 G-D3 - LEVEL-1 REAL CLAUDE ADAPTER ACTIVATION PACKET

Date: 2026-07-28. Status: CODE ONLY. The Level-1 real Claude
adapter is implemented, unit-tested against an injected fake
process runner, and WIRED INTO NOTHING. No step in this packet
has been performed. Claude performs none of them.

Scope of this packet: the exact owner-run path from "code exists"
to "one bounded read-only Level-1 task has been observed", plus
the restore and global-stop procedures. Every step is owner-run
on the staging host. Claude never runs the Claude CLI against the
live staging repository, never authenticates it, never sets the
feature gate, and never approves a protected action.

## 1. What was built

`apps/dashboard/src/lib/ai-os/real-claude-adapter.ts` - the
SEPARATED real-adapter path. It is not imported by the durable
driver, the dispatcher, the orchestrator, or any route; a test
pin asserts that. The simulation contract is untouched:
`makeSimulationAdapter` still returns `executed:false`, and
`probeRealCapability` in `orchestration/adapters.ts` still returns
`unavailable`.

Controls implemented (all fail-closed):

- Owner env gate `ORCH_REAL_CLAUDE_ENABLED` must be exactly
  `true`. Anything else returns `unavailable` with NO process.
- Emergency flag `DISABLE_REMOTE_RUNNER` must be exactly `false`.
- `SUPABASE_RUNTIME_ENV` must be `staging`.
- `system_controls` must be READABLE and show execution_enabled
  and remote_runner_enabled true with owner_stop and paused false.
- Capability probe performs NO authentication, NO file writes, NO
  network, and NO implementation prompt. Its only I/O is an
  existence test on the configured executable.
- Executable must be an ABSOLUTE path, traversal-free, with a
  basename on the FIXED allowlist `claude` / `claude.exe`. git,
  npm, node, sh, bash, and pwsh are NOT allowlisted, so no push
  or deploy command is invocable through this adapter. `.cmd` and
  `.bat` shims are excluded because Node cannot spawn them
  without a shell and this adapter never uses one.
- Process invocation: argument-array spawn with `shell: false`, a
  FIXED four-element argument contract, bounded stdout+stderr
  (2,000,000 bytes) with kill-on-exceed, a total timeout clamped
  to 15 minutes with PROCESS-TREE termination, an allowlisted
  secret-free child environment, sanitized bounded evidence
  excerpts, and deterministic exit-status mapping.
- Worktree confinement: the existing atomic worktree lock must be
  bound to this job, worktree id, and base commit, be unexpired,
  carry a valid fence, and carry only relative traversal-free
  paths inside `ORCH_ALLOWED_PATHS`. The working directory must
  be absolute, traversal-free, and - after symlink resolution -
  still inside `ORCH_WORKTREES_ROOT` with the locked directory
  name. A dirty tree refuses.
- Job contract: role claude, Level-1 eligible kind (documentation,
  code, test, audit, recommendation - migration, repair, and
  unknown are excluded), risk within YELLOW, status in_progress
  leased by THIS run_id with a live lease, staging environment,
  and - where the job is gated - an AUTHORITATIVE owner approval
  verified through the same canonical SHA-256 binding the durable
  driver uses (`verifyAuthoritativeApproval`).
- Prompt boundary: the remote agent prompt states the authorized
  task, allowed paths, base commit, the prohibitions (no push, no
  deploy, no credential access, no production, no network, no
  sends, no safety-control edits), the required tests and
  evidence, and the stop conditions. Task text and repository
  content are declared DATA, never instruction authority; task
  text is control-character-stripped, length-bounded, and stays a
  single argv element, so it can neither add arguments nor be
  parsed as a flag.
- Result path: `persistRealResult` writes only through the
  run-owned CAS (`transitionJobOwned`), re-reads controls
  immediately before the write, and refuses non-terminal
  outcomes. A stale, superseded, or out-of-band-cancelled run can
  never commit. `executed:true` appears only in the TYPED result
  and evidence ref for a fully-checked exit-0 untruncated run.

## 2. What is NOT built (deliberate boundaries)

- No Codex adapter. Claude CLI is the first adapter; nothing in
  the shared architecture required Codex to change.
- No wiring into the driver, dispatcher, systemd unit, route, or
  UI. Activating the env gate alone changes NO current behavior,
  because no shipped code path calls the adapter yet. Wiring it
  into a bounded owner-run command is a SEPARATE later gate.
- No migration. `goal_jobs.executed` stays CHECK-pinned false by
  migration 0010, so the adapter never writes that column. A real
  execution record in the database requires a later owner-gated
  migration.
- No credential handling. Claude CLI authentication is owner
  provisioned in the service user's home directory. The adapter
  never reads, passes, or logs it; the child process receives an
  allowlisted environment containing no Supabase, Telegram,
  provider, or other runtime secret.

## 3. Owner-run activation steps (NONE performed)

Run these in order, on the staging host, as the service user.
Stop at the first failure and run section 5.

1. Verify the pinned commit. `git -C <repo> rev-parse HEAD` must
   equal the G-D3 commit recorded at gate close. Build with the
   existing `npm ci` + `npm run build:os-runtime`.
2. Verify Claude CLI authentication OUT OF BAND, as the service
   user, in an interactive shell (`claude --version` and one
   trivial read-only prompt in a scratch directory that is NOT
   the staging repository). Record only that it succeeded. Never
   paste credentials anywhere.
3. Verify the executable path: `command -v claude` then resolve
   it to an absolute path whose basename is `claude`. Confirm the
   binary is owned by root or the service user and is not
   writable by others.
4. Set the environment in `worker.env` (mode 600, service user):
   `ORCH_REAL_CLAUDE_ENABLED=true`, `ORCH_CLAUDE_EXECUTABLE=<the
   absolute path from step 3>`, `ORCH_WORKTREES_ROOT=<absolute
   worktrees root>`. `ORCH_BASE_COMMIT` and `ORCH_ALLOWED_PATHS`
   are already set from the orchestrate-once gate. Also set
   `DISABLE_REMOTE_RUNNER=false` for the duration of the drill
   only.
5. Set the control plane for the drill window (owner SQL):
   execution_enabled true, remote_runner_enabled true, owner_stop
   false, paused false. THIS IS THE POINT OF NO RETURN for
   posture - record the prior values first.
6. Run the CAPABILITY PROBE only. It spawns nothing. Expect
   capability `real` and an empty reason list. If any reason
   code appears, fix that one item and re-probe.
7. Run ONE bounded READ-ONLY Level-1 task: kind `audit` or
   `recommendation`, GREEN risk, a fresh isolated worktree from
   the pinned base, allowed paths limited to a single directory,
   and an owner approval if the job is gated. Observe the process
   exit status, duration, and truncation flag.
8. Inspect evidence: the typed result (outcome, executed,
   evidence ref, bounded sanitized excerpts) and, if the result
   was persisted, the `goal_jobs` row - status terminal, run_id
   cleared, evidence_refs appended, and `executed` still false in
   the DATABASE column (the 0010 pin).
9. Confirm no push, no deploy, no branch beyond `wt/<job-id>`, no
   change outside the allowed paths, and no modification to
   hooks, scanners, approvals, or control rows.

## 4. Restore safe state (run after the drill, always)

1. Remove `ORCH_REAL_CLAUDE_ENABLED` (or set it to empty) and set
   `DISABLE_REMOTE_RUNNER=true` in `worker.env`.
2. Owner SQL: execution_enabled false, remote_runner_enabled
   false, owner_stop false, paused false, hermes_mode
   observe_only - the standing simulation posture.
3. Release or expire any worktree lock the drill acquired and
   remove the drill worktree directory with the existing
   owner-run script. Never force-remove anything outside
   `ORCH_WORKTREES_ROOT`.
4. Re-verify posture with the existing preflight health check.

## 5. Global stop procedure

Any ONE of these halts real execution immediately, and the
adapter refuses on the very next call:

- Owner SQL: `system_controls.owner_stop = true` (or
  `paused = true`). This is the authoritative kill and also
  blocks result persistence mid-flight.
- Set `DISABLE_REMOTE_RUNNER=true` or remove
  `ORCH_REAL_CLAUDE_ENABLED` from `worker.env`.
- Set `system_controls.remote_runner_enabled = false` or
  `execution_enabled = false`.
- Move or chmod the configured executable so the probe's
  existence check fails.

A process already running is bounded by its own timeout and is
terminated as a process tree. An owner stop observed between the
run and the write refuses the write, and the job returns to the
lease-recovery path rather than recording a result.

## 6. Preconditions and residual risks

- Migration 0010 is applied (gate closed 2026-07-28).
- The adapter is unreached by shipped code, so activation of the
  env gate alone is inert until a later wiring gate.
- Residual: the drill window requires execution_enabled and
  remote_runner_enabled true, which the orchestrate-once command
  treats as an unsafe posture and refuses. Do not run the
  simulation orchestrator during the drill window; that refusal
  is correct and expected.
- Residual: the existence-check probe is a point-in-time test; a
  binary swapped between probe and spawn is not detected. The
  allowlist, absolute path, and non-writable ownership check in
  step 3 are the mitigations.
- Residual: the adapter trusts the caller's observed `treeDirty`
  flag and worktree path. A future wiring gate must derive both
  from a real git status inside the locked worktree.
