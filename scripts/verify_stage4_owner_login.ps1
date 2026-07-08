# verify_stage4_owner_login.ps1 - Phase 1B Stage 4 Part A verification
#
# Read-only, unauthenticated checks against the staging alias. Makes
# only HTTPS GET requests, stores nothing, prints no secrets (there are
# none to print: it never sends credentials and only reads public
# fail-closed surfaces). Exit 0 = all checks pass, exit 1 = failures.
#
# Usage:
#   powershell -NoProfile -File scripts\verify_stage4_owner_login.ps1
#   powershell -NoProfile -File scripts\verify_stage4_owner_login.ps1 -ExpectMode setup
#
# -ExpectMode connected (default) verifies POST-activation state.
# -ExpectMode setup verifies the PRE-activation fail-closed state.

param(
  [string]$BaseUrl = 'https://preston-os-staging.vercel.app',
  [ValidateSet('connected', 'setup')]
  [string]$ExpectMode = 'connected'
)

$failures = 0

function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) {
    Write-Host "PASS  $name"
  } else {
    Write-Host "FAIL  $name  ($detail)"
    $script:failures++
  }
}

# 1. Health endpoint: exact shape, no extra fields, expected mode.
$healthRaw = curl.exe -s --max-time 30 "$BaseUrl/api/health"
$healthOk = $false
$healthDetail = "body: $healthRaw"
try {
  $health = $healthRaw | ConvertFrom-Json
  $props = @($health.PSObject.Properties.Name)
  $healthOk = ($health.ok -eq $true) -and
              ($health.mode -eq $ExpectMode) -and
              ($props.Count -eq 2)
} catch {
  $healthDetail = "unparseable body: $healthRaw"
}
Check "/api/health is {ok:true, mode:$ExpectMode} with no extra fields" `
  $healthOk $healthDetail

# 2. Protected routes redirect unauthenticated visitors to /login.
$protected = @('/', '/approvals', '/audit', '/brief', '/remote')
foreach ($path in $protected) {
  $out = curl.exe -s -o NUL --max-time 30 -w '%{http_code} %{redirect_url}' `
    "$BaseUrl$path"
  $parts = $out -split ' ', 2
  $code = $parts[0]
  $target = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  $ok = ($code -in '302', '303', '307', '308') -and
        ($target -like '*/login*')
  Check "unauthenticated $path redirects to /login" $ok "got $out"
}

# 3. /login renders directly (200, no redirect loop).
$loginCode = curl.exe -s -o NUL --max-time 30 -w '%{http_code}' "$BaseUrl/login"
Check "/login returns 200" ($loginCode -eq '200') "got $loginCode"

# 4. Login page body: in connected mode the setup notice must be gone;
#    in setup mode it must be present. (Static marker text only.)
$loginBody = curl.exe -s --max-time 30 "$BaseUrl/login"
$hasSetupNotice = $loginBody -match 'SETUP MODE'
if ($ExpectMode -eq 'connected') {
  Check "/login shows no setup-mode notice" (-not $hasSetupNotice) `
    'setup notice still present - env not active on this deploy'
} else {
  Check "/login shows the setup-mode notice" $hasSetupNotice `
    'setup notice missing - env may already be configured'
}

Write-Host ''
if ($failures -eq 0) {
  Write-Host "RESULT: PASS (mode=$ExpectMode, $BaseUrl)"
  exit 0
} else {
  Write-Host "RESULT: FAIL ($failures check(s) failed, mode=$ExpectMode)"
  exit 1
}
