# SECURITY AND CREDENTIAL HYGIENE PLAN (legacy consolidation)

Date: 2026-07-21. No secret value appears in this document. No
credential was rotated, revoked, created, or displayed. All
rotation/revocation steps are OWNER-RUN and PLANNED ONLY.

## Findings (ranked)

S1 - MEDIUM-HIGH (VERIFIED): automation.prestonwd.com serves the
n8n console on the public internet. n8n version/patch level and
auth hardening are UNKNOWN. The n8n credential store contains
whatever Gmail/Airtable/API credentials the 7 workflows use -
a compromise of this single console compromises every connected
system. Mitigations (owner-run, after packet C export): update
n8n; enforce strong auth/2FA; consider IP-allowlisting or an
auth proxy; disable unused webhook endpoints; later, retire or
migrate per the consolidation decision.

S2 - MEDIUM (UNKNOWN pending packet E): ubuntu-4gb-fsn1-2 runs
unknown services on a public IP with no known maintenance
history. Unknown = unpatched until proven otherwise.

S3 - MEDIUM (UNKNOWN pending packet B): preston-ai-andersen-vault
is a data repo; data repos frequently contain committed secrets
in helper scripts. The export must be scanner-swept before any
content moves. Same check for -graph.

S4 - LOW-MEDIUM (structural): n8n workflow exports embed
credential identifiers and can embed tokens if exported with
credentials. Packet C mandates credential-EXCLUDED exports.

S5 - LOW (VERIFIED): the active platform's posture is strong -
no secrets in repo (scans 0 across all commits), no service-role
usage in app code, owner-only RLS, anon zero-privilege, browser
bundle verified clean, execution/runner disabled, Hermes
observe-only. No action.

S6 - RESOLVED-PENDING-CONFIRMATION (VERIFIED 404): the two
Andersen repos are no longer publicly visible; Gate 0A's open
"decide visibility" item appears completed. Packet B confirms
whether they are private (good) or deleted (data-loss question).

S7 - PROCESS: Phase 5 identity work (token stores, worker/hermes
identities) is unaffected by this audit; least-privilege cutover
(migration 0007) remains its own future gate.

## Credential inventory (locations only)

| Credential | Where it lives | Status |
|---|---|---|
| Supabase staging anon key + owner login | Vercel env + owner password manager | active, managed |
| SUPABASE_RUNTIME_* refresh tokens | host token stores (0600 files) | active, rotating by design |
| Airtable TEST PAT (read-only, single base) | Vercel env + 1Password | active, scoped |
| Google OAuth (read-only scopes) | Vercel env + 1Password | active, scoped |
| Telegram bot token | 1Password only (bot dormant) | dormant |
| N8N_API_KEY | NOWHERE (empty placeholder; no consumer) | never provisioned - do not create until the automation-admin gate |
| n8n stored credentials (Gmail? Airtable? OpenAI? unknown) | inside n8n DB on gmail-dev-n8n | UNKNOWN set - packet C lists them by name only |
| Legacy server SSH keys | owner machines | packet E confirms authorized_keys per host |
| Hetzner/Supabase/Vercel/registrar console logins | owner password manager | assumed 2FA - owner to confirm |

## Plans (all owner-run, staged after evidence)

1. Credential ROTATION plan: rotate n8n console password +
   any n8n-stored credentials that packet C reveals as broad
   (especially any full-Gmail or write-scope Airtable token);
   rotate legacy-server SSH keys or disable password auth if
   packet E shows it enabled. Active-platform credentials need no
   rotation from this audit (no exposure found).
2. Credential RETIREMENT plan: when a legacy workflow/server/
   project is deleted, its credentials are revoked in the SAME
   retirement step (retirement packet includes a revocation line
   per asset) - never before the export, never after a delay.
3. Environment ISOLATION plan: one credential never spans staging
   and any future production (already policy); n8n credentials
   never shared with Preston OS - any ported automation gets NEW
   scoped credentials at its integration gate.
4. Webhook HARDENING plan: packet C lists all public webhook
   paths; any webhook kept alive gets secret-token validation
   (the OS Telegram receiver pattern) or is disabled at the
   owner gate.
5. BACKUP plan: n8n DB volume snapshot before any change
   (packet E); paused Supabase projects exported before any
   decision (packet D - time-sensitive); Hetzner snapshots
   before quarantine; preston-os-staging backup tier confirmed
   (packet F).
