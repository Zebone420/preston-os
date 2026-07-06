# Phase 1B - LIVE Read-Only Google OAuth Gate Plan (RED)

Status: PLAN ONLY. This document does not authorize activation. Opening this
gate is a RED action requiring explicit, separate owner approval. Phase 1A
(mock-only adapters, fail-closed) is complete at commit d47908e.

## Classification

- Action class: RED (first live external connector, read-only).
- Scope: LIVE read-only Google Workspace access - Gmail and Calendar reads only.
- Explicitly out of scope (remain HARD NO in this gate): any send, any write,
  Drive, Maps, SMS, WhatsApp, n8n activation, production Supabase, autonomous
  or remote runner.

## RED gate requirements (all must hold before activation)

1. Explicit owner approval naming this gate and its scope. A Phase 1A blanket
   YES does not cover it.
2. Internal Google OAuth app, read-only scopes ONLY:
   - https://www.googleapis.com/auth/gmail.readonly
   - https://www.googleapis.com/auth/calendar.readonly
   No send, compose, modify, or Drive scopes are requested.
3. Consent limited to the owner's own Workspace account. No client, vendor, or
   employee mailboxes.
4. All eight emergency shutoff flags present and fail-closed in every
   environment before the first live read (per EMERGENCY_SHUTOFF_SPEC v1).
5. assertNoSend remains active; no send path is reachable. Calendar and Drive
   writes remain blocked.
6. Injection-defense doc reviewed against real message shapes; every external
   field still passes through neutralizeUntrusted before any LLM or UI use.

## Owner approval requirements

- Owner confirms: the read-only scopes above, the single-account consent, the
  secret-storage location, and the exact commit that flips the enable flag.
- Flipping GOOGLE_READONLY_LIVE_ENABLED to true is itself a RED action and is
  done by the owner in the deploy environment, not committed to the repo.

## Secret storage boundary

- Client ID, client secret, and refresh/access tokens live ONLY in the deploy
  secret store (Vercel env / owner .env outside the repo) and Google Cloud.
- The repo holds env var NAMES only (already in env.template). No values, no
  tokens, no client secrets are ever committed or pasted into chat.

## Mock-to-live transition checklist

1. Provision the internal OAuth app with the two read-only scopes.
2. Store credentials in the deploy secret store (never the repo).
3. Implement a live read path behind the SAME adapter interface
   (GoogleReadResult) so callers do not change; source flips 'mock' ->
   'google_readonly'.
4. Keep guardLive: live returns only when config is present AND
   GOOGLE_READONLY_LIVE_ENABLED === 'true'; otherwise mock.
5. Neutralize every external field on the live path exactly as the mock path.
6. Owner sets the enable flag in staging only; verify against the owner's own
   account.
7. No production flip until staging read-only is validated and reviewed.

## Validation plan

- Unit: adapter returns mock when the flag is off; blocks writes and sends;
  neutralizes external text. (Already green in Phase 1A.)
- Integration (staging, owner account): a read returns real Gmail/Calendar
  summaries with source 'google_readonly'; every field is neutralized; no
  write/send path is exercised.
- Security: injection-defense review with adversarial subject/body/title
  fixtures; confirm no external text is ever treated as an instruction.
- Scans: secret scan and RED boundary scan clean; no secrets in repo or logs.

## Rollback / kill-switch

- Set GOOGLE_READONLY_LIVE_ENABLED to anything but 'true' (or unset) -> adapter
  falls back to mock instantly (fail-closed).
- Set DISABLE_ALL_AI_WRITES=true as master kill.
- Revoke the Google OAuth app / tokens in Google Cloud to cut read access.
- Clear the deploy env values to force mock mode.
- git revert the live-path commit.

## Stop conditions (halt and ask the owner)

- Any request for a scope beyond the two read-only scopes.
- Any need to read a non-owner mailbox or calendar.
- Any credential that would land in the repo or chat.
- Any send/write/activation path becoming reachable.
- Any scan finding, or any external text reaching an instruction surface.
- Any production flip before staging validation.

## Exit criteria

- Staging read-only reads validated on the owner account behind owner login.
- Injection-defense review passed against real shapes.
- All boundaries (send/write/Drive/Maps/prod/n8n) still enforced.
- A later separate checkpoint decides on any production enablement.
