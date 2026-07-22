# PHASE 7 - AUDIT RECONCILIATION (Claude + Codex)

Date: 2026-07-22. Repair baseline commit: c50221e (local,
UNPUSHED). Reconciles two independent adversarial audits (Claude
subagent + Codex read-only at d6084be) against repository
evidence, records fixes, and states the HONEST durable-capability
position.

## Honest scope statement (durable capability, not file count)

Phase 7 as of c50221e is a PURE, TESTED SIMULATION of the
orchestration control chain. It is NOT a running system:
- NO durable worker exists (the completion engine is a pure
  step() function; there is no process observing a persistent
  queue, acquiring leases, or recovering from restart).
- Migration 0010 is AUTHORED + statically tested, NOT applied -
  so NO orchestration data is persisted anywhere yet.
- Adapters are SIMULATION only (executed:false); real Claude/
  Codex capability is fail-closed 'unavailable'.
- Worktree isolation is SIMULATED (the existing worktree.ts
  produces an argv PLAN; no atomic lock is enforced by Phase 7).
- The UI is a read-only POSTURE view (contracts + ladder +
  flags); it shows no persisted goal/job rows until 0010 applies.
Nothing here should be counted as real activation.

## Findings and dispositions

| # | Source | Finding | Disposition |
|---|--------|---------|-------------|
| 1 | Codex | goal_jobs.approval_id referenced legacy approvals(uuid), mismatching the Phase 7 text approval lifecycle | FIXED c50221e: approval_id text + deferred FK to orchestration_approvals(approval_id); packet+tests updated |
| 2 | Codex | no durable orchestration persistence path | OPEN (gated): the store adapters + a durable driver are the next gate; requires 0010 applied (owner). Documented as Level-1 prerequisite; NOT claimed done |
| 3 | Codex | worktree lock is echo/planning, not atomic | OPEN (gated): real atomic lock is a Level-1 prerequisite; the existing worktree.ts + worktree_prepare.sh remain PLAN-only (unchanged). Honestly marked simulated |
| 4 | Both | approval oracle could clear requires_approval directly | FIXED c50221e: orchestrator-sim now routes every decision through makeApprovalRequest + validateApprovalDecision (owner-bound, hash-bound, one-time, expiring); no bypass |
| 5 | Both | actionHash is 32-bit FNV (non-crypto) | FIXED (defined): crypto-binding.ts adds SHA-256 canonical action hash for activation; FNV explicitly marked non-authoritative + banned as activation evidence (threat model) |
| 6 | Both | timestamp validation gaps (NaN expiry bypass, no skew, reversed/pre-creation) | FIXED c50221e: one CLOCK_SKEW_MS policy; fail-closed on invalid/reversed/expired/future in both goal-intake and approvals |
| 7 | Codex | approval fields mutable via broad owner update policy | FIXED c50221e: column-level grant restricts update to (status, decided_at, nonce); action/hash/owner immutable |
| 8 | Codex | dependency edge could cross goals | FIXED c50221e: composite same-goal FKs on job_dependencies + unique(id,goal_id) on goal_jobs |
| F2 | Claude | in-flight job false-dead-lettered as stuck graph | FIXED c50221e: inFlight state => running, not dead_lettered; regression test added |
| F5 | Both | type-confusion could throw | FIXED c50221e: string guards in goal-intake + approvals, fail-closed |
| F6 | Claude | goal source unvalidated in TS | FIXED c50221e: GOAL_SOURCES check in validateMasterGoal |
| F7 | Claude | max_wall_ms unbounded | FIXED c50221e: <=24h cap |
| F8 | Claude | unique(nonce) allowed NULLs | FIXED c50221e: nonce NOT NULL |
| F9 | Claude | migration comment omitted 0004 | FIXED c50221e |

Open items 2, 3 are DURABLE-RUNTIME gates, correctly not claimed
as complete. Everything else is fixed + tested at c50221e.

## Corrected completion (durable-capability weighted)

Using the amendment's weights and the "don't count simulation as
real" rule:

| Category | Weight | State | Credit |
|---|---|---|---|
| 1 Recon + gap | 5 | committed | 5.0 |
| 2 Data model + migration | 10 | authored+tested, NOT applied (no persistence) => coded/tested cap | 5.0 |
| 3 Registry + policy | 10 | committed, tested | 9.0 |
| 4 Worktree coordinator | 8 | SIMULATED only (no atomic lock) => designed cap | 1.6 |
| 5 Claude adapter | 8 | simulation only (real unavailable) => coded-sim | 3.0 |
| 6 Codex adapter | 8 | simulation only | 3.0 |
| 7 Hermes coordinator sim | 8 | committed, tested | 7.0 |
| 8 ChatGPT bridge | 8 | intake coded+tested, no durable/auth transport => 50% | 4.0 |
| 9 Telegram approval sim | 7 | validator coded+tested, no real send => sim | 3.5 |
| 10 Completion engine | 10 | pure, tested; NO durable worker => not "continuous" | 5.0 |
| 11 Command Center UI | 7 | posture view only, no read model of persisted rows | 2.0 |
| 12 Health/ops | 4 | reuses existing; no new durable ops | 1.0 |
| 13 Threat model + safety tests | 4 | committed, 2 audits reconciled | 3.6 |
| 14 Validation + activation packets | 3 | committed | 2.7 |

VERIFIED PHASE 7 COMPLETION: ~55% of the Level-0 simulation
objective; ~34% of the full owner-supervised orchestration
objective (durable runtime, real adapters, real isolation, real
transports all gated/unbuilt). This aligns with Codex's
independent estimate (Level-0 ~80% was optimistic vs the
durable-capability rule; full ~35% matches).

## Exact next implementation gate (durable runtime)

G-D1 (owner): apply migration 0010 to staging (packet).
G-D2 (Claude, after G-D1): store adapters for master_goals/
goal_jobs/job_dependencies/orchestration_approvals reusing the
lib/ai-os/store.ts idiom (idempotent, CAS, owner-RLS), + a
durable driver that reads persisted state, acquires an os_jobs
lease per goal-job, checkpoints, and resumes after restart -
reusing the EXISTING leases/checkpoint/queue modules (no
duplicate persistence). This is where "continuous" becomes true.
G-D3 (owner): activation-ladder Level 1 - real Claude adapter in
an atomic worktree lock (new lock design) behind runner.ts
allowlist.

## Codex package P7-CX-01 - READY

Pinned commit: c50221e (tree clean). The reserved file
apps/dashboard/test/orchestration-security-regressions.test.ts
does NOT exist and is NOT touched by Claude, so Codex may create
it without conflict. Scope: adversarial security regression tests
only; Codex must edit no existing file. Recommended coverage:
approval replay/expiry/hash/actor matrices, timestamp fuzz,
contract default-deny fuzz, policy obfuscation inputs (defense in
depth for F3), migration static pins - all additive.
