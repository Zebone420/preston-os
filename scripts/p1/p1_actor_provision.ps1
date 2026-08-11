# ============================================================
# P1 actor + intake-config provisioning (OWNER-RUN, prod)
#
# Generates FRESH production tokens (never staging reuse), prints each
# token ONCE to this console for you to store in 1Password (PROD-*),
# then inserts ONLY sha256 hashes into the prod DB via one psql session
# (interactive password). Nothing secret is written to disk or logs.
#
# Rows created:
#   actor_registry: owner-remote-1 (enabled), chatgpt-1 (enabled),
#                   claude-1 (enabled), codex-1 (DISABLED),
#                   hermes-1 (DISABLED)      [n8n needs migration 0016]
#   remote_intake_config: id='global', fresh legacy token hash, ENABLED
#
# Usage (own PowerShell window, from C:\dev\preston-os):
#   .\scripts\p1\p1_actor_provision.ps1 -ProdHost <pooler-host> `
#       -ProdUser postgres.<prod-ref>
# ============================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProdHost,
  [Parameter(Mandatory=$true)][string]$ProdUser,
  [int]$Port = 5432,
  # Dry run: DUMMY tokens, SQL written to a preview file, psql NOT called.
  [switch]$GenerateOnly
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\dev\preston-os'
$evDir = Join-Path $repo 'reports\p1_evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
if ($ProdUser -match 'vcqtlmlaxxankxyezlul') { throw 'Refusing: target is STAGING.' }

function New-Token {
  $b = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function Sha256Hex([string]$s) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($s))
  return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
}

$actors = @(
  @{ id = 'owner-remote-1'; role = 'owner_remote'; name = 'Owner remote';  enabled = 'true'  },
  @{ id = 'chatgpt-1';      role = 'chatgpt';      name = 'ChatGPT';       enabled = 'true'  },
  @{ id = 'claude-1';       role = 'claude';       name = 'Claude';        enabled = 'true'  },
  @{ id = 'codex-1';        role = 'codex';        name = 'Codex';         enabled = 'false' },
  @{ id = 'hermes-1';       role = 'hermes';       name = 'Hermes';        enabled = 'false' }
)

Write-Host ''
if (-not $GenerateOnly) {
  Write-Host '=== FRESH PROD TOKENS - store each in 1Password NOW (shown once) ===' -ForegroundColor Yellow
}
$sql = @()
$sql += '\set ON_ERROR_STOP on'
foreach ($a in $actors) {
  if ($GenerateOnly) { $t = 'dry-run-token-' + $a.id } else { $t = New-Token }
  if (-not $GenerateOnly) { Write-Host ('  PROD-' + $a.id + ': ' + $t) }
  $h = Sha256Hex $t
  $sql += ("insert into actor_registry (actor_id, display_name, actor_role, token_hash, enabled) " +
    "values ('$($a.id)', '$($a.name)', '$($a.role)', '$h', $($a.enabled)) " +
    "on conflict (actor_id) do update set token_hash = excluded.token_hash, enabled = excluded.enabled;")
}
if ($GenerateOnly) { $global = 'dry-run-token-global' } else { $global = New-Token }
if (-not $GenerateOnly) {
  Write-Host ('  PROD-remote-intake-global (also goes in Vercel REMOTE_INTAKE_TOKEN): ' + $global)
}
$gh = Sha256Hex $global
$sql += ("insert into remote_intake_config (id, token_hash, enabled) values ('global', '$gh', true) " +
  "on conflict (id) do update set token_hash = excluded.token_hash, enabled = true;")
$sql += "select actor_id, actor_role, enabled, length(token_hash) as hash_len, left(token_hash, 8) as hash_prefix from actor_registry order by actor_id;"
$sql += "select id, enabled, length(token_hash) as hash_len, left(token_hash, 8) as hash_prefix from remote_intake_config;"

if ($GenerateOnly) {
  $preview = Join-Path $evDir '_provision_preview.gen.sql'
  $sql -join "`r`n" | Out-File -Encoding ascii $preview
  Write-Host "DRY RUN: generated SQL (dummy tokens) written to $preview - psql NOT called."
  if (($sql -join ' ') -match '\{[0-9]\}') { throw 'Literal {n} placeholder found in generated SQL.' }
  Write-Host 'Placeholder check: PASS (no literal {n} remains).' -ForegroundColor Green
  return
}
$f = Join-Path $env:TEMP 'p1_provision.gen.sql'
$sql -join "`r`n" | Out-File -Encoding ascii $f
Write-Host ''
Write-Host '=== Applying to PROD (password prompt = PROD db password) ===' -ForegroundColor Cyan
$psql = (Get-Command psql).Source
& $psql -h $ProdHost -p $Port -U $ProdUser -d postgres -f $f
$code = $LASTEXITCODE
Remove-Item $f -Force
if ($code -ne 0) { throw "Provisioning failed (psql exit $code)." }
Write-Host ''
Write-Host 'DONE. Copy the two verification tables above into the session,' -ForegroundColor Green
Write-Host 'or just confirm: 5 actors (3 enabled) + global config enabled, all hash_len 64.'
