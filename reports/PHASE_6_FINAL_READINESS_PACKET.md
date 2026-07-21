# Phase 6 Final Readiness Packet - Owner Decision (2026-07-21)

Supersedes reports/PHASE_6_CLOSEOUT_SKELETON.md for the Remote-Live
staging program. Companion: reports/PHASE_5_CLOSEOUT_REPORT.md (gate
ruling PASS WITH NOTES), PHASE_5_EVIDENCE_BINDER.md,
PHASE_5_DEFECT_REGISTER.md.

## 1. Final system status (state claims per evidence level)

- Control plane (proposals, enqueue, controls, cancel, status, queue):
  coded, unit-tested, integration-tested via route tests, deployed to
  staging, owner-run.
- Worker simulation loop + lease/checkpoint/recovery machinery: coded,
  unit-tested, deployed, owner-run through D1-D12 drills.
- Hermes observe-only loop: coded, unit-tested, deployed, owner-run.
- Laptop-closed operation: owner-run (processing proven; phone-control
  evidence pending micro-drill - closeout note N2).
- Telegram intake: coded, unit-tested; receiver DISABLED (activation
  gate documented; proxy-matcher exclusion is a prerequisite).
- ChatGPT connector: coded, unit-tested (fail-closed guards);
  DISABLED; live trace deferred to activation gate (circularity
  documented and resolved procedurally).
- Multi-agent orchestration envelope (5J): coded, unit-tested; INERT
  (0008 unapplied; runner disabled; no invocation path).
- Least-privilege runtime roles (0007): authored, static-tested,
  NOT applied (owner gate).

## 2. Remote-Live STAGING readiness: 99% (evidence-based)

Rationale: all functional criteria are met and audited (six independent
audits; zero unresolved critical/high). Withheld 1%: binder archive
(N1), phone pause/resume micro-drill (N2), token-path stat (N3) - all
owner-run, ~1 hour total. This figure deliberately does NOT round to
100: the promotion packet's own standard requires archived evidence,
not assertion. (The previous 99.5% figure predates the audit round;
the extra open surface found by audits nets out to 99% honest.)

Production readiness is NOT claimed and is not a Phase 6 question.

