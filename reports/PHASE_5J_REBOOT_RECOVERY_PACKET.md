# Phase 5J - Reboot Recovery Drill Packet (owner-run, staging)

OWNER-RUN. Proves that a controlled reboot of preston-agent-staging is fully
recoverable without any manual re-enablement: the timers re-arm themselves
(they are systemd-enabled units; the AI never runs `systemctl enable`), the
services still have no `[Install]` section so nothing can auto-start except
via its timer, the first post-boot cycles stay bounded/simulate-only, the repo
and token stores survive untouched, and `deploy/preflight-health.sh` still
reports PASS. This packet formalizes and extends D12 (host reboot recovery) in
reports/PHASE_5_CONTROL_RECOVERY_DRILL_PACKET.md with the full pre/post
evidence chain; it does not replace D12, it completes it.

Global prohibitions for this drill (same standing rules as 5F/5I): no
production, no service-role key, no Telegram sends, no business writes,
execution_enabled and remote_runner_enabled stay false throughout. Global stop
condition: any unexpected row in approvals/audit_log business tables, any
outbound message, or any log line with executed=true -> run the GLOBAL KILL
(PHASE_4B1 packet section 16.4) and stop the drill.

Standing initial state (same as 5F): worker + Hermes timers enabled; controls
= {execution_enabled:false, remote_runner_enabled:false, owner_stop:false,
paused:false, hermes_mode:'observe_only'}. All host commands run as the owner
on preston-agent-staging. All SQL (if any is needed for evidence-only reads)
runs in the Supabase STAGING SQL editor.

## 1. Pre-reboot state capture (owner action, on the host)

Run and save the output of each (no secrets are printed by any of these):

    systemctl list-timers 'preston-*' --all
    systemctl is-enabled preston-worker.timer preston-hermes-observe.timer
    sudo tail -n 50 /var/log/preston/worker.log /var/log/preston/hermes.log
    git -C /srv/preston-os rev-parse HEAD
    git -C /srv/preston-os status --short
    uptime

Also capture token-store ownership/permissions ONLY (never the file contents
or any printed value):

    stat -c '%U:%G %a %n' /var/lib/preston/worker /var/lib/preston/hermes
    stat -c '%U:%G %a %n' /var/lib/preston/worker/token.json /var/lib/preston/hermes/token.json

Record: current HEAD sha, repo clean/dirty state, whether both timers show
`enabled`, and the ownership/perm string for each path above (expect service
user:group, `700` on the directories and `600` on the token files, per the
least-privilege store rules in reports/PHASE_4B_WORKER_IDENTITY_PACKET.md
section 1). This is the baseline the post-reboot capture must match.

## 2. Controlled reboot (OWNER ACTION)

    sudo reboot

Note the wall-clock time. Reconnect after ~2-3 minutes. This is the only
disruptive step in the drill; everything else is read-only verification.

## 3. Post-reboot verification

Perform each check below. Every one maps to a row in the expected-outcomes
table in section 4.

1. `uptime` - confirms a fresh boot (uptime measured in minutes, not the
   pre-reboot value).
2. `systemctl list-timers 'preston-*' --all` - both timers show `enabled` and
   a populated NEXT time, with no owner action taken to re-enable them. This
   is the core recovery proof: the units were enabled BEFORE the reboot (unit
   file `[Install] WantedBy=timers.target`), so timers.target re-arms them at
   boot automatically. If either timer was disabled before the reboot per
   section 1, it will (correctly) stay disabled after - that is not a failure,
   it is the fail-closed default working as designed.
3. Confirm neither service can start itself:
       systemctl cat preston-worker.service preston-hermes-observe.service | grep -c '^\[Install\]'
   Expect `0` - deploy/systemd/preston-worker.service and
   preston-hermes-observe.service both carry the comment "No [Install]: the
   SERVICE never auto-starts" (worker) / "never auto-starts; the timer
   (owner-enabled) fires it" (hermes), and neither file has an `[Install]`
   section. Only the `.timer` units are `[Install]`-enabled.
