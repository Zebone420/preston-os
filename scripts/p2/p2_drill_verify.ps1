# ============================================================
# P2 drill evidence capture (OWNER-RUN, READ-ONLY, prod)
#
# Captures the ground-truth rows the P2 drill ladder needs
# (reports/PRESTON_P2_PROD_HOST_RUNBOOK_v1.md H-9, D-P2-1..3)
# into timestamped evidence files under reports/p2_evidence/.
#
# This script only ever runs SELECT statements. It never
# mutates any row and never prints or stores any credential.
# The password is typed at psql's own interactive prompt.
#
# Run it once after EACH drill step with a matching label:
#   .\scripts\p2\p2_drill_verify.ps1 `
#       -ProdHost aws-0-us-east-1.pooler.supabase.com `
#       -ProdUser postgres.hiqsymsiwonmvrbbqhhe -Label d-p2-1
#   (SESSION pooler, port 5432 - never 6543)
#
# What to look for per drill (details in the runbook):
#   d-p2-1: intake rows consumed; goals/jobs environment=production;
#           actor_id preserved; capability reasons show no execution
#   d-p2-2: approval row decided; posture shows owner_stop round-trip
#   d-p2-3: completed job evidence_refs contain real:* completed
#           executed:true + real-audit paths_ok, zero sim:* entries
# ============================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProdHost,
  [Parameter(Mandatory=$true)][string]$ProdUser,
  [int]$Port = 5432,
  [string]$Label = 'capture'
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$evDir = Join-Path $repo 'reports\p2_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
if ($Label -notmatch '^[a-z0-9-]{1,32}$') {
  throw 'Label must be short lowercase kebab-case.'
}

if ($ProdUser -match 'vcqtlmlaxxankxyezlul') {
  throw 'Refusing: target is the STAGING project.'
}
if ($ProdUser -notmatch 'hiqsymsiwonmvrbbqhhe') {
  throw 'Refusing: ProdUser does not name the prod project ref.'
}

$psql = (Get-Command psql).Source
$outFile = Join-Path $evDir ("p2_${Label}_$stamp.txt")
function ToPsqlPath([string]$p) { return ($p -replace '\\', '/') }

$q = @()
$q += '\set ON_ERROR_STOP on'
$q += ('\o ' + (ToPsqlPath $outFile))
$q += ('\echo === P2 EVIDENCE ' + $Label + ' ' + $stamp + ' ===')
$q += '\echo === controls posture ==='
$q += ('select id, execution_enabled, remote_runner_enabled, ' +
  'owner_stop, paused, hermes_mode, updated_at from system_controls;')
$q += '\echo === remote intake rows ==='
$q += ('select request_id, source, actor_id, status, reject_reason, ' +
  'created_at, consumed_at from remote_intake_requests ' +
  'order by created_at;')
$q += '\echo === master goals ==='
$q += ('select id, status, environment, source, requested_by, ' +
  'correlation_id, iteration, created_at from master_goals ' +
  'order by created_at;')
$q += '\echo === goal jobs ==='
$q += ('select id, goal_id, kind, status, assigned_role, attempts, ' +
  'requires_approval, approval_id, failure_reason from goal_jobs ' +
  'order by goal_id;')
$q += '\echo === terminal job evidence refs (d-p2-3 pass criteria) ==='
$q += ('select id, status, evidence_refs from goal_jobs ' +
  "where status in ('completed','failed','dead_lettered');")
$q += '\echo === approvals ==='
$q += ('select approval_id, goal_id, job_id, action, status, ' +
  'environment, risk_class, created_at, expires_at ' +
  'from orchestration_approvals order by created_at;')
$q += '\echo === summary counts ==='
$q += ("select 'intake_pending', count(*) from remote_intake_requests " +
  "where status = 'pending' union all " +
  "select 'intake_consumed', count(*) from remote_intake_requests " +
  "where status = 'consumed' union all " +
  "select 'goals_total', count(*) from master_goals union all " +
  "select 'goals_production', count(*) from master_goals " +
  "where environment = 'production' union all " +
  "select 'jobs_completed', count(*) from goal_jobs " +
  "where status = 'completed' union all " +
  "select 'approvals_pending', count(*) from orchestration_approvals " +
  "where status = 'pending';")
$q += '\o'

$gen = Join-Path $env:TEMP 'p2_verify.gen.sql'
$q -join "`r`n" | Out-File -Encoding ascii $gen

Write-Host "Target: $ProdUser @ $ProdHost : $Port (PROD password prompt)"
& $psql -h $ProdHost -p $Port -U $ProdUser -d postgres -f $gen
$code = $LASTEXITCODE
Remove-Item $gen -Force
if ($code -ne 0) { throw "Capture failed (psql exit $code)." }

Write-Host ("Evidence written: " + $outFile) -ForegroundColor Green
Get-Content $outFile | Select-Object -First 40
Write-Host '(full file under reports/p2_evidence/ - commit it with the gate)'
