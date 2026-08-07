# REMOTE OPERATIONS V1 - VERIFIED GAP MATRIX AND ARCHITECTURE

Date: 2026-08-07. Phase 8 Stage 1+2 deliverable. Every row verified from
code/runtime (three independent repo sweeps + live host inspection), not
assumed. Baseline: master e3b99a4 (Phase 7 GO, bounded remote-live
staging). Work branch: phase8/remote-ops-v1.

## 1. Verified state at Phase 8 entry

READY (Phase 7, live-proven):
- Composer intake from phone (server actions, owner session, deterministic
  parse, idempotent persistence via submit_goal_decomposition RPC).
- Goal decomposition, policy tiers (GREEN/YELLOW/RED + 16 mobile-gate
  markers), agent contracts (default-deny, can_approve=false everywhere).
- Approval lifecycle: hash-bound one-time decisions (0010 RPC, UPDATE
  revoked), authoritative verification (11 fail-closed checks), park/clear
  CAS bound to 8 action columns, expiry at execution time.
- Durable driver: restart-safe, run-owned leases + fencing, wall-deadline
  anchored to owner decisions (d13c215), terminal-verdict exit, worktree
  LOCK rows (fenced, stale-takeover-safe).
- orchestrate-once under systemd timer; owner_stop single-line halt exit
  75; rollback to inert posture. All proven live 2026-08-07.
- Host: claude + codex CLIs INSTALLED (/home/grann/.local/bin), node 24,
  git 2.43, /srv/worktrees exists. Services run as preston-worker.

PARTIAL at entry:
- Real Claude adapter (G-D3): complete + 65 tests on branch
  phase7/gd3-adapter-port, wired into NOTHING; simulation driver
  unconditionally used the simulation adapter.
- ChatGPT route /api/os/chatgpt: bearer-authenticated, durable dedup, but
  terminates in legacy runtime_command_packets AND holds a cookie-session
  DB client that cannot write on cookie-less calls (documented
  circularity). No goal-graph path, no remote status/evidence read.
- execution_enabled/remote_runner_enabled: gates that gate no live path
  (orchestrate-once refused when true; simulation ignores them).
- Hermes: observes legacy os_jobs only; no goal-graph visibility.
- dead_letters TABLE writer unwired (status-only dead-lettering on
  goal_jobs - acceptable; table remains a designed sink).
- Telegram: parse-only route, sendless, in-process dedup only; durable
  0006 adapter unbound; route not proxy-excluded.

MISSING at entry:
- Any capability level between simulation and unrestricted execution.
- Runtime worktree provisioning (owner-run shell script only).
- Path-allowlist ENFORCEMENT after a real run (locks carried the list;
  nothing verified compliance).
- Remote goal submission/status for a cookie-less caller.
- Host permissions: preston-worker cannot reach the agent CLIs
  (/home/grann, mode 700 home) nor write /srv/worktrees (grann-owned).

BLOCKED/OWNER-GATED at entry: everything in section 4.

## 2. What Phase 8 built (commits 8abe4c9..this doc, all tested)

1. G-D3 real adapter ported to the canonical line (8abe4c9; 65 tests).
2. execution-capability.ts: SIMULATION / BOUNDED_CODE_EXECUTION /
   EXTERNAL_WRITE. Owner DB posture dominates env; EXTERNAL_WRITE is
   refused by a CODE ceiling (not a flag); every gap resolves SIMULATION.
3. worktree-provision.ts: runtime git worktree add/status/remove via
   FIXED argv builders (no push/fetch/remote constructible), porcelain
   path audit = post-run allowlist ENFORCEMENT (rename-aware, fail-closed
   on unreadable status, empty allowlist permits nothing).
4. Driver seam: injected RealJobExecutor reached ONLY after the
   authoritative approval gate and lease claim; null declines to
   simulation; throws contained; mid-run owner stop discards results
   identically to Phase 7. orchestration/ stays structurally spawn-free.
