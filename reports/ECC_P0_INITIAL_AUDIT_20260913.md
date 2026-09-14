# ECC P0 Initial Architecture Audit — Preston OS

Date: 2026-09-13
Baseline: `master` @ `2d447d52077719c76dd2d611958d3e774abb5b4a`
ECC reference: `affaan-m/ECC` @ `8321021c54d670126ce3b2969d5deb880b4b0c2a`
Mode: read-only architecture/security review; no runtime activation.

## Executive verdict

**Proceed with selective ECC capability integration. Do not install ECC as a control plane or executor.** Preston already owns the consequential authority surfaces and has stronger system-specific fail-closed controls for jobs, approvals, worktrees, model routing, and SSOT.

## Findings

### HIGH — GitHub baseline may lag active local build state

The pushed `master` head is dated 2026-09-01 while active Preston build work continued after that date. This audit can prove only the pushed GitHub state. Before promotion of any ECC runtime component, reconcile the authoritative local/server HEAD and require a clean exact-head evidence packet.

Recommended fix: no runtime integration promotion until the owner/Preston runtime proves the authoritative HEAD and compares it to this branch.

### MEDIUM — `master` is not GitHub-protected

GitHub reports the current `master` branch as unprotected with no required status checks. Preston's internal owner gates and safety model remain the primary authority, but repository-host protection would provide an additional independent barrier against accidental direct writes.

Recommended fix: evaluate branch/ruleset protection as a separate owner-approved gate. Do not change it as part of ECC P0.

### PASS — Worktree confinement covers committed and uncommitted changes

A prior production audit identified that status-only confinement was blind to changes hidden in a local commit. Current `master` explicitly audits both `git status --porcelain -uall` and `git diff --name-only --no-renames <base> HEAD`, unions those surfaces, and fails closed if the authoritative base cannot be verified.

This is stronger and more Preston-specific than replacing execution with ECC's generic tmux/worktree orchestrator.

### PASS — Preston model routing should remain authoritative

Preston already has a deterministic, versioned, owner-configured per-kind model routing table. ECC cost-aware routing should remain advisory only; worker reasoning must not mutate `ORCH_MODEL_*` environment values or override provider/model decisions.

### PASS — Existing worker contract cleanly bounds ECC

`WORKER_CONTEXT.md` already defines isolated worktrees, scoped tasks, no network/external services, no credential or hook edits, no deploy/push/merge, and explicit result evidence. ECC P0 can fit under that contract without changing authority.

### PASS — ECC security tooling is best used as a second opinion

AgentShield-style checks add useful coverage for agent configuration, unrestricted tool permissions, hook injection, MCP risks, and supply-chain auto-install behavior. They should supplement — never replace — Preston secret scanning, RED boundary checks, pre-commit safety hooks, path confinement, approvals, and owner gates.

## P0 decision matrix

| Capability | P0 decision |
| --- | --- |
| agent architecture audit | ENABLE as guidance |
| AgentShield/security scan methodology | ENABLE advisory-only |
| verification loop | ENABLE, mapped to Preston commands |
| parallel execution optimizer | ENABLE planning-only |
| council multi-model critique | ENABLE advisory-only when task/provider path permits |
| cost-aware LLM recommendations | ENABLE advisory-only |
| ECC hooks | DISABLED |
| GateGuard enforcement | DISABLED |
| ECC auto-fix / repair / update | DISABLED |
| ECC memory writes / memory MCP | DISABLED |
| ECC control plane / control pane | DISABLED |
| ECC tmux/worktree executor | DISABLED |

## Next gate

P0 is documentation/policy only. The next safe step is to have Claude and Codex use the P0 playbook on isolated audit/review tasks and compare whether it improves defect detection and verification quality. No ECC runtime component should be promoted until those trials are independently reviewed and exact-head reconciliation is complete.
