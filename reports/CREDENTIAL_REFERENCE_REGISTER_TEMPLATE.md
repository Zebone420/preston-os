# CREDENTIAL REFERENCE REGISTER (template)

Date opened: 2026-07-21. NAMES AND LOCATIONS ONLY - no credential
value, fragment, or fingerprint ever appears in this file. Filled
from packet V2 item 7 (and item 3d) once returned. Each row later
receives a lifecycle plan line; rotation/revocation is always
owner-run.

Row format:

| # | System | Credential label | Type | Stored where | Used by | Last known use | Scope assessment | Lifecycle plan |

Scope assessment values: SCOPED (least-privilege) / BROAD /
UNKNOWN. Lifecycle plan values: KEEP / ROTATE (schedule) /
RETIRE-WITH-ASSET (which retirement step) / ORPHAN-REVOKE
(no consumer exists).

## Known rows (pre-seeded from repo + prior phases; names only)

| # | System | Credential label | Type | Stored where | Used by | Last known use | Scope | Lifecycle plan |
|---|---|---|---|---|---|---|---|---|
| C1 | Supabase staging | anon key + owner login | key + password | Vercel env, 1Password | dashboard, runtime | Phase 6 gate | SCOPED (RLS-bound) | KEEP |
| C2 | Supabase staging | runtime refresh tokens (worker, hermes) | rotating tokens | host token stores (0600) | dispatchers | Phase 5 drills | SCOPED | KEEP |
| C3 | Airtable | TEST PAT (read-only, single base) | PAT | Vercel env, 1Password | dashboard cards | Phase 6 gate | SCOPED | KEEP |
| C4 | Google | OAuth client + refresh token (read-only scopes) | OAuth | Vercel env, 1Password | /brief | Phase 1B+ | SCOPED | KEEP |
| C5 | Telegram | bot token (@preston_os_notify_bot) | token | 1Password only | dormant | never bound live | SCOPED | KEEP (dormant) |
| C6 | n8n | console login | password (+2FA?) | 1Password (assumed) | owner | unknown | UNKNOWN | ROTATE at hardening step |
| C7-Cn | n8n-stored credentials | (names from packet item 3d) | various | inside n8n DB | workflows | unknown | UNKNOWN | per-workflow: RETIRE-WITH-ASSET or re-scope |
| Cx | Hetzner | SSH keys per server | keypairs | owner machines | owner SSH | Phase 5/6 (staging) | UNKNOWN for legacy hosts | legacy-host keys RETIRE-WITH-ASSET |
| Cy | GitHub | account + repo access | account | owner | push/pull | today | SCOPED | KEEP |
| Cz | Registrars | prestonwd.com / preston.nyc logins | accounts | 1Password (assumed) | owner | unknown | UNKNOWN | KEEP; confirm 2FA |

Special flags to fill from evidence: any credential found OUTSIDE
1Password (loose .env on old hosts/machines) is tagged
ORPHAN-CANDIDATE and gets its own review line; any n8n credential
with write/send scope is tagged BROAD pending workflow review.