## 3. Topology (text)

    owner (phone/laptop)
      |-- Vercel dashboard (owner-gated proxy + RLS)
      |     |-- /os control center (read-only view + safe controls)
      |     |-- /api/os/* owner routes -> controlplane handlers
      |           -> Supabase STAGING (RLS, owner session)
      |
      |-- Supabase dashboard app (phone) -> D1/D2/kill SQL
      |
      +-- staging host preston-agent-staging
            |-- systemd timers (5-6 min cadence)
            |     |-- preston-worker.service (oneshot, preston-worker)
            |     |     -> node dist/os-runtime/bin.js worker-loop --max 5
            |     +-- preston-hermes-observe.service (preston-hermes)
            |           -> node dist/os-runtime/bin.js hermes-loop --max 5
            |-- /etc/preston/{worker,hermes}.env (0600, per identity)
            |-- /var/lib/preston/{worker,hermes}/<token store> (0700/0600)
            +-- /srv/preston-os @ pinned commit (dist built on host)

    Data plane (Supabase STAGING, RLS owner-only + append-only audit):
    runtime_command_packets -> os_jobs -> worker_leases -> job_attempts
    -> job_checkpoints -> orchestration_decisions -> os_events,
    system_controls (single fail-closed row), audit_log,
    telegram_updates (dedup bookkeeping, unbound).

## 4. Active services and controls (standing posture)

- Active: two timers + their oneshot services; Vercel dashboard.
- Controls: execution_enabled=false | remote_runner_enabled=false |
  paused=false | owner_stop=false | hermes_mode=observe_only.
- Everything else (connectors, agents, runner, 0007/0008): disabled or
  unapplied.

## 5. Remaining hard stops (unchanged, all fail-closed)

Production access; credentials/secrets; execution_enabled=true;
remote_runner_enabled=true; live sends (email/SMS/Telegram); business
writes; n8n activation; force push; destructive SQL; safety-guard
changes without ratification; deployment activation. Each requires an
explicit owner-run RED gate.

## 6. Production-promotion prerequisites (future, in order)

1. Close closeout notes N1-N3 (owner, ~1 hour).
2. Apply 0007 + identity cutover gate (packet corrected; includes
   deny/permit matrix + 5F re-pass under new identities + rollback
   exercised once). Address SEC-1 note (worker UPDATE breadth).
3. Apply 0008 + live-schema envelope verification.
4. Hermes soak: 50 consecutive observe-only firings / 48 h, archived.
5. Connector activation gates (ChatGPT: regate intake off
   execution_enabled + runtime-identity client; Telegram: proxy
   exclusion + durable dedup binding).
6. Fence checkpoint appends by lease generation (ARCH-2) - REQUIRED
   before any execution-enabled gate.
7. Wire dead-lettering + /os heartbeat surface (operator visibility).
8. Execution pilot design gate (bounded GREEN allowlist, per-job
   owner approval, kill-switch drill under execution).

## 7. Agent-building readiness statement

The platform is READY for building business agents in STAGING
SIMULATION mode today: the envelope schema, worktree isolation planner,
reviewer-separation rules, GREEN/YELLOW classification, approval
gates, idempotent job spine, and full evidence chain all exist and are
tested. Agents built now would produce PROPOSALS and SIMULATED runs
only - by construction, not by promise: remote_runner_enabled=false,
execution_enabled=false, no spawn API in the runtime path (structurally
pinned by test), and no autonomous loop exists. Building agents does
NOT require enabling execution.

## 8. Recommended next phase

BEGIN BUSINESS-AGENT CONSTRUCTION on the staging-safe platform, while
keeping every approval gate and leaving autonomous execution disabled.
First candidates (highest owner leverage, lowest risk):
1. Quote-draft agent (Airtable TEST reads -> draft quote proposals
   into the approval queue; zero sends).
2. Daily-brief enrichment agent (existing /brief read-only sources ->
   structured morning packet).
3. Follow-up drafting agent (drafts only; Approval Center holds sends).
Each agent ships as: envelope definition + simulation run + owner
review packet. No new capability class is enabled.

## 9. 30/60/90-day technical roadmap

- 30 days: close N1-N3; owner pushes + deploys the 6 closeout commits;
  0007 apply gate; Hermes 48 h soak (collect while building); first
  business agent (quote-draft) end-to-end in simulation.
- 60 days: 0008 apply gate; connector activation gate (ChatGPT first -
  regate + runtime client, then live proposal trace); /os heartbeat +
  dead-letter surfaces; logrotate + fetch timeout hardening; second
  agent (daily brief).
- 90 days: execution pilot design gate (bounded GREEN reads pilot,
  e.g. repo-status jobs actually executing read-only commands under
  lease fencing + checkpoint fencing fix); third agent; production
  promotion criteria review with the evidence binder complete.

## 10. Prioritized backlog (safety > reliability > leverage > value > effort)

1. (safety) Owner ratification of a1a3cfd scanner parity edit.
2. (safety) N2 phone pause/resume micro-drill + N1/N3 archives.
3. (safety) 0007 apply gate incl. SEC-1 breadth note + rollback drill.
4. (safety) Checkpoint lease-generation fencing (ARCH-2) - before any
   execution gate.
5. (reliability) /os heartbeat/last-firing surface (OPS-11) - dead
   timer visible from phone.
6. (reliability) Dead-letter wiring + owner surface (OPS-13).
7. (reliability) Unit-file bound tidy (TimeoutStartSec vs
   RuntimeMaxSec), logrotate, app-level fetch timeout, stale-temp
   cleanup on bootstrap.
8. (leverage) Quote-draft agent in simulation (sec 8).
9. (leverage) ChatGPT connector activation gate (regate + runtime
   identity client + live trace).
10. (value) Telegram activation gate (proxy exclusion, durable dedup
    binding, freshness future-date fix).
11. (value) Daily-brief + follow-up agents.
12. (effort/hygiene) Migrate table-agnostic test fakes (TEST-F4);
    NEXT_GATES.md dated rulings (P7); npm audit moderates review.

## Owner decision requested

- [ ] Accept Phase 5 closeout PASS WITH NOTES (sign attestation in the
      closeout report) and run owner actions 1-6 there.
- [ ] Approve next phase: business-agent construction in simulation
      (sec 8), approval gates retained, execution disabled.
- [ ] Schedule the 0007 apply gate (first promotion prerequisite).
