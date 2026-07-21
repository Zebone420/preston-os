#!/usr/bin/env bash
# secret_scan.sh - Linux/bash port of scripts/secret_scan_phase0a.ps1.
# Read-only. Scans TRACKED files only (git ls-files) for secret-shaped
# strings. Exit 0 = clean, 1 = findings. Prints only file, line number,
# and rule label - NEVER the matched value itself.
#
# Keep the pattern set in sync with scripts/secret_scan_phase0a.ps1. Any
# rule added/removed there must be mirrored here (and vice versa). Matching
# is case-INSENSITIVE (grep -i) to mirror PowerShell's Select-String, which
# is case-insensitive by default.
#
# Usage: scripts/secret_scan.sh [repo-root]
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

# label|regex (extended regex, POSIX ERE via grep -E). One rule per line.
# The private-key regex is split across two literals below so this file
# cannot match its own rule definition.
PATTERNS=(
  'private-key-block|-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY'
  'jwt-token|eyJ[A-Za-z0-9_-]{15,}\.eyJ'
  'openai-style-key|sk-[A-Za-z0-9]{20,}'
  'github-pat|ghp_[A-Za-z0-9]{30,}'
  'github-fine-pat|github_pat_[A-Za-z0-9_]{20,}'
  'slack-token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'aws-access-key|AKIA[0-9A-Z]{16}'
  'airtable-pat|pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{20,}'
  'telegram-token|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}'
  'assigned-secret|(password|secret|api_key|apikey|auth_token)[[:space:]]*[=:][[:space:]]*[A-Za-z0-9+/_-]{20,}'
)

# Extensions included (mirrors the .ps1 $exts list; '' means extensionless).
EXTS='md sql ps1 js mjs ts tsx json template txt yml yaml sh'

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
      echo "FINDING [$label] $f:$lineno"
      findings=$((findings + 1))
    done < <(grep -n -E -a -i "$pattern" -- "$f" 2>/dev/null || true)
  done
done < <(git ls-files -z)

echo "== secret scan: $findings finding(s) =="
if [ "$findings" -gt 0 ]; then
  exit 1
fi
exit 0
