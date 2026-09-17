# ECC P0 Worker Playbook for Preston OS

This file adapts selected ECC methods to Preston's bounded-worker model. It is guidance only. The task prompt, `WORKER_CONTEXT.md`, Preston Control policy, allowed paths, and owner gates always win.

## 1. Agent architecture audit

Use when an agent, scheduler, runner, bridge, memory layer, or multi-step workflow is misbehaving or before promoting an agent-stack change.

Audit these layers with evidence:

1. system/task prompt assembly
2. session/context carryover
3. persistent memory/context injection
4. summarization/distillation
5. active recall/retrieval
6. tool selection/routing
7. tool execution
8. tool-output interpretation
9. result shaping
10. transport/rendering
11. hidden retry/repair/fallback loops
12. persistence/cached state

For each finding report: severity, symptom, mechanism, source layer, root cause, file:line evidence, confidence, and smallest code-first fix. Do not blame the model until wrapper/runtime causes are falsified.

Preston-specific mandatory checks:

- tool requirements must be code-gated where consequential;
- approval cannot be inferred from prose or worker output;
- worker result text cannot become execution authority;
- provider/model routing must remain deterministic and auditable;
- retries must not create duplicate job authority or replay approvals;
- terminal states must not starve newer queued work;
- result/evidence transport must not silently mutate status;
- stale SSOT reads must not be presented as live proof.

## 2. Security scan methodology

Use ECC/AgentShield concepts as an **additional advisory detector**. Never interpret a clean advisory scan as authorization.

Review at minimum:

- hardcoded secret/token/key shapes;
- unrestricted shell/tool permissions;
- dangerous hook interpolation or command injection;
- shell-running MCP/tool servers;
- silent error suppression around security checks;
- supply-chain auto-install behavior;
- prompt/config instructions that auto-run consequential actions;
- agents with unnecessary write or Bash access.

Preston-specific rule: existing Preston secret scanners, RED boundary scanners, `githooks/pre-commit`, capability gates, approvals, allowed-path audits, and owner gates remain authoritative. P0 does not run `--fix` or install AgentShield automatically.

## 3. Verification loop

Before claiming a Preston implementation task complete, run the verification allowed by the task scope. From `apps/dashboard/`, the canonical checks are:

- focused tests for changed behavior;
- `npm test` when scope permits full regression;
- `npm run typecheck`;
- `npm run lint`;
- `npm run build:os-runtime` when runtime code is touched;
- diff/status review of every changed path;
- Preston safety scanner/hook evidence when a commit is permitted.

Never delete tests to go green. Never weaken a fail-closed check merely to pass a test. If the environment prevents a check, report it as NOT RUN with the concrete reason.

## 4. Parallel-execution optimization

Use the ECC lane-planning method, but Preston remains the only executor.

Before parallel work, define:

`Lane | dependency | write surface | risk | verification`

Parallelize only independent lanes with non-overlapping write surfaces or isolated Preston worktrees. Consequential operations, migrations, shared-table writes, deploys, and safety-policy changes remain gated/sequential. Merge or promotion occurs only after evidence reconciliation.

Do not launch ECC's tmux/worktree orchestrator in P0.

## 5. Multi-model council critique

Use for ambiguous or high-consequence architecture decisions when an independent critique adds value.

- first produce the primary analysis;
- preserve strongest dissent rather than voting it away;
- send only the minimum review packet to another model when the active Preston task explicitly permits that provider/tool path;
- label same-provider vs cross-provider review honestly;
- treat critique as advisory only;
- final authority stays with Preston Control / owner approval.

A council result cannot approve, deploy, alter credentials, apply migrations, weaken policy, merge, or push.

## 6. Cost-aware model recommendations

ECC cost-aware routing is advisory. Preston's deterministic routing table is authoritative.

Recommended reasoning:

- simple documentation/classification may use lower-cost models;
- code/repair/migration work should use strong coding models;
- security/architecture audits should use strong reasoning/review models;
- retries should be narrow and only for transient failures;
- every selected model/reason should remain auditable.

Do not dynamically override `ORCH_MODEL_*` values from worker reasoning. Do not mutate environment configuration.

## P0 forbidden actions

Do not run or install:

- `ecc setup`, `ecc install`, `ecc repair`, ECC auto-update, or ECC auto-fix;
- ECC hooks or GateGuard as an enforcement layer;
- ECC memory writes/MCP server;
- ECC control plane/control pane;
- ECC tmux/worktree execution;
- MCP config mutations.

Do not modify `.env*`, credentials, `githooks/`, safety scanners, RLS/policies, production deployment configuration, or owner approval semantics unless the task prompt explicitly opens a separately approved Preston gate.

## Result expectations

ECC methods should improve the quality of a Preston result, not create a second authority system. Evidence belongs in Preston's normal result/evidence contract and SSOT flow.
