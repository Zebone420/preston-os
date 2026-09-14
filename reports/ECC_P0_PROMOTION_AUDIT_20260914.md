# ECC P0 Promotion Audit — 2026-09-14

Status: **REPOSITORY-SIDE P0 CLEAN; PROMOTION STILL BLOCKED ON OFF-GITHUB GOVERNANCE / HEAD RECONCILIATION.**

This report is evidence-only. It does not authorize merge, deployment, environment changes, database changes, production execution, or policy weakening.

## Baseline and scope

- Base at branch creation: `master` @ `2d447d52077719c76dd2d611958d3e774abb5b4a`
- P0 branch: `integration/ecc-p0-capability-pack`
- Draft PR: #2
- ECC behavior in P0: subordinate guidance/capability layer only.
- Explicitly disabled: ECC hooks, GateGuard enforcement, ECC setup/install/repair/auto-update, ECC control plane/control pane, ECC memory writes/MCP server, ECC tmux/worktree executor, MCP config mutation.
- Preston Control remains sole authority for approvals, SSOT, routing, execution, safety, evidence, and owner gates.

## Repository-side verification

Strengthened CI evidence before this report-only update: GitHub Actions run #164 (`34805538845`) on branch head `25c834182a1bf624c1c1d5b5d649a8ef1a9a9539`.

### Dashboard

- `npm ci`: **0 vulnerabilities**
- Blocking `npm audit --audit-level=high`: PASS
- ESLint: PASS
- TypeScript: PASS
- `npm run build:os-runtime`: PASS
- Vitest: **130 files passed**
- Tests: **1,798 passed + 1 expected fail**
- Preston secret scanner: **0 findings**
- Preston RED boundary scanner: **0 findings**

### Guards

- `npm ci`: **0 vulnerabilities**
- Blocking `npm audit --audit-level=high`: PASS
- TypeScript: PASS
- Tests: **25 passed**

The CI workflow uses `actions/checkout@v7` and `actions/setup-node@v7` with the repository's Node 24 runtime.

## Resolved findings

### P0-F1 — RESOLVED — dependency security exposure

Initial audit discovered a green CI run with 13 dashboard vulnerabilities (including one critical) and four guard-package vulnerabilities.

Narrow remediation completed:

- `next` `16.2.10` -> `16.3.5`
- matching `eslint-config-next` -> `16.3.5`
- `vitest` `4.1.9` -> `4.1.11` in dashboard and guards
- targeted lock refresh of vulnerable transitive packages, without install scripts or blanket `npm audit fix --force`
- permanent CI security gate added: `npm audit --audit-level=high` now fails the job on high/critical advisories

Issue #3 closed after final zero-vulnerability verification.

A non-vulnerability supply-chain warning remains intentionally unapproved: `unrs-resolver@1.12.2` declares a postinstall script not covered by npm `allowScripts`. P0 did not approve or enable it.

### P0-F4 — RESOLVED — GitHub Actions Node runtime warning

The old workflow used `actions/checkout@v4` and `actions/setup-node@v4`, which GitHub warned were Node-20-targeted while the runner forced Node 24.

Updated to:

- `actions/checkout@v7`
- `actions/setup-node@v7`

The strengthened CI run uses these v7 actions under Node 24 without the earlier Node-20 action-runtime warning.

### P0-F5 — PASS — committed-change confinement repair remains present

Current `worktree-provision.ts` audits the normalized union of:

- uncommitted/index/untracked paths from `git status --porcelain -uall`
- committed paths from `git diff --name-only --no-renames <base> HEAD`

It fails closed when the authoritative base SHA is missing, malformed, or not comparable. Regression coverage remains green.

## Remaining promotion blockers

### P0-B1 — HIGH — authoritative local/host HEAD is not proven from GitHub

The newest pushed `master` available through GitHub was dated 2026-09-01 when this integration began. Work performed later through Claude/Codex may exist only on a workstation, server, worktree, or other unpushed state.

Required on the authoritative Preston host/workstation before merge:

```text
git status --short
git branch --show-current
git rev-parse HEAD
git worktree list
git log --oneline --decorate -20
```

Reconcile any unpushed commits/worktrees, then rerun the same CI/security gates on the reconciled exact SHA.

### P0-B2 — HIGH — `master` GitHub governance is still unresolved

GitHub branch metadata observed during this audit reported `master` as unprotected with required status-check enforcement off.

Issue #4 tracks the owner-governed decision. Preferred posture is a PR/ruleset gate with required CI and no force-push/history rewriting. If direct pushes are intentionally retained, the compensating control and rationale must be documented explicitly.

### P0-B3 — MEDIUM — independent bounded worker review still required on reconciled SHA

Before promotion, run an independent bounded Claude/Codex (or equivalent) review against the exact reconciled candidate SHA. The reviewer must have no deployment/credential authority and must verify:

- ECC cannot become an approval or execution authority;
- hooks/memory/control-plane/tmux execution remain disabled;
- dependency and CI hardening do not weaken Preston gates;
- no unexpected allowed-path, approval, routing, RLS, production, or credential changes exist.

## ECC P0 verdict

The P0 capability pack is acceptable as a **subordinate worker-quality layer**:

- ECC skills may improve architecture diagnostics, verification, security review, parallel planning, council critique, and cost-awareness.
- ECC/AgentShield may provide advisory security findings.
- Preston remains the single governing control plane.

## Promotion verdict

**DO NOT MERGE YET.**

The GitHub-visible repository candidate is clean and materially hardened, but promotion remains blocked until:

1. authoritative local/host HEAD is reconciled;
2. `master` governance decision in Issue #4 is resolved/documented;
3. independent bounded review passes on the reconciled exact candidate SHA.

No production action is authorized by this report.
