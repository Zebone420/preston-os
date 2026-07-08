# scripts/ — Phase 0A Local Safety Scripts

All scripts are local, bounded, and read-only outside this repo. None of
them connect to any external service, read any .env file, or print any
key material.

| Script | Purpose | Exit codes |
|---|---|---|
| preflight_phase0a.ps1 | Read-only environment check | 0 ok / 1 problems |
| secret_scan_phase0a.ps1 | Scan for secret-shaped strings | 0 clean / 1 findings |
| red_boundary_scan_phase0a.ps1 | Scan code for RED patterns | 0 clean / 1 findings |
| verify_stage4_owner_login.ps1 | Read-only staging auth-gate check (HTTPS GET only; -ExpectMode setup or connected) | 0 pass / 1 fail |

Run from inside the repo folder:

    cd C:\dev\preston-os
    powershell -NoProfile -File scripts\preflight_phase0a.ps1

The pre-commit hook (githooks/pre-commit) runs both scanners before every
commit. Git is configured with core.hooksPath=githooks.
