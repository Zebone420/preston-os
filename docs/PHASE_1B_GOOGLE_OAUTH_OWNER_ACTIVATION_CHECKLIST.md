# Phase 1B - Google OAuth Owner Activation Checklist (READINESS ONLY)

Status: READINESS doc. This checklist does NOT activate anything. It lists the
exact owner-run steps for a FUTURE, separately-approved activation subgate.
No credential, secret, or env value belongs in this file, in the repo, or in
chat. Companion docs: PHASE_1B_LIVE_READONLY_GOOGLE_OAUTH_GATE_PLAN.md,
PHASE_1A_EXTERNAL_CONTENT_INJECTION_DEFENSE.md, PRESTON_AI_SECRETS_POLICY_v1.md.

Scope of any eventual activation: LIVE read-only Gmail + Calendar, owner's own
Workspace account, staging only. Everything else stays HARD NO (see boundaries).

## A. Owner manual steps (no secrets; the owner performs these outside the repo)

1. In Google Cloud Console, create/select an internal project for Preston AI.
2. Configure the OAuth consent screen as Internal (owner's Workspace org only).
3. Add ONLY these read-only scopes:
   - https://www.googleapis.com/auth/gmail.readonly
   - https://www.googleapis.com/auth/calendar.readonly
4. Create an OAuth 2.0 Client ID (Web application).
5. Set the authorized redirect URI to the staging callback (see section E).
6. Store the Client ID and Client Secret in the deploy secret store only
   (Vercel env for staging). Never paste them into the repo or into chat.
7. Do NOT enable the live flag yet. Activation is a separate approval (sec. K).

The owner performs all of the above. The AI never creates the app, never sees
the secret, and never performs the consent flow.

## B. Required Google Cloud / Workspace items

- A Google Cloud project (internal).
- OAuth consent screen: Internal, owner org.
- OAuth 2.0 Web Client (Client ID + Client Secret).
- Read-only Gmail + Calendar APIs enabled on the project.
- Owner Workspace account to grant consent (single account only).

## C. OAuth app boundary

- Internal app, owner org only. No external/public users.
- No client, vendor, or employee mailbox/calendar is ever connected.
- Web application client; server-side token handling only.
- The app requests read-only scopes and nothing else.

## D. Read-only scope boundary (HARD)

- Allowed: gmail.readonly, calendar.readonly.
- Forbidden: any gmail.send / compose / modify / insert scope; any calendar
  write/events scope; any Drive scope; any Maps usage; any admin scope.
- Requesting any non-read-only scope is a STOP condition (section J).

## E. Callback / redirect URI placeholder rule

- The repo/env.template stores the NAME GOOGLE_OAUTH_REDIRECT_URI only, no value.
- The real redirect URI is a staging URL configured in Vercel env and in the
  Google client. Represent it in docs only as a placeholder, e.g.
  https://<staging-host>/api/google/oauth/callback - never a real secret host
  tied to a token. No real callback value is committed.

## F. Secret storage boundary (Vercel / staging)

- Client ID, Client Secret, and any refresh/access token live ONLY in the
  Vercel staging environment (and Google Cloud). Never in the repo, git
  history, logs, error messages, or chat.
- The repo holds env var NAMES only (already in env.template):
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_WORKSPACE_READONLY_SCOPES, GOOGLE_READONLY_LIVE_ENABLED.
- No secret is ever echoed back to the AI. Server-side only (Command Gateway
  principle: credentials load server-side, hidden from prompts and logs).

## G. Standing boundaries (remain enforced during and after activation)

- No Gmail send (assertNoSend blocks all send channels).
- No Calendar write / event create or modify.
- No Drive read or write.
- No Maps usage.
- No n8n activation. No production. No autonomous/remote runner.
- No real client/vendor/employee data - owner's own account only.

## H. Rollback steps (instant fallback to safe)

1. Set GOOGLE_READONLY_LIVE_ENABLED to anything but the exact string 'true'
   (or unset it) in Vercel -> adapter returns MOCK immediately (fail-closed).
2. Clear the Google env values in Vercel -> mock mode.
3. Revoke the OAuth client / tokens in Google Cloud -> live read access cut.
4. git revert the commit that introduced the live read path.

## I. Emergency shutoff steps

- Set DISABLE_ALL_AI_WRITES=true (master kill) in every environment.
- The eight shutoff flags are fail-closed: missing/unparseable = blocked.
- Owner Kill Procedure (EMERGENCY_SHUTOFF_SPEC v1) needs no AI cooperation:
  flip the flag in Vercel, rotate any suspected credential, review audit_log.

## J. Validation steps (before the owner flips the flag)

- Local: guards + dashboard test suites green, including the Phase 1B Stage 1
  fail-safe tests (missing env -> mock; config without flag -> mock; non-exact
  flag values never enable live; send/write stubs throw).
- Typecheck: tsc --noEmit clean for guards and dashboard.
- Scans: secret scan and RED boundary scan = 0 findings.
- Confirm env.template still lists NAMES only, no values.

## K. Stop conditions (halt and ask the owner)

- Any real credential, secret, token, or .env value would be needed by the AI.
- Any scope beyond the two read-only scopes is requested.
- Any non-owner mailbox/calendar, Drive, Maps, send, or write path appears.
- Any production flip, or any flag flip, would be done by the AI rather than
  the owner.
- Any scan finding, or any external text reaching an instruction surface.

## L. Owner approval wording required before activation

Activation does not proceed until the owner provides an explicit statement of
this form (wording may vary but must name scope, account, environment, and the
enable action). Example:

    "I approve Phase 1B activation: live READ-ONLY Gmail and Calendar only,
     scopes gmail.readonly + calendar.readonly, on my own Workspace account,
     in STAGING only. I will set GOOGLE_READONLY_LIVE_ENABLED=true in Vercel
     myself. No send, no write, no Drive, no Maps, no production."

Until that exact-scope approval is given and the owner sets the flag, the
adapter stays mock-only and fail-closed. The AI never sets the flag, never
handles the secret, and never performs the consent flow.
