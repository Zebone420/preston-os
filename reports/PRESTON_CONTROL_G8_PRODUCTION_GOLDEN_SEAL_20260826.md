# PRESTON CONTROL G8 - PRODUCTION GOLDEN BASELINE SEAL (2026-08-26)

Owner authorized Phase H ("OWNER AUTHORIZES PHASE H: promote Preston
Control RC 4cd20d3 to production."). All mandatory production gates GREEN.
DECLARATION: Preston Control (G8 owner-confirmation build) is
PRODUCTION-LIVE on both surfaces, owner-only, fail-closed, simulation-only,
no outbound business-write capability, execution disabled.

## Deployment
- Deployed prod SHA: 53d2c1b (master; direct descendant of RC 4cd20d3 =
  ec0698b G8 + 71eb806 desc-fix + 4cd20d3 fake-align; tree-identical
  source). Vercel project preston-os-prod, alias preston-os-prod.vercel.app.
- Prod Supabase: hiqsymsiwonmvrbbqhhe (org ysgjgcyrdsamyaihhewn), OAuth
  Server enabled, consent /oauth/consent, dynamic registration OFF.

## Wave 1 MCP surface - LIVE
- Client A' 7e935dc7-fd95-49ef-bd6f-fb9352439600 (Confidential,
  client_secret_basic; owner-created; owner probe active). Connector
  "Preston Control MCP - Prod" Connected (identity info@preston.nyc).
  Handshake: /oauth/token 200 -> initialize -> tools/list; 6 tools with
  G8 owner_confirmation schema. Tests A/B PASS (prod-access guard fired
  correctly on the word "production").

## Wave 2 GPT Actions surface - LIVE
- Client B' 03ef39d0-5977-443b-a174-ae814cdfc6cb (Confidential,
  client_secret_post; owner-created). Env GPT_OAUTH_CLIENT_ID/_SECRET/
  _BRIDGE_KEY/_CALLBACK_URL set. GPT editor repointed to prod + published;
  aip callback g-ab244b138bb1114d43be55d82a4fc8b76e261b73. Sign-in chain
  server-verified (authorize 302 -> consent -> callback 302 -> token 200).
  Tests A/B PASS.

## Galaxy production drill - PASS (server-verified)
- Status card env=production. Harmless documentation goal
  101700c7-fe34-4998-ac2f-da989df6830b: status decomposed, ONE job
  a6eceb92 (documentation, pending, attempts 0, requires_approval false,
  approval_id null), pending_approvals 0. Identical resubmit -> duplicate,
  SAME goal id, no second goal (Vercel: two POST /api/control/goals 200 at
  20:21:11 + 20:21:15; SSOT one row). request_id idempotency proven.

## SSOT / audit evidence
- Prod status: posture operating, open approvals 0, FAILED 0, dead_letter
  1 (historical/pre-Preston-Control prod-runtime residue; non-blocking -
  the readiness/simulation posture keys on failed + execution, not on
  historical dead-letters). No approval created by any acceptance test.
  ZERO /api/control/*/decision calls in the prod log = no production
  approval decision made anywhere.
- No unintended execution: all jobs attempts 0, executed=false pinned by
  0010 CHECK; execution/runner disabled.

## Security / fail-closed
- Pre-activation smokes proved fail-closed (all control routes disabled
  w/o env). Post-activation: unauthenticated status/mcp 401, bare authorize
  400 unauthorized_client. openapi carries G8 owner_confirmation; ZERO
  preston-os-staging references. No secret entered repo/logs/chat; both
  client secrets + bridge key handled owner-side; pre-commit secret + RED
  scanners 0/0 across all Phase H evidence commits.

## Rollback posture
- Instant: PRESTON_CONTROL_ENABLED=false (all surfaces -> 503/404).
- Per surface: disable client A' (MCP) or B' (GPT) in prod Supabase;
  remove the connector / GPT Action. Rotate GPT_BRIDGE_KEY to kill
  in-flight GPT logins. Code: revert; no migration to roll back.

## Retained simulation-only prod data (no cleanup mechanism, by design)
- Goals 133a3e5a (MCP Test B), eab9e8ef (GPT Test B), 101700c7 (Galaxy).
  All documentation, decomposed, no approvals, no execution.

## Seal
- Tag: prod-golden-control-g8 at 53d2c1b (deployed prod artifact).
- Evidence chain (feature/preston-control): 64ab8df Wave1, 8872e23 Wave2,
  this report. Prior prod baseline prod-golden-0025 (e17287b) unaffected.
