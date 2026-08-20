# ============================================================
# R-2 forensics capture (OWNER-RUN, READ-ONLY, prod)
#
# Investigates the undecided-by-owner approval of
# apr-df39913f3a529546551071e0 (2026-08-19 23:40:34 UTC).
# SELECT-only; never mutates; password at psql's own prompt.
# Output -> reports/p2_evidence/r2_forensics_<stamp>.txt
#
# What the nonce prefix means (deployed code has exactly ONE caller
# of decide_orchestration_approval - the dashboard server action):
#   dash-<uuid>  = decided via the dashboard UI by an authenticated
#                  owner session (actions.ts:145)
#   anything else = decided via direct SQL (psql / Supabase SQL
#                  editor) under an owner-authenticated context
# ============================================================
[CmdletBinding()]
param(
  [string]$PoolerHost = 'aws-0-us-east-1.pooler.supabase.com',
  [string]$ProdUser = 'postgres.hiqsymsiwonmvrbbqhhe',
  [int]$Port = 5432
)
$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$evDir = Join-Path $repo 'reports\p2_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$out = Join-Path $evDir "r2_forensics_$stamp.txt"
$gen = Join-Path $evDir '_r2_forensics.gen.sql'
$outP = ($out -replace '\\', '/')
@(
  '\set ON_ERROR_STOP on'
  ('\o ' + $outP)
  "\echo === approval record (full decision fields) ==="
  "select approval_id, goal_id, job_id, status, nonce, owner_identity, reason, created_at, decided_at, expires_at from orchestration_approvals where approval_id='apr-df39913f3a529546551071e0';"
  "\echo === audit_log rows 23:30-23:59 UTC 2026-08-19 ==="
  "select id, actor, action, action_class, environment, detail, created_at from audit_log where created_at between '2026-08-19 23:30+00' and '2026-08-19 23:59+00' order by created_at;"
  "\echo === all approval decisions today (context) ==="
  "select approval_id, status, left(coalesce(nonce,'(null)'), 12) as nonce_prefix, decided_at from orchestration_approvals where decided_at >= '2026-08-19 00:00+00' order by decided_at;"
  "\echo === goal + job rows ==="
  "select id, status, environment, requested_by, correlation_id, created_at, updated_at from master_goals where id='a9dec5b1-af7a-4490-ac81-ea79f65a2df7';"
  "select id, status, requires_approval, approval_id, assigned_role, attempts, updated_at from goal_jobs where id='5117bf5b-c3db-46bf-81b1-a2c26ada67f2';"
  '\o'
) -join "`r`n" | Out-File -Encoding ascii $gen
$psql = (Get-Command psql).Source
Write-Host 'The password prompt below wants the PROD db password.' -ForegroundColor Yellow
& $psql -h $PoolerHost -p $Port -U $ProdUser -d postgres -v ON_ERROR_STOP=1 -f $gen
if ($LASTEXITCODE -ne 0) { throw "capture failed (psql exit $LASTEXITCODE)." }
Remove-Item $gen -Force
Write-Host "Capture: $out" -ForegroundColor Green
Get-Content $out
