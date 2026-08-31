# Supervisor Bridge Staging Validation - 2026-08-31

Milestone: declare Supervisor Bridge slice 1 (36dbcc1) ready for production
promotion and Hermes integration.

Result: **BLOCKED at the ChatGPT bridge proof** by a staging OAuth
client-credential failure that requires an owner secret rotation. Everything
before that gate is GREEN and stands.

## Phase 1 - Re-audit (PASS)

- Branch `feature/supervisor-bridge`, HEAD 36dbcc1; origin/master f9747d7.
- Diff origin/master..HEAD = exactly the slice-1 commit: 11 files,
  +1000/-11. No migrations, no RLS change, no env/deploy config, no
  secrets, no worker-authority change.
- Poll path (`prestonPollEvents`, `/api/control/events` GET) verified
  write-free; the only new write is the idempotent `GoalSubmitRejected`
  os_events append on the already-authenticated submit path (static codes +
  request id only). OpenAPI marks `pollPrestonEvents`
  `x-openai-isConsequential: false`; MCP annotations readOnlyHint true.
- Focused suites (preston-control-supervisor / bridge-acceptance / gpt):
  43/43 pass.
- Full regression minus worktree-prep: 128 files, 1733 pass, 1 expected
  fail. tsc 0 errors; eslint 0; `next build` clean; os-runtime build clean.
- No repairs needed; no repair commit exists.

## Phase 2 - Staging deployment (PASS)

- Promoted the existing preview build of 36dbcc1 in Vercel project
  preston-os-staging to its Production alias.
  Deployment `H1UHwst7sP66itPBPjHv7NGXzrUC` (build 34s, Ready), alias
  `preston-os-staging.vercel.app`, source `feature/preston-control`
  @ 36dbcc1. Production project untouched (still master f9747d7 /
  earlier promotion); no env, no migration, no RLS, no secret changes.
- Live verification (unauthenticated, read-only):
  - `/api/health` 200 `{"ok":true,"mode":"connected"}`
  - `/api/control/status` 401; `/api/control/events` 401 (auth precedes
    cursor parsing); `/api/control/events?cursor=garbage` 401
  - `/mcp` GET 401, POST 401 `missing_token`
  - `/api/control/openapi.json`: exactly **11 operations**;
    `pollPrestonEvents` present, non-consequential; only
    `cancelPrestonGoal` + `decidePrestonApproval` consequential.

## Phase 3 - Staging connector diagnosis (BLOCKED - owner action)

Symptom: connector "Preston Control MCP - Staging Clean" fails
account-connection ("We couldn't connect your account"); fresh-chat tool
calls fail `ConnectorClientError: 400`; chat-level catalogue shows the
stale 10-tool set (account-level catalogue does show all 11 including
`preston_poll_events`, so tool discovery against 36dbcc1 succeeded).

Evidence chain (read-only, staging Supabase auth logs):
- `/oauth/token` succeeded (INFO) through **Aug 28 18:14 UTC** (working
  drills era). Every call from **Aug 30 17:03 UTC** onward is a WARNING:
  status 400, error `invalid client credentials`, error_code
  `invalid_credentials`.
- The authorize + consent legs still complete (authorize INFO ->
  /oauth/authorizations/<id> INFO -> token 400), ruling out
  redirect_uri mismatch and consent failure.
- No config change on either side in the failure window: OAuth apps
  created Aug 20 (both present: "Preston Control GPT (staging)"
  7f83970f-..., "Preston Control MCP (staging)" c1680204-...); staging web
  unchanged Aug 28-31; secrets untouched.
- Supabase has an unresolved incident ("401 errors due to JWT
  rejections", API Gateway degraded; us-east-1 not yet in the applied-fix
  region list; staging project showed 1,572 Postgres errors/24h). Vendor
  remediation "restart project" was executed on the STAGING project
  (services healthy again afterward; app /api/health 200 connected) but
  the token exchange still fails identically -> restart eliminated the
  transient-incident hypothesis.

Conclusion: token-exchange failure from a client-secret verification
mismatch on the staging Supabase OAuth client (most plausibly a GoTrue
2.195.0 upgrade regression in secret verification from the incident
window; the auth-service version changed in exactly that window). The fix
requires generating a new client secret and entering it in the ChatGPT
connector - **owner-only secret rotation**. Stopped per gate rules; no
connector was deleted or rebuilt; no secrets were viewed, printed, or
entered.

## Owner action required (minimum)

1. Supabase dashboard -> project `preston-os-staging` -> Authentication ->
   OAuth Apps -> "Preston Control MCP (staging)" -> regenerate the client
   secret.
2. ChatGPT -> Settings -> Plugins -> "Preston Control MCP - Staging
   Clean" -> update the connector's client secret with the new value ->
   Reconnect.
3. Say the word; the agent then re-runs the fresh-chat 11-op bridge proof,
   cursor/replay proof, and the end-to-end staging drill (Phases 4-6).

Note: if the same failure exists on the PROD connector (same GoTrue
version on prod project), the prod MCP connector will hit the identical
error on its next token refresh; check after staging is proven.

## Phase 6 preview - promotion diff (prepared, not executed)

- Promotion content: master f9747d7 + exactly 36dbcc1 (fast-forward-able
  via `feature/supervisor-bridge`). Production needs **code deployment
  only**: no env change, no migration, no RLS change, no secret change,
  no host restart/repin required for the poll surface (the events feed is
  web-only; the runtime host does not serve it).
- DO NOT promote until the staging ChatGPT bridge proof passes.

## Authority delta

- New write authority: none (one idempotent os_events append on the
  existing authenticated submit-rejection path; os_events is append-only,
  owner-RLS).
- Worker authority: unchanged. Migrations: none. RLS: unchanged.
- Secrets: none viewed/changed. Production: untouched.
- Staging infra action taken: one Supabase project restart
  (vendor-recommended incident remediation; staging only).
