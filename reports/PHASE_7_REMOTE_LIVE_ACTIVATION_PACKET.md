# PHASE 7 REMOTE-LIVE STAGING ACTIVATION PACKET (STAGE 8)

Finalized: 2026-08-06 (UTC). Stages 2-7 all CLOSED PASS. THIS PACKET
AUTHORIZES NOTHING BY ITSELF - every section marked OWNER is an
owner-only gate. Final local chain (oldest first): 72efc4b, 62b0cf6,
4bb8714, cdb9668, eaa7df3, c4ccf23, then the Stage 5/6 evidence
commits and this packet's own commit as the final tip (hashes in the
closing report; verify with git log --oneline origin/master..master
before Gate A).

## 1. State ledger (verified, per-claim)

- CODED + TESTED + COMMITTED (local): everything in the evidence chain
  below. TESTED = 1059/1061 vitest (1 pre-existing env fail
  compensated, 1 xfail), tsc/eslint/next/os-runtime builds 0, scans 0/0.
- PUSHED / DEPLOYED / HOST-PINNED: e922db0 line only. The local
  evidence+regression commits are NOT pushed until the final gate.
- STAGING ACTIVATED (timers): NO. Timers disabled x3, services
  inactive x3 - all drill runs were bounded owner oneshots.
- REMOTELY ORCHESTRATING: proven in bounded oneshot mode only
  (composer intake -> goals -> approvals -> driver -> completion, all
  live on the deployed host). Continuous (timer-driven) operation is
  what this packet activates.
- EXTERNALLY EXECUTING: NO - executed=false everywhere, global
  executed_true_rows=0, adapters simulation-only, real Claude/Codex
  adapters remain unavailable/fail-closed. NOT activated by this packet.
- PRODUCTION LIVE: NO. Out of scope; separate future gate.

## 2. Evidence chain (files -> commits; hashes finalized at close)

- PHASE_7_TIP_82E0FAB_DEPLOY_GATE_EVIDENCE.md (b55dd55)
- PHASE_7_CL3C_EXPIRY_LIVE_EVIDENCE.md (762889b + 62b0cf6)
- PHASE_7_GATE_D_A7_STARVATION_DIAGNOSIS.md (93eee0a)
- PHASE_7_GATE_D_A7_VERIFICATION_DEFECTS.md (e922db0)
- PHASE_7_GATE_D_APPROVE_PATH_GATE_EVIDENCE.md (72efc4b)
- PHASE_7_GATE_D_REJECT_PATH_GATE_EVIDENCE.md (4bb8714)
- PHASE_7_CL3C_SYNTHETIC_EXPIRY_GATE_EVIDENCE.md (eaa7df3; test pin cdb9668)
- PHASE_7_FULL_REGRESSION_MATRIX.md (c4ccf23)
- PHASE_7_CL3D_OWNER_STOP_GATE_EVIDENCE.md (at close)
- PHASE_7_FINAL_CLEANUP_AND_POSTURE_EVIDENCE.md (at close)
- Code fixes this bridge: a0f0119, ba54ccc, 1a9b053, 39d2f17, 0ecee8b
  (+ 82e0fab from the prior session), all on the pushed line or in the
  local chain above.

## 3. OWNER GATE A - push + verify + Vercel

    cd C:\dev\preston-os
    git log --oneline origin/master..master
    git push origin master
    git rev-parse master
    git ls-remote origin master

PASS: the listed chain matches section 2 exactly; ls-remote shows the
new tip. Vercel auto-deploys; the agent verifies deployment sha/status/
alias dpl anonymously (GitHub deployments API + Link-header capture)
and the owner glances chips false/false/observe_only after login.
Docs-only + test-only + UI commits are in this chain; run Gate B before
any further orchestrator run only because evidence discipline pins host
== origin at activation.

## 4. OWNER GATE B - host pin at the final tip

    TIP=<final tip full hash>   PREV=e922db06661d5b56e6c6bd1e03aea567635257be
    cd /srv/preston-os && sudo git fetch origin && sudo git checkout --detach $TIP
    git rev-parse HEAD
    cd apps/dashboard
    sudo npm ci --dry-run ; echo DRYRUN=$?
    sudo npm ci ; echo CI=$?
    sudo npm run build:os-runtime ; echo BUILD=$?
    sudo node dist/os-runtime/bin.js health ; echo HEALTH=$?   # expect 78
    sudo sed -i "s/^ORCH_BASE_COMMIT=.*/ORCH_BASE_COMMIT=$TIP/" /etc/preston/worker.env
    sudo grep -c "ORCH_BASE_COMMIT=$TIP" /etc/preston/worker.env   # expect 1
    diff /srv/preston-os/deploy/systemd/preston-orchestrator.service /etc/systemd/system/preston-orchestrator.service && echo U1_OK
    diff /srv/preston-os/deploy/systemd/preston-worker.service /etc/systemd/system/preston-worker.service && echo U2_OK
    diff /srv/preston-os/deploy/systemd/preston-hermes-observe.service /etc/systemd/system/preston-hermes-observe.service && echo U3_OK
    sudo bash /srv/preston-os/deploy/preflight-health.sh ; echo PREFLIGHT=$?

