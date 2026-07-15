# Phase 3 Runtime - Owner-Run Packets

Status: OWNER-RUN packets. Documentation ONLY. The AI did NOT execute any SQL,
install any service, start any worker, activate Hermes/Runner, or send any
message. Every step is owner-run against STAGING. Applying these activates
nothing by itself - execution stays fail-closed until controls are flipped in
the final gate.

Golden rules: staging only; no production; grant to authenticated only (never
anon); no service-role key in the app; no secret pasted into chat; keep append-
only tables append-only; do not bypass safety guards.

## Packet 1 - Apply runtime migration 0004

Prereq: 0002 + 0003 applied (public.is_owner exists; Phase 2 tables present).

NAMING / COLLISION FIX: the first 0004 attempt named the Phase 3 intake table
'command_packets', which already exists as a LEGACY table (migration 0001, a
different schema with no expires_at). CREATE TABLE IF NOT EXISTS silently
matched the legacy table and the expires_at index failed (ERROR 42703). The
Phase 3 table is now runtime_command_packets. The legacy command_packets is
NOT dropped, renamed, or altered.

Preflight A (read-only) - the nine NEW Phase 3 tables should be ABSENT:

    select proname from pg_proc where proname='is_owner';
    select table_name from information_schema.tables
    where table_schema='public' and table_name in
     ('runtime_command_packets','os_jobs','worker_leases','job_attempts',
      'job_checkpoints','dead_letters','repository_worktrees',
      'orchestration_decisions','system_controls')
    order by table_name;

Expect is_owner present and the nine tables ABSENT (the failed run rolled back;
confirm rather than assume).

Preflight B (read-only) - the LEGACY table must exist and be left intact:

    select column_name from information_schema.columns
    where table_schema='public' and table_name='command_packets'
    order by ordinal_position;

Expect the legacy columns (id, tenant_id, created_at, task_id, requested_by,
... status, result) and NO expires_at. This packet never modifies this table.

Apply: in the Supabase SQL editor (STAGING), paste and run the full contents of
supabase/migrations/0004_phase3_runtime.sql once.

Seed the single controls row (fail-closed defaults):

    insert into system_controls (id) values ('global')
    on conflict (id) do nothing;
    select execution_enabled, owner_stop, paused, hermes_mode, remote_runner_enabled
    from system_controls where id='global';

Expect: execution_enabled false, owner_stop false, paused false,
hermes_mode 'disabled', remote_runner_enabled false.

Verify: RLS on for all nine; owner-only policies; append-only tables
(job_attempts/job_checkpoints/dead_letters/orchestration_decisions) show only
SELECT+INSERT for authenticated.

Expected result: runtime schema present, everything disabled. Nothing runs.

Rollback (owner-run, STAGING; only the NEW additive tables are dropped - the
legacy command_packets is intentionally NOT listed and stays untouched):

    drop table if exists orchestration_decisions, repository_worktrees, dead_letters,
      job_checkpoints, job_attempts, worker_leases, os_jobs, runtime_command_packets,
      system_controls cascade;

Verification after rollback: the nine NEW tables are absent; legacy
command_packets and all Phase 0-2 tables unaffected.

## Packet 2 - Remote staging server setup (owner-run, no activation)

Goal: prepare the host that will later run bounded workers - WITHOUT starting
anything. (SSH alias preston-agent-staging exists per project notes.)

Steps (owner, on the staging host):
1. Install runtime prerequisites (git, node LTS) via the host's package manager.
2. Clone the canonical repo to a dedicated path (read-only checkout for now).
3. Create per-agent working directories under a worktrees/ root; do NOT create
   git worktrees yet.
4. Provision a LEAST-PRIVILEGE service identity for later worker Supabase/Google
   access - NOT the owner's personal OAuth. Store any secret in the host secret
   store, never in the repo or chat.
5. Do NOT install a systemd/Docker service. Do NOT start a daemon.

Expected result: host ready; no worker, no daemon, no execution.
Rollback: remove the checkout + working dirs; revoke the service identity.
Verify: `git -C <path> status` clean; no preston worker process running.

## Packet 3 - Hermes observe-only activation (owner-run, later gate)

Prereq: Packet 1 applied; owner has reviewed the Hermes spec.

Step: set Hermes to observe-only (it will only READ + record decisions; it
cannot dispatch because execution stays disabled):

    update system_controls set hermes_mode='observe_only', updated_at=now()
    where id='global';

Expected: hermes.decide() returns 'observe'; no dispatch; orchestration_decisions
may record observations. execution_enabled stays false.
Rollback: `update system_controls set hermes_mode='disabled' where id='global';`
Verify: control center shows Hermes observe_only; no jobs enter 'running'.
STOP: do NOT set dispatch_eligible in this gate.

## Packet 4 - Remote Runner simulation drill (owner-run)

Goal: validate execution envelopes with NO process launch.
Step: using the dashboard/runner simulate() path (or a local script that only
calls simulate/validateEnvelope), submit sample envelopes and confirm:
- a safe `git status` envelope validates;
- non-allowlisted executables, shell metacharacters, path traversal,
  destructive args, network, cwd escape, and bad timeouts are rejected;
- simulate().wouldRun is always false.
Expected result: validation matrix passes; nothing executes.
Rollback: none (no state changed). Verify: no process was launched.

## Packet 5 - Bounded remote build activation (RED gate - owner only)

Do NOT perform in this session. Prerequisites before ANY bounded remote build:
- Packets 1-4 complete; least-privilege worker identity provisioned.
- Transport auth configured for the bridge(s) being used.
- A single, well-scoped GREEN job approved through the Approval Center.
Activation sequence (owner, staging):
1. `update system_controls set remote_runner_enabled=true where id='global';`
2. `update system_controls set execution_enabled=true where id='global';`
   (execution_enabled is the master switch; enable last, disable first.)
3. Optionally `hermes_mode='dispatch_eligible'` for one drill job.
4. Watch heartbeat + checkpoints + os_events; keep OWNER_STOP within reach.
Kill: `update system_controls set owner_stop=true, execution_enabled=false,
remote_runner_enabled=false, hermes_mode='disabled' where id='global';`
Rollback: the kill above halts everything immediately; revert any job via its
checkpoint rollback. Verify: no job in 'running'; runner disabled.
STOP CONDITIONS: any RED/BLACK job, any production target, any secret needed in
chat, any unapproved job - halt immediately.

## Packet 6 - Global stop / kill switch (always available)

    update system_controls set owner_stop=true, execution_enabled=false,
      remote_runner_enabled=false, hermes_mode='disabled', paused=true,
      updated_at=now() where id='global';

Effect: isHalted true everywhere; Hermes noop; runner not permitted; no
dispatch, no new leases honored for running. No deploy needed. Verify via the
control center reading system_controls.

## Non-execution statement

The AI wrote these files only. It did NOT run SQL, install software, start a
worker, activate Hermes or the Remote Runner, send a message, or touch
production. All activation is owner-run and gated; the runtime is fail-closed
until the owner explicitly flips system_controls in Packet 5.
