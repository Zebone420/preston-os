# PHASE 6 - MIGRATION 0009 OWNER APPLICATION PACKET

Date: 2026-07-21
Migration file: supabase/migrations/0009_phase6b_business_foundation.sql
Applied by: OWNER ONLY, in the Supabase STAGING SQL editor.
Claude has authored and statically tested this migration and has
NOT applied it. Do not run against production (none exists).

## 1. Purpose

Creates the Business Command Center V1 foundation: 18 new tables
for clients, contacts, properties, leads, quotes, quote versions,
quote items, projects, milestones, vendor orders, installations,
payment schedules, payment events, communications, the append-only
business activity ledger, agent recommendations, quote-draft agent
runs, and approval links. Adds ONE privilege to an existing table:
grant insert on approvals to authenticated (owner-only RLS still
governs every row; folds the ad hoc Stage 5/8 grant history into a
tracked migration).

## 2. Preconditions

- Migrations 0001 and 0002 applied (approvals table, is_owner()).
- 0007 and 0008 are NOT required and remain unapplied.
- Owner login (info@preston.nyc) works on staging.

## 3. Affected objects

New tables (all with owner-only RLS via public.is_owner(), grants
to authenticated only, nothing for anon):

business_clients, business_contacts, business_properties,
sales_leads, quotes, quote_versions, quote_items, projects,
project_milestones, vendor_orders, installation_events,
payment_schedules, payment_events, communication_records,
business_activity_events, agent_recommendations, quote_draft_runs,
approval_links.

Append-only (insert+select only; update/delete revoked):
quote_items, payment_schedules, payment_events,
business_activity_events, quote_draft_runs, approval_links.

DB-level simulation pins (CHECK constraints):
- quote_versions.simulation_state = 'simulation'
- quote_draft_runs.simulation_only = true
- quote_draft_runs.execution_eligible = false
Lifting any of these requires a future owner-gated migration.

Existing tables: only `grant insert on approvals to authenticated`.
No policy, column, or constraint on any existing table changes.

## 4. Application steps (owner-run)

1. Open the Supabase STAGING project SQL editor.
2. Paste the full contents of
   supabase/migrations/0009_phase6b_business_foundation.sql.
3. Run once. Expect success with no errors ("if not exists"
   makes re-runs safe).
4. Run the verification SQL in section 5.
5. OPTIONAL: run supabase/fixtures/business_staging_fixtures.sql
   for labeled demo rows (see its header; separate decision).

## 5. Verification SQL (read-only)

-- 18 new tables exist:
select count(*) from information_schema.tables
 where table_schema = 'public' and table_name in
 ('business_clients','business_contacts','business_properties',
  'sales_leads','quotes','quote_versions','quote_items','projects',
  'project_milestones','vendor_orders','installation_events',
  'payment_schedules','payment_events','communication_records',
  'business_activity_events','agent_recommendations',
  'quote_draft_runs','approval_links');
-- Expect 18.

-- RLS enabled on all 18:
select count(*) from pg_tables
 where schemaname = 'public' and rowsecurity = true
   and tablename like 'business_%';
-- Expect 4 (business_ prefixed); repeat mentally for the rest or:
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename in
 ('quotes','quote_versions','quote_draft_runs','approval_links');
-- Expect rowsecurity = true on every row returned.

-- Simulation pins present:
select conname from pg_constraint
 where conrelid = 'quote_draft_runs'::regclass
   and pg_get_constraintdef(oid) like '%simulation_only = true%';
-- Expect 1 row.

-- Approvals gained insert privilege:
select privilege_type from information_schema.role_table_grants
 where table_name = 'approvals' and grantee = 'authenticated';
-- Expect SELECT, UPDATE, INSERT (order varies).

## 6. Rollback considerations

The migration is additive. Rollback = owner-run removal of the 18
new tables and the approvals insert grant. Removal SQL is
intentionally NOT included in the repo (destructive statements are
kept out of tracked files); if rollback is ever needed, the owner
composes the removal statements in the SQL editor table by table
(the new tables have no data the rest of the system depends on).
Revoking the approvals insert privilege restores the pre-0009
grant state without affecting Stage 5/8 behavior.

## 7. Stop conditions

Stop and report to the build session if:
- any statement errors (capture the exact message);
- verification returns unexpected counts;
- any existing dashboard page (/, /approvals, /os) regresses after
  application.
Nothing in this migration can enable execution, sending, or any
production behavior; the worst failure mode is missing tables,
which the UI reports as read errors.
