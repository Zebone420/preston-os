# Phase 1B Stage 3 - Live Read-Only Google Path (RED build) Report

Date: 2026-07-07. Repo C:\dev\preston-os, branch master, built on HEAD 7fb91a1.
Owner-approved RED build. Live read-only Gmail/Calendar code exists but stays
FAIL-CLOSED. No real Google call runs in tests or CI. No secrets. No production.
Staged, not committed.

## Result: PASS (local build; owner performs live activation at Stage 4)

## Scope honored (owner approval)

- Live read-only Gmail/Calendar path behind fail-closed guards. DONE.
- GOOGLE_READONLY_LIVE_ENABLED remains the activation gate. DONE.
- Missing config fails closed (throws). DONE + tested.
- Flag off keeps mock mode. DONE + tested.
- All external Google content neutralized. DONE + tested.
- Gmail send blocked; Calendar write blocked; Drive/Maps absent. DONE.
- Tests use injected mocks only; no real Google calls. DONE.
- No OAuth consent run by the AI; no refresh-token handling by the AI. HELD
  (callback route is a fail-closed scaffold; live path uses a pre-provisioned
  access token the OWNER sets at Stage 4).
- No production, no n8n, no remote runner. HELD.

## What was built

- apps/dashboard/src/lib/google.ts
  - getGmailSummary / getCalendarSummary are now async.
  - Flag off (GOOGLE_READONLY_LIVE_ENABLED !== 'true') -> source 'mock'.
  - Flag on -> uses an injectable GoogleReadClient; default client calls
    READ-ONLY REST endpoints with a bearer access token from env. Missing
    token or non-readonly scopes -> GuardError (fail closed).
  - Every external field neutralized (from/subject/snippet, title/location).
  - sendGmail / writeCalendarEvent still throw.
- apps/dashboard/src/app/api/google/oauth/callback/route.ts (NEW)
  - Fail-closed scaffold; resolves the redirect URI; performs NO token
    exchange and NO consent (503 setup-mode). Owner completes at Stage 4.
- apps/dashboard/src/lib/daily-brief.ts + brief/page.tsx
  - Updated to await the now-async adapter; behavior unchanged (mock when flag
    off; a live request without a token fails safe to a 'blocked' section).
- env.template: added GOOGLE_OAUTH_ACCESS_TOKEN (NAME only; owner sets value in
  Vercel at Stage 4; the AI never sets it).

## Tests (all passing)

dashboard 75, guards 25 (100% pass):
- mock mode: flag off -> mock; non-exact flag values stay mock.
- fail-closed: flag on + no token -> throws; non-readonly scopes -> throws.
- live path: flag on + injected client -> google_readonly, fields neutralized;
  default client uses INJECTED fetch (no real network) with a bearer token and
  hits only read-only endpoints; a non-ok response throws (no silent mock).
- send/write: sendGmail + writeCalendarEvent throw.
- daily brief: mock sources; neutralization; drafts require approval; live
  request without token fails safe to blocked.

## Validations run

- dashboard vitest 75/75; guards vitest 25/25; tsc --noEmit dashboard=0.
- secret scan 0; RED boundary scan 0.
- No real Google request in any test (client/fetch injected).

## Boundaries held

Read-only only. No send/write/Drive/Maps. No production, n8n, or remote runner.
No secrets in repo/chat/logs (env.template holds NAMES only; test token is an
obvious non-secret fixture). No OAuth consent or refresh-token handling by the
AI. No live Google call. No commit/push by the AI without owner approval.

## Owner-run next (Stage 4, RED)

1. Perform the OAuth consent on the owner account (read-only scopes) and obtain
   an access token; store it as GOOGLE_OAUTH_ACCESS_TOKEN in Vercel staging.
2. Set GOOGLE_READONLY_LIVE_ENABLED=true in Vercel STAGING (owner only).
3. Validate a real read-only Gmail/Calendar summary on the owner account behind
   owner login; confirm neutralization and that no send/write path is reachable.
4. Return the Stage 3/4 activation attestation.

The AI does not set the flag, handle the token, or run the consent.
