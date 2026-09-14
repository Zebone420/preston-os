# Preston ECC P0 Capability Pack

Status: **STAGING / REVIEW ONLY**. This integration adds no execution authority and activates no external service.

Upstream reviewed: `affaan-m/ECC` at commit `8321021c54d670126ce3b2969d5deb880b4b0c2a` (ECC 2.2.1 era).

## Authority boundary

Preston Control remains the sole authority for goals, jobs, approvals, actor identity, leases, provider selection, model routing, allowed paths, worktree provisioning, execution, audit evidence, and promotion. Supabase remains the Preston SSOT. Existing Preston safety guards and owner gates remain authoritative.

ECC is used only as a **worker capability/reference layer** in P0.

## Enabled in P0

- agent architecture audit methodology
- security-scan / AgentShield methodology as an advisory detector
- verification-loop discipline mapped to Preston's canonical commands
- parallel-execution planning methodology while Preston remains the executor
- multi-model council critique as advisory review only
- cost-aware model-selection recommendations, while Preston's deterministic routing table remains authoritative

## Explicitly disabled in P0

- ECC hook installation or hook mutation
- GateGuard as an enforcement authority
- `ecc setup`, `ecc install`, `ecc repair`, auto-update, or auto-fix
- ECC control plane / control pane
- ECC worktree/tmux orchestration as an executor
- ECC memory writes or MCP memory server
- MCP configuration changes
- credential, environment, database, deployment, RLS, policy, or production changes
- any bypass, weakening, replacement, or editing of Preston safety scanners or `githooks/`

## P0 use

Workers may consult `integrations/ecc/P0_WORKER_PLAYBOOK.md` when the assigned task matches one of the approved capability lanes. The task prompt and `WORKER_CONTEXT.md` remain authoritative. ECC-derived guidance never expands allowed paths, tools, network access, execution authority, or approval scope.

## Promotion criteria

No ECC runtime component may be enabled until a separate owner-reviewed gate proves:

1. no collision with Preston hooks or safety guards;
2. no alternate SSOT or approval path;
3. no unbounded network/tool access;
4. no worker ability to self-promote memory, rules, or policy;
5. clean focused tests, full regression, typecheck, lint, runtime build, and security scan;
6. rollback is documented and verified in staging.

See `integrations/ecc/P0_CAPABILITIES.json` for the machine-readable policy.