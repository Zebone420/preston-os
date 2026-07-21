# Phase 5J - Promotion Criteria Packet (owner-only decision gate, pre-activation)

Status: CRITERIA / DECISION document. This packet authorizes NOTHING by
itself. It sets - and lets the owner judge against - the bar that must be met
before any future, separate, owner-approved RED gate may ever set
`system_controls.execution_enabled=true`. It contains no activation SQL, no
command to flip any flag, and no instruction the AI or any agent may act on
unattended. Reaching every checkbox below still requires a SEPARATE owner
decision and a SEPARATE future packet to actually activate anything.

Companion documents this packet cross-references: reports/PHASE_5_CONTROL_RECOVERY_DRILL_PACKET.md,
reports/PHASE_5_REMOTE_LIVE_JOB_DRILL_PACKET.md, reports/PHASE_5J_REBOOT_RECOVERY_PACKET.md,
reports/PHASE_5_LEAST_PRIVILEGE_IDENTITY_PACKET.md, docs/PRESTON_AI_REMOTE_LIVE_READINESS_PLAN_v1.md,
docs/PHASE_5_EVIDENCE_BINDER_TEMPLATE.md, apps/dashboard/src/lib/ai-os/envelope.ts.

## 1. Preconditions checklist (ALL required; none satisfied by claim alone)

Every row below must be independently EVIDENCED (a filled evidence-binder
entry, a test file, an applied+verified migration, or a dated owner note) -
not merely asserted in a report. "PASS" in a prior packet's own text is not
sufficient if the underlying evidence row was never actually filled in.

- [ ] All Phase 5 drills PASS with evidence in the binder: 5E staging
      simulation (reports/PHASE_5_STAGING_SIMULATION_OWNER_PACKET.md), 5F
      control/recovery D1-D13 (reports/PHASE_5_CONTROL_RECOVERY_DRILL_PACKET.md),
      5I laptop-closed job drill (reports/PHASE_5_REMOTE_LIVE_JOB_DRILL_PACKET.md),
      and 5J reboot recovery (reports/PHASE_5J_REBOOT_RECOVERY_PACKET.md,
      rows R1-R7).
- [ ] Migration 0007 (supabase/migrations/0007_phase5h_runtime_roles.sql,
      least-privilege runtime roles) APPLIED to staging AND verified per
      reports/PHASE_5_LEAST_PRIVILEGE_IDENTITY_PACKET.md section 6: worker and
      hermes identities cut over, old owner-allowlisted service identities
      revoked, deny/permit matrix confirmed (worker cannot flip
      execution_enabled, cannot write system_controls, cannot touch
      approvals/owners/audit), and the 5F drill suite re-passes unchanged
      under the new identities.
- [ ] Migration 0008 (supabase/migrations/0008_phase5j_orchestration_envelope.sql,
      orchestration envelope columns) APPLIED to staging AND verified: the
      additive columns exist with their documented defaults/CHECK constraints
      (`environment='staging'` pin, `push_allowed`/`deploy_allowed` pinned
      false, `assigned_implementer`/`assigned_reviewer` distinctness
      constraint), and apps/dashboard/src/lib/ai-os/envelope.ts's
      `validateJobEnvelope` invariants have been exercised against the live
      schema (not just unit tests against the pure TS types).
- [ ] ChatGPT connector configured and verified operating in PROPOSAL-ONLY
      mode: the intake endpoint (reports/PRESTON_AI_OS_RUNTIME_STATUS_v2.md
      section 2 lists this as specified-but-not-built - it must be built and
      tested before this box can be checked) accepts a command proposal,
      creates a `runtime_command_packets` row via `submitCommandProposal`
      (owner-checked, validated, default-deny, production-rejected, audited),
      and demonstrably never leases, executes, or bypasses the owner
      allowlist. Evidence: one real ChatGPT-sourced proposal traced end-to-end
      to a queued (not executed) job.
      DEFERRED (2026-07-21 ruling, audit findings DOCS-1/ARCH-1/SEC-9):
      as wired, this trace is IMPOSSIBLE under the standing posture -
      intakeChatGpt couples proposal acceptance to execution_enabled=true
      and the route's cookie-session DB client carries no session on a
      bearer request. Both fixes are connector-ACTIVATION-gate work (see
      PHASE_5J_CHATGPT_CONNECTOR_PACKET.md section 9 KNOWN LIMITATIONS).
      This criterion moves from the Phase 5 closeout bar to the connector
      activation gate; Phase 5 records the fail-closed guard tests only.
- [ ] Hermes observe-only verified over N unattended cycles, where N is
      owner-set (suggested floor: at least 50 consecutive observe-only
      firings spanning at least 48 continuous hours of enabled-timer
      operation, with zero cycles showing anything other than
      `hermes_mode=observe_only` behavior - no lease attempt, no execution,
      `recorded` consistent with actual queue state throughout).
