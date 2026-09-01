# Hermes Native - Production Promotion Owner Packet (v1)

Status: PREPARED ONLY. Nothing in this packet has been executed.
Scope: promote the native Hermes read-only Preston link from
staging (verified 2026-09-01) to production. Every step below is
owner-gated; the packet grants no authority by itself.

Baseline facts at packet time:
- feature/hermes-native pushed; remote tip d67e87e (contains
  278bc99 hermes auth surface + d67e87e durable link client).
- Remote master = 10e54e0 (does NOT contain the hermes surface).
- Staging live-link proof: reports and session evidence of
  2026-09-01 (7 reads 200, 4 writes 403 wrong_client, rotation
  captured, fail-closed drills, UI verified at 127.0.0.1:9119).
- Production Vercel project preston-os-prod untouched. No prod
  OAuth client, env, Site URL, or bootstrap work has been done.

## 1. Dedicated production Hermes OAuth client (owner creates)

Requirements (mirror of the staging client, separate everywhere):
- Auth project: the PRODUCTION auth project that backs
  preston-os-prod (NOT the staging project).
- Name: Preston Control - Hermes Production
- Client type: Confidential (Public Client toggle OFF).
- Token endpoint auth method: client_secret_basic.
- Redirect URI: http://127.0.0.1:9127/callback (RFC 8252
  loopback; bootstrap runs on the dashboard host only).
- Dedicated to Hermes production. Never reuse the staging hermes
  client, the MCP client, or the GPT client (either environment).
- Secret goes to 1Password only. Never in chat, repo, or logs.
- Record (non-secret): client id, created date, auth method.

## 2. Production Site URL / redirect checks (MANDATORY)

Root-cause lesson from staging: the auth server Site URL decides
WHERE /oauth/consent renders. A stale URL silently sends consent
to an old deployment and consent fails client_not_allowed.

Owner verifies in the PRODUCTION auth project before bootstrap:
- Auth > URL Configuration > Site URL == the canonical prod app
  origin (the stable production alias, never a git preview URL).
- OAuth Server > Authorization Path == /oauth/consent.
- Preview Authorization URL shown by the dashboard == canonical
  prod origin + /oauth/consent.
- Redirect URLs allowlist rows use the canonical prod origin.
- The prod deployment serving that origin includes the hermes
  surface code (master must contain 278bc99; see section 9).

## 3. Production environment/config entries (NAMES ONLY)

Vercel preston-os-prod (Production scope, Config type):
- PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID  (prod client id; this
  is non-secret but must be the PROD value, never staging)

Hermes dashboard host (server-side only, never the browser):
- HERMES_PRESTON_CONTROL_URL          (canonical prod app origin)
- HERMES_PRESTON_OAUTH_TOKEN_URL      (prod auth project
                                       /auth/v1/oauth/token)
- HERMES_PRESTON_OAUTH_CLIENT_ID      (prod hermes client id)
- HERMES_PRESTON_OAUTH_CLIENT_SECRET  (secret; owner-entered)
- HERMES_PRESTON_TOKEN_STORE          (a PROD-dedicated store
  path, e.g. hermes\preston-link\token-store.prod.json - never
  the staging store file)

Notes:
- No secret values in this packet, in chat, or in the repo.
- If one dashboard host serves both environments, the two store
  paths and env sets must stay disjoint. Simplest safe posture:
  one environment linked per dashboard process at a time.

## 4. Fresh production bootstrap sequence (owner-run)

1. Confirm section 2 checks all pass.
2. Confirm PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID is set in
   preston-os-prod and the prod deployment was rebuilt after.
3. On the dashboard host, in the owner terminal, set the five
   HERMES_PRESTON_* values for PROD (secret via hidden prompt),
   with HERMES_PRESTON_TOKEN_STORE at the prod-dedicated path.
4. Run: python tools/link_bootstrap.py
   - The script refuses to overwrite an existing store.
   - It prints an authorize URL; open it in the browser session
     signed in to the PROD app as the owner; approve consent.
   - Success prints only the store path. Tokens never print.
5. Restart the Hermes dashboard with the prod env loaded.

## 5. Expected read-only authority boundary (unchanged)

- The prod hermes client is valid ONLY for the seven read routes
  (status, goal, job, approvals, events, evidence, artifact) via
  http.ts READ_SURFACES; submit, follow-up, decision, and cancel
  refuse it as wrong_client by construction.
- No MCP/GPT surface change. Per-surface revocation: deleting the
  prod hermes client severs only the Hermes link.
- Plugin backend remains GET-only, op-allowlisted, stdlib-only;
  frontend calls only /api/plugins/preston-supervisor/*.
- No owner-confirmation capability, no approval or cancel
  authority, no direct Claude/Codex calls, no second engine.

## 6. Fail-closed checks (run after bootstrap)

- Unset/rename the prod store (probe copy only): UI must show the
  static token_store_missing state with zero data, zero
  notifications; restore and confirm recovery with cursor intact.
- Malformed store copy: token_store_malformed.
- Wrong token URL (isolated env): token_refresh_refused or
  token_endpoint_unreachable.
- Invalid access token: one bounded forced-refresh retry, then
  preston_auth_failed 401. Never a fallback credential.
- Consent page with the client id env removed from a PREVIEW
  deployment: client_not_allowed (proves the registry gate).

## 7. Rollback procedure

Any one of these fully severs the prod link (no code rollback
needed for the link itself):
- Delete or disable the prod Hermes OAuth client in the auth
  dashboard (revokes the whole session family), and/or
- Remove PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID from
  preston-os-prod env and redeploy (surface unconfigured), and/or
- Delete the prod token store file and stop the dashboard.
App rollback (if the promoted deployment itself misbehaves):
Vercel instant rollback on preston-os-prod to the prior Ready
production deployment. MCP/GPT surfaces are untouched by all of
the above.

## 8. Post-promotion validation matrix

- /api/health on prod origin = 200.
- Live probe (prod token): 7 reads 200; submit, follow-up,
  decision, cancel = 403 wrong_client.
- Forced refresh: rotation captured (hash prefix change), store
  ready, subsequent read OK.
- /preston UI: env badge = production posture as reported by
  prod status; metrics match prod control-plane facts; approvals
  display-only; feed LIVE; artifact signed URL works, 300s,
  never stored; notifications in-dashboard only.
- Staging regression: staging link still works afterward.
- Repo matrix unchanged: dashboard + plugin suites green, tsc,
  lint, builds, secret + RED scans 0/0.

## 9. Exact owner-gated actions (in order)

G-1 Approve and perform merge of feature/hermes-native (tip
    d67e87e) into master, and push master. RED-class: master is
    the production code line.
G-2 Deploy/promote the new master on preston-os-prod (Vercel).
G-3 Create the prod Hermes OAuth client (section 1); store the
    secret in 1Password.
G-4 Set PRESTON_CONTROL_HERMES_OAUTH_CLIENT_ID on
    preston-os-prod; rebuild/redeploy.
G-5 Verify prod Site URL / consent checks (section 2).
G-6 Run the prod bootstrap (section 4).
G-7 Approve the post-promotion validation run (section 8) and
    the fail-closed drills (section 6).
G-8 Close the gate with a structured report; only then declare
    the prod link live.

## 10. Explicit not-yet-occurred confirmations

As of this packet: NO merge to master, NO production deployment,
NO production OAuth client created or modified, NO production
environment change, NO production bootstrap, NO production Site
URL change. Production remains exactly as before this gate.
