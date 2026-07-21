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

CORRECTION (2026-07-21, Phase 5 operations audit finding OPS-7): the
deployed staging runtime (systemd worker/Hermes oneshot timers reading
system_controls) does NOT read the eight env flags above. Those flags
bind the dashboard-side approval/guard libraries only. Setting
DISABLE_ALL_AI_WRITES=true does NOT halt the staging runtime.

To kill the DEPLOYED STAGING RUNTIME (authoritative procedure - the
GLOBAL KILL in reports/PHASE_4B1_STAGING_DEPLOYMENT_OWNER_PACKET.md
section 16.4):

1. Supabase STAGING SQL editor (phone or laptop):
       update system_controls set owner_stop=true, paused=true,
         execution_enabled=false, remote_runner_enabled=false,
         hermes_mode='disabled', updated_at=now() where id='global';
2. On the host (when reachable):
       sudo systemctl stop preston-worker.timer preston-hermes-observe.timer
   For a reboot-persistent stop use disable --now instead of stop.
3. Controls fail closed: even if step 2 is unreachable, every firing
   halts on owner_stop/paused (exit 75) and writes nothing new.

For the dashboard/approval surfaces (Vercel), the env flags above still
apply as originally specified:

1. Set DISABLE_ALL_AI_WRITES=true in Vercel (and any future host that
   actually reads the flags).
2. Rotate any credential suspected of exposure.
3. Review reports/ and the audit_log table.
4. Re-enable flags one at a time only after review.

This procedure never requires the AI's cooperation.
