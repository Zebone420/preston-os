# red_boundary_scan_phase0a.ps1 - scans code files for RED-boundary
# patterns (network calls, sends, destructive SQL, guard bypasses).
# Read-only. Exit 0 = clean, 1 = findings.

$root = 'C:\dev\preston-os'
$selfNames = @(
  'secret_scan_phase0a.ps1',
  'red_boundary_scan_phase0a.ps1',
  # Parity with the bash ports (scripts/secret_scan.sh,
  # red_boundary_scan.sh), which exclude these two .ps1 files in return
  # (their SELF_A-D list). Scanner pattern DEFINITIONS are detection
  # regexes, not runnable boundaries; without this exclusion the
  # pre-commit hook blocks every commit on Windows by flagging the bash
  # scanners' own pattern lists. Coverage of real code is unchanged.
  'secret_scan.sh',
  'red_boundary_scan.sh'
)

$patterns = @{
  'network-call'     = 'Invoke-RestMethod|Invoke-WebRequest'
  'web-fetch'        = '\bcurl\s+http|\bwget\s+http'
  'remote-shell'     = '\bssh\s+\S+@|\bscp\s+\S+@'
  'mail-send'        = 'Send-MailMessage'
  'n8n-activation'   = '"active"\s*:\s*true'
  'sudo-use'         = '\bsudo\s'
  'recursive-delete' = 'rm\s+-rf'
  'ps-delete'        = 'Remove-Item.+-Recurse.+-Force'
  'destructive-sql'  = '\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b'
  'hook-bypass'      = '--no-verify'
  'global-install'   = 'npm\s+(install|i)\s+-g'
}

# Code files only; markdown docs are excluded because they legitimately
# DESCRIBE these boundaries.
$exts = @('.ps1','.sql','.js','.mjs','.ts','.tsx','.json','.sh','')

$gci = @{ Path = $root; Recurse = $true; Force = $true; File = $true }
$files = Get-ChildItem @gci -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.FullName -notmatch '\\\.git\\') -and
    ($_.FullName -notmatch '\\node_modules\\') -and
    ($_.FullName -notmatch '\\\.next\\') -and
    ($selfNames -notcontains $_.Name) -and
    ($exts -contains $_.Extension)
  }

$findings = 0
foreach ($f in $files) {
  foreach ($label in $patterns.Keys) {
    $hits = Select-String -Path $f.FullName -Pattern $patterns[$label]
    foreach ($h in $hits) {
      Write-Output "RED FLAG [$label] $($f.FullName):$($h.LineNumber)"
      $findings++
    }
  }
}

Write-Output "== RED boundary scan: $findings finding(s) =="
if ($findings -gt 0) { exit 1 } else { exit 0 }
