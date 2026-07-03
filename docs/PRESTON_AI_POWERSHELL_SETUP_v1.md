# PRESTON AI POWERSHELL SETUP v1 (Windows, owner-safe)

Status: Phase 0A document. All checks here are read-only.

## Approved Local Repo Path

    C:\dev\preston-os

All builder writes stay inside this path. Verified present.

## Disallowed Path

The Google Drive working repo is reference-only. No active development,
commits, or edits there. (Owner: record the exact Drive path here when
convenient.)

## Required Tools Check (verified 2026-07-02)

| Tool | Status |
|---|---|
| Git | OK (2.51.2) |
| Node | OK (24.13.0) |
| npm | OK (11.6.2) |
| PowerShell | OK |
| OpenSSH client | OK |
| pnpm | Not installed (optional; npm is acceptable) |
| Vercel CLI | Not installed (needed at Phase 0B) |
| Supabase CLI | Not installed (optional; dashboard SQL editor works) |

Re-run anytime with: scripts/preflight_phase0a.ps1 (read-only).

## SSH Alias Check

The alias preston-agent-staging exists in the user's SSH config. Checks
read alias names only, never key file contents.

## known_hosts Verification Step

A known_hosts file exists. The owner must verify the staging host
fingerprint against the Hetzner console before any agent SSH use.
To display the fingerprint hash only (safe, prints no keys):

    ssh-keygen -lF <staging-hostname>

Status: verification PENDING owner confirmation. Until verified, SSH use
by the agent is forbidden.

## Hard Prohibitions

1. No private key printing. Scripts never read key files.
2. No password printing or prompting. No Read-Host for secrets, ever.
3. No .env file reading by scripts or the agent.
4. No modification of SSH config or known_hosts by the agent (owner only).
5. No bypassing local safety guards: no --no-verify, no hook removal,
   no editing guard scripts outside an approved gate.
6. Scripts are read-only outside C:\dev\preston-os.
