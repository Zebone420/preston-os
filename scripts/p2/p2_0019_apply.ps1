# ============================================================
# Gate 2 driver: migration 0019 (ssot read audit) apply + verify
# OWNER-RUN, interactive passwords only. Staging FIRST, then prod.
#
# Does, in one terminal session (two password prompts):
#   STAGE 1  apply 0019 to STAGING + static verify capture
#   STAGE 2  apply 0019 to PROD    + static verify capture
#            -> reports/p2_evidence/m0019_apply_<stamp>_{staging,prod}.txt
#
# Static verify per DB (behavioral proof lands in Gate 3's read):
#   - read_ssot_status function body now contains the 'ssot-read'
#     access_events INSERT
#   - access_events row count captured (baseline for Gate 3 delta)
#   - grants unchanged: execute for anon/authenticated only
#
# Safety:
#   - ON_ERROR_STOP=1; first error aborts
#   - passwords typed at psql's own prompt; never args, never logged
#   - refuses to run staging stage against the prod ref and vice versa
#
# Usage (own PowerShell window, from C:\dev\preston-os):
#   .\scripts\p2\p2_0019_apply.ps1
# ============================================================
[CmdletBinding()]
param(
  [string]$PoolerHost = 'aws-0-us-east-1.pooler.supabase.com',
  [string]$StagingUser = 'postgres.vcqtlmlaxxankxyezlul',
  [string]$ProdUser = 'postgres.hiqsymsiwonmvrbbqhhe',
  [int]$Port = 5432,
  [switch]$SkipStaging
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$mig = Join-Path $repo 'supabase\migrations\0019_ssot_read_audit.sql'
if (-not (Test-Path $mig)) { throw "missing $mig" }
if ($StagingUser -eq $ProdUser) { throw 'staging user equals prod user - refusing.' }
if ($StagingUser -notmatch 'vcqtlmlaxxankxyezlul') { throw 'StagingUser does not target the staging ref - refusing.' }
if ($ProdUser -match 'vcqtlmlaxxankxyezlul') { throw 'ProdUser targets the STAGING ref - refusing.' }

$evDir = Join-Path $repo 'reports\p2_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$psql = (Get-Command psql).Source
function ToPsqlPath([string]$p) { return ($p -replace '\\', '/') }

function Invoke-Stage([string]$label, [string]$user) {
  $out = Join-Path $evDir ("m0019_apply_${stamp}_$label.txt")
  $gen = Join-Path $evDir "_m0019_$label.gen.sql"
  $lines = @()
  $lines += ('\o ' + (ToPsqlPath $out))
  $lines += "select 'env_check: '||current_database()||' as '||current_user;"
  $lines += "select 'before_access_events='||count(*) from access_events;"
  $lines += ('\i ' + (ToPsqlPath $mig))
  $lines += "select 'fn_has_audit_insert='||(position('ssot-read' in pg_get_functiondef('public.read_ssot_status(text)'::regprocedure)) > 0);"
  $lines += "select 'after_access_events='||count(*) from access_events;"
  $lines += "select 'grants='||string_agg(grantee||':'||privilege_type, ',' order by grantee) from information_schema.routine_privileges where routine_schema='public' and routine_name='read_ssot_status';"
  $lines += '\o'
  $lines -join "`r`n" | Out-File -Encoding ascii $gen

  Write-Host ""
  Write-Host "=== $label APPLY: 0019 -> $user @ $PoolerHost : $Port ===" -ForegroundColor Cyan
  Write-Host "The password prompt below wants the $label db password." -ForegroundColor Yellow
  & $psql -h $PoolerHost -p $Port -U $user -d postgres -v ON_ERROR_STOP=1 -f $gen
  if ($LASTEXITCODE -ne 0) { throw "$label apply failed (psql exit $LASTEXITCODE)." }
  Remove-Item $gen -Force
  Write-Host "$label apply OK. Evidence: $out" -ForegroundColor Green
  Get-Content $out
}

if (-not $SkipStaging) { Invoke-Stage 'staging' $StagingUser }
Invoke-Stage 'prod' $ProdUser

Write-Host ""
Write-Host 'DONE. Both evidence files are in reports\p2_evidence\. Reply "0019 applied" in the agent session.' -ForegroundColor Green
