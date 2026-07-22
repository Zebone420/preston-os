# PHASE 7 - MIGRATION 0010 FINAL OWNER APPLICATION PACKET

Date: 2026-07-22. Supersedes reports/PHASE_7_MIGRATION_0010_OWNER_
PACKET.md. Migration file (FINAL, hardened):
supabase/migrations/0010_phase7_orchestration.sql
Applied by: OWNER ONLY, in the Supabase STAGING SQL editor.
Claude authored + statically tested it and has NOT applied it and
will NOT apply it. Never apply to production (none exists; the
environment is CHECK-pinned to 'staging' regardless).

## 0. Verified clean-slate starting state (owner-confirmed)

The owner ran the five-table existence query in Supabase STAGING
and got "Success. No rows returned." Therefore:
- none of the five Phase 7 tables exist,
- migration 0010 was never applied,
- there is NO partial schema, NO rollback, NO destructive cleanup.
This is a clean first-run.

## 1. Final hardening applied since the prior packet

- Approval FK corrected: goal_jobs.approval_id is text with a
  deferred FK to orchestration_approvals(approval_id) - the Phase
  7 lifecycle - NOT the legacy 0001 approvals(uuid).
- Same-goal dependency integrity: job_dependencies composite FKs
  into goal_jobs(id, goal_id) - an edge can never cross goals.
- Approval immutability: only (status, decided_at, nonce) are
  updatable; action/hash/owner/resource/created_at are privilege-
  immutable.
- DECISION-NONCE FIX (final): orchestration_approvals.nonce is
  NULLABLE with a PARTIAL unique index
  (uq_orchestration_approvals_nonce ... where nonce is not null).
  A pending approval legitimately has no decision nonce yet; a
  plain NOT NULL + unique(nonce) would have made it IMPOSSIBLE to
  insert any pending approval. Uniqueness is still enforced on
  every real decision nonce (one-time replay guard).
- expires_at > created_at CHECK on approvals; anon fully revoked;
  no delete grant on mutable tables; simulation/execution/approve
  DB CHECK pins intact.

## 2. Preconditions

- Migrations 0001 (approvals + is_owner base), 0002 (is_owner()),
  0004 (os_jobs - referenced by goal_jobs.runtime_job_id) applied.
  All three are long-applied on staging. 0007/0008 NOT required.
- Owner login (info@preston.nyc) works on staging.

## 3. Objects created (all owner-only RLS, anon revoked, no delete)

master_goals, goal_jobs, job_dependencies, agent_contracts,
orchestration_approvals - see the migration header for the full
column + CHECK detail. agent_contracts is intentionally NOT seeded
(the app reads the canonical contracts from code; the table is for
optional DB-side inspection, seeded later by the owner if wanted).

## 4. EXACT clean-first-run steps

Step 1. Open the Supabase STAGING project -> SQL Editor -> new
        query.
Step 2. Paste the ENTIRE contents of
        supabase/migrations/0010_phase7_orchestration.sql
        (all 177 lines, from the first comment through the final
        `end $$;`). Do not paste a partial selection.
Step 3. Run it ONCE. Expect: success, no errors. (Every statement
        is `create table if not exists` / `create index if not
        exists` / `drop policy if exists` / a guarded `do $$` FK
        block, so a re-run is safe, but a single clean run is
        expected here.)
Step 4. ONLY AFTER step 3 reports success, run the verification
        block in section 6 (a SEPARATE query).

### !!! EXPLICIT WARNING !!!

RUN THE FULL MIGRATION (steps 1-3) BEFORE THE VERIFICATION BLOCK.
The verification queries in section 6 assume all five tables,
their constraints, and the partial index already exist. If you
run the verification block first, it will report missing objects
and could mislead you into thinking the migration failed. Do not
interleave: full migration first, then verification.

Also: paste the migration as ONE script. The deferred FK at the
end (goal_jobs_approval_fk) depends on orchestration_approvals
existing, which the same script creates earlier - running the
file in fragments out of order will fail. One paste, one run.

## 5. Owner stop conditions

Stop and report if any statement errors (capture the exact SQL
state + message), or if verification returns an unexpected count.
Nothing in 0010 can enable execution, sending, or production
behavior; the worst failure mode is a missing object, which the
/os/orchestration page tolerates (it renders "migration 0010 not
applied" and disables goal submission).

## 6. Verification SQL (run ONLY after the full migration succeeds)

-- 6a. All five tables exist (expect 5):
select count(*) from information_schema.tables
 where table_schema='public' and table_name in
 ('master_goals','goal_jobs','job_dependencies','agent_contracts',
  'orchestration_approvals');

-- 6b. RLS enabled on all five (expect 5):
select count(*) from pg_tables where schemaname='public'
 and rowsecurity and tablename in
 ('master_goals','goal_jobs','job_dependencies','agent_contracts',
  'orchestration_approvals');

-- 6c. anon holds zero privileges on all five (expect 0):
select count(*) from information_schema.role_table_grants
 where grantee='anon' and table_name in
 ('master_goals','goal_jobs','job_dependencies','agent_contracts',
  'orchestration_approvals');

-- 6d. Simulation/execution/approve/env DB pins present (expect >=4):
select count(*) from pg_constraint where
 (conrelid='master_goals'::regclass and pg_get_constraintdef(oid) like '%simulation_only = true%')
 or (conrelid='goal_jobs'::regclass and pg_get_constraintdef(oid) like '%executed = false%')
 or (conrelid='agent_contracts'::regclass and pg_get_constraintdef(oid) like '%can_approve = false%')
 or (conrelid='master_goals'::regclass and pg_get_constraintdef(oid) like '%environment = ''staging''%');

-- 6e. Approval FK targets the Phase 7 lifecycle (expect 1):
select count(*) from pg_constraint where conname='goal_jobs_approval_fk';

-- 6f. Same-goal dependency composite FKs (expect 2):
select count(*) from information_schema.table_constraints
 where table_name='job_dependencies' and constraint_type='FOREIGN KEY';

-- 6g. Approval columns immutable except decision fields
--     (expect exactly: status, decided_at, nonce):
select column_name from information_schema.column_privileges
 where table_name='orchestration_approvals' and grantee='authenticated'
   and privilege_type='UPDATE';

-- 6h. Partial unique index on the decision nonce exists (expect 1):
select count(*) from pg_indexes
 where schemaname='public' and indexname='uq_orchestration_approvals_nonce';

Expected: 6a=5, 6b=5, 6c=0, 6d>=4, 6e=1, 6f=2, 6g={status,
decided_at, nonce}, 6h=1. Report these back; on all-pass, 0010 is
applied and the durable-worker gate (G-D2/G-D3) opens.

## 7. Rollback

Additive; the five tables are inert if unused. Removal is owner-
composed SQL (destructive statements are kept out of tracked
files). Reverting the app does not require dropping them.
