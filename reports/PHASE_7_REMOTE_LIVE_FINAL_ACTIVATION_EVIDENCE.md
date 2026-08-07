# PHASE 7 REMOTE-LIVE STAGING - FINAL ACTIVATION EVIDENCE

Date: 2026-08-07 (UTC). Scope: BOUNDED REMOTE-LIVE STAGING per
reports/PHASE_7_REMOTE_LIVE_ACTIVATION_PACKET.md (Stage 8).
Verdict: GO (bounded remote-live staging). NOT production-live.

Canonical line: origin/master == host /srv/preston-os ==
d13c215c8e4cb3402cbeaa7fadb1cced8c21f687 (contains a14d6db, e8f48d0).
Vercel: Production deployment of exactly d13c215, state success at
2026-08-07T01:33:34Z (GitHub deployments API, anonymous); alias served
dpl_FyJbyt3ksZnRPmv7cAEMEAoCnxrH (Link-header capture).

## 1. Gate results

- Gate A (push + Vercel): PASS. ls-remote tip d13c215 full hash; deploy
  chain verified anonymously; owner dashboard consistent.
- Gate B (host re-pin): PASS (owner E-block + independent read-only ssh
  re-verification). HEAD d13c215, npm ci dry-run 0 / ci 0 / os-runtime
  build 0 / health 78, ORCH_BASE_COMMIT=d13c215 count 1 (owner-run,
  file 600 root), unit parity U1/U2/U3 OK, preflight PASS db-health
  ok true, bin.js rebuilt 2026-08-07 01:41.
- Gate C (activation): PASS. ONLY preston-orchestrator.timer enabled;
  worker and hermes-observe timers stayed disabled throughout.

## 2. Live verification ledger (packet section 6)

 1. Phone Composer intake persisted: goal 447a870c-938c-42b2-9218-
    5cc01b03fbf2 "Phase 7 Remote-Live final verification drill,
    staging simulation only", decomposed, sim true (GOALS 11).
 2. Timer ticks clean on d13c215: first tick disp-117322, unit exit 0,
    all-parked scan, dead-lettered goal cef03ae2 absent from scan.
 3. Park proof: tick disp-117640 drove the goal (cycles 1); the
    documentation task completed in simulation; the migration job
    87e18801-5ea0-4ecd-937e-e047c2402dff parked awaiting approval with
    the fail-closed refusal not_approved surfaced (approval undecided).
 4. Exactly one fresh pending approval bound to the migration task:
    apr-1241bb01ef3c2782c23930e3 | goal 447a870c | job 87e18801.
    The three expired residue approvals stayed refused.
 5. Owner approval authoritatively recorded (open approvals 4 to 3;
    row controls withdrawn; decision one-time, nonce-bound).
 6. Resume proof: tick disp-117899 - cycles 1, reason completed, no
    refusals, no deadline. Goal row completed on the dashboard.
    RUNNING 0, FAILED 0, DEAD-LETTER 0.
 7. executed=false everywhere: migration 0010 CHECK pin (executed can
    never be true), global simulation-pin probe passed on every tick,
    execution_enabled false, simulation_safe true. Owner SQL count of
    executed=true rows earlier the same day: 0. No path since raises it.
 8. Residue integrity every tick: 4 parked goals stayed parked;
    5c9ca82e refused action_hash_mismatch (unverifiable approval
    94dd8bcc never unlocked); cef03ae2 stayed dead_lettered, unscanned.
 9. owner_stop drill: owner SQL true at 02:22:46Z (status surface read
    owner_stop true, status halted). Tick disp-119034 = SINGLE log
    line, stoppedReason halted, NO goal id, no goal read, no
    progression; unit ExecMainStatus=75 (SuccessExitStatus honored).
10. Restore: owner SQL false at 02:28:56Z. Tick disp-119253 resumed the
    normal all-parked scan, unit exit 0, no unintended progression.
11. Rollback: owner disabled preston-orchestrator.timer. Independent
    read-only verification: timers disabled x3, services inactive x3 -
    exact pre-activation posture restored.

Note on the first drill attempt this night: an initial approval claim
for the prior goal cef03ae2 was NOT found in the database (row stayed
pending; tick disp-116097 still refused not_approved). Verification
halted until the owner re-decided for real. The refusal chain worked
exactly as designed; the claim-vs-database discrepancy was surfaced,
not acted on.

## 3. Defects found and fixed during the bridge (all live-proven)

- A7 scheduler starvation + verification surfacing (prior session,
  ba54ccc / 39d2f17 / 0ecee8b / a14d6db line): live-proven again this
  session (parked residue never starved the fresh goal; refusals
  surfaced in every tick line).
- Wall-deadline / terminal-loop defect (THIS session, commit d13c215):
  goal cef03ae2 resumed after an owner approval decided hours after
  goal creation; the engine wall deadline (measured from goal
  creation) fired before scheduling, the ready job was never selected
  (attempts 0), the goal dead-lettered, and the drive loop re-stepped
  the terminal verdict to its cycle bound (cycles 11, iteration 11).
  FIX: the deadline now measures from the latest authoritatively
  VERIFIED approval decision (durable decided_at anchor; unverifiable
  records never anchor), and driveGoal exits on the terminal engine
  verdict after the legacy all-terminal/blocked checks. Regression
  file test/orchestration-approval-resume.test.ts (3 tests, proven
  failing pre-fix). Live-proven at disp-117899 (cycles 1, completed).

## 4. Final posture (independently verified read-only at close)

- preston-orchestrator.timer disabled; worker + hermes timers disabled;
  all three services inactive. Host HEAD d13c215 full hash. Last tick
  disp-119253 (nothing fired after rollback).
- Controls: execution_enabled false, remote_runner false, hermes
  observe_only, owner_stop false, paused false. Status simulation_ready.
- Open approvals 3 (expired residue only, decisions refused). Failed 0,
  dead-lettered jobs 0, running 0. executed_true_rows 0.
- No external writes at any point: simulation adapters only, no
  worker/hermes processes, oneshot exits 0/75 only, posture chips
  false/false/observe_only throughout.

## 5. Ruling

GO for BOUNDED REMOTE-LIVE STAGING: the owner can, from a phone with
the laptop closed, compose a goal, watch it decompose and park on a
gated task, approve or reject the exact bound action, watch the timer
drive it to simulated completion, halt everything with owner_stop, and
restore. Re-activation is one owner command
(enable preston-orchestrator.timer); the estate currently rests in the
rolled-back posture by owner choice.

This is NOT production-live and NOT real execution. Still gated
(each its own owner gate): worker timer, hermes timer,
execution_enabled true, remote runner, real Claude/Codex adapters
(G-D3 branch unmerged), Telegram/ChatGPT bridges (telegram durable
dedup = activation blocker), least-privilege runtime identities
(migration 0007), production Supabase/data, LA-10 off-host backup
copy, paused-project preservation (OVERDUE).

Readiness: bounded remote-live staging target 100 percent (verified,
this document). Toward controlled production pilot / real external
execution: approximately 55 percent (blockers P1-P22 in
reports/PHASE_7_PRODUCTION_READINESS_PACKET.md et al.).