4. Wait for the first post-boot firing. worker.timer uses `OnBootSec=5min`,
   hermes-observe.timer uses `OnBootSec=6min` (deploy/systemd/*.timer) - allow
   up to ~7 minutes after boot before treating a missing firing as a stop
   condition.
5. First post-boot worker cycle - bounded, simulate-only:
       sudo journalctl -u preston-worker.service --since "-10 min" --no-pager | tail -30
       sudo tail -n 20 /var/log/preston/worker.log
   Expect a SUCCESS oneshot exit and a log line containing `executed=false`
   (the worker's `worker-loop --max 5` only ever simulates; execution stays
   globally disabled by `system_controls.execution_enabled=false`).
6. First post-boot Hermes cycle - observe-only, no candidates:
       sudo journalctl -u preston-hermes-observe.service --since "-10 min" --no-pager | tail -30
       sudo tail -n 20 /var/log/preston/hermes.log
   Expect a SUCCESS oneshot exit and a log line containing `recorded=0`
   (nothing queued for Hermes to observe across the reboot; it never leases or
   executes regardless).
7. Preflight health:
       sudo bash deploy/preflight-health.sh
   Expect `PREFLIGHT: PASS - authenticated read-only control-plane connectivity OK`.
8. Repo state unchanged by the reboot:
       git -C /srv/preston-os rev-parse HEAD
       git -C /srv/preston-os status --short
   Expect the SAME HEAD sha as section 1, and the SAME clean/dirty state (a
   reboot never touches the working tree; any difference is a stop condition
   to investigate, not something this drill causes).
9. Token stores intact - ownership/perms only, values never printed:
       stat -c '%U:%G %a %n' /var/lib/preston/worker /var/lib/preston/hermes
       stat -c '%U:%G %a %n' /var/lib/preston/worker/token.json /var/lib/preston/hermes/token.json
   Expect an EXACT match to the section-1 baseline (service user:group, `700`
   dirs, `600` files). The successful db-health run in step 7 and the worker
   cycle in step 5 each perform an atomic rotate-and-rewrite of their token
   file (PHASE_4B_WORKER_IDENTITY_PACKET.md section 1); ownership and mode
   must be unchanged even though the file's mtime/contents rotate.

## 4. Expected outcomes table

| ID | Check | Expected | Result |
|----|-------|----------|--------|
| R1 | Timers re-armed after reboot | both `enabled`, NEXT populated, no owner action taken | PASS/FAIL |
| R2 | Services still have no `[Install]` | grep count = 0 on both units | PASS/FAIL |
| R3 | First post-boot worker cycle | SUCCESS, log line `executed=false` | PASS/FAIL |
| R4 | First post-boot Hermes cycle | SUCCESS, log line `recorded=0` | PASS/FAIL |
| R5 | Preflight health | `PREFLIGHT: PASS` | PASS/FAIL |
| R6 | Repo state | HEAD sha and clean/dirty state unchanged from section 1 | PASS/FAIL |
| R7 | Token store ownership/perms | unchanged from section 1 baseline (700/600, correct owner) | PASS/FAIL |

PASS = all seven rows PASS with evidence recorded per section 5.

## 5. Evidence capture instructions

Record this drill using the docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md
structure (drill session header + one evidence row per check, no secrets, no
host names/IPs, no token values):

- Drill session header: date, operator, environment (STAGING ONLY), and the
  pre-reboot baseline captured in section 1 (HEAD sha, timer enablement
  state, token-store owner/perm strings).
- Evidence rows: use R1-R7 above in place of the template's D1-D9 rows: ID,
  control, action taken ("controlled sudo reboot"), observation (command
  output summary only - e.g. "enabled, NEXT 4min" - never a full log paste
  containing incidental data), PASS/FAIL.
- Boundary confirmations section: answer all six template questions
  (production untouched, no live sends, no live writes, no n8n activation, no
  secret pasted, bounded workload only) - all must be "yes" for this drill
  since it is read-only verification plus one `sudo reboot`.
- Halt log: fill only if a stop condition (section 6) fired.
- Owner sign-off: "All R1-R7 PASS" yes/no, recommendation, and the same
  laptop-close-safe caveat as the template (a reboot-recovery PASS here
  proves boot-time recovery; it does not by itself prove laptop-closed
  remote-live readiness - that is docs/PRESTON_AI_REMOTE_LIVE_READINESS_PLAN_v1.md).

## 6. Stop conditions

Abort the drill (do not proceed to the remaining checks) and investigate
before re-attempting if ANY of the following occurs:

- The host does not come back within ~10 minutes of `sudo reboot` (an
  infrastructure issue, not a drill failure to paper over).
- A timer that was `enabled` in section 1 is NOT `enabled` after reboot (an
  enablement leak - matches the D12 stop condition in the 5F packet).
- Either service shows ACTIVE at boot time WITHOUT its timer having fired
  first (would mean something other than the timer started it).
- Any log line, from either service, containing `executed=true`, or a Hermes
  cycle with `recorded` greater than the number of legitimately queued drill
  jobs.
- `deploy/preflight-health.sh` returns anything other than PASS.
- The post-reboot HEAD sha differs from the pre-reboot HEAD sha, or the repo
  is dirty in a way section 1 did not already show.
- Token-store ownership, group, or mode differs from the section-1 baseline,
  or either path is now world- or group-readable.
- Any unexpected row appears in approvals/audit_log, or any outbound message
  is observed (global stop condition, same as every 5F/5I drill).

Any stop condition -> run the GLOBAL KILL (PHASE_4B1 packet section 16.4) if
there is any sign of a business-table or send-path anomaly; otherwise simply
leave the timers as found and escalate to the owner before continuing.

## 7. Rollback

None needed for the reboot itself - a controlled reboot is fully recoverable
by design (that is the entire point of this drill), and no state-changing SQL
or code change is part of it.

If a post-reboot cycle misbehaves (e.g. an unexpected firing pattern, a log
anomaly that is not yet understood), the owner can immediately stop further
firings without waiting on a code fix:

    sudo systemctl disable --now preston-worker.timer preston-hermes-observe.timer

This is an OWNER ACTION - it stops future timer firings (disable) and cancels
any pending firing (--now stops the timer unit immediately) without touching
system_controls or any DB row. Re-arm later with:

    sudo systemctl enable --now preston-worker.timer preston-hermes-observe.timer

If the misbehavior involves anything business-table-shaped (unexpected
approvals/audit_log row, a send), use the GLOBAL KILL SQL (PHASE_4B1 packet
section 16.4) in addition to disabling the timers.

## 8. Note: RuntimeMaxSec on Type=oneshot (cosmetic systemd warning)

Both deploy/systemd/preston-worker.service and preston-hermes-observe.service
declare:

    Type=oneshot
    TimeoutStartSec=120
    RuntimeMaxSec=300

For `Type=oneshot`, systemd's actually-enforced bound on how long `ExecStart`
may run is `TimeoutStartSec` (120s here) - a oneshot unit is considered
"starting", not "running", for the whole duration of its single ExecStart, so
`TimeoutStartSec` is what kills a hung `ExecStart` before it ever reaches the
"running"/"exited" state that `RuntimeMaxSec` bounds. On some systemd
versions this combination produces a harmless journal warning to the effect
that `RuntimeMaxSec=` has no effect for this unit's type. That warning is
COSMETIC and is not a drill failure by itself - do not treat its presence or
absence as a pass/fail signal. Verify the actual configuration on the host
with:

    systemctl show preston-worker.service preston-hermes-observe.service \
      -p Type -p TimeoutStartSec -p RuntimeMaxSec

Expect `Type=oneshot`, `TimeoutStartSec=[120s]` (the effective bound), and
`RuntimeMaxSec=[300s]` (present as defense-in-depth / documented intent, not
the mechanism actually enforcing the bound for this unit type). If a future
gate changes either service's `Type=` away from `oneshot` (not proposed
here), `RuntimeMaxSec` would then become the operative bound and this note
would need to be revisited.