- [ ] Synthetic multi-agent drill completed with an owner-review packet: one
      full JobEnvelope (apps/dashboard/src/lib/ai-os/envelope.ts) processed
      end-to-end with `assigned_implementer='claude'`,
      `assigned_reviewer='codex'` (the only values `validateJobEnvelope`
      accepts today), `risk_class` GREEN or YELLOW only (RED/BLACK are
      rejected by the validator itself), `allowed_operations` drawn only from
      the fixed allowlist (`read_repo, edit_docs, edit_code, run_tests,
      run_lint, run_build, secret_scan, boundary_scan` - no shell/exec/network
      verb exists in that list), and `prohibited_operations` carrying at
      least the five required baseline entries (`push, deploy,
      production_access, secret_access, network_egress`). The resulting
      owner-review packet must show the full chain: envelope validated ->
      job queued -> leased -> simulated/checkpointed -> reviewed -> owner
      sign-off, with `execution`, `push`, `deploy` all `false` throughout (the
      envelope type pins them as the literal `false` - this checklist item
      just requires that the pin was never worked around).
- [ ] Security audit findings closed: outstanding items tracked in
      NEXT_GATES.md (npm audit moderate advisories, Supabase RLS tightening
      once an owner user exists, staging exposure gate preconditions) are
      resolved or explicitly owner-accepted with a dated rationale - not
      silently carried forward.
- [ ] Secret/red-boundary scanners green on the exact commit proposed for
      promotion: scripts/secret_scan.sh, scripts/red_boundary_scan.sh, and
      githooks/pre-commit (the local safety scanner run on every commit) all
      pass with no findings.
- [ ] Backup/rollback procedure tested: code changes are confirmed
      git-revertable (no destructive history rewrite needed); the migration
      0007 rollback SQL (PHASE_5_LEAST_PRIVILEGE_IDENTITY_PACKET.md section 5)
      has actually been exercised once in staging, not just written; a
      documented, owner-tested path exists to restore `system_controls` to
      the standing safe state (`execution_enabled:false,
      remote_runner_enabled:false, owner_stop:true, paused:true,
      hermes_mode:'disabled'`) within one command (the GLOBAL KILL SQL,
      PHASE_4B1 packet section 16.4).

PASS on this section = every box above checked AND its evidence citation
exists (a file path, a dated binder entry, or a test name) - a checked box
with no evidence behind it does not count.

## 2. The activation sequence itself is NOT in this packet

Flipping `system_controls.execution_enabled` (and/or
`remote_runner_enabled`) to `true` is, by CLAUDE.md build rule 6 and the RED
action classes in docs/PRESTON_AI_PHASE_0A_FOUNDATION_GATE.md, a RED,
owner-approved-only action. It is deliberately NOT specified here - not as an
oversight, but because:

- This packet's job is to define and evidence the BAR, not to cross it.
- A future, SEPARATE packet (placeholder name: "Phase 6 Activation Gate
  Packet" - to be authored only after every box in section 1 is checked and
  the owner explicitly requests it) must contain: the exact activation SQL
  scoped to a single control-flag flip, an explicit owner-typed approval
  capture (not a blanket YES - CLAUDE.md's blanket-YES semantics never cover
  RED actions), a go/no-go checklist that re-cites this packet's section 1 by
  reference, and its own rollback-to-safe-state step tested BEFORE the flip
  (not after).
- No activation SQL, no `execution_enabled=true` literal, and no runnable
  activation command appears anywhere in this document, on purpose.

## 3. Scope limits for the first controlled execution (once/if promoted)

These bound what the FUTURE activation packet may authorize for its first
run - they do not themselves authorize anything now:

- GREEN documentation-only jobs only: `risk_class='GREEN'`, and
  `allowed_operations` limited to `edit_docs` (plus read-only/verification
  ops `read_repo`, `run_lint`, `secret_scan`, `boundary_scan` as needed) - NOT
  `edit_code`, and never a shell/exec/network verb (none exist in the
  allowlist today).
- Bounded runtime: the existing systemd bounds stay as-is
  (`TimeoutStartSec=120`, `RuntimeMaxSec=300` per
  deploy/systemd/preston-worker.service - see the RuntimeMaxSec-on-oneshot
  note in reports/PHASE_5J_REBOOT_RECOVERY_PACKET.md section 8 for how that
  bound is actually enforced); the first run uses a single manual
  `--max 1` invocation, not the standing `--max 5` timer-driven batch.
- Single job: exactly one `os_jobs` row transitions out of
  `pending_owner`/`queued` for the first controlled execution - never a
  batch, never the timer's steady-state cadence.
