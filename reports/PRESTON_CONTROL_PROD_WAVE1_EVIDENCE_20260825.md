# Preston Control PROD Wave 1 - MCP surface LIVE, Tests A/B PASS (2026-08-25)

Phase H authorized by owner ruling ("OWNER AUTHORIZES PHASE H: promote
Preston Control RC 4cd20d3 to production."). Log times EDT (UTC-4).

## Deployment

- master fast-forwarded e17287b -> 53d2c1b (direct descendant; tree = RC
  4cd20d3 source + evidence docs). preston-os-prod auto-built; alias
  preston-os-prod.vercel.app. Pre-activation smokes: health 200; control
  status/openapi/mcp all disabled (fail-closed proof of new code serving).

## Wave 1 activation

- Prod Supabase (hiqsymsiwonmvrbbqhhe) OAuth Server ENABLED by agent:
  Site URL https://preston-os-prod.vercel.app, auth path /oauth/consent,
  dynamic client registration OFF.
- Client A' "Preston Control MCP (prod)" created by OWNER:
  7e935dc7-fd95-49ef-bd6f-fb9352439600, Confidential, client_secret_basic,
  redirects = connector_platform_oauth_redirect + the connector-specific
  https://chatgpt.com/connector/oauth/Wa9cXmKrzpbn (agent-added, verified
  persisted). Secret owner-side only; owner probe returned
  refresh_token_not_found = credentials active.
- Vercel prod env (owner-entered; agent blocked by classifier on prod
  forms): PRESTON_CONTROL_ENABLED=true + PRESTON_CONTROL_OAUTH_CLIENT_ID,
  Production scope; redeployed.
- Enablement smokes (agent): health 200; PRM 200 with resource=prod /mcp +
  AS hiqsymsiwonmvrbbqhhe.supabase.co/auth/v1 (no staging leakage);
  /mcp 401 + RFC-9728 challenge; GPT surface still fail-closed
  (status 503 unconfigured, openapi 404 disabled, gpt/authorize 404).

## Connector + handshake (server-verified)

- Failed token exchanges 18:48/18:50 (connector-specific callback not yet
  registered) -> agent registered the callback -> INFO /oauth/token
  19:13:59. Vercel: consent 19:13:50-58 (owner login), then POST /mcp
  200 initialize, 202 notifications/initialized, 200 tools/list at
  19:14:01-02. Connector "Preston Control MCP - Prod" Connected,
  identity info@preston.nyc, URL prod /mcp, decide tool discovered with
  G8 owner_confirmation schema.

## Tests A/B (prod, per spec 7)

- A PASS: environment=production, posture operating, hermes observe_only,
  open approvals 0, generated_at 2026-08-25T23:18:03.055Z.
- B first attempt REJECTED prohibited:production_access - the composer's
  production-target guard fired on the WORD "production" in the goal text
  (designed defense, live on prod; security-positive).
- B retry PASS (wording without the trigger word, request_id
  pc-prod-testb2-20260825): accepted, goal
  133a3e5a-d2cc-4345-9b79-71b9de00bf72, job 8e2a053f (requires_approval
  false), approvals_required 0; identical resubmit -> duplicate, SAME
  goal id, replayed true. One SSOT row; no approval; no execution.
- NO production approval decision was made.

## Wave 2 next (GPT Actions surface)

Client B' + PRESTON_CONTROL_GPT_* env + GPT editor repoint to prod +
callback pin; then G8 contract verification on prod openapi; Galaxy
prod re-run. Secrets owner-side throughout.
