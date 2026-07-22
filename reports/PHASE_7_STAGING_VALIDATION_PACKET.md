# PHASE 7 - STAGING SIMULATION VALIDATION PACKET

Date: 2026-07-22. Proves the orchestration chain in SIMULATION,
locally, with evidence. No external system, no execution, no send.
Reproducible: `npm test` in apps/dashboard (the orchestration
suites) plus the structural pins and scanners.

## What is proven (test -> claim)

| Capability | Test evidence |
|---|---|
| Goal intake (auth, fail-closed) | orchestration-e2e.test: allowlist/nonce/expiry/secret rejects; control commands pass |
| Decomposition (dependency-ordered) | orchestration.test: topo order, determinism, cycle+dangling reject, budget-size reject |
| Job creation + role assignment | orchestration.test: audit->audit role; edit kinds->claude; capability-violation guard |
| Claude simulation adapter | orchestration.test/adapters: executed:false, simulated:true, write-scope guard |
| Codex simulation adapter | agent-contracts + adapters: codex contract present; simulation adapter generic over role |
| Hermes coordinator simulation | orchestration.test/coordinator: observe vs coordinator_simulation intents; can_approve/execute false |
| Worktree isolation | reuses existing worktree.ts (Phase 3 tests) + adapters simulate worktree, spawn nothing |
| Leases / heartbeats / retry / timeout / cancel | existing queue/leases tests + completion-engine: retry, dead-letter, deadline, iteration caps |
| Pause / resume / owner stop / global kill | existing controls/controlplane tests (unchanged); goal cancel path in engine |
| Approval creation + one-time/scoped/expiring/replay | orchestration.test approvals: hash, actor, nonce, expiry, self-approval-deny |
| Telegram approval simulation | approvals.renderApprovalMessage (no secret, no send); simulation-only |
| Duplicate approval handling | approvals: not_pending on second decision; nonce replay rejected |
| Audit completeness | correlation ids threaded goal->job->evidence; audit tables unchanged append-only |
| No external writes / no production access | structural pins ban network/send/external tokens across 10 files |
| No push / no deployment | orchestration code has no git/deploy surface; adapters simulate |
| execution_enabled stays false | controls untouched; adapters executed:false; migration executed CHECK=false |
| Remote Runner stays false | untouched; no orchestration path sets it |
| Hermes stays observe_only | DB hermes_mode untouched; coordinator ladder is a separate simulation concept |

## End-to-end scenarios (orchestrator-sim, all passing)

1. GREEN goal (code->test->audit) drives to `completed`;
   any_executed=false, any_sent=false; every adapter result
   executed:false/simulated:true.
2. RED goal (objective names production/deploy) parks at
   `awaiting_approval` and stays `blocked` under the HOLD oracle -
   never self-approves.
3. Same RED goal with an explicit owner approve -> `completed`.
4. Same RED goal with an owner reject -> job `cancelled`.
5. Retry-budget exhaustion -> `dead_lettered`; iteration cap ->
   escalate+stop; wall-clock deadline -> stop.

## How the owner extends this to live staging (future, gated)

Level 1+ of the activation ladder replaces the simulation adapter
with a real bounded worktree adapter and re-runs scenarios 1-2
against a real worktree (local commit, no push). That is an owner
gate; this packet proves the CONTROL LOGIC now, in simulation.

## Reproduce

cd apps/dashboard
npx vitest run test/orchestration.test.ts test/orchestration-e2e.test.ts \
  test/orchestration-structural.test.ts test/migration-0010.test.ts
# then the repo scanners (secret + RED boundary): 0 findings.
