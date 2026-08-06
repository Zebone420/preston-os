# CL-3d OWNER_STOP KILL SWITCH (STAGE 5) - CLOSE EVIDENCE (PASS)

Closed: 2026-08-06 (UTC). Deployed line e922db0 (Vercel dpl_Cc4iUQvC...,
host /srv/preston-os). All mutations owner-run; all log/host claims
independently agent-verified by read-only ssh.

## Evidence chain

1. PRE-STATE (owner SQL): system_controls single row captured;
   owner_stop=false, paused=false, execution_enabled=false,
   remote_runner_enabled=false, hermes_mode=observe_only.
2. ENGAGE (owner SQL): owner_stop=true guarded update - exactly 1 row.
3. HALT ONESHOT disp-103073 (agent-verified log line 53):
   {"event":"orchestrate_once","stoppedReason":"halted"} - NO goal id,
   NO cycles, no selection, no unlock attempt: the halt fires BEFORE
   any goal read. Owner-observed ExecMainStatus=75 at run time (the
   unit displays failed cosmetically - known recorded decision; cleared
   with reset-failed). No job progressed, no lease, no execution.
4. RESTORE (owner SQL): owner_stop=false guarded update - exactly 1 row.
5. RESTORATION ONESHOT disp-103110 (agent-verified): normal bounded
   behavior resumed EXACTLY - all-parked skip of the four inert goals,
   the Stage 4 hash-refusal re-observed (action_hash_mismatch), exit 0,
   nothing new enabled, no execution.
6. POST-STATE (owner SQL): owner_stop=false,
   updated_at=2026-08-06 04:10:27.877365+00; row matches pre-state
   except updated_at. executed_true_rows=0; running_jobs=0.
7. Posture (agent ssh): service inactive, ExecMainStatus=0 after
   restoration, NRestarts=0, timers disabled x3.

## Ruling

PASS. owner_stop is engaged and cleared only through owner-controlled
action; it halts the runtime before any goal processing with an
intentional exit (75); no progression, leases, or execution occur while
stopped; completed evidence remains intact; clearing restores exactly
the prior simulation posture; Hermes stays observe_only; executed count
stays 0. The DB row + timer disablement are confirmed as the real
emergency controls.
