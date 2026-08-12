# P2 - PRODUCTION HOST + BOUNDED CLAUDE EXECUTION PACKET v1

Date: 2026-08-12. Status: PLAN + inventory. Nothing here activates
anything. Baseline: PRESTON_GOLDEN_STAGING_BASELINE.md (staging host
posture) + PRESTON_P1_GATE_REPORT.md (prod surface/identity live).

## 1. Host decision (OWNER DECISION REQUIRED)

Option (a) shared staging host, separated env files + identities:
  cheapest, fastest; blast-radius caveat (one kernel/systemd/firewall
  serves both envs; a host compromise or timer misconfiguration crosses
  environments; staging is a protected golden reference).
Option (b) dedicated production host (preston-agent-prod):
  cleanest isolation; mirrors the proven staging hardening 1:1
  (drop-by-default firewall, key-auth-only, service user, systemd
  sandboxing); cost ~= one more CPX-class Hetzner instance.

RECOMMENDATION: (b) dedicated host. Matrix default, owner preference
("prefer a dedicated production host"), and it preserves the sealed
staging baseline untouched. All following sections assume (b); the
runbook notes the (a) deltas in case cost forces it.

## 2. Environment-generalization inventory (the P2 code gate)

Principle: every current invariant "X must be literally 'staging'"
becomes "X must equal THIS deployment's pinned environment", where the
pinned environment comes from SUPABASE_RUNTIME_ENV via ONE shared
module and is allowlisted to exactly 'staging' | 'production'
(anything else fails closed). Equality invariants stay; only the
constant generalizes. Business-layer pins are OUT OF SCOPE (P3 RED).

New module: src/lib/ai-os/runtime-environment.ts
  runtimeEnvironment(env): 'staging' | 'production' (throw/refuse
  otherwise). Reused by web tier (remote-surface-env stays as the
  route-facing allowlist) and os-runtime.

