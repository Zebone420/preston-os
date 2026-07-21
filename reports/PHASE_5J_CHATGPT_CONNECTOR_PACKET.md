# Phase 5J - ChatGPT Connector Setup Packet (owner-run, staging)

OWNER-RUN. This packet documents how to configure ChatGPT (a custom
action/connector) against the new intake route
`apps/dashboard/src/app/api/os/chatgpt/route.ts`. DISABLED BY DEFAULT: the
route returns 503 unless the owner has explicitly set the three env vars in
section 1 on the dashboard host. The AI has set nothing; every env value
below is a placeholder name only, never a real value.

Route file: `apps/dashboard/src/app/api/os/chatgpt/route.ts`. Core logic
(pure, unit-tested separately from the HTTP layer):
`processChatGptIntake` in that same file, backed by
`apps/dashboard/src/lib/ai-os/bridges/chatgpt.ts` (`intakeChatGpt`),
`apps/dashboard/src/lib/ai-os/commands.ts` (`normalizeCommand`/
`validateCommand`), `apps/dashboard/src/lib/ai-os/controlplane.ts`
(`mentionsProduction`), and `apps/dashboard/src/lib/ai-os/store.ts`
(`insertCommandPacket`). Tests: `apps/dashboard/test/chatgpt-route.test.ts`
(8 header-gate tests + business-logic tests, all passing as of this packet).

## 1. Endpoint and required environment (server-side, dashboard host only)

    POST /api/os/chatgpt

Required env vars (names only - the owner sets real values on the host,
never in chat, never committed):

- `CHATGPT_INTAKE_ENABLED` - must be the literal string `true`; any other
  value (including unset) yields 503 `disabled` before anything else runs.
- `CHATGPT_INTAKE_TOKEN` - the bearer token ChatGPT must present. Owner-only
  to create/rotate (see section 8). Never logged, never echoed in a
  response, never diffed into a commit.
- `CHATGPT_OWNER_IDENTITY` - the single owner identity string the request's
  `owner_identity` field must match (case/whitespace-insensitive compare via
  `normIdentity` - trim + lowercase - in the route file). This is the SAME
  allowlist shape `intakeChatGpt`'s `ownerAllowlist` uses.
