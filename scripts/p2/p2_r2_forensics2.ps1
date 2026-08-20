# ============================================================
# R-2 forensics part 2 (OWNER-RUN, READ-ONLY, prod): WHO held the
# owner JWT that called decide_orchestration_approval at
# 2026-08-19 23:40:34 UTC (edge log a4f8f17b, user_agent "node",
# no Vercel involvement - direct REST call).
#
# SELECT-only on auth metadata. NEVER selects token/secret values.
# Output -> reports/p2_evidence/r2_forensics2_<stamp>.txt
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
$out = Join-Path $evDir "r2_forensics2_$stamp.txt"
$gen = Join-Path $evDir '_r2_forensics2.gen.sql'
$outP = ($out -replace '\\', '/')
@(
  '\set ON_ERROR_STOP on'
  ('\o ' + $outP)
  "\echo === owners table membership (who can pass is_owner) ==="
  "select o.user_id, u.email, o.created_at, o.note from owners o join auth.users u on u.id=o.user_id;"
  "\echo === ALL auth sessions for owner users (device inventory; ip+ua per session) ==="
  "select s.id, u.email, s.created_at, s.updated_at, s.ip, s.user_agent from auth.sessions s join auth.users u on u.id=s.user_id order by s.updated_at desc limit 30;"
  "\echo === auth audit entries 2026-08-19 22:30-23:45 UTC (logins/refreshes with ip) ==="
  "select created_at, payload->>'action' as action, payload->>'actor_username' as actor, coalesce(payload->'traits'->>'provider','') as provider, ip_address from auth.audit_log_entries where created_at between '2026-08-19 22:30+00' and '2026-08-19 23:45+00' order by created_at;"
  "\echo === refresh token metadata for owner users, updated 22:30-23:45 (NO token values) ==="
  "select rt.id, u.email, rt.revoked, rt.created_at, rt.updated_at, rt.parent is not null as has_parent from auth.refresh_tokens rt join auth.users u on u.id::text=rt.user_id where rt.updated_at between '2026-08-19 22:30+00' and '2026-08-19 23:45+00' order by rt.updated_at;"
  '\o'
) -join "`r`n" | Out-File -Encoding ascii $gen
$psql = (Get-Command psql).Source
Write-Host 'The password prompt below wants the PROD db password.' -ForegroundColor Yellow
& $psql -h $PoolerHost -p $Port -U $ProdUser -d postgres -v ON_ERROR_STOP=1 -f $gen
if ($LASTEXITCODE -ne 0) { throw "capture failed (psql exit $LASTEXITCODE)." }
Remove-Item $gen -Force
Write-Host "Capture: $out" -ForegroundColor Green
Get-Content $out
