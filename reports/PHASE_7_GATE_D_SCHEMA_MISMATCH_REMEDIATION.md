# GATE D HARD STOP - SCHEMA/CODE MISMATCH - DIAGNOSIS + REMEDIATION

Date: 2026-08-04. Status: ROOT CAUSE PROVEN, CODE FIXED LOCALLY
(541b578), DEPLOYMENT REQUIRED before Gate D can rerun. The staging
schema is CORRECT and unchanged - the defect was code-side.

## Observed (owner, deployed build c24a7e5, first gated confirm)

"Rejected - nothing was created." with:
- "Migration 0010 is not applied - nothing can be persisted yet."
- approval_create_failed: orchestration_approvals insert failed:
  column orchestration_approvals.id does not exist
- compensating cancellation applied to goal
  6fd46b2b-6c3f-4840-82e5-b10204f48d8d and jobs
  247a9beb-3f32-47e2-aa73-aa79e917723c /
  647642bb-2342-49ec-84e7-fbf147ee3f8e

## Root cause (single, code-side)

store.ts insertRow() unconditionally chained .select('id') after
every insert. Three 0010 tables key on `id` (master_goals uuid PK,
goal_jobs uuid PK, job_dependencies uuid PK) - but
orchestration_approvals keys on `approval_id` (migration 0010 line
161) and HAS NO id COLUMN. PostgREST validates the requested
representation columns, so the WHOLE INSERT was rejected. Answer to
the canonical-PK question: the table's canonical key IS approval_id;
the code was wrong, the migration is right, the migration was FULLY
applied (proven again by the drill itself - the RPC graph commit and
the FK-referencing error message both require the 0010 tables).

Why it never failed before: (a) CL-3.2's graph had zero approvals,
so this code path first ran live during Gate D; (b) the 0010 gate B2
drill inserted approvals via SQL/RPC, not through this adapter;
(c) the test fake did not emulate PostgREST representation-column
validation, so suites stayed green (test gap, now closed).

Secondary defect (diagnostics): isMigrationAbsentError matched a
bare /does not exist/, so the missing-COLUMN error was relabeled
"Migration 0010 is not applied" - false and misleading. Tightened to
table-level absence only.

Compensation behaved CORRECTLY (atomicity held): goal + jobs were
cancelled, no approval row existed to leak. Residue check below.

## Fix (commit 541b578 on phase7/offhost-0802; +2 earlier commits
06ce6a4 wording / 733f90f+fdc9ff9 evidence are unrelated but ride
the same branch)

- store.ts: insertRow(client, table, row, keyColumn='id');
  insertApproval + insertJobApproval pass 'approval_id'. Duplicate
  and success paths return row[keyColumn]. decideApproval already
  selected 'approval_id' (unaffected); casStatus only touches
  id-keyed tables (verified).
- read-model.ts: isMigrationAbsentError now matches ONLY
  relation-absent / schema-cache / 42P01 shapes; a missing column
  surfaces as a real error.
- composer-fake-db.ts: insert().select(cols) and update().select(
  cols) now REJECT representation columns absent from the row -
  faithful PostgREST emulation; the pre-fix code now fails the
  existing gated test with the exact staging error message.
- New pins: composer-persist.test.ts "approval insert selects
  approval_id, never a phantom id column" (records the selected
  column; asserts ok + id echo); orchestration-read-model.test.ts
  isMigrationAbsentError column-vs-table matrix.

Validation: composer+orchestration suites 151/151; tsc 0; eslint 0;
os-runtime build 0; scanners 0/0. Approval ENFORCEMENT logic
untouched - no policy weakened; the fix is purely which PK column
the insert returns.

## Owner verification SQL (read-only) - schema truth + residue state

```sql
-- 1. Actual approvals-table shape (expect approval_id text PRIMARY
--    KEY present; NO row named 'id')
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orchestration_approvals'
order by ordinal_position;

-- 2. Compensation residue: expect goal + both jobs status='cancelled'
select id, status, updated_at from master_goals
where id = '6fd46b2b-6c3f-4840-82e5-b10204f48d8d';
select id, status, executed, approval_id from goal_jobs
where goal_id = '6fd46b2b-6c3f-4840-82e5-b10204f48d8d';

-- 3. No orphan approvals / no runnable residue anywhere (expect 0 /
--    0 rows / prior values only)
select count(*) from orchestration_approvals
where goal_id = '6fd46b2b-6c3f-4840-82e5-b10204f48d8d';
select count(*) from goal_jobs
where status in ('pending','ready','running')
  and goal_id = '6fd46b2b-6c3f-4840-82e5-b10204f48d8d';

-- 4. Prior evidence intact (expect completed / 0)
select status from master_goals
where id = '106adcdf-7cd8-4929-a567-0de7f5f81036';
select count(*) from goal_jobs where executed = true;
```

Dependency-edge note: job_dependencies rows for the cancelled goal
may remain (append-only design); they are inert - the driver never
drives a cancelled goal. Do not delete them.

## Rerun path (owner gates, in order - Gate D CANNOT rerun at c24a7e5)

The deployed build cannot create ANY gated goal until the fix ships.
1. Owner runs the verification SQL above (read-only close of this
   diagnosis).
2. Owner reviews + pushes phase7/offhost-0802, ff-merges to master
   (new $TIP), Vercel auto-deploys -> quick Block-V-style check at
   the new tip.
3. Host re-pin via the CL-2/2 packet shape with the new $TIP (also
   clears the RuntimeMaxSec warning; ORCH_BASE_COMMIT -> new tip).
4. Rerun Gate D from A1 with FRESH interprets (new goals; the
   cancelled 6fd46b2b goal stays as audit residue).

## Gate D rerun PASS / STOP criteria (unchanged from the issued gate,
plus)

- PASS additionally requires: the A2 success card lists exactly one
  apr- id; the A3 row exists with status pending; NO
  "migration_0010_not_applied" or column-does-not-exist error
  appears anywhere in the drill.
- STOP: any repeat of a column error (would mean the deployed tip
  does not contain 541b578); any approval row count != 1 per gated
  goal; the pre-existing STOPs (gated job runs undecided, replay
  accepted, executed=true).
