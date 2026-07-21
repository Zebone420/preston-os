# secret_scan_phase0a.ps1 - scans repo text files for secret-shaped
# strings. Read-only. Exit 0 = clean, 1 = findings. Prints only file,
# line number, and pattern label - never the matched value itself.

$root = 'C:\dev\preston-os'
$selfNames = @(
  'secret_scan_phase0a.ps1',
  'red_boundary_scan_phase0a.ps1',
  # Parity with the bash ports' self-exclusion list (SELF_A-D in
  # scripts/secret_scan.sh / red_boundary_scan.sh, which exclude these
  # two .ps1 files in return). Pattern definitions are not secrets.
  'secret_scan.sh',
  'red_boundary_scan.sh'
)

# Patterns are label = regex. The private-key regex is assembled from
# parts so this file cannot match itself; scanners are excluded anyway.
$patterns = @{
  'private-key-block' = ('-----BEGIN' + ' [A-Z ]*PRIVATE KEY')
  'jwt-token'         = 'eyJ[A-Za-z0-9_\-]{15,}\.eyJ'
  'openai-style-key'  = 'sk-[A-Za-z0-9]{20,}'
  'github-pat'        = 'ghp_[A-Za-z0-9]{30,}'
  'github-fine-pat'   = 'github_pat_[A-Za-z0-9_]{20,}'
  'slack-token'       = 'xox[baprs]-[A-Za-z0-9\-]{10,}'
  'aws-access-key'    = 'AKIA[0-9A-Z]{16}'
  'airtable-pat'      = 'pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{20,}'
  'telegram-token'    = '[0-9]{8,10}:AA[A-Za-z0-9_\-]{30,}'
}
$assigned = '(?i)(password|secret|api_key|apikey|auth_token)'
$assigned = $assigned + '\s*[=:]\s*[A-Za-z0-9+/_\-]{20,}'
$patterns['assigned-secret'] = $assigned

$exts = @('.md','.sql','.ps1','.js','.mjs','.ts','.tsx','.json',
          '.template','.txt','.yml','.yaml','.sh','')

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
      Write-Output "FINDING [$label] $($f.FullName):$($h.LineNumber)"
      $findings++
    }
  }
}

Write-Output "== secret scan: $findings finding(s) =="
if ($findings -gt 0) { exit 1 } else { exit 0 }
