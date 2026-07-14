# Phase 1B Stage 9 - Durable Read-Only Google OAuth Activation Packet

Status: OWNER-RUN packet. Documentation and instructions ONLY. The AI did
NOT run any OAuth consent, did NOT create/exchange/handle any token, and did
NOT set any env value. The durable read-only code path is implemented and
fail-closed (commit f39d947); this packet is the owner-run activation.

Goal: end the ~1-hour manual access-token re-mint. The app will mint fresh
read-only access tokens automatically from a stored refresh token. Read-only
only; Preview only; no send/write scopes; no production.

## 0. Hard-stop safety rules

- Read-only scopes ONLY: gmail.readonly + calendar.readonly. Never add send,
  modify, or write scopes.
- Preview environment only. Do not touch Production.
- The refresh token is a SECRET: it goes ONLY into Vercel Preview env, never
  into chat, the repo, or any doc.
- Do NOT paste any token value into chat. The AI never sees it.
- If unsure whether a scope is read-only, STOP and confirm before consenting.

## 1. What the code does (implemented, fail-closed)

- apps/dashboard/src/lib/google.ts acquireAccessToken(): if
  GOOGLE_OAUTH_ACCESS_TOKEN is set it is used (legacy path, still supported);
  otherwise, if GOOGLE_OAUTH_REFRESH_TOKEN + GOOGLE_OAUTH_CLIENT_ID +
  GOOGLE_OAUTH_CLIENT_SECRET are present, the app POSTs the token endpoint
  with grant_type=refresh_token to mint a fresh read-only access token.
- Fail-closed: missing/invalid config throws; a revoked/expired refresh token
  yields "refresh-token exchange failed ... (reconnect required)". No secret
  is ever logged; errors carry only an HTTP status.
- googleConfigStatus() reports presence-only mode (disabled / access_token /
  refresh_token / misconfigured); it is shown on the /brief header
  ("google: refresh_token") with no secret value.
- Read-only endpoints only; sendGmail/writeCalendarEvent remain hard-blocked.

## 2. Owner steps - obtain a read-only refresh token

Use the client id/secret already registered for staging (Stage 4). Two safe
options; pick one.

Option A - Google OAuth Playground (quickest):
- [ ] Open https://developers.google.com/oauthplayground
- [ ] Gear (top right) -> "Use your own OAuth credentials" -> paste the
      staging client id + secret (in the Playground UI, not in chat).
- [ ] In the scope list authorize EXACTLY:
      https://www.googleapis.com/auth/gmail.readonly
      https://www.googleapis.com/auth/calendar.readonly
- [ ] "Authorize APIs", consent as the owner account.
- [ ] "Exchange authorization code for tokens" -> copy the REFRESH token.
      (Ensure the OAuth client is allowed to use the Playground redirect, or
      use Option B.)

Option B - one-time consent on the app's own client:
- [ ] Build the consent URL with access_type=offline and prompt=consent and
      the two readonly scopes, redirect to the registered
      GOOGLE_OAUTH_REDIRECT_URI, consent as owner, exchange the code for
      tokens out-of-band, and keep the refresh_token.

## 3. Owner steps - set Vercel Preview env (Preview only)

In Vercel -> preston-os-staging -> Settings -> Environment Variables
(Preview scope only; none NEXT_PUBLIC_):
- [ ] GOOGLE_OAUTH_REFRESH_TOKEN = the refresh token from step 2
- [ ] GOOGLE_OAUTH_CLIENT_ID     = staging client id (should already be set)
- [ ] GOOGLE_OAUTH_CLIENT_SECRET = staging client secret (should already be set)
- [ ] GOOGLE_WORKSPACE_READONLY_SCOPES contains "readonly" (already set)
- [ ] GOOGLE_READONLY_LIVE_ENABLED = true (already set)
- [ ] REMOVE or clear GOOGLE_OAUTH_ACCESS_TOKEN. IMPORTANT: the explicit
      access token WINS if present, so leaving a stale one set keeps the app
      on the old ~1h path. Clear it to activate the durable refresh path.

Then redeploy Preview with build cache unchecked.

## 4. Verification

- [ ] /brief header shows: google: refresh_token
- [ ] Inbox summary shows (google_readonly) with real messages.
- [ ] Today's appointments shows (google_readonly).
- [ ] Wait > 1 hour and reload /brief: it STILL shows google_readonly (no
      401), proving auto-mint works (the old access-token path would 401 by
      now).

## 5. Rollback

- Fastest: set a fresh GOOGLE_OAUTH_ACCESS_TOKEN again (it takes precedence),
  redeploy - back to the legacy path.
- Or remove GOOGLE_OAUTH_REFRESH_TOKEN: the path fails closed to a blocked
  read (no data leak), /brief header shows "misconfigured".
- No database or production change is involved.

## 6. Revocation handling

If the owner revokes the app's access in their Google account, the next mint
returns "refresh-token exchange failed ... (reconnect required)" and /brief
shows the sections blocked. Reconnect by minting a new refresh token
(step 2) and updating the Preview var.

## 7. Statement of non-execution

The AI did NOT run consent, did NOT create/exchange/read any token, did NOT
set any env value, and handled no secret. All steps above are owner-run
against Preview only. Code is implemented and fail-closed; it activates only
when the owner provisions the refresh-token config.

## 8. Note on production / remote-live

This durable staging path is still owner-account, Preview-only. A production
or laptop-closed remote path would use a dedicated least-privilege identity
and encrypted server-side storage - out of scope here; see the remote-live
readiness section of PRESTON_OS_ACTIVATION_READINESS_v1.md.
