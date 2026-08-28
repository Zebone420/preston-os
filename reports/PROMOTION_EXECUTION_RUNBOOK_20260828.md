# Promotion Execution Runbook — Owner-Run Commands (H-6 boundary)

Date: 2026-08-28. Companion to PROMOTION_PACKAGE_HARDENING_20260828.md.

WHY THIS FILE: the owner approved promotion `6ea49a2..efc56b9`, but the
local Preston safety guard (H-6, installed owner-authorized at B-25)
mechanically blocks git push/fetch/pull and outbound mutations from the
assistant's toolchain, with NO override switch by design. Every prior
push/repin/env change in this project was owner-executed. This runbook
gives the exact owner-run commands, in the approved order, with the
verification the assistant can perform read-only after each step.

Run steps 1–2 from `C:\dev\preston-os`. In a Claude Code session, prefix
with `!` to run them in-session so the assistant sees the output.

## Step 1 — push the branch (7 local commits)

    git push origin hardening/audit-repairs-clone-proof

Expected: origin branch advances 2d4d54e -> efc56b9.

## Step 2 — merge to master and push (FEEDS VERCEL PROD)

    git checkout master
    git pull origin master           # expect fast-forward/no-op from 6ea49a2
    git merge --no-ff hardening/audit-repairs-clone-proof -m "merge: hardening + three live-defect fixes (promotion package efc56b9)"
    git push origin master
    git checkout hardening/audit-repairs-clone-proof

Record the MERGE COMMIT SHA — call it <MERGED> below.

## Step 3 — verify the Vercel production deployment (assistant can do this)

    curl -s https://preston-os-prod.vercel.app/api/health
      -> 200 {"ok":true,"mode":"connected"}
    curl -s https://preston-os-prod.vercel.app/api/control/status
      -> 401 (no token = fail-closed, correct)
    openapi operation count -> 10 ops (unchanged; no new op in this range)

Regression check: same three checks against preston-os-staging.
Rollback: Vercel Instant Rollback to the sealed 6ea49a2 build.

## Steps 4–6 — repin BOTH hosts to <MERGED> and rebuild

Jump chain (single local key `C:/Users/grann/.ssh/preston_agent_ed25519`):

    # staging
    ssh -i C:/Users/grann/.ssh/preston_agent_ed25519 -J root@178.105.10.19 root@168.119.153.173
    # production
    ssh -i C:/Users/grann/.ssh/preston_agent_ed25519 -J root@178.105.10.19,root@168.119.153.173 root@46.224.68.139

On EACH host (owner's established repin procedure; /srv/preston-os):

    cd /srv/preston-os
    git fetch origin
    git checkout <MERGED>
    cd apps/dashboard && npm ci && npm run build:os-runtime
    git -C /srv/preston-os rev-parse HEAD   # MUST print <MERGED> on BOTH hosts

## Step 7 — set the timeout knob on BOTH hosts

Append to the orchestrator env file under `/etc/preston/` (the file the
`preston-orchestrator` oneshot loads):

    ORCH_REAL_TIMEOUT_MS=2700000

(45 minutes; derived run lease 50 minutes. Names only here — no secrets.)

## Step 8 — restart/reload scope (MINIMAL)

The orchestrator is a systemd ONESHOT under manual-tick posture: it reads
env at each start, so NO persistent service restart is required for the
env change. Only if a unit file itself changed (it did not in this range):
`systemctl daemon-reload`. The hermes-observe timer keeps running
unchanged.

## Step 9 — verify active timeout + derived lease

1. `systemctl start preston-orchestrator` (one manual tick) on staging.
2. During the next REAL run (Proof A below), read the claimed job:
   `preston_get_job` -> `run_lease_expires_at` MINUS the claim time must
   be 50 minutes (3,000,000 ms). The lease is derived from the SAME
   resolver as the child timeout, so a 50-min lease horizon PROVES
   ORCH_REAL_TIMEOUT_MS=2700000 is being read (45-min child timeout
   active). If the horizon reads 15 minutes, the env var is not being
   loaded — STOP, fix step 7.

## Live proofs (owner drives via ChatGPT; assistant verifies read-only)

Run on STAGING first; repeat the passing form on prod per posture.

**PROOF A — classification.** Submit via preston_submit_goal:
    "Repair the repository classification lexicon comment in apps/dashboard."
Record: goal id, job id, kind (MUST be code), risk (GREEN expected),
requires_approval (false expected), provider, lease horizon (50 min),
timestamps, terminal state (completed), evidence refs (real:...executed:true,
paths_ok), artifacts if any. Gate check: also submit
    "Fix the deploy script for the dashboard."
and confirm it PARKS approval-gated (deploy marker) — proves gates intact.
(Deny the approval afterward; it is only a gate probe.)

**PROOF B — timeout.** Submit one genuinely long workload, e.g.
    "Audit the apps/dashboard source for stale comments and inconsistencies and write a detailed findings report."
Verify: real execution starts; lease horizon 50 min; if the run needs
longer than 10 minutes it CONTINUES (duration_ms > 600000 when the
workload is long enough — the POLICY proof is the 50-min lease + no
mid-run requeue + attempts=1); artifacts persist (run-report artifact if
the report exceeds 2,000 chars); terminal state correct.

**PROOF C — Business Setup Wizard recovery.** Resubmit ONE wizard
repository-classification goal in the owner's original wording (fix/
repair phrasing). Verify the full path: composition (kinds correct, no
kind_not_eligible, no task_kind_unresolved — if setup/branch wording
still rejects, rephrase with an edit verb; that widening is a separate
work unit), real execution, lease health, artifacts/evidence, terminal
state, and visibility in all three surfaces (preston_status +
preston_get_goal/job via ChatGPT; dashboard orchestration page; control
read-model).

**Per-proof record template** (fill for A, B, C):
goal_id / job_id / composed kind / risk_class / requires_approval /
provider role + model / timeout policy (ms) / lease horizon (ms) /
started_at / ended_at / terminal state + failure_reason(null) /
artifact + evidence refs / preston_status visibility / dashboard
visibility / ChatGPT visibility.

**FAIL-CLOSED:** any unexpected result -> stop, preserve rows/logs, do
not continue, do not clear or rerun historical dead letters; report to
the assistant for diagnosis + rollback recommendation (package section 4).
