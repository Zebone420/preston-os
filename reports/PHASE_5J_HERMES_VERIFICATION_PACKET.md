# Phase 5J - Hermes Observe-Only Routing Verification Packet (owner-run, staging)

OWNER-RUN. Verifies that the Phase 5J routing RECOMMENDATION feature
(`apps/dashboard/src/lib/ai-os/hermes.ts` - `classifyTask` /
`routingReasons`, wired into `runHermesObserveOnce` in
`apps/dashboard/src/lib/ai-os/orchestrator.ts`) behaves exactly as designed
after deploy: it is advisory-only reason-string metadata attached to an
already-computed `observe` decision, it never leases a job, never writes to
`os_jobs`, and it only ever appears while `hermes_mode = 'observe_only'`.
This packet is read-only verification - no SQL here mutates any row.

## 1. What the routing feature actually does (code ground truth)

- `classifyTask` (`hermes.ts`) is pure, no I/O, and always returns a fixed
  `{ implementer: 'claude', reviewer: 'codex' }` pair regardless of input -
  only `task_kind` varies, classified by bounded keyword regexes
  (`migration`, `test`, `documentation`, `code`, else `unknown`) over the
  job's `command_id`/`id` and (if available) the command packet's
  `requested_action`/`requested_scope`/`expected_outcome`.
- `routingReasons` (`orchestrator.ts`) formats that classification into four
  reason strings: `route:implementer=claude`, `route:reviewer=codex`,
  `route:task_kind=<kind>`, `route:mode=recommendation_only`.
- `runHermesObserveOnce` attaches these reason strings ONLY when
  `decide()` already returned `'observe'` (the source comment is explicit:
  "never on noop/reject/etc"). They are appended to the SAME
  `orchestration_decisions` row `decide()`'s own reasons would have produced
  anyway - no extra row, no extra table.
- `decide()` itself only ever returns `'observe'` when
  `controls.hermes_mode === 'observe_only'` (`hermes.ts` lines 45-46) - so a
  live `route:*` reason string is itself proof the mode was `observe_only`
  at that moment; it cannot appear under `dispatch_eligible`/`propose_only`/
  `paused`/`disabled`/`stopped`.
- The live dispatcher path (`buildHermesObserveBatch` in
  `apps/dashboard/src/lib/ai-os/staging-sim.ts`) supplies the optional
  `packet` hint via `readCommandHints` (best-effort SELECT on
  `runtime_command_packets`, fails closed to `null`) - so in production a
  job whose command packet cannot be read for any reason still classifies
  (falls back to job/command id text, normally landing on `task_kind:
  'unknown'`), it never throws or blocks the observe cycle.

## 2. Preconditions

- Staging deploy at or after this commit; worker + Hermes timers enabled
  per `reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md`.
- `system_controls.hermes_mode = 'observe_only'` (verify first - section 3
  query 1). If it reads anything else, the checks in this packet that expect
  `route:*` reasons will correctly find none; that is not a failure of this
  feature, it means the precondition was not met.
- At least one `os_jobs` row in `queued` or `checkpointed` status exists for
  Hermes to observe (e.g. a drill job from
  `reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md` section 4, or a
  ChatGPT-sourced proposal enqueued per
  `reports/PHASE_5J_CHATGPT_CONNECTOR_PACKET.md` + a separate
  `/api/os/enqueue` call).
- All SQL below runs in the Supabase STAGING SQL editor, read-only
  (`select` only - no drill in this packet issues an `update`/`insert`).

## 3. Verification queries

1. Confirm the standing posture:

       select hermes_mode, paused, owner_stop, execution_enabled,
              remote_runner_enabled
         from system_controls where id = 'global';
       -- expect hermes_mode = 'observe_only', execution_enabled = false,
       --        remote_runner_enabled = false

