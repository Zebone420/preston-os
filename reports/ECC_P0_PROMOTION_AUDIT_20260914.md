# ECC P0 Promotion Audit — 2026-09-14

Status: **BLOCKED FROM PROMOTION** pending the blockers below. This report is evidence-only; it does not authorize merge, deployment, environment changes, database changes, or policy changes.

## Baseline

- Base: `master` @ `2d447d52077719c76dd2d611958d3e774abb5b4a`
- P0 branch: `integration/ecc-p0-capability-pack`
- PR: #2 (draft)
- ECC behavior in P0: guidance/manifest only; no ECC hooks, installer, repair, control-plane, memory writer, tmux executor, or MCP mutation.

## Verification evidence

GitHub Actions CI run `34804438058` / run #149 completed **SUCCESS** for the PR merge ref.

Dashboard job:
- TypeScript check: PASS
- Vitest: **130 files passed**
- Tests: **1798 passed, 1 expected fail**
- Preston secret scanner: zero findings
- Preston RED boundary scanner: zero findings

Guards package job:
- TypeScript check: PASS
- Tests: **25 passed**

## Findings

### P0-F1 — HIGH — CI is green while npm reports high/critical dependency vulnerabilities

Evidence from CI run #149:

- `apps/dashboard` `npm ci`: **13 vulnerabilities** — 5 moderate, 7 high, **1 critical**.
- `packages/guards` `npm ci`: **4 vulnerabilities** — 2 moderate, 2 high.
- CI does not currently fail on these audit counts; typecheck/tests continue and the workflow concludes success.

Additional dashboard install warning:
- `sharp@0.34.5` has an install script not covered by `allowScripts`.
- `unrs-resolver@1.12.2` has a postinstall script not covered by `allowScripts`.

Assessment:
- The counts alone do not prove runtime exploitability; exact advisory/package paths must be enumerated with `npm audit` on the authoritative checkout.
- A green test result must not be treated as a clean supply-chain/security result.

Promotion requirement:
1. run exact `npm audit` for dashboard and guards on the reconciled authoritative HEAD;
2. classify each high/critical item as runtime/dev-only, reachable/unreachable, and fixed/accepted;
3. apply narrow dependency updates where safe;
4. rerun the full Preston regression and scanners;
5. record any explicit risk acceptance as owner-governed evidence.

Do **not** run `npm audit fix --force` as an unattended blanket repair.

### P0-F2 — HIGH — GitHub `master` is unprotected

GitHub branch metadata for `master` reports `protected: false` and required status-check enforcement off.

Risk:
- repository-level policy does not independently prevent a direct push to the authoritative branch;
- this weakens separation between the Preston approval model and GitHub branch mutation even if local operating rules remain strict.

Promotion requirement:
- establish an owner-approved GitHub branch/ruleset policy appropriate to Preston's workflow (PR-only or otherwise explicitly controlled), with required CI checks and no force-push history rewriting.
- if direct pushes are intentionally retained, document the compensating control and owner rationale explicitly.

### P0-F3 — HIGH — Authoritative-head reconciliation is incomplete outside GitHub

The newest pushed `master` visible through GitHub is dated 2026-09-01. Recent Claude/Codex work discussed after that date may exist only on a local workstation, host, worktree, or other unpushed branch/state.

Risk:
- promoting P0 against GitHub `master` could integrate against a stale baseline;
- review evidence could be valid for the wrong tree.

Promotion requirement:
- on the authoritative Preston host/workstation, capture `git status --short`, current branch, `git rev-parse HEAD`, `git worktree list`, and `git log --oneline --decorate -20`;
- reconcile any unpushed commits/worktrees before merge;
- rerun CI/security verification against the reconciled exact SHA.

### P0-F4 — MEDIUM — Actions dependency/runtime compatibility warning

GitHub Actions reports `actions/checkout@v4` and `actions/setup-node@v4` target Node.js 20 and are being forced to run on Node 24 by the current runner environment.

Current effect:
- CI succeeds today.

Required follow-up:
- track upstream action versions and update to Node-24-native action releases when appropriate; do not weaken CI to suppress the warning.

### P0-F5 — PASS / historical high-risk confinement defect is repaired on current master

The earlier PF1 issue (post-run audit blind to worker changes hidden in a local commit) is repaired in current `worktree-provision.ts`.

Current design audits the normalized union of:
- uncommitted/index/untracked paths from `git status --porcelain -uall`;
- committed paths from `git diff --name-only --no-renames <base> HEAD`.

It fails closed when the authoritative base SHA is absent, malformed, or not comparable. This is the correct direction and should remain pinned by regression tests.

## ECC P0 authority verdict

The P0 capability pack is architecturally acceptable **only as a subordinate guidance layer**:

- Preston Control remains sole authority for approvals, job state, routing, execution, safety, and evidence.
- ECC skills may improve worker reasoning/review.
- ECC/AgentShield may be an advisory security detector.
- ECC memory, hooks, repair, control plane, worktree executor, and auto-update remain disabled in P0.

## Promotion verdict

**NOT MERGE-READY.**

Blocking gates:
1. reconcile true local/host HEAD;
2. triage and remediate/accept all high + critical npm audit findings;
3. decide and implement/document `master` branch governance;
4. rerun exact-head full CI/scanners;
5. independent worker review (Claude/Codex or equivalent bounded reviewer) against that exact reconciled SHA.

No production action is authorized by this report.
