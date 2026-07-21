# Phase 5J - Control and Rollback Packet (pause/resume/stop/kill + per-job cancel)

OWNER-RUN. Documents the exact owner-session-authenticated control actions
this phase added or extended: `pause`/`resume`/`stop` (existing, Phase 4),
`kill` (new, Phase 5J), and per-job `cancel` (new, Phase 5J). Every action
below is served by
`apps/dashboard/src/app/api/os/control/route.ts` (`pause|resume|stop|kill`)
or `apps/dashboard/src/app/api/os/jobs/cancel/route.ts`, backed by
`requestControl`/`cancelJob` in `apps/dashboard/src/lib/ai-os/controlplane.ts`.
Status is read via `apps/dashboard/src/app/api/os/status/route.ts`
(`readStatus`).

## 1. Authentication model for these routes (different from the ChatGPT connector)

All four routes in this packet (`/api/os/control`, `/api/os/jobs/cancel`,
`/api/os/status`) call `resolveOwner()`
(`apps/dashboard/src/lib/ai-os/owner-context.ts`): they require an
authenticated OWNER DASHBOARD SESSION (Supabase auth session cookie,
re-checked against the owner allowlist server-side), returning 401 `{ ok:
false, error: 'owner authorization required' }` otherwise. This is the
OPPOSITE auth model from `/api/os/chatgpt` (bearer token, no cookie) - do
not attempt to drive these routes with a bearer token; use an authenticated
browser session or an owner-session-carrying `curl` invocation (e.g. with
the session cookie copied from an authenticated browser dev-tools session).
Placeholder host used throughout: `<HOST-PLACEHOLDER>`. Placeholder cookie:
`<OWNER-SESSION-COOKIE-PLACEHOLDER>`.

## 2. Pause (OWNER-RUN)

    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/control \
      -H 'Cookie: <OWNER-SESSION-COOKIE-PLACEHOLDER>' \
      -H 'Content-Type: application/json' \
      -d '{ "action": "pause" }'
    # Expect: HTTP 200, { "ok": true, "code": "pause", "message": "runtime control updated: pause" }

Effect (`requestControl`, action `pause`): patch `{ paused: true }` only -
`owner_stop`, `execution_enabled`, `remote_runner_enabled`, `hermes_mode` are
untouched. Audited GREEN (`control:pause`).

## 3. Resume (OWNER-RUN)

    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/control \
      -H 'Cookie: <OWNER-SESSION-COOKIE-PLACEHOLDER>' \
      -H 'Content-Type: application/json' \
      -d '{ "action": "resume" }'
    # Expect: HTTP 200, { "ok": true, "code": "resume", "message": "runtime control updated: resume" }

Effect (`requestControl`, action `resume`): patch `{ paused: false,
owner_stop: false }`. Per `controlplane.ts`'s own comment on
`requestControl` and its "resume clears paused+owner_stop but NEVER touches
execution or runner flags" test in `controlplane.test.ts`: resume is THE ONE
AND ONLY reversal path for `owner_stop`, regardless of whether `owner_stop`
was set by `stop` OR by `kill` - there is no separate "un-kill" action.
Resume NEVER sets `execution_enabled` or `remote_runner_enabled` to `true` -
those remain whatever they already were (default `false`); enabling either
stays a separate, owner-run SQL / RED-gate action, never reachable through
this route. Audited GREEN (`control:resume`).

## 4. Stop (OWNER-RUN)

    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/control \
      -H 'Cookie: <OWNER-SESSION-COOKIE-PLACEHOLDER>' \
      -H 'Content-Type: application/json' \
      -d '{ "action": "stop" }'
    # Expect: HTTP 200, { "ok": true, "code": "stop", "message": "runtime control updated: stop" }

Effect: patch `{ owner_stop: true, paused: true }` (hard halt). Audited
YELLOW (`control:stop`).

## 5. Kill (OWNER-RUN, RED-audited)

    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/control \
      -H 'Cookie: <OWNER-SESSION-COOKIE-PLACEHOLDER>' \
      -H 'Content-Type: application/json' \
      -d '{ "action": "kill" }'
    # Expect: HTTP 200, { "ok": true, "code": "kill", "message": "runtime control updated: kill" }

Effect: writes the IDENTICAL patch `stop` writes -
`{ owner_stop: true, paused: true }` - per `controlplane.ts`'s own comment:
"`kill` ... writes the IDENTICAL hard-halt patch as `stop` ... but is audited
RED instead of YELLOW ... Kill invents no new control-plane flag." The only
observable difference between `stop` and `kill` is the `audit_log.action_
class` value (`YELLOW` vs `RED`) and the log-line semantics (an
owner-declared emergency vs. a routine pause-for-maintenance stop) - both
result in the exact same `system_controls` row. `execution_enabled` and
`remote_runner_enabled` are NEVER touched by `kill` either (verified by
`controlplane.test.ts`'s "kill NEVER touches execution_enabled/
remote_runner_enabled/hermes_mode" test).

Note: this route-level `kill` is a DIFFERENT, narrower action than the
GLOBAL KILL SQL referenced throughout the 5F/5I/5J drill packets (PHASE_4B1
packet section 16.4), which additionally forces
`execution_enabled=false`/`hermes_mode='disabled'` directly via SQL for a
full emergency shutdown. Use the SQL GLOBAL KILL, not this HTTP `kill`
action, whenever `execution_enabled` or `hermes_mode` themselves need
forcing (this HTTP action cannot touch either).

## 6. Per-job cancel (OWNER-RUN, new Phase 5J)

    curl -i -X POST https://<HOST-PLACEHOLDER>/api/os/jobs/cancel \
      -H 'Cookie: <OWNER-SESSION-COOKIE-PLACEHOLDER>' \
      -H 'Content-Type: application/json' \
      -d '{ "job_id": "<job-uuid-placeholder>",
            "correlation_id": "<correlation-id-placeholder>",
            "reason": "owner-requested cancel" }'
    # Expect (first call):  HTTP 200,
    #   { "ok": true, "code": "cancel_requested", "message": "cancellation requested",
    #     "id": "<job-uuid-placeholder>", "already": false }
    # Expect (replay):      HTTP 200,
    #   { "ok": true, "code": "already_requested", "message": "cancellation already requested",
    #     "id": "<job-uuid-placeholder>", "already": true }

