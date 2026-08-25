# Preston Control - live MCP connector Tests A-E: ALL PASS (2026-08-25)

Surface: ChatGPT web Developer-mode MCP connector "Preston Control MCP -
Staging Clean" (URL https://preston-os-staging.vercel.app/mcp, OAuth client A
c1680204-8846-44b0-aa34-e9af1545c4a1, scope email, identity info@preston.nyc).
Staging build: RC 4cd20d3 artifact (deployment 2tn9zRsfCaY7vz3GHsNuDtY7Vuoi @
71eb806, artifact-equivalent). Times: Vercel/Supabase logs EDT (UTC-4).

## Connector activation (after two failed rounds)

- Root causes fixed en route: (1) first attempt aborted at discovery (no
  client credentials attached -> DCR fail); (2) rounds 2-3 failed
  /oauth/token with invalid client credentials x6 (stale/never-activated
  secret - the drawer "Update app" commit gotcha, same as client B on
  08-24). Fixed via regenerate -> Update app -> owner-shell Basic-auth
  probe (invalid_grant-class = credentials accepted) -> paste into ChatGPT.
- Success trail: INFO /oauth/token 17:03:50; then /mcp POST 200
  (initialize), 202 (notifications/initialized), 200 (tools/list) at
  17:03:52. Connector "Connected"; all 6 tools discovered with correct
  annotations (decide = WRITE/DESTRUCTIVE + G8 owner_confirmation schema):
  preston_status, preston_submit_goal, preston_get_goal,
  preston_list_approvals, preston_decide_approval, preston_get_evidence.

## Tests (single chat; every call verified in Vercel /mcp request log)

- A status (17:13): environment staging, posture operating,
  execution_enabled true, hermes observe_only, 3 open approvals,
  generated_at 2026-08-25T21:13:13.712Z. PASS.
- B harmless goal + idempotency (17:14): accepted, goal
  b686c9cc-0014-4493-b4c8-b101a09bb932, job 14857fae (no approval);
  identical resubmit (same request_id pc-mcp-testb-20260825) -> duplicate,
  SAME goal id. PASS. ChatGPT write-permission card shown on first write
  (Allow once used; later writes in-chat did not re-prompt - platform
  behavior noted).
- C gated goal + list (17:15): accepted, goal
  4a48516b-e491-4b46-b4f7-b72214557eac, approvals_required 1, approval
  apr-38f22750c38024172c92e12e pending decision_open true; gated job
  2d2deffa (requires_approval true) + ungated doc job da9ef4c9. PASS.
- D G8 decision handshake (17:16): no owner_confirmation ->
  decision_made false, owner_confirmation_required, required phrase
  restated; owner_confirmation "Approve that." -> refused identically;
  list re-check: still pending/decision_open true; owner-typed exact
  phrase -> approved, decided_at 2026-08-25T21:16:50.381Z (Vercel log
  17:16:49.86 matches); replay with same valid phrase -> not_pending, no
  second decision. PASS.
- E evidence (17:17): both jobs pending, attempts 0, gated job carries
  approval_id apr-38f22750..., executed nothing; gate clears only on the
  runtime tick. PASS.

## Gate status after this run

- Tests A-E (spec 6.3): PASS - Phase H prerequisite 1 met.
- Galaxy G1-G8 device re-run (spec 6.5): still owner-side.
- Phase H: still requires Galaxy pass + owner RED ruling + prod clients
  A'/B' + prod env (owner/secret-side).

Residual test data (simulation-only, no cleanup mechanism by design):
goals b686c9cc, 4a48516b; approval apr-38f22750 (approved). Production
untouched; no migrations; client A secret handled entirely owner-side.
