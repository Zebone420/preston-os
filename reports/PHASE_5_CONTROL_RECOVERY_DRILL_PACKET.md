# Phase 5F - Control and Recovery Drill Packet (owner-run, staging)

OWNER-RUN. Prove the operational controls under failure. Every drill lists:
initial state / owner action / expected system state / expected DB evidence /
expected logs / rollback / stop condition / prohibited actions.

Global prohibitions for EVERY drill: no production, no service-role key, no
Telegram sends, no business writes, execution_enabled and
remote_runner_enabled stay false. Global stop condition for EVERY drill: any
unexpected row in approvals/audit_log business tables, any outbound message,
or any log line with executed=true -> run the GLOBAL KILL
(PHASE_4B1 packet 16.4) and stop the phase.

Standing initial state unless a drill says otherwise: worker + Hermes timers
enabled; controls = {execution_enabled:false, remote_runner_enabled:false,
owner_stop:false, paused:false, hermes_mode:'observe_only'}; one drill job
from the 5E simulation packet available or completed.

All SQL runs in the Supabase STAGING SQL editor. All host commands run as the
owner on preston-agent-staging.

## D1 - Pause
- Action: `update system_controls set paused=true, updated_at=now() where id='global';`
- Expected state: next worker firing exits 75; hermes firing exits 75.
- DB evidence: no new job_attempts/orchestration_decisions rows after the flip.
- Logs: worker.log/hermes.log line with stoppedReason=halted.
- Rollback: D2. Stop: any new attempt row while paused.

## D2 - Resume (must NOT enable execution)
- Action: `update system_controls set paused=false, owner_stop=false, updated_at=now() where id='global';`
- Expected: next firings SUCCESS again.
- DB evidence: `select execution_enabled, remote_runner_enabled from system_controls` -> false,false
  (regression-pinned in code: resume never touches those columns).
- Rollback: D1. Stop: either flag reads true.

## D3 - Owner stop
- Action: `update system_controls set owner_stop=true, paused=true, updated_at=now() where id='global';`
- Expected: both services exit 75 at next firing; /os shows stopped.
- Rollback: D2. Stop: any evidence row written while stopped.

## D4 - Kill (controls + units)
- Action: GLOBAL KILL SQL (PHASE_4B1 16.4) + `sudo systemctl stop preston-worker.timer preston-hermes-observe.timer`.
- Expected: timers gone from `systemctl list-timers`; nothing fires.
- Rollback: restore controls (D2 + hermes_mode='observe_only'), re-enable timers.
- Stop: any preston process visible after the kill.

## D5 - Worker restart (manual oneshot)
- Initial: D4 rolled back; queue empty.
- Action: `sudo systemctl start preston-worker.service` twice, ~1 min apart.
- Expected: two SUCCESS oneshot runs; iterations=0 (empty queue is a clean no-op).
- DB evidence: no new rows. Stop: a second concurrent run (RuntimeMaxSec breach).

## D6 - Hermes restart
- Same as D5 with preston-hermes-observe.service; expect stoppedReason
  completed (observe_only) or disabled (if mode disabled), recorded>=0, exit 0.

## D7 - Lease expiry takeover (crashed-generation recovery, BEFORE completion)
- Initial: one FRESH queued drill job (5E packet steps 3-4, correlation id
  drill5f-007) that the worker has NOT yet processed. Immediately after
  enqueueing, plant a dead generation's expired lease (simulates a worker that
  crashed after leasing but before any checkpoint):
      insert into worker_leases (job_id, owner, token, acquired_at, expires_at)
      select id, 'preston-worker', 'stale-crashed-token', now() - interval '10 minutes',
             now() - interval '5 minutes'
      from os_jobs where correlation_id = 'drill5f-007';
  Wait for the next worker firing.
- Expected: the fresh insert path fails (lease row exists), the worker TAKES
  OVER via the expired-lease CAS, simulates, and completes; job -> checkpointed.