Code sites to generalize (each keeps its fail-closed shape):
  1. os-runtime/dispatcher.ts:118 staging_gate -> allowlist gate;
     log line renames to environment_gate (keep fail-closed).
  2. lib/ai-os/execution-capability.ts:75 same generalization.
  3. lib/ai-os/real-claude-adapter.ts:183 env gate; :244/:261
     goalEnvironment must equal deployment env (was 'staging').
  4. orchestration/model.ts:97,153 MasterGoal.environment type widens
     to the allowlist; validation = equality with deployment env.
  5. orchestration/store.ts:70,273,335 forced writes use deployment
     env; :410 verifyAuthoritativeApproval equality check vs
     deployment env.
  6. orchestration/agent-contracts.ts:50,70-148 environment_scope =
     deployment env; validator checks equality not literal.
  7. orchestration/crypto-binding.ts:17,97 activation hash binds the
     actual deployment env (hash input changes ONLY for production
     rows; staging hashes unchanged).
  8. orchestration/goal-intake.ts:124 composer stamps deployment env.
  9. orchestration/composer-persist.ts:169 same.
 10. orchestration/driver.ts:128 goal state carries deployment env.
 11. orchestration/policy.ts:63 policy env check = allowlist member +
     equality with deployment (production keeps YELLOW max-risk rule
     identical to staging; NO risk loosening).
 12. lib/ai-os/candidates.ts / staging-sim path: keep the DB-command
     env gate, generalized.
 13. dispatcher.ts:297 simulation residue filter: environment
     comparison generalizes (still refuses mismatched env rows).
 14. envelope.ts stays PINNED to 'staging' (0008 envelope columns do
     not exist in prod; envelope path is staging-only until its own
     gate) - document, do not widen.
 OUT of scope (stay pinned): app/business/* (P3), approvals-store
 default (business), api/os/chatgpt legacy route (own gate),
 audit.ts default (callers pass explicit env).

Tests: every touched invariant gets both directions - staging
deployment behaves byte-identically (regression), production
deployment accepts only 'production' rows and refuses 'staging' rows
and vice versa (no cross-env consumption).

## 3. DB layer (OWNER-APPLIED migration 0017, prod AND staging)

0017_environment_production.sql (draft to be authored at
implementation time, applied at the P2 gate):
  - widen CHECKs to in ('staging','production'):
      master_goals.environment, goal_jobs.environment,
      agent_contracts.environment_scope (0010 pins).
  - new single-row table runtime_deployment(id 'self' pk,
    environment text check in ('staging','production')), owner-only
    RLS, anon zero; seeded 'production' in prod / 'staging' in
    staging by the owner at apply time.
  - re-create read_ssot_status (0013) replacing the hardcoded
    'environment','staging' pair with a read of runtime_deployment
    (fallback 'staging' when the row is absent, preserving current
    staging behavior).
  Defaults stay 'staging' (a row with no explicit env can never claim
  production). goal_jobs.executed CHECK and simulation pins are NOT
  touched.

## 4. Runtime posture port (owner-run, mirrors staging exactly)

From the golden baseline, identical hardening on preston-agent-prod:
  - service user preston-worker (HOME=/var/lib/preston/worker),
    Claude CLI at /var/lib/preston/worker/.local/bin/claude,
    interactive /login as the service user (setup-token does NOT
    persist) - FRESH prod Claude credential, never staging reuse.
  - systemd: preston-orchestrator.timer (~5min) ENABLED at drill time
    only; worker + hermes-observe timers DISABLED; unit Type=oneshot,
    TimeoutStartSec=3600, SuccessExitStatus=75, flock-serialized,
    ProtectSystem=strict, exact ReadWritePaths
    (/var/lib/preston/worker /srv/worktrees /srv/preston-os/.git).
  - worker.env: SUPABASE_RUNTIME_ENV=production, prod SUPABASE_URL,
    prod runtime key/token via SUPABASE_RUNTIME_TOKEN_STORE (one-time
    --bootstrap, atomic store, owner-identity NOT service-role),
    ORCH_BASE_COMMIT=<full hash of the P2-reviewed tip>,
    ORCH_CLAUDE_EXECUTABLE=<path>, CHILD_ENV_ALLOWLIST with NO token
    vars (file-based credential only).
  - db-health gate generalizes with the code change (currently
    staging-allowlist + prod-URL refuse - it must learn the same
    deployment-equality rule; refuse cross-env URL/env mismatch).
  - firewall: drop-by-default, TCP/22 key-auth from owner /32s only.
  - /srv/preston-os clone pinned (detached) at ORCH_BASE_COMMIT;
    /srv/worktrees empty.

## 5. Drill ladder at P2 activation (owner-run, in order)

  D-P2-1 CONSUME: orchestrator tick consumes the two parked P1 intake
    rows through the composer (validation/risk/approval gating);
    expect goals+tasks rows with environment='production',
    actor attribution preserved, no execution (capability env absent).
  D-P2-2 APPROVALS: park -> owner approve -> resume once (0010
    lifecycle, nonce/hash/expiry); then owner_stop=true global halt
    drill (exit 75) and reset.
  D-P2-3 BOUNDED EXECUTION x2: execution capability env + DB posture
    flipped by owner; ONE doc-only Level-1 goal (risk<=YELLOW, path
    allowlist); PASS = real:*:completed:executed:true +
    real-audit:paths_ok:clean, worktree created AND removed, no sim:*
    fallback; then one repeat for repeatability. Codex/Hermes/n8n
    stay disabled throughout.

## 6. Rollback (all inherited, per layer)

  Timer disable; owner_stop=true SQL halt (drill-proven); capability
  env off; per-actor disable; env-flag blanking (routes 503); host
  re-pin $PREV; Vercel instant rollback; 0017 reverse block (narrow
  CHECKs back after verifying no production-labeled rows remain).

## 7. Owner cost/effort summary

  One Hetzner instance (~EUR 5-10/mo), ~45-60 min provisioning
  following the staging packet with prod deltas, one Claude service
  login, two short drill sessions. Everything else is agent-side.