2. Confirm `orchestration_decisions` rows carry the `route:*` reasons for a
   known job/correlation id (substitute the drill's `correlation_id`):

       select job_id, hermes_mode, decision, reasons, correlation_id, created_at
         from orchestration_decisions
        where correlation_id = '<drill-correlation-id-placeholder>'
        order by created_at desc;
       -- expect decision = 'observe'; reasons array CONTAINS
       --   'route:implementer=claude', 'route:reviewer=codex',
       --   'route:mode=recommendation_only', and one 'route:task_kind=<kind>'

3. Same check expressed as an array-containment filter (useful to scan
   broadly across recent decisions rather than one correlation id):

       select job_id, decision, reasons, created_at
         from orchestration_decisions
        where reasons @> array['route:implementer=claude']::text[]
        order by created_at desc
        limit 20;
       -- every row here must ALSO have decision = 'observe' (see query 4)

4. Confirm the routing reason never appears on a non-observe decision (this
   would indicate the advisory-only invariant broke):

       select count(*) from orchestration_decisions
        where reasons @> array['route:implementer=claude']::text[]
          and decision <> 'observe';
       -- expect 0

5. Confirm `task_kind` only ever takes one of the five known values (no
   unexpected classification value leaked through):

       select distinct
         (select r from unnest(reasons) r where r like 'route:task_kind=%')
           as task_kind_reason
         from orchestration_decisions
        where reasons @> array['route:mode=recommendation_only']::text[];
       -- every non-null value must be one of: route:task_kind=documentation,
       --   route:task_kind=code, route:task_kind=test,
       --   route:task_kind=migration, route:task_kind=unknown

6. Confirm Hermes wrote no lease for the same jobs (routing recommendation
   never causes a lease acquisition):

       select wl.job_id, wl.owner, wl.token
         from worker_leases wl
         join orchestration_decisions od on od.job_id::text = wl.job_id::text
        where od.reasons @> array['route:implementer=claude']::text[]
          and wl.owner = 'preston-hermes';
       -- expect 0 rows (Hermes never appears as a lease owner - only
       --   'preston-worker' or the configured worker identity ever does)

7. Confirm Hermes performed no job-row mutation (`os_jobs.status`/
   `os_jobs.updated_at` unaffected by the observe cycle beyond the worker's
   own separate lease/checkpoint activity - cross-reference against the
   worker log timestamps captured in section 4):

       select id, status, updated_at, lease_owner
         from os_jobs
        where correlation_id = '<drill-correlation-id-placeholder>';
       -- status/lease_owner must only ever change via a WORKER cycle
       --   (worker.log), never coincide with a hermes-only cycle in
       --   hermes.log with no corresponding worker.log line at the same time

8. Confirm no `job_attempts` row was written by Hermes (Hermes never
   executes or attempts a job):

       select count(*) from job_attempts
        where worker = 'preston-hermes';
       -- expect 0 (the only workers are 'preston-worker' / the configured
       --   staging worker identity)

## 4. Log checks

    sudo tail -n 50 /var/log/preston/hermes.log

Expect lines shaped `{"source":"ai-os-dispatcher", ..., "event":"hermes_loop",
"rounds":<n>, "stoppedReason":"completed", "recorded":<n>}` (exact field set
per `apps/dashboard/src/os-runtime/dispatcher.ts`'s `hermes_loop` log call).
`recorded` must be `>= 0` and should match the count of NEW
`orchestration_decisions` rows written in that cycle (duplicates are
idempotent no-ops and do not increment `recorded` -
`orchestrator.ts`: "duplicates are idempotent no-ops, not new records").
`stoppedReason` must be `completed` (not `halted`/`disabled`) while
`hermes_mode = 'observe_only'` and controls are not paused/stopped.

## 5. PASS/FAIL table

| ID | Check | Expected | Result |
|----|-------|----------|--------|
| H1 | Standing posture | `hermes_mode='observe_only'`, `execution_enabled=false`, `remote_runner_enabled=false` | PASS/FAIL |
| H2 | `route:*` reasons present for observed jobs | query 2 returns rows with all four `route:*` reason strings | PASS/FAIL |
| H3 | Routing reasons only on `observe` decisions | query 4 = 0 | PASS/FAIL |
| H4 | `task_kind` bounded to the 5 known values | query 5 shows no unexpected value | PASS/FAIL |
| H5 | Hermes holds no lease | query 6 = 0 rows | PASS/FAIL |
| H6 | Hermes wrote no job_attempts | query 8 = 0 | PASS/FAIL |
| H7 | No unexplained `os_jobs` mutation coincident with a hermes-only cycle | query 7 cross-checked against logs | PASS/FAIL |
| H8 | hermes.log shows `stoppedReason:"completed"`, `recorded>=0` | matches section 4 | PASS/FAIL |

PASS = all eight rows PASS. Any FAIL is a stop condition: do not treat
Hermes as observe-only-safe until investigated; escalate before further
promotion-criteria work (`reports/PHASE_5J_PROMOTION_CRITERIA_PACKET.md`).

## 6. Rollback / no-op note

This packet performs no writes, so there is nothing to roll back. If a FAIL
is observed and the owner wants to halt Hermes entirely while investigating,
use the standing control-plane pause/kill path documented in
`reports/PHASE_5J_CONTROL_ROLLBACK_PACKET.md` (`hermes_mode` itself is not
flipped by the `pause`/`resume`/`stop`/`kill` control actions -
`controlplane.ts`'s `requestControl` never touches `hermes_mode` - so
setting `hermes_mode='disabled'` directly via SQL, per the GLOBAL KILL
procedure in the PHASE_4B1 packet, is the applicable stop if Hermes
specifically, not the whole runtime, needs to be silenced).
