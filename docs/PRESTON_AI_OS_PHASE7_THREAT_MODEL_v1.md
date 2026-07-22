# PRESTON AI OS - PHASE 7 THREAT MODEL v1

Date: 2026-07-22. Scope: the orchestration layer + its intake and
approval surfaces. Each threat lists the mitigation and where it
is enforced (code + test). "Structural pin" = a text-level test
that fails if the mitigation is removed.

| # | Threat | Mitigation | Enforced |
|---|--------|-----------|----------|
| T1 | Prompt injection in a goal objective | objective is DATA, never instruction; secret text rejected; classifyJob escalates gated keywords to RED+approval | goal-intake secret reject; policy; orchestration.test |
| T2 | Malicious repo instructions steer an agent | agents run in simulation only (executed:false); real capability fail-closed; adapters contract-guarded; no spawn/network (structural pins) | adapters; orchestration-structural.test |
| T3 | Compromised agent proposes a dangerous action | default-deny contracts; agentMayProposeRisk caps risk; policy RED+mobile gate; no agent can approve | agent-contracts; policy; tests |
| T4 | Command spoofing (fake owner goal) | envelope requires allowlisted owner_identity, nonce, expiry; fail-closed | goal-intake; orchestration-e2e.test |
| T5 | Replay of a goal/approval | one-time nonce with caller seen-set; approval nonce unique; expiry | goal-intake; approvals; tests |
| T6 | Approval spoofing / wrong action | action_hash binds action+resource+env; decision must present the exact hash; actor must be owner | approvals; tests |
| T7 | Self-approval / agent collusion | validateApprovalDecision rejects decided_by==requesting agent; contracts can_approve:false | approvals; agent-contracts; tests |
| T8 | Telegram takeover | approval router is simulation-only; owner allowlist; no real send without an owner activation gate; signed-callback design deferred to that gate | approvals doc; activation ladder |
| T9 | Token/secret leakage | hasSecretText rejects secrets in goals + approval messages; no secret in any orchestration file (scanner + structural pins) | goal-intake; approvals; secret scan |
| T10 | Worktree escape / path traversal | worktree coordination reuses the existing worktree.ts allow-path + lock model (Phase 3, unchanged); adapters never touch paths in simulation | worktree.ts (existing); adapters |
| T11 | Shell/command injection | orchestration modules spawn NO process (structural pins ban child_process/exec/spawn); adapters produce evidence, never argv | orchestration-structural.test |
| T12 | Runaway execution / cost | iteration/retry/wall-clock/max-jobs budgets; dead-letter; harness max-steps; deterministic stop | completion-engine; model; tests |
| T13 | Audit-log tampering | audit remains append-only (audit_log/os_events, existing); orchestration writes go through owner-RLS tables; no delete grant in 0010 | migration 0010; existing audit |
| T14 | Privilege escalation across agents | no agent inherits authority; each contract standalone; universal prohibitions checked regardless of contract | agent-contracts; tests |
| T15 | Production-boundary crossing | environment hard-pinned 'staging' (model + migration CHECK); non-staging fails closed to RED; execution/runner flags untouched | model; policy; migration |
| T16 | Dependency attack (new npm deps) | Phase 7 added ZERO runtime dependencies; pure TS only | package.json unchanged |
| T17 | Stuck/blocked goal masquerading as progress | fixpoint detection parks blocked goals; coordinator escalates stalls; no silent success | orchestrator-sim; coordinator; tests |
| T18 | Malicious test script in a job | jobs are simulated; no test is actually executed by an adapter in this phase; real test execution is a future gated adapter capability | adapters (simulation) |

## Residual / deferred (owner-gated, not exploitable in simulation)

- Real Telegram signed callbacks + real ChatGPT signature
  verification are designed but land at the activation gate
  (no real send exists yet, so no live attack surface).
- Real agent adapters (Claude/Codex) introduce shell + network;
  they are 'unavailable' until an owner activation gate that must
  add sandboxing, allowlisted argv, and the existing runner.ts
  executable allowlist. Recorded as Level-1 prerequisites in the
  activation ladder.

## Audit-reconciliation update (2026-07-22, commit c50221e)

Two independent adversarial audits (Claude + Codex) were
reconciled in reports/PHASE_7_AUDIT_RECONCILIATION.md. Fixes
landed for: approval FK/type mismatch, oracle-bypass of the
approval validator (now every decision routes through
validateApprovalDecision), timestamp NaN/skew/reversed gaps (one
CLOCK_SKEW_MS policy), approval field immutability (column-level
grant), cross-goal dependency integrity (composite FKs), and the
crypto action binding. The 32-bit FNV actionHash is explicitly
NON-authoritative and BANNED as activation evidence; the
activation-grade hash is crypto-binding.ts SHA-256
(canonicalActionHash), tested. Durable-runtime items (persistent
worker, atomic worktree lock, real adapters/transports) remain
GATED and are honestly NOT claimed complete.

## High-risk findings requiring a structural test - status

All T1-T18 mitigations that are code-enforceable in this phase
have a passing test or DB pin (see the table's Enforced column).
No unmitigated high-risk finding remains inside the simulation
boundary. The real-adapter and real-send surfaces are gated to
'unavailable'/'no real send' and carry no live risk yet.
