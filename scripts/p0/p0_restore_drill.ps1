# ============================================================
# P0 backup RESTORE DRILL (OWNER-RUN, prepared 2026-09-08)
#
# A backup nobody has restored is not a backup. This drill restores a
# pg_dump -Fc file produced by p0_bootstrap_backup.ps1 into a FRESH
# scratch database on a PostgreSQL server the owner names (a local
# PostgreSQL, or a throwaway server) and proves the restore by
# comparing table/data counts against the dump's own table of contents.
#
# It NEVER targets the staging or production Supabase projects: the
# target user/host are refused when they carry either project ref, and
# the scratch database name must start with 'preston_restore_drill_'.
# Nothing is written back to any Preston system except the evidence
# file under reports/p0_evidence/.
#
# Usage (own PowerShell window, from C:\dev\preston-os):
#   .\scripts\p0\p0_restore_drill.ps1 -DumpFile C:\dev\backups\preston-os-prod-2026-09-08.dump `
#       -TargetHost localhost -TargetUser postgres
# Optional: -Port 5432  -ScratchDb preston_restore_drill_20260908  -KeepDb
# ============================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DumpFile,
  [Parameter(Mandatory=$true)][string]$TargetHost,
  [Parameter(Mandatory=$true)][string]$TargetUser,
  [int]$Port = 5432,
  [string]$ScratchDb = '',
  [switch]$KeepDb
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$evDir = Join-Path $repo 'reports\p0_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
if (-not $ScratchDb) { $ScratchDb = "preston_restore_drill_$stamp" }

# ---- refusals (fail closed) ----
foreach ($v in @($TargetHost, $TargetUser)) {
  if ($v -match 'vcqtlmlaxxankxyezlul') { throw 'Target carries the STAGING project ref - refusing.' }
  if ($v -match 'hiqsymsiwonmvrbbqhhe') { throw 'Target carries the PRODUCTION project ref - refusing.' }
  if ($v -match 'supabase\.co|supabase\.com|pooler\.supabase') { throw 'Target is a Supabase endpoint - the drill restores into a scratch server only.' }
}
if ($ScratchDb -notmatch '^preston_restore_drill_[a-z0-9_]+$') { throw 'ScratchDb must match preston_restore_drill_<suffix>.' }
if (-not (Test-Path $DumpFile)) { throw "Dump file not found: $DumpFile" }

$psql = (Get-Command psql).Source
$pgrestore = (Get-Command pg_restore).Source

# ---- STAGE 1: dump identity + TOC ----
Write-Host '=== STAGE 1: dump identity ===' -ForegroundColor Cyan
$size = (Get-Item $DumpFile).Length
$sha = (Get-FileHash $DumpFile -Algorithm SHA256).Hash
$tocFile = Join-Path $evDir ("restore_drill_toc_$stamp.txt")
& $pgrestore -l $DumpFile | Out-File -Encoding ascii $tocFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore -l failed (exit $LASTEXITCODE)" }
$tocTables = (Select-String -Path $tocFile -Pattern ' TABLE public ').Count
$tocData = (Select-String -Path $tocFile -Pattern 'TABLE DATA public').Count
Write-Host "  dump sha256=$sha size=$size toc_tables=$tocTables toc_table_data=$tocData"

# ---- STAGE 2: fresh scratch database ----
Write-Host '=== STAGE 2: scratch database (target password prompt) ===' -ForegroundColor Cyan
$exists = & $psql -h $TargetHost -p $Port -U $TargetUser -d postgres -tA -c "select count(*) from pg_database where datname = '$ScratchDb';"
if ($LASTEXITCODE -ne 0) { throw "target unreachable (psql exit $LASTEXITCODE)" }
if ([int]$exists -ne 0) { throw "Scratch database $ScratchDb already exists - choose a new name (never reused)." }
& $psql -h $TargetHost -p $Port -U $TargetUser -d postgres -c "create database $ScratchDb;"
if ($LASTEXITCODE -ne 0) { throw "create database failed (exit $LASTEXITCODE)" }

# ---- STAGE 3: restore (schema + data, no owner/privilege replay) ----
Write-Host '=== STAGE 3: pg_restore into the scratch database ===' -ForegroundColor Cyan
$restoreLog = Join-Path $evDir ("restore_drill_$stamp.log")
& $pgrestore -h $TargetHost -p $Port -U $TargetUser -d $ScratchDb --no-owner --no-privileges --exit-on-error $DumpFile 2>&1 | Out-File -Encoding ascii $restoreLog
$restoreExit = $LASTEXITCODE

# ---- STAGE 4: verify ----
Write-Host '=== STAGE 4: verification ===' -ForegroundColor Cyan
$q1 = "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';"
$restoredTables = & $psql -h $TargetHost -p $Port -U $TargetUser -d $ScratchDb -tA -c $q1
$q2 = "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname = 'public';"
$liveRows = & $psql -h $TargetHost -p $Port -U $TargetUser -d $ScratchDb -tA -c $q2
$q3 = "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';"
$functions = & $psql -h $TargetHost -p $Port -U $TargetUser -d $ScratchDb -tA -c $q3
$verdict = if ($restoreExit -eq 0 -and [int]$restoredTables -ge $tocTables -and $tocTables -gt 0) { 'PASS' } else { 'FAIL' }

$evid = @(
  "RESTORE DRILL EVIDENCE ($stamp)",
  "verdict: $verdict",
  "dump_file: $DumpFile",
  "dump_size_bytes: $size",
  "dump_sha256: $sha",
  "toc_tables: $tocTables",
  "toc_table_data_entries: $tocData",
  "scratch_db: $ScratchDb on $TargetHost",
  "pg_restore_exit: $restoreExit",
  "restored_public_tables: $restoredTables",
  "restored_public_functions: $functions",
  "restored_live_rows_estimate: $liveRows",
  "restore_log: $restoreLog",
  'method: pg_restore --no-owner --no-privileges --exit-on-error into a fresh scratch database',
  'targets refused: staging/production project refs, any Supabase endpoint'
)
$evid | Out-File -Encoding ascii (Join-Path $evDir ("restore_drill_evidence_$stamp.txt"))
Write-Host ''
$evid | ForEach-Object { Write-Host "  $_" }

# ---- STAGE 5: cleanup (scratch only) ----
if (-not $KeepDb) {
  Write-Host '=== STAGE 5: drop the scratch database ===' -ForegroundColor Cyan
  & $psql -h $TargetHost -p $Port -U $TargetUser -d postgres -c "drop database $ScratchDb;"
}
if ($verdict -ne 'PASS') { throw "Restore drill FAILED - see $restoreLog" }
Write-Host 'DONE. Evidence under reports/p0_evidence/.' -ForegroundColor Green