Environment verification is presence-only (grep -c on names; values
never echoed). Rollback: checkout $PREV + rebuild + restore
ORCH_BASE_COMMIT; unit backup /root/preston-unit-backup-15085cf.

## 5. OWNER GATE C - bounded staging activation (simulation-only path)

Activation target: ORCHESTRATOR TIMER ONLY, simulation mode, execution
disabled. Worker + Hermes timers stay disabled in this gate (the
orchestrator oneshot performs the goal-driving drills; worker/hermes
loops add nothing to the bounded target and each is its own later gate).

    sudo systemctl enable --now preston-orchestrator.timer
    systemctl list-timers preston-orchestrator.timer
    systemctl is-enabled preston-orchestrator.timer   # enabled
    systemctl is-enabled preston-worker.timer preston-hermes-observe.timer  # both disabled

Order: Gate A -> Gate B -> Gate C. Nothing else starts. The service
stays Type=oneshot flock-guarded, TimeoutStartSec=120, staging-gated,
simulation-pinned; execution_enabled=false refuses unsafe posture runs.

## 6. Live verification (agent + owner, after Gate C)

1. Timer fires: agent ssh-verifies a new disp-* line per interval with
   the all-parked skip (inert residue) and NO progression.
2. Remote request: owner submits a composer request FROM PHONE.
   Deterministic goal appears; gated job parks awaiting approval.
3. Owner approves FROM PHONE. Next timer tick drives the goal to
   completed, executed=false, evidence_refs written (laptop closed -
   this is the laptop-off independence proof).
4. Reject/expiry spot-check: rejected + expired residue rows remain
   refused (already live-proven; re-verified passively in the logs).
5. owner_stop: owner sets owner_stop=true from phone-accessible SQL or
   the /os control action; next tick exits 75 with no goal read; clear
   restores; unit reset-failed.
6. Rollback proof: sudo systemctl disable --now preston-orchestrator.timer
   returns the estate to the pre-activation posture (verified inactive/
   disabled; dashboard unchanged).

## 7. Stop conditions (any -> disable the timer, then diagnose)

Any executed=true row; any unlockRefusals-free unlock of a non-approved
record; any goal driven while owner_stop=true; any external write; any
production URL touched; unit failures beyond the documented exit-75
cosmetic; posture chips deviating from false/false/observe_only.

## 8. Emergency stop (global kill)

    update system_controls set owner_stop = true, updated_at = now();
    sudo systemctl disable --now preston-orchestrator.timer

(Env flags are NOT read by the deployed runtime - the DB row and the
timer are the real controls; both proven in CL-3d.)

## 9. Go / No-Go criteria

GO when: Gates A-C PASS; verification 6.1-6.6 all observed; posture
false/false/observe_only/false/false throughout; executed_true_rows=0.
NO-GO on any stop condition or any unexplained log line.

## 10. Explicitly NOT activated / NOT authorized by this packet

Real Claude/Codex adapters (G-D3 branch phase7/gd3-adapter-port,
unmerged - separate proof + owner gate); worker + hermes timers;
execution_enabled=true; remote_runner_enabled=true; Telegram/ChatGPT
bridges (telegram durable dedup remains an activation blocker);
production anything; credential changes; allowed-path expansion; RLS
changes. Known inert residue and the dist.untrusted quarantine
(one-line owner rm AFTER this closeout: sudo rm -rf
/srv/preston-os/apps/dashboard/dist.untrusted.20260803T033009Z).

## 11. Residual risks

- Single-identity worker/hermes env (least-privilege 0007 deferred,
  acceptable while both timers stay disabled).
- Timer-driven operation is new surface: bounded by oneshot flock +
  TimeoutStartSec + staging gate + simulation pins; stop = one command.
- Env-class test fail on Windows dev machine (compensated; not a
  runtime risk).
- Supabase paused-project preservation (LA-10/J) remains OVERDUE -
  independent of this activation but time-sensitive.
