# PRESTON AI PHASE 0A FOUNDATION GATE

Status: active gate plan. Controlling plan:
PRESTON_AI_BUSINESS_POWERSTATION_MASTER_PLAN_v2_1_REVISED.md.

## Gate Structure

| Gate | Name | Class | Owner | Status |
|---|---|---|---|---|
| 0A-1 | Repo Foundation | GREEN | No | DONE (0438b5e) |
| 0A-2 | Governance Docs | GREEN | No | IN PROGRESS |
| 0A-3 | Supabase Schema Files | GREEN | No | Files only |
| 0A-4 | Safety Scripts | GREEN | No | Pending |
| 0A-5 | Owner Session | YELLOW | YES | Pending |
| 0A-6 | Exit Audit | GREEN | No | Pending |

Gate 0A-5 owner session covers: GitHub repo, Supabase project creation,
Telegram bot with chat_id rejection test, Verification Register rulings
on V1, V2, V3, V4, V8, and SSH fingerprint confirmation.

## Action Classes (summary)

GREEN: pre-approved inside the active gate. Read-only inspection; creating
docs, specs, schema files, env-name templates, folders, tests, hook
scripts, guards, reports; running local tests/lint; safe commits; bounded
local scripts touching no production or secrets.

YELLOW: only when named in the active gate. Staging deploys, Supabase
staging changes, Airtable TEST/DEV, inactive n8n drafts, GitHub/Vercel
setup, read-only connector tests, OAuth/Telegram setup guidance, SSH
read-only inspection, remote staging files in approved paths.

RED: hard stop, owner review, no exceptions. Credential exposure, unknown
SSH fingerprint, private keys, passwords, root/sudo/firewall/DNS changes,
production anything, any live send, calendar writes, n8n activation,
payments, client-facing go-live, legal finalization, deletions,
destructive migrations, guard bypass, autonomous loops.

## Blanket YES

A YES at gate entry covers GREEN actions plus only the YELLOW actions
named in that gate. Never spans gates. Never covers RED.

## Blocked Items Register

| Item | Reason | Unblock path |
|---|---|---|
| CLAUDE.md | Corrupted preview | Owner re-supplies content |
| BUILDER_ACCESS_PASS_v1.md | Corrupted preview | Owner re-supplies content |

Blocked file paths in full: CLAUDE.md at repo root, and
docs/PRESTON_AI_BUILDER_ACCESS_PASS_v1.md. Unblock path for both: owner
re-supplies or re-approves content, then a single clean write.

## Exit Gate (Phase 0A PASS requires)

- Repo operating from C:\dev\preston-os with git history.
- Governance docs complete (or explicitly BLOCKED with owner note).
- Schema migration files exist; nothing deployed by the AI.
- Safety scripts pass locally.
- Owner session complete: GitHub, Supabase staging, Telegram bot with
  chat_id rejection test, V1-V4 + V8 resolved or explicitly blocked,
  SSH fingerprint confirmed or SSH kept forbidden.
- No secrets committed. No production touched. No live sends.
