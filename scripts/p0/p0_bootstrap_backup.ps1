# ============================================================
# P0-3 owner bootstrap + P0-4 day-one backup (OWNER-RUN)
#
# Prerequisite: the prod owner auth user (info@preston.nyc) exists
# (Supabase dashboard -> Authentication -> Add user) and the P0 migration
# chain is applied (p0_db_apply.ps1 PASS).
#
# Does, in one terminal session (two password prompts, both PROD):
#   STAGE 1  owners bootstrap insert (0002 packet block) + verification
#   STAGE 2  pg_dump -Fc day-one backup + pg_restore toc check + SHA256
#
# Usage (own PowerShell window, from C:\dev\preston-os):
#   .\scripts\p0\p0_bootstrap_backup.ps1 -ProdHost <prod-session-pooler-host> `
#       -ProdUser postgres.<prod-project-ref>
# ============================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProdHost,
  [Parameter(Mandatory=$true)][string]$ProdUser,
  [int]$Port = 5432,
  [string]$BackupDir = 'C:\dev\backups',
  [switch]$SkipBootstrap
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$evDir = Join-Path $repo 'reports\p0_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

if ($ProdUser -match 'vcqtlmlaxxankxyezlul') { throw 'ProdUser targets the STAGING project - refusing.' }

$psql = (Get-Command psql).Source
$pgdump = (Get-Command pg_dump).Source
$pgrestore = (Get-Command pg_restore).Source

# ---------- STAGE 1: owners bootstrap ----------
if (-not $SkipBootstrap) {
  Write-Host ''
  Write-Host '=== STAGE 1: owners bootstrap (PROD password prompt) ===' -ForegroundColor Cyan
  $bootSql = Join-Path $evDir '_bootstrap.gen.sql'
  $b = @()
  $b += '\set ON_ERROR_STOP on'
  $b += "select 'auth_user_present='||count(*) as check1 from auth.users where email = 'info@preston.nyc';"
  $b += "do `$`$ declare n int; begin select count(*) into n from auth.users where email='info@preston.nyc'; if n = 0 then raise exception 'Owner auth user missing - create it in the dashboard first (Authentication -> Add user)'; end if; end `$`$;"
  $b += "insert into owners (user_id, note) select id, 'primary owner' from auth.users where email = 'info@preston.nyc' on conflict (user_id) do nothing;"
  $b += "select 'owners_rows='||count(*) as check2 from owners;"
  $b -join "`r`n" | Out-File -Encoding ascii $bootSql

  $bootLog = Join-Path $evDir ("prod_bootstrap_$stamp.log")
  & $psql -h $ProdHost -p $Port -U $ProdUser -d postgres -L $bootLog -f $bootSql
  if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed (psql exit $LASTEXITCODE) - see $bootLog" }
  Write-Host 'Bootstrap OK.' -ForegroundColor Green
}

# ---------- STAGE 2: day-one backup ----------
Write-Host ''
Write-Host '=== STAGE 2: pg_dump backup (PROD password prompt) ===' -ForegroundColor Cyan
$date = Get-Date -Format 'yyyy-MM-dd'
$dumpFile = Join-Path $BackupDir ("preston-os-prod-$date.dump")
& $pgdump -Fc -h $ProdHost -p $Port -U $ProdUser -d postgres -f $dumpFile
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }

$size = (Get-Item $dumpFile).Length
if ($size -lt 10000) { throw "Backup suspiciously small ($size bytes) - check pooler host/creds." }

$tocFile = Join-Path $evDir 'prod_backup_toc.txt'
& $pgrestore -l $dumpFile | Out-File -Encoding ascii $tocFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore -l failed (exit $LASTEXITCODE)" }
$tableData = (Select-String -Path $tocFile -Pattern 'TABLE DATA').Count
$sha = (Get-FileHash $dumpFile -Algorithm SHA256).Hash

$evid = @(
  "PROD DAY-ONE BACKUP EVIDENCE ($stamp)",
  "file: $dumpFile",
  "size_bytes: $size",
  "sha256: $sha",
  "pg_restore_table_data_entries: $tableData",
  'method: pg_dump -Fc via session pooler :5432, interactive password',
  'off-host copy: OWED (LA-10 discipline) - owner copies to second location'
)
$evid | Out-File -Encoding ascii (Join-Path $evDir 'prod_backup_evidence.txt')
Write-Host ''
$evid | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'DONE. Evidence under reports/p0_evidence/.'
