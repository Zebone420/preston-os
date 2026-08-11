# ============================================================
# P0-0/P0-2/P0-3 DB driver (OWNER-RUN, interactive passwords only)
#
# Does, in one terminal session (two password prompts):
#   STAGE 1  staging parity capture (P0-0)  -> reports/p0_evidence/
#   STAGE 2  prod migration chain apply (P0-2) + verification block (P0-3)
#            -> reports/p0_evidence/
#
# Chain: 0001..0006, [0008 auto-decided from staging], 0009..0015.
# 0007 is deferred by design and never applied.
#
# Safety:
#   - refuses to target the staging project ref as "prod"
#   - refuses to apply 0001 onto a non-empty public schema
#   - ON_ERROR_STOP: first failed migration aborts the run
#   - passwords are typed interactively at psql's own prompt; never
#     passed as arguments, never stored, never logged
#
# Usage (own PowerShell window, from C:\dev\preston-os):
#   .\scripts\p0\p0_db_apply.ps1 -ProdHost <prod-session-pooler-host> `
#       -ProdUser postgres.<prod-project-ref>
#   (hosts/users come from each project's Connect page, SESSION pooler,
#    port 5432 - never the transaction pooler 6543)
#
# Resume after a mid-chain failure:  add -StartAt 00NN -SkipStagingCapture
# ============================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProdHost,
  [Parameter(Mandatory=$true)][string]$ProdUser,
  [string]$StagingHost = 'aws-0-us-east-1.pooler.supabase.com',
  [string]$StagingUser = 'postgres.vcqtlmlaxxankxyezlul',
  [int]$Port = 5432,
  [string]$StartAt = '0001',
  [switch]$SkipStagingCapture
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$migDir = Join-Path $repo 'supabase\migrations'
$evDir = Join-Path $repo 'reports\p0_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

if ($ProdUser -eq $StagingUser) { throw 'ProdUser equals StagingUser - refusing (staging protection).' }
if ($ProdUser -match 'vcqtlmlaxxankxyezlul') { throw 'ProdUser targets the STAGING project - refusing.' }
if ($ProdHost -eq $StagingHost -and $ProdUser -eq $StagingUser) { throw 'Prod target equals staging - refusing.' }

$psql = (Get-Command psql).Source
Write-Host "psql: $psql"

$stagingListing = Join-Path $evDir 'staging_listing.txt'
$stagingMeta = Join-Path $evDir 'staging_parity_meta.txt'

function ToPsqlPath([string]$p) { return ($p -replace '\\', '/') }

# ---------- STAGE 1: staging parity capture (P0-0) ----------
if (-not $SkipStagingCapture) {
  Write-Host ''
  Write-Host '=== STAGE 1: STAGING parity capture ===' -ForegroundColor Cyan
  Write-Host "Target: $StagingUser @ $StagingHost : $Port"
  Write-Host 'The password prompt below wants the STAGING db password.' -ForegroundColor Yellow

  $capSql = Join-Path $evDir '_staging_capture.gen.sql'
  $cap = @()
  $cap += '\pset format unaligned'
  $cap += '\pset tuples_only on'
  $cap += ('\o ' + (ToPsqlPath $stagingListing))
  $cap += "select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public';"
  $cap += ('\o ' + (ToPsqlPath $stagingMeta))
  $cap += "select 'all_objects='||count(*) from information_schema.tables where table_schema='public';"
  $cap += "select 'base_tables='||count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"
  $cap += "select 'm0007_runtime_roles='||coalesce(to_regclass('public.runtime_roles')::text,'ABSENT');"
  $cap += "select 'm0008_os_jobs_approval_state_cols='||count(*) from information_schema.columns where table_schema='public' and table_name='os_jobs' and column_name='approval_state';"
  $cap += '\o'
  $cap -join "`r`n" | Out-File -Encoding ascii $capSql

  & $psql -h $StagingHost -p $Port -U $StagingUser -d postgres -v ON_ERROR_STOP=1 -f $capSql
  if ($LASTEXITCODE -ne 0) { throw "Staging capture failed (psql exit $LASTEXITCODE)." }
  Write-Host 'Staging capture OK.' -ForegroundColor Green
}

if (-not (Test-Path $stagingListing)) { throw "Missing $stagingListing - run without -SkipStagingCapture first." }
$meta = Get-Content $stagingMeta
Write-Host ''
Write-Host 'Staging parity meta:'
$meta | ForEach-Object { Write-Host "  $_" }
$include0008 = [bool]($meta | Where-Object { $_ -eq 'm0008_os_jobs_approval_state_cols=1' })
if ($include0008) { Write-Host '0008 decision: INCLUDE (staging carries the envelope columns)' }
else { Write-Host '0008 decision: SKIP (staging does not carry the envelope columns)' }

# ---------- STAGE 2: prod apply + verify (P0-2 / P0-3) ----------
$migFiles = Get-ChildItem $migDir -Filter '*.sql' | Sort-Object Name | Where-Object {
  $_.Name -notmatch '^0007' -and ($include0008 -or ($_.Name -notmatch '^0008'))
} | Where-Object { $_.Name.Substring(0, 4) -ge $StartAt }
if (-not $migFiles) { throw "No migration files selected (StartAt=$StartAt)." }

