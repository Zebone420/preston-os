# Preston Control PROD Wave 2 - GPT Actions LIVE, Tests A/B PASS (2026-08-25/26)

Log times EDT (UTC-4). Prod alias preston-os-prod.vercel.app @ 53d2c1b
(RC 4cd20d3 artifact). No production data mutated beyond simulation-only
intake; no approval decision made.

## Client B' + env

- Client B' "Preston Control GPT (prod)" created by OWNER:
  03ef39d0-5977-443b-a174-ae814cdfc6cb, Confidential, client_secret_post,
  redirect https://preston-os-prod.vercel.app/oauth/gpt/callback. Secret
  owner-side; owner probe = refresh_token_not_found (active).
- Vercel prod env (Production scope): PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID
  (agent-entered), PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET + _BRIDGE_KEY
  (owner-entered secrets), PRESTON_CONTROL_GPT_CALLBACK_URL (agent-entered
  after a first-attempt miss - initially absent caused unconfigured;
  re-added + redeployed).

## GPT editor repoint (agent) + publish (agent)

- Schema re-imported from prod openapi; action server preston-os-prod.
  OAuth: client id B', authorize/token URLs prod, scope email, POST method.
  Published (Update). aip Callback URL displayed + SURVIVED publish:
  https://chat.openai.com/aip/g-ab244b138bb1114d43be55d82a4fc8b76e261b73/
  oauth/callback (zoom-verified byte-exact; pinned into CALLBACK_URL var).
  Supabase B' needs NO aip redirect - bridge only exposes /oauth/gpt/callback.

## Bridge posture after callback var + redeploy (agent probes)

- bare authorize -> 400 unauthorized_client (was 503 unconfigured).
- valid-client authorize -> 302 to hiqsymsiwonmvrbbqhhe.supabase.co/auth/v1/
  oauth/authorize, client B', redirect prod /oauth/gpt/callback, S256 PKCE,
  signed state. status 401. openapi 200 owner_confirmation present, ZERO
  preston-os-staging refs.

## Live sign-in + Tests A/B (server-verified in Vercel log)

Chain: 20:09:41 GET 302 /oauth/gpt/authorize -> /oauth/consent + /login
(owner) -> 20:09:45 POST 303 /oauth/consent -> 20:09:45-46 GET 302
/oauth/gpt/callback -> 20:09:49 POST 200 /oauth/gpt/token -> 20:10:11
GET 200 /api/control/status (Test A) -> 20:11:08 + 20:11:11 POST 200
/api/control/goals (Test B x2).

- Test A PASS: environment production, posture operating, hermes
  observe_only, open approvals 0, generated_at 2026-08-26T00:10:11.712Z.
- Test B PASS: accepted, goal eab9e8ef-fa45-4259-b843-1e9c4f30feef, job
  493e0105 (approvals_required 0); identical resubmit (request_id
  pc-prodgpt-testb-20260825) -> duplicate, SAME goal id. One SSOT row,
  no approval, no execution.

## Status

Both prod surfaces LIVE and validated: MCP (Wave 1, client A') + GPT
Actions (Wave 2, client B'). G8 owner_confirmation contract live on prod
openapi. Fail-closed proven pre-activation. No staging leakage. Rollback:
PRESTON_CONTROL_ENABLED=false + disable clients A'/B'. Remaining before
golden seal: production Galaxy device drill (owner), then seal.