- `SUPABASE_RUNTIME_ENV` - must be exactly `staging`. This is a hard
  fail-closed posture pin (mirrors the dispatcher's staging gate): if this
  var is missing or anything other than `staging` (e.g. unset, or
  `production`), the route returns 503 `unconfigured` regardless of the
  other three vars. There is no production posture for this route today.

If any of `CHATGPT_INTAKE_TOKEN` / `CHATGPT_OWNER_IDENTITY` /
`SUPABASE_RUNTIME_ENV=staging` is missing, the route returns 503
`unconfigured` even when `CHATGPT_INTAKE_ENABLED=true` (route.ts lines
164-170). These four names are not yet listed in `env.template` as of this
commit - the owner should add the four NAMES (never values) there when
configuring this connector, consistent with the "names only" rule CLAUDE.md
sets for `env.template`.

## 2. Authentication model

- Bearer token in the `Authorization` header: `Authorization: Bearer
  <CHATGPT_INTAKE_TOKEN>`.
- Compared with `constantTimeEqual` (`apps/dashboard/src/lib/ai-os/telegram-
  security.ts`) - the same constant-time-compare primitive the Telegram
  receiver uses. No timing side-channel on token guesses.
- NOT an owner dashboard session cookie. This is a server-to-server
  credential; the route is excluded from the owner-session proxy path
  (see `apps/dashboard/src/proxy.ts`) exactly as the Telegram webhook is.
- The token check runs strictly AFTER the enabled/configured/size gates and
  strictly BEFORE the JSON body is parsed or trusted (route.ts lines
  172-192): size gate, then auth gate, then JSON parse. A bad or missing
  token never causes the body to be read.
- A second, DB-free identity check happens inside `processChatGptIntake`:
  the body's `owner_identity` field must match `CHATGPT_OWNER_IDENTITY`
  (trim + lowercase) BEFORE any control-plane read - an unauthorized
  `owner_identity` costs only a string compare, never a DB round-trip.

## 3. Exact request shape (placeholders only)

    POST /api/os/chatgpt
    Authorization: Bearer <CHATGPT_INTAKE_TOKEN-PLACEHOLDER>
    Content-Type: application/json

    {
      "owner_identity": "<OWNER_IDENTITY_PLACEHOLDER>",
      "correlation_id": "chatgpt-drill-00000001",
      "idempotency_key": "chatgpt-drill-00000001-cmd",
      "command": {
        "requested_action": "read repository status",
        "target_project": "preston-os",
        "target_repository": "preston-os",
        "requested_scope": "read-only",
        "expected_outcome": "a status summary",
        "constraints": ["staging only", "no production targets"]
      }
    }

Shape rules enforced server-side (route.ts `ID_RE`): `correlation_id` and
`idempotency_key` are each required and must match
`^[A-Za-z0-9._:-]{8,128}$`. `command` fields are coerced to strings (`str()`
helper); `constraints` must be an array if present. Body is capped at
`MAX_BODY_BYTES = 32 * 1024` (32 KiB) via the pre-body `Content-Length`
check.

## 4. Every response status and example body

All bodies below are the literal shape the route returns - no field is
invented here.

| Status | `status` value | When | Example body |
|---|---|---|---|
| 503 | `disabled` | `CHATGPT_INTAKE_ENABLED` != `'true'` | `{ "ok": false, "status": "disabled" }` |
| 503 | `unconfigured` | token/owner-identity/staging-pin env missing, OR Supabase client unavailable (setup mode) | `{ "ok": false, "status": "unconfigured" }` |
| 413 | `too_large` | `Content-Length` missing/NaN/over 32 KiB | `{ "ok": false, "status": "too_large" }` |
| 401 | (none - `forbidden` in code comment, no `status` field on this path) | bad/missing bearer token | `{ "ok": false, "status": "forbidden" }` |
| 400 | `bad_request` | body is not valid JSON, or not an object | `{ "ok": false, "status": "bad_request" }` |
| 400 | `invalid` | `correlation_id`/`idempotency_key` fail `ID_RE`, OR `validateCommand` fails (includes secret-shaped text rejection) | `{ "ok": false, "status": "invalid", "message": "correlation_id and idempotency_key are required and must match ...", "correlation_id": "..." }` |
| 403 | `denied` | `owner_identity` empty or does not match `CHATGPT_OWNER_IDENTITY` (case/whitespace-insensitive) | `{ "ok": false, "status": "denied", "message": "owner identity not authorized", "correlation_id": "..." }` |
| 503 | `stopped` | runtime halted (`isHalted` - `owner_stop` or `execution_enabled` false in a way that halts) | `{ "ok": false, "status": "stopped", "message": "...", "correlation_id": "..." }` |
| 200 | `paused` | `system_controls.paused = true` | `{ "ok": false, "status": "paused", "message": "...", "correlation_id": "..." }` |
| 400 | `production_rejected` | `mentionsProduction` matches target/scope/action (audited RED) | `{ "ok": false, "status": "production_rejected", "message": "production targets are not permitted", "correlation_id": "..." }` |
| 400 | `write_failed` | DB insert failed for a non-duplicate reason | `{ "ok": false, "status": "write_failed", "message": "unable to record proposal", "correlation_id": "..." }` |
| 200 | `proposed` | success, new proposal created | `{ "ok": true, "packet_id": "<uuid>", "status": "proposed", "duplicate": false, "correlation_id": "..." }` |
| 200 | `duplicate` | idempotent replay of the same `idempotency_key` | `{ "ok": true, "packet_id": "<uuid-or-original>", "status": "duplicate", "duplicate": true, "correlation_id": "..." }` |

Note: the 401 path returns `{ ok: false, status: 'forbidden' }` per the
route's own `NextResponse.json` call (route.ts line 184) - "bad token" maps
to `status: 'forbidden'`, not a `status: 'unauthorized'` string; do not
expect a different literal.

## 5. Idempotency and correlation semantics

- `idempotency_key` is the DB-level dedup key for `runtime_command_packets`
  (via `insertCommandPacket`) - a replay with the SAME key returns
  `duplicate: true` and creates NO second row.
- `correlation_id` is echoed on every response (success or rejection) so the
  same drill/session can be traced across `runtime_command_packets`,
  `audit_log`, and (once enqueued separately via `/api/os/enqueue`, a
  DIFFERENT route this connector never calls) `os_jobs`.
- This route never enqueues on its own - it only ever produces a
  `runtime_command_packets` proposal row. Turning a proposal into a queued
  job still requires the separate, owner-gated `/api/os/enqueue` path
  (`enqueueStagingJob` in `controlplane.ts`), with its own `approval_id`.

## 6. What this route can NEVER do

Enforced in code, not by convention:

- No enqueue: `processChatGptIntake` calls `insertCommandPacket` only - it
  never calls `insertStagingJob`/`enqueueStagingJob`.
- No execution: `packet.execution_eligible = false` is forced unconditionally
  (route.ts line 120, "defense in depth" even though `normalizeCommand`
  already forces it) and `packet.approval_required = true` is forced
  unconditionally (line 119) - an external connector proposal can never be
  implicitly GREEN-approved.
- No shell, no git: the route imports no process/child_process/git module;
  it only calls pure validation functions and Supabase reads/writes.
- No production targets: `mentionsProduction` re-screens
  `target_project`/`target_repository`/`requested_scope`/`requested_action`
  even though `normalizeCommand`/`validateCommand` may also catch it -
  matches are rejected 400 and audited RED (`command_rejected:
  production_target`).
- No secret exfiltration: DB write-failure messages are never passed
  through raw (`'unable to record proposal'` is the only string returned on
  `write_failed`, verified in `chatgpt-route.test.ts` - "never passes a raw
  DB error through on write failure").
- No owner-session bypass: bearer-token auth only; this path is explicitly
  excluded from the cookie-based owner-session proxy.

## 7. ChatGPT custom-action / connector configuration (owner-run)

1. In ChatGPT's custom-action/connector builder, add one action:
   - Method: `POST`
   - URL: `https://<DASHBOARD-HOST-PLACEHOLDER>/api/os/chatgpt`
   - Auth: "API key" / "Bearer" type, value = the `CHATGPT_INTAKE_TOKEN`
     the owner generated (owner pastes this directly into ChatGPT's own
     credential store - never into this repo, never into a chat transcript).
   - Request body schema: mirror section 3's JSON shape exactly (owner_
     identity, correlation_id, idempotency_key, command.{requested_action,
     target_project, target_repository, requested_scope, expected_outcome,
     constraints}).
2. Set `owner_identity` in the action's request template to the literal
   value matching `CHATGPT_OWNER_IDENTITY` on the server (e.g.
   `info@preston.nyc` - a real value, not a secret, since it is an identity
   string, not a credential).
3. Instruct the assistant/action description that `correlation_id` and
   `idempotency_key` must be freshly generated bounded id-shaped strings
   per request (8-128 chars, `[A-Za-z0-9._:-]`) - reusing a key intentionally
   is how idempotent replay is exercised.
4. Do NOT configure any action that targets `/api/os/enqueue`,
   `/api/os/control`, or `/api/os/jobs/cancel` from ChatGPT - those remain
   owner-dashboard-session-only routes; this connector is scoped to
   `/api/os/chatgpt` (proposal intake) alone.

## 8. Token creation and rotation (owner-only; no commands here that echo a token)

Generating and rotating `CHATGPT_INTAKE_TOKEN` is an OWNER-ONLY step and is
deliberately NOT specified as a runnable command in this packet - no command
that would generate, print, or echo a token value belongs in a document that
may be read back into a transcript. The owner is expected to generate a
high-entropy token using their own preferred local method, set it as
`CHATGPT_INTAKE_TOKEN` in the host's env store (never `.env*` committed to
git; consistent with CLAUDE.md rule 2), and paste it only into ChatGPT's own
credential UI. Rotation = repeat the same owner-only step with a new value,
update ChatGPT's stored credential to match, and restart/redeploy the
dashboard process that reads the env var.

