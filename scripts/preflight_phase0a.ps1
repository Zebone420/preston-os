# preflight_phase0a.ps1 - read-only environment and repo-state check.
# Prints findings; changes nothing. Exit 0 = ok, 1 = problems found.

$root = 'C:\dev\preston-os'
$problems = 0

Write-Output "== Preston AI Phase 0A preflight (read-only) =="

# 1. Repo path
if (Test-Path $root) {
  Write-Output "OK   repo path exists: $root"
} else {
  Write-Output "FAIL repo path missing: $root"
  $problems++
}

# 2. Git repo + hooks path
if (Test-Path (Join-Path $root '.git')) {
  Write-Output "OK   git repository initialized"
  $hp = git -C $root config core.hooksPath
  if ($hp -eq 'githooks') {
    Write-Output "OK   core.hooksPath = githooks"
  } else {
    Write-Output "WARN core.hooksPath is '$hp'"
    Write-Output "     expected: githooks"
    $problems++
  }
} else {
  Write-Output "FAIL not a git repository"
  $problems++
}

# 3. Required tools (presence only; never prints secrets)
foreach ($t in @('git','node','npm')) {
  $c = Get-Command $t -ErrorAction SilentlyContinue
  if ($c) {
    Write-Output "OK   tool present: $t"
  } else {
    Write-Output "FAIL tool missing: $t"
    $problems++
  }
}
foreach ($t in @('pnpm','vercel','supabase')) {
  $c = Get-Command $t -ErrorAction SilentlyContinue
  if ($c) {
    Write-Output "INFO optional tool present: $t"
  } else {
    Write-Output "INFO optional tool not installed: $t"
  }
}

# 4. No .env files inside the repo
$gci = @{ Path = $root; Recurse = $true; Force = $true; File = $true }
$allFiles = Get-ChildItem @gci -ErrorAction SilentlyContinue
$envFiles = $allFiles | Where-Object {
  ($_.Name -like '.env*') -and ($_.FullName -notmatch '\\\.git\\')
}
if ($envFiles) {
  foreach ($f in $envFiles) {
    Write-Output "FAIL .env-shaped file present: $($f.FullName)"
  }
  $problems++
} else {
  Write-Output "OK   no .env files inside repo"
}

# 5. env.template values must be blank or the literal 'true'
$tmpl = Join-Path $root 'env.template'
if (Test-Path $tmpl) {
  $pat = '^[A-Z0-9_]+=(?!true$).+$'
  $bad = Select-String -Path $tmpl -Pattern $pat
  if ($bad) {
    foreach ($b in $bad) {
      Write-Output "FAIL env.template non-blank value, line $($b.LineNumber)"
    }
    $problems++
  } else {
    Write-Output "OK   env.template contains names only"
  }
} else {
  Write-Output "WARN env.template missing"
  $problems++
}

# 6. Expected folders
$folders = @('docs','context','supabase\migrations',
             'scripts','githooks','reports')
foreach ($d in $folders) {
  if (Test-Path (Join-Path $root $d)) {
    Write-Output "OK   folder present: $d"
  } else {
    Write-Output "WARN folder missing: $d"
    $problems++
  }
}

Write-Output "== preflight complete: $problems problem(s) =="
if ($problems -gt 0) { exit 1 } else { exit 0 }
