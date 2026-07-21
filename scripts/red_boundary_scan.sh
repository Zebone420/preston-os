#!/usr/bin/env bash
# red_boundary_scan.sh - Linux/bash port of scripts/red_boundary_scan_phase0a.ps1.
# Read-only. Scans TRACKED code files (git ls-files) for RED-boundary
# patterns (network calls, sends, destructive SQL, guard bypasses).
# Exit 0 = clean, 1 = findings.
#
# Keep the pattern set in sync with scripts/red_boundary_scan_phase0a.ps1.
# Any rule added/removed there must be mirrored here (and vice versa).
# Markdown docs are excluded because they legitimately DESCRIBE these
# boundaries (mirrors the .ps1 code-files-only $exts list). Matching is
# case-INSENSITIVE (grep -i) to mirror PowerShell's Select-String, which
# is case-insensitive by default.
#
# Usage: scripts/red_boundary_scan.sh [repo-root]
#   repo-root defaults to `git rev-parse --show-toplevel`.
set -euo pipefail

ROOT="${1:-}"
if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel)"
fi
cd "$ROOT"

SELF_A="scripts/secret_scan.sh"
SELF_B="scripts/red_boundary_scan.sh"
SELF_C="scripts/secret_scan_phase0a.ps1"
SELF_D="scripts/red_boundary_scan_phase0a.ps1"

# label|regex (extended regex, POSIX ERE via grep -E).
PATTERNS=(
  'network-call|Invoke-RestMethod|Invoke-WebRequest'
  'web-fetch|\<curl[[:space:]]+http|\<wget[[:space:]]+http'
  'remote-shell|\<ssh[[:space:]]+[^[:space:]]+@|\<scp[[:space:]]+[^[:space:]]+@'
  'mail-send|Send-MailMessage'
  'n8n-activation|"active"[[:space:]]*:[[:space:]]*true'
  'sudo-use|\<sudo[[:space:]]'
  'recursive-delete|rm[[:space:]]+-rf'
  'ps-delete|Remove-Item.+-Recurse.+-Force'
  'destructive-sql|\<DROP[[:space:]]+TABLE\>|\<TRUNCATE\>|\<DELETE[[:space:]]+FROM\>'
  'hook-bypass|--no-verify'
  'global-install|npm[[:space:]]+(install|i)[[:space:]]+-g'
)

# Code files only; markdown docs are excluded (mirrors the .ps1 $exts list).
EXTS='ps1 sql js mjs ts tsx json sh'

is_included_ext() {
  local f="$1"
  local base ext
  base="$(basename -- "$f")"
  case "$base" in
    *.*) ext="${base##*.}" ;;
    *) ext="" ;;
  esac
  if [ -z "$ext" ]; then
    return 0
  fi
  for e in $EXTS; do
    if [ "$ext" = "$e" ]; then
      return 0
    fi
  done
  return 1
}

findings=0

while IFS= read -r -d '' f; do
  case "$f" in
    node_modules/*|*/node_modules/*|.next/*|*/.next/*|dist/*|*/dist/*) continue ;;
  esac
  case "$f" in
    "$SELF_A"|"$SELF_B"|"$SELF_C"|"$SELF_D") continue ;;
  esac
  if ! is_included_ext "$f"; then
    continue
  fi
  [ -f "$f" ] || continue

  for entry in "${PATTERNS[@]}"; do
    label="${entry%%|*}"
    pattern="${entry#*|}"
    while IFS=: read -r lineno _rest; do
      [ -z "$lineno" ] && continue
      echo "RED FLAG [$label] $f:$lineno"
      findings=$((findings + 1))
    done < <(grep -n -E -a -i "$pattern" -- "$f" 2>/dev/null || true)
  done
done < <(git ls-files -z)

echo "== RED boundary scan: $findings finding(s) =="
if [ "$findings" -gt 0 ]; then
  exit 1
fi
exit 0
