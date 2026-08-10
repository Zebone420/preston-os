# SSOT B3+B4 Migrations Owner Packet (0013 + 0014)

Status: DRAFT. Neither migration is applied. Applying is owner-only.
Nothing activates on apply: the /api/os/ssot/status route stays 503
until SSOT_STATUS_ENABLED=true (a separate Vercel env gate), and every
actor row stays disabled with an empty hash until SSOT B5 mints one.

Apply ORDER (staging SQL editor, one file at a time):
  1. 0012_ssot_actor_registry.sql
     (see reports/SSOT_B2_ACTOR_REGISTRY_OWNER_PACKET.md)
  2. 0013_ssot_status_gateway.sql
  3. 0014_ssot_actor_stamping.sql

## 0013 - canonical status read gateway

Adds read_ssot_status(token): SECURITY DEFINER, SELECT-only, auth
delegated to resolve_ssot_actor, bounded canonical projection
(posture, goals, jobs + evidence refs, approvals, latest Hermes
status, recent intake). Never returns token hashes.

Verification SQL after apply:

   -- unknown token refused (expect forbidden)
   select public.read_ssot_status('not-a-real-token');

## 0014 - authenticated actor stamping on remote intake

Adds nullable remote_intake_requests.actor_id and replaces
submit_remote_intake: legacy global-token leg unchanged; a bearer
token resolving to an ENABLED actor is accepted and stamped. With all
actors disabled (current state) behavior is identical to 0011.

Verification SQL after apply:

   -- column exists (expect 1 row)
   select column_name from information_schema.columns
     where table_name = 'remote_intake_requests'
       and column_name = 'actor_id';

   -- unknown token still refused (expect forbidden)
   select public.submit_remote_intake(
     'not-a-real-token', 'req-verify-0014', 'info@preston.nyc',
     'verification probe', 'api');

   -- global token path: re-run any prior authenticated status check
   -- from the phone flow; behavior must be unchanged.

## Rollback

Both are additive. To back out:

   -- 0014: restore the 0011 fn body by re-running the
   -- create or replace function block from 0011 (lines 79-142), then:
   alter table remote_intake_requests drop column if exists actor_id;
   -- 0013:
   drop function if exists public.read_ssot_status(text);

## Gate report fields

- Production touched: false (staging only)
- Secrets exposed: false
- Live messages/emails sent: false
- Next gate: SSOT B5 (per-actor token minting, one actor at a time)
