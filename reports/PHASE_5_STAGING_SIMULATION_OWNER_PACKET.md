# Phase 5 - Staging Simulation Owner Packet (migration 0006 + first evidence run)

OWNER-RUN. The AI applied no migration, ran no SQL, touched no server, and
activated nothing. Everything below is owner-run against STAGING only.
Execution, Remote Runner, and Telegram sends stay disabled throughout.

Preconditions: the Phase 4B.1 staging deployment is live per
reports/PHASE_4B1_STAGING_DEPLOYMENT_OWNER_PACKET.md (worker + Hermes timers
enabled, /os visible); MIGRATION 0005 (id alignment) IS APPLIED - without it
every attempt/decision/event insert fails silently and the evidence chain
stays empty; and the repo on the host is at the Phase 5 commit.

## 1. Apply migration 0006 (telegram replay dedup - safe to apply now)

Supabase SQL editor, STAGING project: paste
supabase/migrations/0006_phase5g_telegram_updates.sql. Additive only (one new
owner-scoped append-only table). Verify:

    select count(*) from telegram_updates;              -- 0
    select relrowsecurity from pg_class where relname = 'telegram_updates';  -- t

Migration 0007 (least-privilege identities) is NOT applied in this packet -
see reports/PHASE_5_LEAST_PRIVILEGE_IDENTITY_PACKET.md (separate gate).

## 2. Update the staging host to the Phase 5 commit

    ssh preston-agent-staging
    cd /srv/preston-os && git fetch origin && git pull --ff-only && git log -1 --oneline
    cd apps/dashboard && npm ci --ignore-scripts && npm run build:os-runtime
    sudo bash /srv/preston-os/deploy/preflight-health.sh    # expect PASS

BEHAVIOR CHANGE ON THIS DEPLOY (understand before pulling): until now the
timer-fired loops were pure no-ops. From this commit on, each worker firing
actively touches the STAGING control-plane DB: it sweeps expired-lease jobs
back to queued, writes an `agents` heartbeat row, and processes any queued
drill jobs; each Hermes firing records observe decisions/events for queued or
checkpointed jobs. All writes are control-plane evidence only - nothing
executes, sends, or touches business data. With an empty queue the worker
still logs `iterations=0 stoppedReason=completed` (plus `recovered=0`) - the
only standing write is the agent heartbeat. Nothing new starts, and no service
is restarted by this deploy; the running timers simply pick up the new bin.js
at their next firing.

## 3. Submit ONE synthetic staging command (owner session, dashboard host)

From a logged-in owner session, POST /api/os/command:

    { "source": "owner_cli",
      "requested_action": "staging simulation drill: read repository status",
      "target_project": "preston-os", "target_repository": "preston-os",
      "correlation_id": "drill5e-001", "idempotency_key": "drill5e-001-cmd" }

Save the returned command id. Verify (SQL): one runtime_command_packets row,
action_class GREEN, execution_eligible=false.

## 4. Enqueue ONE staging job for it (queue-only)

POST /api/os/enqueue:

    { "command_id": "<id from step 3>",
      "approval_id": "<a fresh uuid - your explicit approval marker for this drill>",
      "correlation_id": "drill5e-001", "idempotency_key": "drill5e-001-job" }

Expect: { ok: true, code: "queued" }. Replaying the same body returns
code "duplicate" and creates NOTHING (verify: still exactly one os_jobs row).
Verify the queued row:

    select id, status, risk_class, execution_enabled, attempts
      from os_jobs where correlation_id = 'drill5e-001';
    -- status=queued, risk_class=GREEN, execution_enabled=false, attempts=0

## 5. Let both timers fire and verify the evidence chain

Allow one worker cadence (<=5 min) AND one Hermes cadence (<=6 min) after it -
the decision/event rows are written by Hermes, which also observes
checkpointed jobs, so worker-first timing cannot lose them.

    select status, attempts, lease_owner from os_jobs  where correlation_id = 'drill5e-001';
    -- status=checkpointed, attempts=1, lease_owner=preston-worker
    select id, outcome, worker from job_attempts       where correlation_id = 'drill5e-001';
    -- one row, id like 'att::<job>::1::<token>', outcome=completed
    select status, agent_id from job_checkpoints       where correlation_id = 'drill5e-001';
    -- one row, status=complete
    select owner, token from worker_leases             where job_id = (select id from os_jobs where correlation_id='drill5e-001');
    -- one row, expired (expires_at <= now())
    select decision from orchestration_decisions       where correlation_id = 'drill5e-001';
    -- one row, decision=observe   (Hermes observe-only timer)
    select type from os_events                         where correlation_id = 'drill5e-001';
    -- HermesObserved
    select execution_enabled, remote_runner_enabled from system_controls where id='global';
    -- both false, unchanged (nothing executed; nothing may have flipped them)

Also: `sudo tail -5 /var/log/preston/worker.log` shows the firing with
outcomes:['simulated'] and executed=false.

One correlation id now links command -> job -> lease -> attempt -> checkpoint
-> decision -> event. That is the Phase 5E evidence chain.

## 6. Idempotency after the fact

The job is 'checkpointed' (terminal for the drill): later firings must log
iterations=0 and write nothing new for it. Verify job_attempts count for the
correlation id stays 1 across two further firings.

## 7. Rollback of this drill

    -- evidence rows are append-only audit history; to retire the drill job:
    update os_jobs set status='cancelled', updated_at=now()
      where correlation_id='drill5e-001' and status not in ('completed','cancelled');
No uninstall needed; nothing was activated. Global kill remains available
(PHASE_4B1 packet section 16.4).
