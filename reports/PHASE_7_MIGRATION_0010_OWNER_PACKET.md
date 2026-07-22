# PHASE 7 - MIGRATION 0010 OWNER APPLICATION PACKET

Date: 2026-07-22. Migration file:
supabase/migrations/0010_phase7_orchestration.sql
Applied by: OWNER ONLY, in the Supabase STAGING SQL editor.
Claude authored + statically tested it and has NOT applied it.
Never apply to production (none exists; environment is CHECK-
pinned to 'staging' regardless).

## 1. Purpose

Persist the Phase 7 orchestration model: master_goals, goal_jobs,
job_dependencies, agent_contracts, orchestration_approvals.
Enables the /os/orchestration surface to show real goal/job rows
and the (future, gated) intake bridge to store goals. Additive
only; changes no existing table.

## 2. Preconditions

- Migrations 0001, 0002 applied (approvals, is_owner). 0009
  applied (business foundation) - not required by 0010 but the
  goal_jobs.runtime_job_id FK references os_jobs (0004, applied).
- 0007/0008 NOT required.

## 3. Objects created (all owner-only RLS, anon revoked, no delete grant)

- master_goals - environment CHECK='staging', simulation_only
  CHECK=true.
- goal_jobs - executed CHECK=false; runtime_job_id FK to os_jobs;
  approval_id is a SOFT text ref to orchestration_approvals (Phase
  7 lifecycle), NOT the legacy 0001 approvals(uuid); a deferred FK
  goal_jobs_approval_fk is added at the end of the file. composite
  unique(id, goal_id) so dependencies can enforce same-goal.
- job_dependencies - append-only edges; unique(job,dep); self-dep
  CHECK forbidden; composite FKs (job_id,goal_id)+(depends_on_job_
  id,goal_id) -> goal_jobs(id,goal_id) so an edge can NEVER cross
  goals (audit finding 8).
- agent_contracts - can_approve CHECK=false, network_scope
  CHECK='none', environment_scope CHECK='staging'.
- orchestration_approvals - hash + expiry + unique NOT NULL nonce;
  environment CHECK='staging'; CHECK expires_at>created_at.
  IMMUTABILITY (audit finding 7): update is revoked and re-granted
  ONLY on (status, decided_at, nonce) - action/hash/owner/resource/
  created_at are privilege-immutable after insert.

## 4. Application steps

1. Open the Supabase STAGING SQL editor.
2. Paste the full 0010 file; run once (if-not-exists = re-run
   safe).
3. Run the verification SQL (section 5).

## 5. Verification SQL (read-only)

-- 5 new tables exist (expect 5):
select count(*) from information_schema.tables
 where table_schema='public' and table_name in
 ('master_goals','goal_jobs','job_dependencies','agent_contracts',
  'orchestration_approvals');

-- RLS on all 5 (expect 5):
select count(*) from pg_tables where schemaname='public'
 and rowsecurity and tablename in
 ('master_goals','goal_jobs','job_dependencies','agent_contracts',
  'orchestration_approvals');

-- anon holds nothing (expect 0):
select count(*) from information_schema.role_table_grants
 where grantee='anon' and table_name in
 ('master_goals','goal_jobs','job_dependencies','agent_contracts',
  'orchestration_approvals');

-- simulation/execution/approve pins present (expect >=4):
select count(*) from pg_constraint where
 (conrelid='master_goals'::regclass and pg_get_constraintdef(oid) like '%simulation_only = true%')
 or (conrelid='goal_jobs'::regclass and pg_get_constraintdef(oid) like '%executed = false%')
 or (conrelid='agent_contracts'::regclass and pg_get_constraintdef(oid) like '%can_approve = false%')
 or (conrelid='master_goals'::regclass and pg_get_constraintdef(oid) like '%environment = ''staging''%');

## 5b. Audit-reconciliation verification (added SQL)

-- goal_jobs.approval_id is text with a FK to orchestration_approvals:
select data_type from information_schema.columns
 where table_name='goal_jobs' and column_name='approval_id'; -- expect text
select 1 from pg_constraint where conname='goal_jobs_approval_fk'; -- expect 1

-- approval fields immutable (only decision cols updatable):
select column_name from information_schema.column_privileges
 where table_name='orchestration_approvals' and grantee='authenticated'
   and privilege_type='UPDATE'; -- expect exactly: status, decided_at, nonce

-- same-goal dependency FKs exist (expect 2 composite FKs on job_dependencies):
select count(*) from information_schema.table_constraints
 where table_name='job_dependencies' and constraint_type='FOREIGN KEY';

## 6. Rollback

Additive; the 5 tables are inert if unused. Removal is owner-
composed SQL (destructive statements are kept out of tracked
files). Reverting the app does not require dropping them.

## 7. Stop conditions

Any statement error, unexpected verification count, or regression
on /os or /business. Nothing in 0010 can enable execution,
sending, or production behavior; worst failure is missing tables,
which the /os/orchestration page tolerates (posture view only).
