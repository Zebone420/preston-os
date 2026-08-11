\pset format unaligned
\pset tuples_only on
\o C:/dev/preston-os/reports/p0_evidence/staging_listing.txt
select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public';
\o C:/dev/preston-os/reports/p0_evidence/staging_parity_meta.txt
select 'all_objects='||count(*) from information_schema.tables where table_schema='public';
select 'base_tables='||count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';
select 'm0007_runtime_roles='||coalesce(to_regclass('public.runtime_roles')::text,'ABSENT');
select 'm0008_os_jobs_approval_state_cols='||count(*) from information_schema.columns where table_schema='public' and table_name='os_jobs' and column_name='approval_state';
\o
