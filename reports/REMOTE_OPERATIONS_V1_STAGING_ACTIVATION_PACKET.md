# REMOTE OPERATIONS V1 - STAGING ACTIVATION PACKET (OWNER GATES)

Date: 2026-08-07. THIS PACKET AUTHORIZES NOTHING BY ITSELF. Every gate is
owner-run, in order. Staging only; production is out of scope. The agent
verifies read-only between gates and runs the drills' verification.

Prereqs: phase8/remote-ops-v1 reviewed; full matrix green at its tip;
Phase 7 estate at rest (all timers disabled).

## GATE A - merge + push (owner)

    cd C:\dev\preston-os
    git log --oneline master..phase8/remote-ops-v1
    git checkout master && git merge --ff-only phase8/remote-ops-v1
    git push origin master
    git ls-remote origin master

PASS: ls-remote tip = the reviewed branch tip. Vercel auto-deploys; agent
verifies sha/status anonymously.

## GATE B - apply migration 0011 + configure the gateway (Supabase SQL)

1. Run supabase/migrations/0011_phase8_remote_intake.sql (whole file).
2. Mint a strong random token; store it in 1Password as
   REMOTE_INTAKE_TOKEN. Never paste it into chat.
3. Configure (computes the hash server-side; history is owner-only):

    update remote_intake_config
      set token_hash = encode(digest('PASTE_TOKEN_HERE', 'sha256'), 'hex'),
          enabled = true, updated_at = now();
    select enabled, length(token_hash) as hash_len, max_pending
      from remote_intake_config;

PASS: enabled=true, hash_len=64.

## GATE C - Vercel env (Preview/Production of the staging project)

    REMOTE_INTAKE_ENABLED=true
    REMOTE_INTAKE_TOKEN=<the token>
    (SUPABASE_RUNTIME_ENV=staging must already be present)

Redeploy (cache unchecked). Agent then verifies anonymously:
- POST /api/os/remote/goal without a token -> 401
- with the token + a throwaway request_id -> accepted/duplicate
- GET /api/os/remote/status?request_id=... -> ok

## GATE D - host re-pin + runtime env + permissions

Re-pin exactly as CL-2 shape ($TIP = the merged tip full hash; $PREV =
d13c215c8e4cb3402cbeaa7fadb1cced8c21f687):

    cd /srv/preston-os && sudo git fetch origin && sudo git checkout --detach $TIP
    cd apps/dashboard && sudo npm ci ; sudo npm run build:os-runtime
    sudo node dist/os-runtime/bin.js health   # expect 78

Append to /etc/preston/worker.env (600 preserved):

    ORCH_EXECUTION_LEVEL=bounded_code_execution
    ORCH_GIT_EXECUTABLE=/usr/bin/git
    ORCH_CANONICAL_REPO=/srv/preston-os
    ORCH_REAL_CLAUDE_ENABLED=true
    ORCH_CLAUDE_EXECUTABLE=<absolute path, see below>
    ORCH_WORKTREES_ROOT=/srv/worktrees
    DISABLE_REMOTE_RUNNER=false
    REMOTE_INTAKE_OWNER_IDENTITY=info@preston.nyc
    ORCH_BASE_COMMIT=$TIP   (replace existing line)

Permissions (owner decisions, one-time):
1. Agent CLI for the service user. Recommended: install the Claude CLI
   for preston-worker itself (sudo -u preston-worker, its own HOME) so
   credentials and binary live under the service account, not grann:
       sudo -iu preston-worker bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'
       (then) sudo -iu preston-worker claude login   # owner completes auth
   Set ORCH_CLAUDE_EXECUTABLE to the resulting absolute path.
2. Worktrees root writable by the service user:
       sudo chown preston-worker:preston-worker /srv/worktrees
3. Canonical repo readable (it already is; worktree add writes only
   .git/worktrees metadata + the new dir under /srv/worktrees).

    sudo bash /srv/preston-os/deploy/preflight-health.sh   # PASS required

## GATE E - controls posture for the drill window (Supabase SQL)

    update system_controls
      set execution_enabled = true, remote_runner_enabled = true,
          updated_at = now();
    select execution_enabled, remote_runner_enabled, owner_stop, paused
      from system_controls;

owner_stop stays the kill switch and downgrades everything to SIMULATION
instantly. Reverting after the drills: set both back to false.

## GATE F - enable the orchestrator timer

    sudo systemctl enable --now preston-orchestrator.timer

Worker + Hermes timers STAY DISABLED (orchestrate-once carries intake,
capability resolution, and driving in one bounded oneshot).

## DRILLS (agent-verified, owner acts only where marked)

- Stage 11 controlled real drill: agent submits via /api/os/remote/goal a
  docs-only request; tick consumes -> goal -> REAL bounded run in an
  isolated worktree -> path audit -> evidence -> completed; agent proves
  the full checklist (remote origin, worktree confinement, no external
  write, lease released, status readable remotely).
- Stage 12 approval-gated drill: request including a migration-kind task
  -> parks -> OWNER approves from phone -> real run of the ungated tasks,
  gated task stays simulation-eligible only per adapter kinds - the drill
  proves gating, not migration execution.
- Stage 13 owner_stop under the real runner: OWNER sets owner_stop=true
  mid-window; agent proves the tick halts, no claim, no real spawn, then
  OWNER restores.
- Stage 14 rollback: OWNER reverts Gate E controls, disables the timer;
  agent proves inert baseline (disabled x3 / inactive x3, level resolves
  SIMULATION).

## Emergency stop (unchanged)

    update system_controls set owner_stop = true, updated_at = now();
    sudo systemctl disable --now preston-orchestrator.timer

## Explicitly NOT activated

Codex real executable; Telegram; Hermes sends; worker/hermes timers;
EXTERNAL_WRITE (code ceiling); production anything; executed CHECK-pin
lift; least-privilege identities (0007).
