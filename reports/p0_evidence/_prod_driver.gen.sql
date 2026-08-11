\set ON_ERROR_STOP on
do $$ declare n int; begin select count(*) into n from information_schema.tables where table_schema='public'; if n > 0 then raise exception 'PROD public schema NOT EMPTY (% objects) - aborting', n; end if; end $$;
\echo === APPLY 0001_phase0a_core_schema.sql
\i C:/dev/preston-os/supabase/migrations/0001_phase0a_core_schema.sql
\echo === DONE 0001_phase0a_core_schema.sql
\echo === APPLY 0002_phase0b_owner_rls.sql
\i C:/dev/preston-os/supabase/migrations/0002_phase0b_owner_rls.sql
\echo === DONE 0002_phase0b_owner_rls.sql
\echo === APPLY 0003_phase2_ai_os_core.sql
\i C:/dev/preston-os/supabase/migrations/0003_phase2_ai_os_core.sql
\echo === DONE 0003_phase2_ai_os_core.sql
\echo === APPLY 0004_phase3_runtime.sql
\i C:/dev/preston-os/supabase/migrations/0004_phase3_runtime.sql
\echo === DONE 0004_phase3_runtime.sql
\echo === APPLY 0005_phase4b1_id_alignment.sql
\i C:/dev/preston-os/supabase/migrations/0005_phase4b1_id_alignment.sql
\echo === DONE 0005_phase4b1_id_alignment.sql
\echo === APPLY 0006_phase5g_telegram_updates.sql
\i C:/dev/preston-os/supabase/migrations/0006_phase5g_telegram_updates.sql
\echo === DONE 0006_phase5g_telegram_updates.sql
\echo === APPLY 0009_phase6b_business_foundation.sql
\i C:/dev/preston-os/supabase/migrations/0009_phase6b_business_foundation.sql
\echo === DONE 0009_phase6b_business_foundation.sql
\echo === APPLY 0010_phase7_orchestration.sql
\i C:/dev/preston-os/supabase/migrations/0010_phase7_orchestration.sql
\echo === DONE 0010_phase7_orchestration.sql
\echo === APPLY 0011_phase8_remote_intake.sql
\i C:/dev/preston-os/supabase/migrations/0011_phase8_remote_intake.sql
\echo === DONE 0011_phase8_remote_intake.sql
\echo === APPLY 0012_ssot_actor_registry.sql
\i C:/dev/preston-os/supabase/migrations/0012_ssot_actor_registry.sql
\echo === DONE 0012_ssot_actor_registry.sql
\echo === APPLY 0013_ssot_status_gateway.sql
\i C:/dev/preston-os/supabase/migrations/0013_ssot_status_gateway.sql
\echo === DONE 0013_ssot_status_gateway.sql
\echo === APPLY 0014_ssot_actor_stamping.sql
\i C:/dev/preston-os/supabase/migrations/0014_ssot_actor_stamping.sql
\echo === DONE 0014_ssot_actor_stamping.sql
\echo === APPLY 0015_anon_table_revoke_sweep.sql
\i C:/dev/preston-os/supabase/migrations/0015_anon_table_revoke_sweep.sql
\echo === DONE 0015_anon_table_revoke_sweep.sql
\echo === VERIFY: parity listing
\pset format unaligned
\pset tuples_only on
\o C:/dev/preston-os/reports/p0_evidence/prod_listing.txt
select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public';
\o
\pset tuples_only off
\pset format aligned
\echo === VERIFY: RLS coverage (expect 0 rows)
select tablename from pg_tables where schemaname='public' and rowsecurity = false;
\echo === VERIFY: anon table privileges (expect 0 rows)
select distinct table_name from information_schema.table_privileges where table_schema='public' and grantee='anon';
\echo === VERIFY: gateway probes (expect refused/rejected x2)
create temp table probe_results(name text, outcome text);
do $$ declare r jsonb; begin r := public.read_ssot_status('probe-not-a-token'); insert into probe_results values('read_ssot_status', 'returned: '||coalesce(r::text,'null')); exception when others then insert into probe_results values('read_ssot_status', 'refused: '||sqlerrm); end $$;
do $$ declare r jsonb; begin r := public.submit_remote_intake('probe-not-a-token','req-p0-verify','info@preston.nyc','verification probe','api'); insert into probe_results values('submit_remote_intake', 'returned: '||coalesce(r::text,'null')); exception when others then insert into probe_results values('submit_remote_intake', 'refused: '||sqlerrm); end $$;
select * from probe_results;
\echo === VERIFY: simulation pins (expect rows)
select conname from pg_constraint where conname like '%simulation%' limit 5;
\echo === VERIFY: controls fail-closed (expect false/false/false or 0 rows)
select execution_enabled, remote_runner_enabled, owner_stop from system_controls;
\echo === VERIFY: 0007 deferred (expect ABSENT)
select coalesce(to_regclass('public.runtime_roles')::text,'ABSENT') as m0007;
