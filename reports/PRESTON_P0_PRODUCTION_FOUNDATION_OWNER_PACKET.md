# P0 - PRODUCTION FOUNDATION OWNER PACKET (NON-ACTIVATING)

Every step is owner-run. At P0 exit, production EXISTS but does
NOTHING: all intake/SSOT/execution surfaces fail closed (503/absent),
no actors, no tokens, no timers, no host runtime. Baseline reference:
PRESTON_GOLDEN_STAGING_BASELINE.md (b4f1b71). Stop at any failed
verification and report output.

## P0-0 Parity target (staging, read-only, 2 minutes)

In the STAGING SQL editor run and SAVE the output (the parity target):

   select table_name from information_schema.tables
    where table_schema='public' order by 1;

Also confirm the deferred set stays deferred (expect NULL / absent):

   select to_regclass('public.runtime_roles') as m0007_absent;

Known-applied staging chain: 0001,0002,0003,0004,0005,0006,0008(*),
0009,0010,0011,0012,0013,0014. 0007 deferred by design.
(*) If the parity listing shows no 0008 tables, skip 0008 in prod too
- mirror STAGING EXACTLY, not the file directory.

## P0-1 Create the production Supabase project

- Same org (or a new org if you want billing isolation; note the
  Free-plan backup limits from the LA-10 work - Pro recommended for
  prod). Name: preston-os-prod. Strong DB password -> 1Password.
- Record project ref + URLs in 1Password (never in repo/chat).
- Enable MFA on the Supabase account if still off (LA-11).

## P0-2 Apply the migration chain (SQL editor, IN ORDER, one per run)

Apply from repo tip (b4f1b71 or later), each file fully, in order:

   0001 -> 0002 -> 0003 -> 0004 -> 0005 -> 0006 -> [0008 per P0-0]
   -> 0009 -> 0010 -> 0011 -> 0012 -> 0013 -> 0014

After EACH file: it must end "Success". After ALL files, run the
parity check: the same information_schema listing as P0-0 must match
the staging target exactly (plus/minus nothing).

## P0-3 Owner identity + core verification

1. Auth: create the owner user (info@preston.nyc) via Supabase Auth;
   run the owners-bootstrap block from 0002's packet (owners row).
2. Verification block (expect noted results):

   -- RLS coverage: expect 0 rows (every public table has RLS)
   select tablename from pg_tables where schemaname='public'
     and rowsecurity = false;
   -- anon privileges: expect 0 rows
   select distinct table_name from information_schema.table_privileges
     where table_schema='public' and grantee='anon';
   -- fail-closed gateways: expect forbidden x2
   select public.read_ssot_status('probe-not-a-token');
   select public.submit_remote_intake('probe-not-a-token',
     'req-p0-verify','info@preston.nyc','verification probe','api');
   -- simulation pins intact (0009/0010): spot-check one CHECK
   select conname from pg_constraint
     where conname like '%simulation%' limit 5;
   -- controls row fail-closed default
   select execution_enabled, remote_runner_enabled, owner_stop
     from system_controls;
   -- expect false/false/false (or empty -> runtime defaults closed)

## P0-4 First backup (day-one discipline, LA-10 lesson)

pg_dump -Fc via the SESSION POOLER host port 5432 (direct db host is
IPv6-only; ZPC26 has no global IPv6), interactive Password: prompt
(no PGPASSWORD env), verify toc via pg_restore -l, record SHA256,
store off-host copy. Same procedure as the staging backup packet.

## P0-5 Production web tier (fail-closed deploy)

Recommended: NEW Vercel project preston-os-prod from the same repo
(Root Directory apps/dashboard, include-files-outside-root ON,
Turbopack build), so staging and prod never share env.
Env vars (Production scope; names only here, values from P0-1):
   NEXT_PUBLIC_SUPABASE_URL   (BARE project URL - never /rest/v1/)
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   OWNER_EMAIL_ALLOWLIST = info@preston.nyc
   SUPABASE_RUNTIME_ENV = production
DO NOT SET (their absence IS the off switch):
   REMOTE_INTAKE_ENABLED, REMOTE_INTAKE_TOKEN, SSOT_STATUS_ENABLED,
   TELEGRAM_*, GOOGLE_*, AIRTABLE_* (add per later gates)
Enable Vercel Deployment Protection. After deploy verify:
   - logged-out -> /login redirect on all owner surfaces
   - owner login works; / and /os render against empty prod data
   - POST /api/os/remote/goal -> 503 disabled
   - GET /api/os/ssot/status -> 503 disabled
   - NOTE: intake/ssot routes are staging-gated in code
     (SUPABASE_RUNTIME_ENV must be 'staging') - with 'production'
     they stay 503 even if flags are later set. Lifting that gate for
     prod is a CODE change belonging to P1, reviewed then.

## P0-6 Gate report (close P0 with)

- Parity listing match: PASS/FAIL
- Verification block results (paste)
- Backup: file name + size + SHA256 prefix + off-host location
- Deploy URL + protection state + probe results
- Production touched: TRUE (new infra, fail-closed)
- Secrets exposed: false. Live messages/emails: false.
- Next gate: P1 (intake + approvals, execution disabled) - includes
  the reviewed code change lifting the staging-only env gate for the
  two remote routes under an explicit environment allowlist.

## Rollback

Pause or delete the prod Supabase project; delete the Vercel project.
Nothing else references them at P0. Staging is untouched throughout.
