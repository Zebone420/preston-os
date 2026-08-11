-- 0015_anon_table_revoke_sweep.sql
-- Final pre-production audit hardening (2026-08-11): Supabase default
-- privileges historically granted anon broad DML on tables created by
-- early migrations (0001-0006, 0010, 0011 era); only later migrations
-- (0009, 0012+) revoked explicitly. RLS is enabled on EVERY public
-- table with owner-only policies, so anon has zero ROW access today -
-- this sweep closes the defense-in-depth gap so table privileges match
-- the policy posture, and makes the anon-zero verification hold on any
-- database built from this chain (P0-3 expectation).
--
-- SCOPE: TABLE and SEQUENCE privileges for role anon only.
-- DELIBERATELY UNTOUCHED:
--   - function EXECUTE grants (the 0011/0013 SECURITY DEFINER gateways
--     REQUIRE anon EXECUTE - that is the remote auth path by design)
--   - the authenticated role (owner-identity runtime path needs its
--     grants)
-- Idempotent; safe to re-run.

do $$
declare r record;
begin
  for r in
    select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on table %I.%I from anon',
      r.schemaname, r.tablename);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;

-- Future-proof: new tables/sequences in public start with no anon
-- privileges (function default grants intentionally left as-is).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Verification (expect 0 rows):
--   select distinct table_name from information_schema.table_privileges
--    where table_schema='public' and grantee='anon';
-- Gateway sanity after apply (expect forbidden, NOT permission errors):
--   select public.read_ssot_status('probe-not-a-token');
