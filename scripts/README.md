# scripts/ — Phase 0A Local Safety Scripts

All scripts are local, bounded, and read-only outside this repo (except
`worktree_prepare.sh`, which is OWNER-RUN ONLY and only ever creates one
new `git worktree` directory under `/srv/worktrees/`). None of them
connect to any external service, read any .env file, or print any key
material.

| Script | Purpose | Exit codes |
|---|---|---|
| preflight_phase0a.ps1 | Read-only environment check (Windows) | 0 ok / 1 problems |
| secret_scan_phase0a.ps1 | Scan for secret-shaped strings (Windows) | 0 clean / 1 findings |
| red_boundary_scan_phase0a.ps1 | Scan code for RED patterns (Windows) | 0 clean / 1 findings |
| secret_scan.sh | Scan for secret-shaped strings (Linux/macOS bash port of secret_scan_phase0a.ps1) | 0 clean / 1 findings |
| red_boundary_scan.sh | Scan code for RED patterns (Linux/macOS bash port of red_boundary_scan_phase0a.ps1) | 0 clean / 1 findings |
| worktree_prepare.sh | OWNER-RUN: create one isolated `git worktree` for a job under `/srv/worktrees/` | 0 pass / 1 refused |
| verify_stage4_owner_login.ps1 | Read-only staging auth-gate check (HTTPS GET only; -ExpectMode setup or connected) | 0 pass / 1 fail |

## Windows

Run from inside the repo folder:

    cd C:\dev\preston-os
    powershell -NoProfile -File scripts\preflight_phase0a.ps1

## Linux / macOS (staging host)

The bash scanners take the repo root as an optional first argument
(default: `git rev-parse --show-toplevel`) and scan **tracked files only**
(`git ls-files`), mirroring the PowerShell blocklists rule-for-rule. They
print only the rule label and `file:line` for any finding — never the
matched value.

    bash scripts/secret_scan.sh
    bash scripts/red_boundary_scan.sh

`worktree_prepare.sh` is OWNER-RUN ONLY, for staging hosts, and creates
exactly one worktree per invocation:

    scripts/worktree_prepare.sh --job-id <id> --base-commit <40-hex-sha> [--base-branch master]

It refuses (exit 1, no side effects) if: the canonical checkout is dirty,
the target directory under `/srv/worktrees/` already exists, the base
commit is not a known object in the canonical repository, or the job id
has an invalid shape. It never pushes, installs, or makes network calls.
It is reversible via the owner-run `git worktree` removal command against
the canonical repository.

## Pre-commit hook

The pre-commit hook (githooks/pre-commit) runs both scanners before every
commit. Git is configured with core.hooksPath=githooks. The hook detects
platform: it prefers the PowerShell scanners when `powershell.exe` is on
PATH, otherwise falls back to the bash scanners. If neither scanner
runtime is available, the hook fails closed and blocks the commit rather
than letting it through unscanned.

Pattern sets between the `.ps1` and `.sh` scanners are kept in sync by
hand; a change to one must be mirrored in the other.
