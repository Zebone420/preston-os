# PRESTON AI EMERGENCY SHUTOFF SPEC v1

Status: Phase 0A document. All flags must exist before any live connector
is configured.

## The Eight Flags

| Variable | Blocks |
|---|---|
| DISABLE_ALL_AI_WRITES | Every write path of any kind (master kill) |
| DISABLE_CLIENT_MESSAGES | Any client-facing message in any channel |
| DISABLE_EMAIL_SEND | Gmail/SMTP send (drafts still allowed) |
| DISABLE_CALENDAR_WRITES | Calendar event creation or modification |
| DISABLE_AIRTABLE_PROD_WRITES | Writes to any production Airtable base |
| DISABLE_N8N_ACTIVATION | Setting any n8n workflow active |
| DISABLE_REMOTE_RUNNER | Stage 5C remote runner invocation |
| DISABLE_PRODUCTION_DEPLOY | Any production deploy |

## Semantics (binding)

1. Set in every environment (local .env, Vercel, Hetzner, n8n) from
   Gate 0A-5 onward. Default value: true (blocked).
2. Fail-closed: a missing or unparseable flag is treated as true (blocked).
   Absence of configuration can never enable an action.
3. Checked at the top of the Command Gateway pipeline AND inside every
   guard. No caller reaches a send or write code path without passing both.
4. Flipping any flag to false is itself a RED action requiring the
   corresponding owner-approved phase gate.
5. The dashboard Safety card (Phase 0B optional) displays live flag values.
6. Only the string value false (case-insensitive) unblocks. Any other
   value, including empty, blocks.

## Owner Kill Procedure

1. Set DISABLE_ALL_AI_WRITES=true in Vercel, Hetzner, and n8n.
2. Rotate any credential suspected of exposure.
3. Review reports/ and the audit_log table.
4. Re-enable flags one at a time only after review.

This procedure never requires the AI's cooperation.
