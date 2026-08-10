# SSOT B2 - Actor Registry Owner Packet

Status: DRAFT. Migration 0012 is NOT applied. Applying it is an
owner-only action. Nothing activates when it is applied: every actor
row starts disabled with an empty token hash, and no surface consumes
the registry until SSOT B3 ships behind its own disabled flag.

Design: docs/PRESTON_CENTRAL_SSOT_DESIGN_v1.md (sections 4, 11).
Migration: supabase/migrations/0012_ssot_actor_registry.sql

## What this adds (and what it does not)

Adds:
- actor_registry table (owner-only RLS, anon fully revoked, no
  delete grant) holding one row per remote actor with a sha256
  token hash (0011 idiom; extensions.digest per cf62fdb lesson).
- resolve_ssot_actor(token) SECURITY DEFINER fn: answers which
  ENABLED actor presented a token and stamps last_seen_at.

Does NOT add:
- any read or write capability for any actor
- any route, flag, or service
- any change to approvals, execution, RLS posture, or intake

## Owner apply steps (staging SQL editor)

1. Paste supabase/migrations/0012_ssot_actor_registry.sql and run.
2. Verification SQL (expect the noted results):

   -- table exists with RLS enabled (expect rowsecurity = true)
   select relname, relrowsecurity from pg_class
     where relname = 'actor_registry';

   -- anon has zero privileges on the table (expect 0 rows)
   select privilege_type from information_schema.table_privileges
     where table_name = 'actor_registry' and grantee = 'anon';

   -- delete is not granted to authenticated (expect 0 rows)
   select privilege_type from information_schema.table_privileges
     where table_name = 'actor_registry'
       and grantee = 'authenticated' and privilege_type = 'DELETE';

   -- resolver refuses an empty/unknown token (expect forbidden)
   select public.resolve_ssot_actor('');
   select public.resolve_ssot_actor('not-a-real-token');

3. Do NOT seed actor rows in this gate. Token minting/enabling per
   actor is SSOT B5 (its own packet, one actor at a time).

## Rollback

The migration is additive. To back it out entirely:

   drop function if exists public.resolve_ssot_actor(text);
   drop table if exists actor_registry;

(Repo history keeps the file; re-applying is one paste.)

## Gate report fields

- Production touched: false (staging only)
- Secrets exposed: false (hashes only; no token values exist yet)
- Live messages/emails sent: false
- Next gate: SSOT B3 (status read gateway + route, disabled flag)