- Owner watching live: the owner is actively monitoring `/os` and
  `journalctl -u preston-worker.service -f` / `tail -f
  /var/log/preston/worker.log` in real time for at minimum the first N
  executions the owner sets in the future activation packet - this is
  explicitly NOT a laptop-closed scenario, unlike the 5I drill (which proved
  unattended SIMULATION only, never unattended EXECUTION).
- Environment stays pinned: `environment='staging'` in every envelope
  (enforced by the migration 0008 CHECK and by
  `validateJobEnvelope`); production remains untouched per CLAUDE.md rule 3.
- `push_allowed` and `deploy_allowed` remain `false` (migration 0008 pins
  both to the literal `false` via CHECK constraint) - relaxing either is
  explicitly OUT OF SCOPE for the first controlled execution and would
  require yet another later gate that alters that CHECK.

## 4. Automatic demotion triggers

ANY ONE of the following, observed at any point after activation, demotes the
system back to the standing safe state immediately and automatically (i.e.
the demotion is not conditional on catching it live - it is a standing rule
that governs the activation packet's own design):

- **executed != simulated mismatch** - any job_attempts/os_events outcome
  where what actually happened (executed=true or a real write) disagrees with
  what the envelope/job declared it would do (a simulate/dry-run outcome
  expected). This is the sharpest possible signal that a control failed.
- **Audit gap** - any action taken (lease, attempt, decision, event) that
  lacks its corresponding row in the expected audit surface
  (job_attempts/job_checkpoints/orchestration_decisions/os_events/audit_log) -
  an unauditable action is treated as equivalent to an unsafe one.
- **Lease anomaly** - a duplicate `job_attempts` row for one job generation, a
  stale/expired lease token accepted instead of fenced (the D7/D8 fencing
  behavior in reports/PHASE_5_CONTROL_RECOVERY_DRILL_PACKET.md breaking), or
  any CAS-fence bypass.
- **Unexpected outbound network** - the envelope's required baseline
  prohibits `network_egress` for every job (migration 0008 /
  `REQUIRED_PROHIBITED_OPERATIONS` in envelope.ts); any observed outbound
  connection attempt from the worker/Hermes process is treated as a control
  failure regardless of destination.

On any trigger, the standing demotion action is: flip
`system_controls.execution_enabled=false` (and `owner_stop=true`,
`paused=true`) via the GLOBAL KILL SQL (PHASE_4B1 packet section 16.4)
immediately, stop the timers (`sudo systemctl stop preston-worker.timer
preston-hermes-observe.timer` as belt-and-braces), capture full evidence of
the anomaly into the evidence binder, and require a FULL re-run of the 5F/5I/
5J drill suite plus a fresh section-1 checklist pass before any re-promotion
is even considered. A demotion is never silently retried.

## 5. Sign-off template

    PHASE 5J PROMOTION CRITERIA - OWNER SIGN-OFF
    - Drill date (owner fills): __________
    - Operator (owner / owner-approved): __________
    - Environment: STAGING ONLY (confirm): yes/no

    Section 1 preconditions (all boxes checked, each with a cited evidence
    source - file path, binder entry date, or test name):
    - All Phase 5 drills PASS with evidence: yes/no - evidence: __________
    - Migration 0007 applied + verified (cutover complete, old identities
      revoked): yes/no - evidence: __________
    - Migration 0008 applied + verified (live-schema envelope check): yes/no
      - evidence: __________
    - ChatGPT connector verified proposal-only (intake built + traced,
      never executes): yes/no - evidence: __________
    - Hermes observe-only verified over N=____ unattended cycles: yes/no
      - evidence: __________
    - Synthetic multi-agent drill + owner-review packet complete: yes/no
      - evidence: __________
    - Security audit findings closed or owner-accepted with rationale: yes/no
      - evidence: __________
    - Secret/red-boundary scanners green on the proposed commit: yes/no
      - commit sha: __________
    - Backup/rollback procedure tested (0007 rollback + GLOBAL KILL
      exercised): yes/no - evidence: __________

    Decision: [ PROMOTE - authorize drafting the separate Phase 6 Activation
                Gate packet | HOLD - re-run: __________ | REJECT ]

    Owner statement (required verbatim before PROMOTE is valid): "I have
    reviewed each precondition above and confirm it is independently
    evidenced, not claimed. I understand this sign-off authorizes drafting
    the next gate packet ONLY. execution_enabled remains false until that
    separate packet is itself owner-approved and run."

    Signed (owner): __________          Date: __________

This packet, even fully checked and signed PROMOTE, changes NOTHING in
`system_controls` and applies no migration and enables no timer by itself. It
only records that the owner judges the bar met and authorizes the NEXT
packet to be drafted.
