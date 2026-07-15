# Preston AI OS - Live Schema Alignment v1

Purpose: map every Supabase runtime table to its TypeScript contract + adapter,
and give owner-run SQL to confirm the live staging schema matches. Staging only;
no SQL is executed by the AI. Legacy public.command_packets is distinct from the
Phase 3 runtime_command_packets and is never written by any runtime adapter.

## 1. Contract map (table -> purpose / TS type / adapter / RLS)

| Table | Migration | Purpose | TS contract | Adapter (store.ts) | Append-only | RLS |
|-------|-----------|---------|-------------|--------------------|-------------|-----|
| agents | 0003 | AI registry | AgentRecord (types) | (read) | no | owner-all |
| agent_memory | 0003 | shared memory | MemoryEntry (types/memory) | - | yes | owner ins+sel |
| locks | 0003 | distributed locks | LockRecord (types/locks) | - | no | owner-all |
| execution_queue | 0003 | pipeline record | ExecutionRecord (types/pipeline) | - | no | owner-all |
| os_events | 0003 | event log | EventEnvelope (transport) | insertEvent | yes | owner ins+sel |
| runtime_command_packets | 0004 | command intake | CommandPacket (commands) | insertCommandPacket / listCommandPackets | no | owner-all |
| os_jobs | 0004 | job queue | Job (queue) | (planned) | no | owner-all |
| worker_leases | 0004 | lease ownership | LeaseState (leases) | (planned) | no | owner-all |
| job_attempts | 0004 | attempt log | - | (planned) | yes | owner ins+sel |
| job_checkpoints | 0004 | checkpoints | Checkpoint (checkpoint) | insertCheckpoint | yes | owner ins+sel |
| dead_letters | 0004 | terminal failures | - | (planned) | yes | owner ins+sel |
| repository_worktrees | 0004 | worktree coord | Worktree (worktree) | (planned) | no | owner-all |
| orchestration_decisions | 0004 | Hermes log | HermesResult (hermes) | (planned) | yes | owner ins+sel |
| system_controls | 0004 | global gate | SystemControls (controls) | readSystemControls | no (single row) | owner-all |
| approvals | 0001 | approval rows | ApprovalRow (approvals-store) | listApprovalRows/decideApprovalRow | no | owner-all (0002) |
| audit_log | 0001 | audit | - | (approvals-store audit insert) | yes | owner ins+sel (0002) |
| command_packets (LEGACY) | 0001 | legacy gateway | (legacy only) | NONE - never written by runtime | no | owner-all (0002) |

Adapters are server-side, RLS-bound (owner session), inject the client for
tests, use no service-role key, validate before writing, are idempotent on
unique keys, and fail closed on error. readSystemControls returns the fully-
stopped DEFAULT_CONTROLS on any missing row / RLS error.

## 2. Static guarantees (enforced by tests)

Proven by test/store.test.ts + test/migration-0004.test.ts + module tests:
- runtime_command_packets is distinct from legacy command_packets; no runtime
  adapter targets the legacy table (RUNTIME_TABLES.commandPackets assertion).
- execution_eligible is forced false on every command write (default-deny).
- system_controls reads fail closed to DEFAULT_CONTROLS (execution disabled,
  hermes disabled, runner disabled) on missing row / RLS error; unknown
  hermes_mode coerces to 'disabled'.
- events carrying unredacted secrets are rejected before any write.
- migration 0004 never creates/indexes/references the legacy table and is
  additive (no destructive SQL, no anon grant).
- append-only tables (agent_memory, os_events, job_attempts, job_checkpoints,
  dead_letters, orchestration_decisions, audit_log) revoke update/delete from
  authenticated (migration policies + grants).

## 3. Owner-run live verification SQL (STAGING, read-only)

Confirm the live schema matches after applying 0003 + 0004.

Runtime tables present with RLS on:

    select relname, relrowsecurity from pg_class
    where relname in ('agents','agent_memory','locks','execution_queue','os_events',
      'runtime_command_packets','os_jobs','worker_leases','job_attempts',
      'job_checkpoints','dead_letters','repository_worktrees',
      'orchestration_decisions','system_controls')
    order by relname;

Expect: 14 rows, relrowsecurity = true for all.

Legacy table intact and distinct (has no expires_at; runtime table has it):

    select 'legacy' as which, count(*) filter (where column_name='expires_at') as has_expires
    from information_schema.columns
    where table_schema='public' and table_name='command_packets'
    union all
    select 'runtime', count(*) filter (where column_name='expires_at')
    from information_schema.columns
    where table_schema='public' and table_name='runtime_command_packets';

Expect: legacy has_expires = 0; runtime has_expires = 1.

No anon grants on any runtime table:

    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema='public' and grantee='anon'
      and table_name in ('runtime_command_packets','os_jobs','worker_leases',
        'job_attempts','job_checkpoints','dead_letters','repository_worktrees',
        'orchestration_decisions','system_controls');

Expect: zero rows.

Append-only enforced (no update/delete for authenticated):

    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema='public' and grantee='authenticated'
      and table_name in ('job_attempts','job_checkpoints','dead_letters','orchestration_decisions')
      and privilege_type in ('UPDATE','DELETE')
    order by table_name;

Expect: zero rows.

Controls fail-closed defaults:

    select execution_enabled, owner_stop, paused, hermes_mode, remote_runner_enabled
    from system_controls where id='global';

Expect: execution_enabled false, hermes_mode 'disabled', remote_runner_enabled
false (owner_stop false, paused false unless the owner stopped the runtime).

## 4. Result

Code contracts align with migrations 0003 + 0004. Runtime adapters implemented
for command packets, events, checkpoints, and system-controls reads (fail-
closed); remaining tables have contracts + schema and are marked (planned) for
adapter methods in the next build increment. No adapter can touch the legacy
table. Live confirmation is the owner-run SQL above; the AI ran no SQL.
