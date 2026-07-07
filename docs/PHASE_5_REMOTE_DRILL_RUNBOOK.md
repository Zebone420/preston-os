# Phase 5 - Remote-Live Drill Runbook (READINESS; owner-run, staging only)

Status: RUNBOOK. This document does not run anything and does not authorize
activation. Running the drill is a RED, owner-gated activity on the STAGING
host only. Its purpose is to PROVE each control from the Phase 4 surface so a
later report may - only if every item passes - record remote-live readiness.

Baseline: control surface implemented + unit-tested at ad9ff9f
(apps/dashboard/src/lib/remote-control.ts). Companion docs:
PRESTON_AI_REMOTE_LIVE_READINESS_PLAN_v1, PRESTON_AI_SSH_ACCESS_SPEC_v1,
PRESTON_AI_EMERGENCY_SHUTOFF_SPEC_v1, PRESTON_AI_COMMAND_GATEWAY_SPEC_v1.

## Golden rules for the drill

- STAGING ONLY. No production. No real client/vendor/employee data.
- No live sends (email/SMS/WhatsApp). No live writes. No n8n activation.
- Dry-run workload only - a bounded no-op/heartbeat task, never a real action.
- No secret is pasted into the repo or chat. Attestations are pass/fail only.
- The AI does NOT run the drill and does NOT connect to the host. The owner (or
  an owner-approved operator) runs each step and records the observation.
- Any unexpected result = STOP, do not proceed, write an audit note.

## Preconditions (all must be true before starting)

- [ ] SSH known_hosts fingerprint owner-verified vs the Hetzner console
      (SSH spec). Until verified, do not connect.
- [ ] All eight shutoff flags present and fail-closed on the host, settable by
      the owner without the laptop.
- [ ] REMOTE_RUNNER_ENABLED is NOT 'true' yet (runner disabled at rest).
- [ ] The drill uses a bounded dry-run task only (no live action).
- [ ] An owner-reachable surface shows heartbeat + audit rows (dashboard or a
      staging audit table).

## Drill matrix - prove each control

For each row: perform the action, observe, and mark PASS/FAIL. A FAIL halts the
drill. Map to remote-control.ts so the observed behavior matches the tested one.

### D1. Remote runner disabled by default
- Action: with REMOTE_RUNNER_ENABLED unset, request a run.
- Expect: authorization BLOCKED ("remote runner not explicitly enabled").
- Observe: run refused; audit event run_blocked. PASS / FAIL: ____

### D2. Enable gate (double-gated)
- Action: set DISABLE_REMOTE_RUNNER=false AND REMOTE_RUNNER_ENABLED=true; request
  a bounded dry-run.
- Expect: authorized in DRY-RUN only (mode dry_run; never live).
- Observe: mode == dry_run; no live process starts. PASS / FAIL: ____

### D3. Emergency shutoff (master kill)
- Action: during the dry-run, set DISABLE_ALL_AI_WRITES=true on the host.
- Expect: run halts; no further ticks; audit shows the halt.
- Observe: task stopped promptly. PASS / FAIL: ____

### D4. Owner stop (laptop closed)
- Action: with the laptop CLOSED, the owner sets OWNER_STOP=true on the host.
- Expect: run halts immediately (halt_owner_stop).
- Observe: task stopped without the laptop. PASS / FAIL: ____

### D5. Max runtime kill
- Action: start a bounded dry-run with a short max_runtime_seconds; let it exceed.
- Expect: run is killed at the limit (halt_max_runtime); never exceeds the cap.
- Observe: killed at/under the limit. PASS / FAIL: ____

### D6. Heartbeat stall auto-halt
- Action: simulate a stalled task (no heartbeat) beyond interval x threshold.
- Expect: auto-halt (halt_heartbeat_stale) + owner alert.
- Observe: stall detected and halted. PASS / FAIL: ____

### D7. Remote audit rows
- Action: review the audit surface after D2-D6.
- Expect: an append-only row per start/tick/halt (actor, time, event, no secrets).
- Observe: rows present, append-only, secret-free. PASS / FAIL: ____

### D8. Rollback
- Action: apply a reversible staging change with a rollback note, then roll it back.
- Expect: change reverts cleanly (git revert / documented reverse step).
- Observe: state restored. PASS / FAIL: ____

### D9. ChatGPT review checkpoint
- Action: before declaring readiness, run the review checkpoint on the results.
- Expect: no RED boundary silently crossed; review is advisory, owner decides.
- Observe: checkpoint completed. PASS / FAIL: ____

## Owner attestation (return this - pass/fail only, NO secrets, NO host details)

    PHASE 5 DRILL ATTESTATION
    - D1 runner disabled by default: PASS/FAIL
    - D2 enable gate -> dry-run only: PASS/FAIL
    - D3 emergency shutoff halts run: PASS/FAIL
    - D4 owner stop with laptop closed: PASS/FAIL
    - D5 max runtime kill: PASS/FAIL
    - D6 heartbeat stall auto-halt: PASS/FAIL
    - D7 remote audit rows (append-only, secret-free): PASS/FAIL
    - D8 rollback verified: PASS/FAIL
    - D9 review checkpoint: PASS/FAIL
    - No production, no live sends/writes, no secret shared: yes/no

## Pass criteria

- Every item D1-D9 is PASS, and the final line is "yes".
- Only then may reports/ record remote-live readiness for the owner's decision.
- Any FAIL, or a "no" on the boundary line, blocks the readiness claim.

## Rollback / abort for the drill itself

- Set DISABLE_ALL_AI_WRITES=true (master kill) and REMOTE_RUNNER_ENABLED unset.
- Stop the runner via the host (systemd/container stop), independent of the AI.
- git revert any staging change made for D8.

## Hard stops (halt the drill and ask the owner)

- SSH fingerprint mismatch or host key warning (SSH spec RED stop).
- Any live send/write/connector or production surface becoming reachable.
- Any secret needed in the repo or chat.
- Any control not halting as specified.

## What the AI does with the attestation

- Verifies all PASS + boundary "yes"; if so, drafts the Phase 5 report and the
  Phase 6 100% closeout packet for owner approval.
- If any FAIL: records it, proposes a fix (local/GREEN where possible), and the
  drill is re-run. No readiness claim is made.
- The laptop-close-safe claim is made ONLY after a full PASS, and only by the
  owner-approved closeout.