5. os-runtime/real-executor.ts: capability gate (re-resolved PER JOB) ->
   provision -> G-D3 adapter (its own 8-gate probe + contract +
   confinement) -> path audit -> guaranteed worktree removal (violations
   discard the edits with the worktree).
6. Dispatcher: exactly two legal postures (simulation pin unchanged, or
   fully-resolved bounded execution); injects the executor only under the
   second; logs execution_level on driven goals.
7. Migration 0011 remote-intake gateway: SECURITY DEFINER submit/status
   functions, sha256 token-hash auth, backpressure, bounded columns,
   owner-only RLS, anon = EXECUTE on the two functions only, no deletes.
8. /api/os/remote/goal + /api/os/remote/status: bearer + constant-time +
   size gates before body; proxy-excluded; record/read ONLY.
9. remote-intake.ts host consumption at the top of each orchestrate-once
   tick: owner-identity binding precedes composition; the SAME composer
   pipeline as the dashboard; request_id = idempotency key (crash-window
   replays converge); CAS-marked consumed/rejected with readable reasons.
10. Hermes orchestration status observation: read-only bounded summary
    into orchestration_decisions (minute-bucket idempotent), surfaces
    approval_attention. No sends (a Hermes send channel stays gated).

## 3. V1 flow (target end state mapping)

phone/ChatGPT -> POST /api/os/remote/goal (bearer)
  -> 0011 gateway (token hash, backpressure) -> remote_intake_requests
  -> host tick: owner-bound composer consumption -> master_goals/goal_jobs
  -> policy: GREEN/YELLOW proceed; approval-gated tasks PARK
  -> owner approves on /os/orchestration (phone) [unchanged surface]
  -> driver: approval verify -> lease -> capability gate ->
     real worktree -> claude CLI (bounded, scrubbed env, timeout,
     tree-kill) -> path audit -> evidence refs -> run-owned CAS persist
  -> goal completes
  -> GET /api/os/remote/status (bearer) returns goals/jobs/evidence/open
     approvals -> ChatGPT/phone. Laptop never involved.

Codex note: codex-assigned jobs decline to simulation in V1 (the adapter
allowlists only the claude executable); a codex executable gate is a
separate later activation. executed COLUMN stays false (0010 CHECK pin);
real execution is recorded in typed results + real:...:executed:true
evidence refs - lifting the pin is a later owner-gated migration.

## 4. Remaining gaps and owner gates (deploy-time)

OWNER-GATED (single packet at Stage 10):
- Apply migration 0011 (staging SQL editor).
- Set remote_intake_config: token sha256 hash + enabled=true.
- Vercel env: REMOTE_INTAKE_ENABLED/TOKEN (+ redeploy).
- worker.env additions: ORCH_EXECUTION_LEVEL=bounded_code_execution,
  ORCH_GIT_EXECUTABLE, ORCH_CANONICAL_REPO, ORCH_REAL_CLAUDE_ENABLED,
  ORCH_CLAUDE_EXECUTABLE, ORCH_WORKTREES_ROOT, DISABLE_REMOTE_RUNNER=false,
  REMOTE_INTAKE_OWNER_IDENTITY.
- Host permissions: agent CLI reachable by preston-worker (owner choice:
  system-wide install or group access), /srv/worktrees writable by
  preston-worker, Claude CLI credentials provisioned for the service
  user (owner-run login; the adapter never touches them).
- system_controls: execution_enabled=true + remote_runner_enabled=true
  (the drill window only; owner_stop remains the kill switch).
- Timers: orchestrator re-enable for the drills.

DEFERRED (documented, not V1 blockers):
- Codex real executable gate; Telegram durable dedup + proxy exclusion
  (ChatGPT-native intake prioritized per master goal); dead_letters TABLE
  writer; renewLeaseDb (oneshot runs end within one lease); Hermes send
  channel; least-privilege runtime identities (0007); lifting the
  executed CHECK pin (0012 candidate, RED).
