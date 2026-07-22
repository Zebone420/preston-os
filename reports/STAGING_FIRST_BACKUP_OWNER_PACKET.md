# STAGING FIRST BACKUP - OWNER-RUN PACKET
# (preston-os-staging; one-time manual backup; LA-10 remediation
#  step 1 of the approved Option 4 hybrid)

Date: 2026-07-22. Owner-run only. Claude runs NO step in this
packet and never sees the connection string or password.
NOTE 2026-07-22: this packet is ALSO Gate 1 of the Supabase
paid-org transfer plan (reports/SUPABASE_PRE_TRANSFER_BACKUP_
AND_ROLLBACK_PLAN.md) - identical procedure; run once, counts
for both.
Scope: ONE full logical backup of the staging database, stored
outside the repository. NO restore into preston-os-staging ever
occurs under this packet. No Supabase setting, plan, or billing
changes. Estimated time: 15-25 minutes.

## 0. Path determination (evidence-based)

Repository evidence (Item 1, owner-verified 2026-07-21):
"Last Backup: No backups. Free Plan does not include scheduled
project backups." On the Free Plan an ACTIVE project has no
dashboard control that produces a full database export: the
Backups page is a paid-feature surface, and Table Editor CSV
export is per-table, partial, and excludes functions/policies/
grants - it is NOT a backup. Determination: PATH A is expected to
be UNAVAILABLE; PATH B (owner-run pg_dump) is the RECOMMENDED
path. Run the 1-minute Path A check first only to confirm.

## PATH A - dashboard export (use ONLY if genuinely offered)

A1. Dashboard -> project preston-os-staging -> Database ->
    Backups. Look for a "Download backup" / "Export" control
    that does NOT require a plan change.
A2. If (unexpectedly) present: it must state it produces a FULL
    database export (schema + data). If it only offers CSV,
    per-table, or "upgrade to enable" - STOP; use Path B.
A3. If a real export downloads: save it to
    C:\dev\legacy-audit\supabase\preston-os-staging-first-export\
    Contents to confirm from its description: all schemas or at
    least public; whether auth and storage schemas are included
    (note what the UI says). Storage OBJECTS (files in buckets)
    and Auth users may be excluded - note the UI's wording.
    Expected file type: .sql, .dump, or .tar/.gz archive.
A4. Verify: file size > 100 KB (the DB holds ~27.83 MB of data;
    a tiny file means schema-only or a failed export) and record
    Get-FileHash -Algorithm SHA256 <file>.
Stop conditions: any plan-upgrade prompt; any setting change;
any ambiguity about what the export contains -> use Path B.

## PATH B - owner-run pg_dump (RECOMMENDED)

### B0. Prerequisites (check only; install nothing this session)

1. PostgreSQL client tools on your machine: run
     pg_dump --version
   If not installed, installing the PostgreSQL client tools is an
   owner action outside this packet's session (any standard
   PostgreSQL install; only the client tools are needed).
2. VERSION COMPATIBILITY MATTERS: pg_dump's major version must be
   >= the server's major version. Find the server version:
   dashboard -> Project Settings -> Infrastructure (or Database)
   -> Postgres version (e.g. 15.x or 17.x). If your pg_dump major
   is older, stop and get a newer client first.