- DB evidence: worker_leases.token != 'stale-crashed-token' (takeover
  happened); exactly ONE job_attempts row, whose id embeds the NEW token -
  never the stale one; worker.log outcome 'simulated' with leaseVia takeover.
- Rollback: cancel the drill job. Stop: an attempt id containing
  'stale-crashed-token', or two attempt rows.

## D7b - Stranded-leased sweep (crash AFTER job marked leased)
- Initial: the D7 job now checkpointed; strand a synthetic state:
      update os_jobs set status='leased', lease_expires_at = now() - interval '5 minutes'
        where correlation_id='drill5f-007';
  Wait one firing.
- Expected: the cycle's recovery sweep requeues it (log line shows
  recovered=1), and - because its 'complete' checkpoint matches - the same
  firing (or the next) completes it idempotently: outcome skipped_completed.
- DB evidence: job back to checkpointed; job_attempts count UNCHANGED.
- Rollback: none. Stop: a new attempt row.

## D8 - Stale worker rejection (fencing)
- Verified by regression tests: completion/requeue CAS token fence
  (test/store-phase5.test.ts, 'job CAS transitions'), release owner+token
  fence (test/store.test.ts, 'releaseLease ... owner AND lease token'), and
  the takeover path (test/staging-sim.test.ts). Owner spot check after D7:
      select count(*) from job_attempts where job_id = (select id from os_jobs
        where correlation_id='drill5f-007');   -- one row per generation, no dupes
- Stop: any duplicate attempt id.

## D9 - Checkpoint recovery (idempotent completion)
- Initial: the D7 job is checkpointed with a 'complete' checkpoint.
- Action: force a rerun of a completed job's generation:
      update os_jobs set status='queued' where correlation_id='drill5f-007';
  Wait one firing.
- Expected: worker leases it, reads the matching COMPLETE checkpoint, and
  SKIPS rework: outcome skipped_completed; job returns to checkpointed.
- DB evidence: job_attempts count UNCHANGED; no new job_checkpoints row.
- Rollback: none needed. Stop: a new attempt row appears.

## D10 - Token rotation continuity
- Path note (defect #3 correction): the store path is whatever
  SUPABASE_RUNTIME_TOKEN_STORE resolves to in each identity's env file -
  NOT an assumed literal token.json. Resolve it first (prints a path only,
  never a secret):
      sudo grep -h '^SUPABASE_RUNTIME_TOKEN_STORE=' /etc/preston/worker.env
      sudo grep -h '^SUPABASE_RUNTIME_TOKEN_STORE=' /etc/preston/hermes.env
- Action: note `sudo stat -c %Y <resolved worker store path>` (mtime),
  wait two firings, stat again. Repeat for the Hermes store path.
- Expected: mtime advances (rotation persisted each authenticated run);
  firings keep succeeding (rotated token valid).
- Rollback: none. Stop: SUCCESS firings stop after a rotation (store corruption
  -> recovery = re-bootstrap per PHASE_4B_WORKER_IDENTITY_PACKET.md section 1).

## D11 - Timer restart
- Action: `sudo systemctl restart preston-worker.timer` then `systemctl list-timers 'preston-*'`.
- Expected: timer rescheduled (NEXT ~5 min); service untouched.
- Stop: service started by the timer restart itself.

## D12 - Host reboot recovery
- Action: `sudo reboot`. Reconnect after ~2 min.
- Expected: timers auto-resume (enabled units, OnBootSec 5-6 min); first
  post-boot firings SUCCESS; token stores intact (0600, service-owned);
  controls unchanged.
- DB evidence: none required beyond post-boot firing success.
- Rollback: none. Stop: a service ACTIVE at boot without its timer firing
  (would mean an enablement leak - investigate before continuing).

## D13 - Laptop-closed job simulation
- This is the Phase 5I drill: reports/PHASE_5_REMOTE_LIVE_JOB_DRILL_PACKET.md.
