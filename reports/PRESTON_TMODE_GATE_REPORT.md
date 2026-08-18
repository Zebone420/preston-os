# PRESTON CLAUDE + CODEX T-MODE GATE REPORT

Date: 2026-08-18. Packet: PRESTON_TMODE_OWNER_PACKET_v1.md (gate 3
of the final activation sequence).

## Gate result: PASS

One production team goal (a7b7abed) executed the full bounded chain
Claude (plan) -> Codex (implement) -> Claude (review, audit kind),
every job REAL under strict mode, in fenced per-job worktrees, from
one canonical SSOT, with complete durable attribution.

## Commit hashes (this gate)

- f55e146 fix(tmode): explicit claude/codex on audit-kind honored +
  regression tests (prose-form rejection pinned)
- 0da16b2 T-mode host-log evidence
- (this commit) tmode-01 canonical DB capture + this report

## Files changed

- apps/dashboard/src/lib/ai-os/orchestration/composer-persist.ts
  (role fix + buildJobs export for tests)
- apps/dashboard/test/tmode-compose-repro.test.ts (4 regressions)
- reports/p2_evidence/tmode_host_log_20260818.txt
- reports/p2_evidence/p2_tmode-01_20260818_012911.txt
- reports/PRESTON_TMODE_GATE_REPORT.md (this file)

## Commands / tests / environment

- Matrix at f55e146: 1313 pass + 1 xfail + 5 known env-class; tsc 0.
- Host repin 4983d3d -> f55e146 (owner-run over ssh, verified:
  HEAD == ORCH_BASE_COMMIT, tree clean, runtime rebuilt).
- Vercel prod redeployed at f55e146 (machine-verified twice: chunk
  fingerprint change + the successful role-correct composition).
- Orchestrator one-shots (flock-serialized; ZERO timers - F1 rule
  held in strictest form). Strict mode on throughout.

## PASS criteria (packet section 3) - all verified in
## p2_tmode-01_20260818_012911.txt + tmode_host_log_20260818.txt

1. Goal a7b7abed completed, environment=production, 3 jobs. PASS
2. claude jobs 08a71218/769d5b68 + codex job c567481c each carry
   real:*:attempt:1:completed:executed:true +
   real-audit:*:paths_ok:clean + real-provider:*:role:<own>. PASS
3. Review job 769d5b68 kind=audit assigned_role=claude REALLY
   executed (executed:true, no sim) - F3 live proof. PASS
4. Zero sim:* on executed jobs. real_required:* failures exist ONLY
   on superseded goals c049c964/4880f59d (root-caused, fixed,
   corrected rerun succeeded honestly) and the CX-5 revocation
   drill - exactly the F2 semantics the packet allows. PASS
5. No engine-default assignment on the passing chain: all roles
   explicit from the canonical Task-form text (pinned by
   tmode-compose-repro tests). Goal c049c964 shows the default-
   assignment shape being caught FAIL-CLOSED. PASS
6. Per-job wt-<jobId> worktrees created and removed; /srv/worktrees
   empty after every tick; no cross-job path overlap. PASS
7. Approval binding intact: stale graph 5d25fa51 approvals REJECTED
   and its jobs never ran; D-P2-2 authoritative-verification proof
   inherited. PASS
8. Safety invariants: controls exactly (execution t, remote t,
   owner_stop f, paused f, hermes disabled); approvals_pending 0;
   intake_pending 0; staging isolated; no RLS/allowlist/env change;
   CHILD_ENV_ALLOWLIST untouched. PASS

## Live defects found and fixed this gate

1. composer-persist dropped an explicit claude/codex request on
   audit-kind tasks -> review jobs landed on the adapter-less audit
   role and could never really execute (strict mode failed them
   honestly). Fixed f55e146 + 4 regression tests.
2. Free-prose team-goal text composes ZERO tasks (goal_1_has_no_
   tasks) - canonical Task-form text documented and pinned by test.
3. Deploy-sync gap (2nd occurrence): a claimed Vercel promote had
   not landed; established the machine check (chunk-fingerprint
   diff) that now verifies production deployments independently.

## Report flags

- Production touched: true (bounded, owner-authorized window)
- Secrets exposed: false (this gate; the CX-window DB-password
  incident is recorded in the Codex gate report)
- Live messages sent: false
- Live emails sent: false

## Next gate

Hermes (PRESTON_HERMES_PROD_DELTA_PACKET_v1.md): H1 staging proof
if still required, then H2 production. hermes_mode remains disabled
until that gate opens.

## Owner action required

None for this gate. Next gates queue: Hermes -> n8n -> ChatGPT live
SSOT read -> remote owner ops -> final multi-agent drill -> SSOT
activation.
