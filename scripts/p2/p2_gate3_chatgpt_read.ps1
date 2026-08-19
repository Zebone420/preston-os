# ============================================================
# Gate 3 driver: ChatGPT live SSOT read + 0019 behavioral proof
# OWNER-RUN. Two interactive prompts, nothing echoed or logged.
#
# Step 1: prompts for the chatgpt-1 bearer token (secure input),
#         performs ONE authenticated GET
#         https://preston-os-prod.vercel.app/api/os/ssot/status
#         and saves the JSON response (no secrets in it) to
#         reports/p2_evidence/chatgpt_read_<stamp>.json
# Step 2: prompts for the PROD db password at psql's own prompt and
#         captures access_events to
#         reports/p2_evidence/m0019_liveproof_<stamp>_prod.txt
#         Expected: exactly ONE row - actor chatgpt-1, system
#         ssot-read, event used, environment production. (The agent's
#         earlier dummy-token probes must NOT appear: 0019 audits
#         successful reads only.)
#
# Safety: token read as secure string, held in memory only for the one
# request, then cleared; never written to disk, args, or history.
# ============================================================
[CmdletBinding()]
param(
  [string]$Url = 'https://preston-os-prod.vercel.app/api/os/ssot/status',
  [string]$PoolerHost = 'aws-0-us-east-1.pooler.supabase.com',
  [string]$ProdUser = 'postgres.hiqsymsiwonmvrbbqhhe',
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$evDir = Join-Path $repo 'reports\p2_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

# ---------- STEP 1: the authenticated read ----------
$sec = Read-Host -AsSecureString 'Paste the chatgpt-1 bearer token (input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$tok = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if (-not $tok -or $tok.Length -lt 8 -or $tok.Length -gt 128) { throw 'token length implausible - aborting before any request.' }

$outJson = Join-Path $evDir "chatgpt_read_$stamp.json"
try {
  $resp = Invoke-WebRequest -Uri $Url -Headers @{ Authorization = "Bearer $tok" } -UseBasicParsing
  $code = $resp.StatusCode
  $body = $resp.Content
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
} finally {
  $tok = $null; $sec = $null
}
$body | Out-File -Encoding utf8 $outJson
Write-Host "HTTP $code. Response saved: $outJson"
if ($code -ne 200) { Write-Host 'READ DID NOT SUCCEED - stop here and report the code.' -ForegroundColor Red; exit 1 }
$parsed = $body | ConvertFrom-Json
Write-Host ("ok={0} status={1} environment={2} actor={3}" -f $parsed.ok, $parsed.status, $parsed.environment, $parsed.actor.actor_id) -ForegroundColor Green

# ---------- STEP 2: the 0019 per-read audit proof ----------
$psql = (Get-Command psql).Source
$cap = Join-Path $evDir "m0019_liveproof_${stamp}_prod.txt"
$gen = Join-Path $evDir '_m0019_liveproof.gen.sql'
$capP = ($cap -replace '\\', '/')
@(
  ('\o ' + $capP)
  "select 'access_events_total='||count(*) from access_events;"
  "select system, event, actor, environment, detail->>'actor_role' as actor_role, created_at from access_events order by created_at;"
  '\o'
) -join "`r`n" | Out-File -Encoding ascii $gen
Write-Host 'The password prompt below wants the PROD db password.' -ForegroundColor Yellow
& $psql -h $PoolerHost -p $Port -U $ProdUser -d postgres -v ON_ERROR_STOP=1 -f $gen
if ($LASTEXITCODE -ne 0) { throw "capture failed (psql exit $LASTEXITCODE)." }
Remove-Item $gen -Force
Write-Host "Capture: $cap" -ForegroundColor Green
Get-Content $cap
Write-Host ''
Write-Host 'Expected: access_events_total=1, single row actor=chatgpt-1, system=ssot-read, event=used, environment=production. Reply "gate 3 done" in the agent session.' -ForegroundColor Green
