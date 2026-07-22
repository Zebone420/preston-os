# PRESTON AI OS - PHASE 7 ORCHESTRATION SPECIFICATION v1

Date: 2026-07-22. Status: coded + tested + simulation-proven; NOT
deployed, NOT activated. Baseline commit 10305689.

## 1. Position and principle

Phase 7 adds a pure orchestration layer ABOVE the existing job
runtime (queue/os_jobs, leases, checkpoints, commands, controls,
hermes, bridges, envelope). Nothing below was rewritten. The
layer turns owner goals into dependency-ordered simulation jobs
and drives them to closure with bounded, fail-closed control and
owner-gated approvals. Target: owner-SUPERVISED autonomy - the
system does all safe local work automatically and stops only at
genuine owner gates.

## 2. Module map (apps/dashboard/src/lib/ai-os/orchestration/)

- model.ts - MasterGoal, GoalJob, ExecutionBudget, GoalState;
  staging + simulation_only hard-pinned; validators fail-closed.
- agent-contracts.ts - default-deny capability registry for
  chatgpt/claude/codex/hermes/audit. UNIVERSAL_PROHIBITIONS +
  per-agent contracts; can_approve pinned false everywhere; no
  network; capability check denies unless explicitly granted.
- policy.ts - approval policy engine. classifyRisk reuse +
  mobile-gate taxonomy (RED). classifyJob: bounded worktree
  simulation work is GREEN; objectives naming gated actions are
  RED + approval. Fail-closed on empty/non-staging.
- approvals.ts - one-time, scoped, actor-bound, hash-bound,
  expiring, replay-protected approval requests + decision
  validation; no-self-approval; secret rejection. SIMULATION
  (no real send).
- decomposition.ts - deterministic topological decomposition
  (cycle/dangling rejected), capability-based role assignment,
  budget-size enforced.
- completion-engine.ts - pure bounded step() state machine:
  assign/run/approve/retry/audit/dead-letter/escalate; caps on
  iterations, retries, wall-clock; dead-letters repeated failure;
  blocked on approval; deterministic closure; fail-closed on
  stuck graphs.
- adapters.ts - AgentAdapter interface + simulation adapter
  (executed:false, simulated:true, contract-guarded); real
  capability probe fail-closed to 'unavailable'.
- coordinator.ts - Hermes coordinator ladder (observe_only ->
  coordinator_simulation -> coordinator_staging ->
  production_candidate) + observeAndReconcile (intents only;
  can_approve/can_execute pinned false).
- goal-intake.ts - authenticated command envelope -> MasterGoal;
  owner-allowlist, nonce replay, expiry, secret rejection,
  default-deny.
- orchestrator-sim.ts - end-to-end driver: intake-decompose-run
  in memory with an injected approval oracle; blocked-fixpoint
  parks on owner approval; any_executed/any_sent pinned false.

Data model: migration 0010_phase7_orchestration.sql (authored,
NOT applied) - master_goals, goal_jobs, job_dependencies,
agent_contracts, orchestration_approvals; owner-only RLS; anon
revoked; DB CHECK pins simulation_only/environment/executed/
can_approve/network_scope.

UI: /os/orchestration (read-only): contracts, coordinator ladder,
runtime safety posture. Goal/job rows appear post-0010.

## 3. Control chain

owner (ChatGPT/Telegram) -> command envelope -> goal-intake
(auth + fail-closed) -> MasterGoal -> decomposition (dependency
graph, role assignment, per-job policy) -> completion engine
(bounded loop) -> per job: policy GREEN => simulation adapter
runs (executed:false); RED/mobile => approval request parked for
the owner -> coordinator observes/reconciles/escalates -> closure
(completed/failed/dead_lettered/blocked). Every artifact carries
correlation ids; every gated step is default-deny.

## 4. Invariants (each has a test or DB pin)

- Nothing executes: adapters executed:false; structural pins ban
  spawn/network/send tokens in all 10 orchestration files.
- No self-approval: approval validation rejects decided_by ==
  requesting agent; contracts can_approve:false.
- Owner-only approval: decision actor must equal the request's
  owner_identity; hash-bound; one-time nonce; expiring.
- Staging-only + simulation-only: model + migration hard-pin.
- Bounded: iteration/retry/wall-clock caps; deterministic stop;
  dead-letter on repeated failure; fail-closed on ambiguity.
- Real agent capability is 'unavailable' until an owner gate.
- Existing runtime flags untouched: execution_enabled=false,
  remote_runner_enabled=false, hermes_mode=observe_only.

## 5. State terminology (Phase 7 as of this doc)

designed+coded+tested+audited+documented+committed: yes.
pushed/deployed/activated: no. simulated: yes (the whole chain).
staging-ready: the code + migration are; activation is gated.
production-ready/active: no, and not claimed.

## 6. What is deliberately NOT built yet (minimal-implementation)

Real Claude/Codex adapters (gated stubs only); real Telegram/
ChatGPT send paths (simulation only); the coordinator_staging and
production_candidate rungs; the full 5-agent business pack (its
contract is documented; recommendations already exist in the
business layer). These are staged behind the activation ladder.