## 9. Validation steps (OWNER-RUN, curl, placeholder token/host)

All of the following are OWNER-RUN against STAGING only.

    # 1. Confirm disabled-by-default posture (before setting any env var):
    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/chatgpt \
      -H 'Content-Type: application/json' -d '{}'
    # Expect: HTTP 503, {"ok":false,"status":"disabled"}

    # 2. After the owner sets CHATGPT_INTAKE_ENABLED=true,
    #    CHATGPT_INTAKE_TOKEN, CHATGPT_OWNER_IDENTITY, SUPABASE_RUNTIME_ENV=staging
    #    and redeploys/restarts the dashboard process, re-check with no auth:
    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/chatgpt \
      -H 'Content-Type: application/json' -d '{}'
    # Expect: HTTP 401, {"ok":false,"status":"forbidden"}

    # 3. Wrong token:
    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/chatgpt \
      -H 'Authorization: Bearer wrong-token-placeholder' \
      -H 'Content-Type: application/json' -d '{}'
    # Expect: HTTP 401, {"ok":false,"status":"forbidden"}

    # 4. Correct token, malformed JSON:
    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/chatgpt \
      -H 'Authorization: Bearer <CHATGPT_INTAKE_TOKEN-PLACEHOLDER>' \
      -H 'Content-Type: application/json' -d '{not json'
    # Expect: HTTP 400, {"ok":false,"status":"bad_request"}

    # 5. Correct token, well-formed proposal (section 3 body, real owner
    #    identity, fresh correlation_id/idempotency_key):
    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/chatgpt \
      -H 'Authorization: Bearer <CHATGPT_INTAKE_TOKEN-PLACEHOLDER>' \
      -H 'Content-Type: application/json' \
      -d '{ "owner_identity": "<OWNER_IDENTITY_PLACEHOLDER>",
            "correlation_id": "chatgpt-owner-verify-001",
            "idempotency_key": "chatgpt-owner-verify-001-cmd",
            "command": { "requested_action": "read repository status",
                         "target_project": "preston-os",
                         "target_repository": "preston-os" } }'
    # Expect: HTTP 200, {"ok":true,"packet_id":"<uuid>","status":"proposed",
    #                      "duplicate":false,"correlation_id":"chatgpt-owner-verify-001"}

    # 6. Replay the SAME body from step 5:
    #    Expect: HTTP 200, "status":"duplicate","duplicate":true - and verify
    #    (SQL, staging) exactly one runtime_command_packets row for that
    #    idempotency_key:
    select count(*) from runtime_command_packets where idempotency_key =
      'chatgpt-owner-verify-001-cmd';   -- expect 1

    # 7. Verify the proposal is default-deny (SQL, staging):
    select action_class, approval_required, execution_eligible
      from runtime_command_packets where id = '<packet_id from step 5>';
    -- expect approval_required=true, execution_eligible=false

## 10. Rollback (owner action)

    # Disable the connector immediately - no code change, no redeploy of
    # logic, just the env flag:
    CHATGPT_INTAKE_ENABLED=false   # (or unset it entirely)

Restart/redeploy the dashboard process so the new env value takes effect,
then verify:

    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/chatgpt \
      -H 'Authorization: Bearer <CHATGPT_INTAKE_TOKEN-PLACEHOLDER>' \
      -H 'Content-Type: application/json' -d '{}'
    # Expect: HTTP 503, {"ok":false,"status":"disabled"}

This is the SAME 503 the route returns by default, before any owner ever
configures it - rollback restores the exact standing-safe posture, nothing
more. `CHATGPT_INTAKE_TOKEN` and `CHATGPT_OWNER_IDENTITY` may be left set or
removed; either way, `CHATGPT_INTAKE_ENABLED != 'true'` alone is sufficient
to fail closed at the very first check in `POST()`.
