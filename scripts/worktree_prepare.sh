#!/usr/bin/env bash
# worktree_prepare.sh - OWNER-RUN ONLY. Staging host only.
#
# Prepares an isolated git worktree for a single job under /srv/worktrees/.
# This script performs no network access, installs nothing, and never
# pushes. It only reads the canonical repository's local state and, if
# every precondition holds, creates one new worktree directory on a new
# job branch cut from a known base commit.
#
# Reversible: the created worktree can be removed with the owner-run
# `git worktree` removal command against the canonical repository; this
# script does not remove anything itself.
#
# This script mirrors (in bash) the validation performed by the pure
# planner in apps/dashboard/src/lib/ai-os/worktree.ts
# (validateWorktreePath / validateBaseRef / worktreePreparePlan). Keep the
# regexes below in sync with that file.
#
# Usage:
#   scripts/worktree_prepare.sh --job-id <id> --base-commit <sha> [--base-branch master]
#
# Required env / cwd: run from inside a clean checkout of the canonical
# repository (the script resolves the canonical root via
# `git rev-parse --show-toplevel`).
set -euo pipefail

WORKTREES_ROOT="/srv/worktrees"
JOB_ID=""
BASE_COMMIT=""
BASE_BRANCH="master"

usage() {
  echo "Usage: $0 --job-id <id> --base-commit <40-hex-sha> [--base-branch <name>]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --job-id)
      JOB_ID="${2:-}"
      shift 2
      ;;
    --base-commit)
      BASE_COMMIT="${2:-}"
      shift 2
      ;;
    --base-branch)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "worktree_prepare: unknown argument: $1" >&2
      usage
      ;;
  esac
done

fail() {
  echo "worktree_prepare: REFUSED - $1" >&2
  exit 1
}

# --- validate job id (single path segment, safe shape) ---------------------
JOB_ID_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
[ -n "$JOB_ID" ] || fail "job id is required"
[[ "$JOB_ID" =~ $JOB_ID_RE ]] || fail "job id has an invalid shape: $JOB_ID"
case "$JOB_ID" in
  *..*) fail "job id contains a traversal segment" ;;
esac

# --- validate base branch ---------------------------------------------------
BRANCH_RE='^[A-Za-z0-9._/-]{1,100}$'
[ -n "$BASE_BRANCH" ] || fail "base branch is required"
[[ "$BASE_BRANCH" =~ $BRANCH_RE ]] || fail "base branch has an invalid shape: $BASE_BRANCH"
case "$BASE_BRANCH" in
  -*) fail "base branch must not start with a dash" ;;
  *..*) fail "base branch contains a traversal segment" ;;
esac

# --- validate base commit (must look like a full sha; existence checked below) ---
COMMIT_RE='^[0-9a-f]{40}$'
[ -n "$BASE_COMMIT" ] || fail "base commit is required"
[[ "$BASE_COMMIT" =~ $COMMIT_RE ]] || fail "base commit must be a 40-character hex sha"

# --- resolve and validate the canonical repository root ---------------------
CANON_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "must be run from inside the canonical repository"
[ -n "$CANON_ROOT" ] || fail "could not resolve canonical repository root"

# --- refuse if the canonical checkout is dirty ------------------------------
if [ -n "$(git -C "$CANON_ROOT" status --porcelain)" ]; then
  fail "canonical repository ($CANON_ROOT) has a non-clean working tree"
fi

# --- refuse if the base commit is not a known object in this repository ----
if ! git -C "$CANON_ROOT" cat-file -e "${BASE_COMMIT}^{commit}" 2>/dev/null; then
  fail "base commit is not a known commit object in $CANON_ROOT: $BASE_COMMIT"
fi

# --- compute and validate the target worktree path --------------------------
JOB_DIR="wt-${JOB_ID}"
TARGET_PATH="${WORKTREES_ROOT}/${JOB_DIR}"

case "$TARGET_PATH" in
  "$WORKTREES_ROOT"/*) : ;;
  *) fail "computed target path escaped $WORKTREES_ROOT: $TARGET_PATH" ;;
esac
case "$TARGET_PATH" in
  */../*|*/..) fail "computed target path contains a traversal segment" ;;
esac

[ -e "$TARGET_PATH" ] && fail "target directory already exists (no reuse): $TARGET_PATH"

JOB_BRANCH="job/${JOB_ID}"

# --- create the worktree root if it does not exist yet ----------------------
mkdir -p "$WORKTREES_ROOT"

echo "worktree_prepare: creating worktree"
echo "  canonical repo : $CANON_ROOT"
echo "  target path    : $TARGET_PATH"
echo "  new branch     : $JOB_BRANCH"
echo "  base branch    : $BASE_BRANCH"
echo "  base commit    : $BASE_COMMIT"

git -C "$CANON_ROOT" worktree add "$TARGET_PATH" -b "$JOB_BRANCH" "$BASE_COMMIT"

# --- verify the new worktree is clean immediately after creation -----------
if [ -n "$(git -C "$TARGET_PATH" status --porcelain)" ]; then
  fail "newly created worktree is not clean: $TARGET_PATH"
fi

echo "== worktree_prepare: summary =="
echo "status       : PASS"
echo "job_id       : $JOB_ID"
echo "path         : $TARGET_PATH"
echo "branch       : $JOB_BRANCH"
echo "base_branch  : $BASE_BRANCH"
echo "base_commit  : $BASE_COMMIT"
echo "reviewer     : read-only (no separate write worktree created)"
echo "cleanup      : owner-run 'git worktree remove' against $CANON_ROOT"
exit 0