3. Connection info WITHOUT exposing it: dashboard -> Connect (top
   bar) or Project Settings -> Database. You need: host, port,
   user, database name, and the database password (from
   1Password). Use the DIRECT connection or SESSION-mode pooler
   (port 5432). Do NOT use the transaction pooler (port 6543) -
   it is not suitable for pg_dump.
   NEVER paste the connection string or password into chat, this
   repo, any report, or any file - it goes only into the
   interactive prompt below.
   STOP CONDITION: if the database password is not in 1Password
   and unknown, STOP - resetting it is a Supabase settings change
   and needs its own decision (it does not break the app, which
   uses the anon key, but it is out of this packet's scope).

### B1. Safe credential handling (no history, no files)

Open a fresh PowerShell window (not inside any IDE that logs):

  $sec = Read-Host -Prompt "staging db password" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $env:PGHOST = Read-Host -Prompt "db host"
  $env:PGUSER = Read-Host -Prompt "db user"

Read-Host prompts keep the values out of the command history and
off the screen (password) / out of any tracked file. The values
live only in this window's environment until step B6.

### B2. Create the output folder

  New-Item -ItemType Directory -Force -Path "C:\dev\legacy-audit\supabase\preston-os-staging-first-export"
  cd "C:\dev\legacy-audit\supabase\preston-os-staging-first-export"

### B3. Full logical dump (custom format)

  pg_dump -h $env:PGHOST -p 5432 -U $env:PGUSER -d postgres -Fc -v -f "preston-os-staging-2026-07-22.dump"

Notes: -Fc (custom format) supports selective restore and
pg_restore listing. Some Supabase-managed system schemas may emit
permission warnings during -v output - warnings on schemas you do
not own are EXPECTED and acceptable; errors that abort the dump
are not (stop condition). Expected duration: under a minute for
~28 MB.

### B4. Schema-only companion (human-readable verification)

  pg_dump -h $env:PGHOST -p 5432 -U $env:PGUSER -d postgres -s -f "preston-os-staging-2026-07-22-schema.sql"

### B5. Verify the dump

  pg_restore -l ".\preston-os-staging-2026-07-22.dump" > toc.txt
  (Get-Content .\toc.txt | Measure-Object -Line).Lines
  Select-String -Path .\toc.txt -Pattern "quotes|approvals|audit_log|system_controls|business_activity_events" | Select-Object -First 10
  Get-FileHash -Algorithm SHA256 ".\preston-os-staging-2026-07-22.dump"
  Get-Item ".\preston-os-staging-2026-07-22.dump" | Select-Object Length

Pass criteria: toc.txt lists the expected tables (spot-check
lines above show quotes/approvals/audit_log/system_controls/
business_activity_events); dump size is plausibly > 1 MB;
record the SHA256 and byte size in the backup register (those
two values are safe to share; the dump contents are NOT).

### B6. Cleanup (remove credential exposure)

  Remove-Item Env:PGPASSWORD
  Remove-Item Env:PGHOST
  Remove-Item Env:PGUSER
  $sec = $null
  exit   (close the PowerShell window)

The dump file itself contains your business data - treat the
folder as sensitive (it is outside the repo and the repo's
.gitignore additionally blocks *.dump). For the off-host copy
(Option 4 requirement), copy the .dump to your private archive
storage (e.g. an encrypted drive or 1Password-adjacent storage) -
owner's choice; record where in the backup register.

### Explicit non-action

NO restore is performed into preston-os-staging - not now, not
during the restore test. The restore test (within 2 weeks, per
the approved decision) targets a SCRATCH project only and gets
its own packet.

## What this first backup covers (and does not)

COVERED by the full pg_dump of database "postgres":
- all 42 public tables: 18 business tables (0009) + 24 platform
  tables (0001-0006), including approvals, audit_log, activity
  ledger, and the runtime/control tables (system_controls,
  os_jobs, runtime_command_packets, telegram_updates, ...);
- all functions (public.is_owner and helpers), triggers,
  RLS policies (CREATE POLICY statements), grants/revokes, and
  CREATE EXTENSION statements where representable (pgcrypto);
- migration history note: migrations were owner-applied via the
  SQL editor, so there is no populated supabase_migrations
  ledger to dump - the authoritative migration history is the
  repo's supabase/migrations/ files (already in git);
- auth schema: included IF the connection role can read it -
  verify in toc.txt (look for auth.users). If auth is absent or
  partial, that is ACCEPTABLE for this backup: the auth state is
  one owner user (info@preston.nyc) plus dormant runtime
  identities, all recreatable by the documented bootstrap steps;
  note the outcome in the register.

NOT covered:
- Storage OBJECTS (bucket files): pg_dump captures storage
  METADATA tables only, never file contents. Current expectation:
  the app uses no storage buckets - CONFIRM while in the
  dashboard (Storage page; expect zero buckets) and note it. If
  any bucket exists, its files need a separate download - note
  and stop for a scope addition;
- Supabase project settings (auth providers, URL config) - they
  are re-creatable from the repo's owner packets;
- anything in the paused projects (separate brief).

## Evidence to record (backup register row)

Date, file name, byte size, SHA256, toc line count, auth-schema
present yes/no, storage buckets zero yes/no, off-host copy
location. Paste those into the reply; never the dump itself.