Effect (`cancelJob`): flags `os_jobs.cancel_requested = true` for exactly ONE
job (uuid-validated). It NEVER executes, leases, or transitions the job
itself - it is a cooperative signal only; the worker/dispatcher loop remains
solely responsible for observing the flag and stopping at its own next safe
checkpoint (per the route file's own comment). Idempotent: an already-
flagged job returns `already_requested`/`already: true` WITHOUT a second
audit entry or a second DB write. Error mapping: `denied` -> 403,
`unknown_job` -> 404, anything else not-ok (`invalid`, `not_cancellable`) ->
400. Audited YELLOW (`job_cancel_requested`) on the first, non-idempotent
call only.

## 7. Status check (read-only, use after every action above)

    curl -s https://<HOST-PLACEHOLDER>/api/os/status \
      -H 'Cookie: <OWNER-SESSION-COOKIE-PLACEHOLDER>'
    # Returns: { "ok": true, "status": { "execution_enabled": bool,
    #             "owner_stop": bool, "paused": bool, "hermes_mode": string,
    #             "remote_runner_enabled": bool } }

`readStatus` is read-only and fails closed to the default (fully-stopped)
shape if `system_controls` cannot be read
(`readSystemControls`'s fail-closed default,
`apps/dashboard/src/lib/ai-os/store.ts`).

## 8. State matrix (before/after each action)

Columns are `system_controls.{owner_stop, paused}` only - `execution_
enabled`, `remote_runner_enabled`, `hermes_mode` are NEVER touched by any
action in this packet (confirmed in code for all of pause/resume/stop/kill;
`cancelJob` never touches `system_controls` at all, only one `os_jobs` row's
`cancel_requested`).

| Action | Before (owner_stop, paused) | After (owner_stop, paused) | Audit class | Notes |
|---|---|---|---|---|
| pause | any | (unchanged, `paused=true`) | GREEN | only `paused` flips |
| resume | any | `(false, false)` | GREEN | clears BOTH regardless of prior cause |
| stop | any | `(true, true)` | YELLOW | hard halt |
| kill | any | `(true, true)` | RED | IDENTICAL row to `stop`; only the audit class/semantics differ |
| cancel (job) | `os_jobs.cancel_requested=false` for the targeted job | `cancel_requested=true` for that ONE job only; `system_controls` untouched | YELLOW (first call only) | idempotent replay -> `already_requested`, no second audit |

## 9. Rollback of each action

- **pause -> rollback = resume** (section 3). Verify via `/api/os/status`:
  `paused: false`.
- **stop -> rollback = resume** (section 3). Verify: `owner_stop: false,
  paused: false`. Per section 3, resume is the ONLY reversal path - there is
  no separate "unstop" action.
- **kill -> rollback = resume** (section 3), IDENTICAL mechanism to
  reversing `stop` - `controlplane.ts`'s comment is explicit that `resume`
  "remains the one and only reversal path for owner_stop regardless of
  whether it was set by `stop` or `kill`... there is no separate 'un-kill'
  flag to invent." Verify the same way: `/api/os/status` shows
  `owner_stop: false, paused: false`.
- **cancel (job) -> rollback**: there is no "un-cancel" action exposed by
  this route or `cancelJob` - `cancel_requested` is a one-way cooperative
  signal by design (the job is expected to stop at its own next checkpoint,
  not be silently un-cancelled mid-flight). If the SAME work needs to
  proceed again, the owner must enqueue a NEW job (a fresh `/api/os/enqueue`
  call with a new `idempotency_key`/`correlation_id`) rather than attempt to
  clear the flag on the cancelled one. Verify a cancel took effect via:

      select id, status, cancel_requested from os_jobs where id = '<job-uuid-placeholder>';
      -- expect cancel_requested = true; status transitions to whatever the
      --   worker/dispatcher's own cooperative-stop logic sets it to at its
      --   next safe checkpoint (this route itself does not change status)

## 10. Emergency sequence

If multiple signals suggest a wider problem (not just one job), run in this
order:

1. `kill` (section 5) - HTTP, immediate, RED-audited, halts the whole
   runtime's owner_stop/paused gate.
2. For any SPECIFIC job(s) of concern still `queued`/`leased` at the moment
   of kill, ALSO send a per-job `cancel` (section 6) for each - `kill` halts
   future firings; it does not retroactively flag any individual job's
   `cancel_requested`, so a job a worker cycle already leased before the
   kill took effect should still be told to stop cooperatively.
3. If the concern involves `execution_enabled` or `hermes_mode` specifically
   (which this packet's HTTP actions cannot touch), escalate to the GLOBAL
   KILL SQL (PHASE_4B1 packet section 16.4) to force those flags directly.
4. Verify via `/api/os/status` (section 7) AND the SQL confirmation queries
   in `reports/PHASE_5J_HERMES_VERIFICATION_PACKET.md` section 3 (no new
   lease/attempt activity after the kill).
5. Only after the anomaly is understood and evidenced, use `resume`
   (section 3) to lift the halt - never resume reflexively just to "see if
   it's fine now."