$prodListing = Join-Path $evDir 'prod_listing.txt'
$applyLog = Join-Path $evDir ("prod_apply_$stamp.log")
$driver = Join-Path $evDir '_prod_driver.gen.sql'

$d = @()
$d += '\set ON_ERROR_STOP on'
if ($StartAt -eq '0001') {
  $d += "do `$`$ declare n int; begin select count(*) into n from information_schema.tables where table_schema='public'; if n > 0 then raise exception 'PROD public schema NOT EMPTY (% objects) - aborting', n; end if; end `$`$;"
}
foreach ($f in $migFiles) {
  $d += ('\echo === APPLY ' + $f.Name)
  $d += ('\i ' + (ToPsqlPath $f.FullName))
  $d += ('\echo === DONE ' + $f.Name)
}
$d += '\echo === VERIFY: parity listing'
$d += '\pset format unaligned'
$d += '\pset tuples_only on'
$d += ('\o ' + (ToPsqlPath $prodListing))
$d += "select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public';"
$d += '\o'
$d += '\pset tuples_only off'
$d += '\pset format aligned'
$d += '\echo === VERIFY: RLS coverage (expect 0 rows)'
$d += "select tablename from pg_tables where schemaname='public' and rowsecurity = false;"
$d += '\echo === VERIFY: anon table privileges (expect 0 rows)'
$d += "select distinct table_name from information_schema.table_privileges where table_schema='public' and grantee='anon';"
$d += '\echo === VERIFY: gateway probes (expect refused/rejected x2)'
$d += 'create temp table probe_results(name text, outcome text);'
$d += "do `$`$ declare r jsonb; begin r := public.read_ssot_status('probe-not-a-token'); insert into probe_results values('read_ssot_status', 'returned: '||coalesce(r::text,'null')); exception when others then insert into probe_results values('read_ssot_status', 'refused: '||sqlerrm); end `$`$;"
$d += "do `$`$ declare r jsonb; begin r := public.submit_remote_intake('probe-not-a-token','req-p0-verify','info@preston.nyc','verification probe','api'); insert into probe_results values('submit_remote_intake', 'returned: '||coalesce(r::text,'null')); exception when others then insert into probe_results values('submit_remote_intake', 'refused: '||sqlerrm); end `$`$;"
$d += 'select * from probe_results;'
$d += '\echo === VERIFY: simulation pins (expect rows)'
$d += "select conname from pg_constraint where conname like '%simulation%' limit 5;"
$d += '\echo === VERIFY: controls fail-closed (expect false/false/false or 0 rows)'
$d += 'select execution_enabled, remote_runner_enabled, owner_stop from system_controls;'
$d += '\echo === VERIFY: 0007 deferred (expect ABSENT)'
$d += "select coalesce(to_regclass('public.runtime_roles')::text,'ABSENT') as m0007;"
$d -join "`r`n" | Out-File -Encoding ascii $driver

Write-Host ''
Write-Host '=== STAGE 2: PROD apply + verify ===' -ForegroundColor Cyan
Write-Host "Target: $ProdUser @ $ProdHost : $Port"
Write-Host ("Files: " + (($migFiles | ForEach-Object { $_.Name.Substring(0, 4) }) -join ' '))
Write-Host 'The password prompt below wants the PROD db password.' -ForegroundColor Yellow

& $psql -h $ProdHost -p $Port -U $ProdUser -d postgres -L $applyLog -f $driver
if ($LASTEXITCODE -ne 0) { throw "PROD APPLY/VERIFY FAILED (psql exit $LASTEXITCODE) - see $applyLog. Fix, then resume with -StartAt 00NN -SkipStagingCapture." }

# ---------- parity compare ----------
$s = (Get-Content $stagingListing -Raw).Trim()
$p = (Get-Content $prodListing -Raw).Trim()
$verdict = Join-Path $evDir 'parity_verdict.txt'
if ($s -eq $p) {
  "PARITY MATCH ($stamp): prod public table listing identical to staging." | Out-File -Encoding ascii $verdict
  Write-Host 'PARITY: MATCH' -ForegroundColor Green
} else {
  $sSet = $s -split ','
  $pSet = $p -split ','
  $onlyS = $sSet | Where-Object { $pSet -notcontains $_ }
  $onlyP = $pSet | Where-Object { $sSet -notcontains $_ }
  @("PARITY MISMATCH ($stamp)", ("staging-only: " + ($onlyS -join ',')), ("prod-only: " + ($onlyP -join ','))) | Out-File -Encoding ascii $verdict
  Write-Host 'PARITY: MISMATCH - see reports/p0_evidence/parity_verdict.txt' -ForegroundColor Red
}
Write-Host ''
Write-Host "Evidence written under reports/p0_evidence/ (log: $(Split-Path -Leaf $applyLog))"
Write-Host 'DONE. Report the console verdicts back to the session.'
