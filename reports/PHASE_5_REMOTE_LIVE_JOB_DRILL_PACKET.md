# Phase 5I - Final Remote-Live Laptop-Closed Job Drill (owner-run)

OWNER-RUN. The final Remote-Live proof: one authenticated synthetic command
flows end-to-end - queued, leased, simulated, checkpointed, observed - while
the laptop is closed, with remote visibility and remote kill. No business
action, no outbound send, no production contact. Do not claim Remote-Live
complete until every step below has evidence.

Preconditions: Phase 5 commit deployed to staging (5E packet section 2),
migration 0005 applied (0006 optional for this drill), timers enabled,
hermes_mode='observe_only', execution_enabled=false, remote_runner_enabled=false.

1. SUBMIT (laptop): POST /api/os/command (owner session) with
   correlation_id "drill5i-001" (5E packet step 3 shape). Record the id.
2. ENQUEUE (laptop): POST /api/os/enqueue with
   { "command_id": "<step-1 id>", "approval_id": "<a fresh uuid - your
   approval marker>", "correlation_id": "drill5i-001",
   "idempotency_key": "drill5i-001-job" }. Expect code "queued". Verify in
   SQL: status=queued, execution_enabled=false.
3. DISCONNECT: close the laptop / end all SSH sessions. Note the time.
   Stay disconnected >= 30 minutes.
4. LEASE + SIMULATE (nothing to do): within ~5 min the worker timer fires,
   leases the job, simulates, writes attempt + checkpoint, completes to
   'checkpointed'. Within ~6 min Hermes records an observe decision + event.
5. PHONE CHECK (during disconnection): open /os - confirm the job shows
   checkpointed/observed state and controls still show execution disabled.
6. PHONE CONTROL (during disconnection): from the Supabase dashboard app/
   browser on the phone, run PAUSE (D1 SQL). After >=6 min, confirm on /os
   that nothing new is processing. Then RESUME (D2 SQL).
7. RECONNECT (>=30 min): SSH back in. Collect:
       journalctl -u preston-worker.service --since "<disconnect time>" --no-pager
       journalctl -u preston-hermes-observe.service --since "<disconnect time>" --no-pager
       sudo tail -40 /var/log/preston/worker.log /var/log/preston/hermes.log
   Expect: bounded SUCCESS firings the whole window; one firing with
   outcomes:['simulated']; a 75-exit around the pause; recovery after resume.
8. EVIDENCE CHAIN (SQL): run the 5E packet step-5 query block for
   drill5i-001. Every table (command packet, job, lease, attempt, checkpoint,
   decision, event) must return its row, all linked by correlation_id
   drill5i-001; job_attempts count = 1 after two further firings (idempotent).
9. RESTART PROOF: `sudo systemctl restart preston-worker.timer`, wait one
   firing -> SUCCESS, attempts count unchanged.
10. NO-EFFECT PROOF: system_controls flags still false/observe_only; no
    Telegram message was sent (bot chat silent); no Gmail/Airtable/business
    row changed (spot-check approvals + audit_log for drill-window entries -
    only the expected control:pause/resume + job_enqueued audit rows).
11. PRODUCTION UNTOUCHED: no production URL appears anywhere in
    worker.log/hermes.log for the window (grep -i prod -> only the staging
    gate line if any); production Supabase/Airtable dashboards show no access.
12. EVIDENCE PACKET: save the journalctl/log excerpts, the SQL outputs, and
    two /os phone screenshots (during disconnection + after) into the owner
    evidence binder (docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md structure).

PASS = all 12 steps evidenced. Rollback: cancel the drill job (5E packet
section 7); controls back to the standing state. The GLOBAL KILL
(PHASE_4B1 16.4) remains available at every step.
