# PRESTON ARCHITECT / GITHUB GATE — IMPLEMENTATION CONTRACT v1

Status: OWNER_APPROVED. No prior AG-1..AG-10 plan or ADR set exists
anywhere in this repository, its branch history, or owner files (confirmed
by exhaustive search 2026-09-08). This document is that plan, drafted from
the requirements established in the owning conversation and grounded in the
CURRENT Preston codebase (not invented from scratch where existing
primitives already do the job).

## 1. Design summary

Architect is a bounded, advisory capability set that lives entirely inside
the existing chain:

```
OWNER -> CHATGPT SUPERVISOR -> PRESTON CONTROL
      -> GOALS/JOBS/POLICY/APPROVALS/CAPABILITIES
      -> CLAUDE/CODEX/DETERMINISTIC RUNNERS -> GITHUB
```

It adds **no new authority, no new approval mechanism, no new policy
engine, and no new worktree/lock system.** Every governance primitive
Architect needs already exists and is reused as-is:

- `agent-contracts.ts` — `UNIVERSAL_PROHIBITIONS` already forbids `push`
  structurally for every agent, no exceptions, no self-grant.
- `policy.ts` — default-deny risk classifier; `MOBILE_GATE_MARKERS` already
  matches `\bpush\b`, forcing a fresh owner mobile approval.
- `approvals.ts` / `crypto-binding.ts` — scoped, actor-bound, expiring,
  replay-protected approval requests with a canonical SHA-256 envelope
  where every field is bound separately (so no field can drift after
  approval without changing the digest).
- `worktree-lock.ts` — fenced, leased, base-commit-pinned worktree
  ownership.
- `real-executor.ts` — already produces a durable, sha256-sidecar'd unified
  diff patch per completed worker run, outside the worktree, before
  cleanup.

Architect's job is to wire GitHub-shaped facts (repo, branch, commit SHA,
diff, PR) into these existing primitives with exact, separately-bound
fields, and to add exactly one new capability: a single, idempotent,
always-re-checked, always-fresh-approval-gated `push` + PR-open call
(AG-8). **Merging is never in scope.** GitHub API access is read via
native `fetch()` only — no SDK, no new dependency.

### Core data contract (referenced by AG-4/5/6/8)

```ts
interface GithubChangeEnvelope {   // AG-4
  repo: string; base_branch: string; head_branch: string;
  base_sha: string; head_sha: string; diff_hash: string; // sha256
}
interface ActorAttribution {       // AG-5
  requested_by: string; proposer: string; approver: string | null;
  executor: AgentRole; correlation_id: string; run_id: string | null;
}
interface ArchitectProposal {      // AG-6
  request: ArchitectRequest; change: GithubChangeEnvelope;
  actor: ActorAttribution; evidence_refs: string[];
  status: ProposalStatus; pr?: { pr_url: string; pr_number: number };
}
```

Any field change in `GithubChangeEnvelope` changes its digest; any digest
change invalidates every existing approval against it (AG-4 + AG-6).

## 2. AG-1 through AG-10

### AG-1 — Architect Request Intake Contract *(coverage A)*
- **Objective:** the single, validated, fail-closed shape of a request to
  start Architect reasoning about a repo change.
- **Why:** every later package needs one canonical, versioned input; no ad
  hoc objects get attribution or evidence attached to them.
- **Responsibilities:** `ArchitectRequest` type; pure
  `validateArchitectRequest()`.
- **Non-responsibilities:** no policy/approval decision; no git access.
- **Files:** NEW `apps/dashboard/src/lib/ai-os/architect/intake.ts`.
- **Inputs:** raw object from a ChatGPT tool call or goal-job.
- **Outputs:** `ArchitectRequest` or typed validation errors.
- **Invariants:** fail-closed on missing/invalid `correlation_id`, `repo`,
  `requested_by`; `environment` must equal `deploymentEnvironment()`
  (same P2 pin as `model.ts`).
- **Policy interaction:** none directly.
- **Evidence:** none produced; this is the anchor other evidence points to
  via `correlation_id`.
- **Failure behavior:** reject with typed error codes, never partial-accept.
- **Tests:** valid accepted; each required field individually rejected;
  wrong environment rejected; malformed `correlation_id` rejected.
- **Dependencies:** none (root).
- **Rollback:** delete file.
- **Codex overlap:** none — new isolated file.

### AG-2 — Repository Identity & Allowlist *(coverage B)*
- **Objective:** deterministic, fail-closed repo allowlist check before
  Architect may reference a repo at all.
- **Why:** "GitHub is not an authority source" — only owner-enumerated
  repos are addressable.
- **Responsibilities:** `isRepoAllowed(repo, allowlist)`; empty/missing
  allowlist denies everything (same pattern as `OWNER_EMAIL_ALLOWLIST`).
- **Non-responsibilities:** branch checks (AG-3); no GitHub calls.
- **Files:** NEW `architect/repo-policy.ts`; env var
  `ARCHITECT_REPO_ALLOWLIST` (names only) added to `env.template`.
- **Inputs:** repo identifier, allowlist.
- **Outputs:** `{ allowed: boolean; reason: string }`.
- **Invariants:** exact string match only, no globbing; empty allowlist =
  deny all.
- **Policy interaction:** short-circuits before `policy.ts` ever runs.
- **Evidence:** allowlist check result recorded to the proposal's evidence
  trail.
- **Failure behavior:** unauthorized repo -> hard reject, no further AG
  steps run.
- **Tests:** allowed passes; disallowed rejected; empty allowlist rejects
  all; case-sensitivity; near-miss fork name rejected.
- **Dependencies:** AG-1.
- **Rollback:** delete file + env var.
- **Codex overlap:** none.

### AG-3 — Branch & Worktree Policy *(coverage C)*
- **Objective:** protected-branch registry + branch allowlist pattern, and
  a thin adapter onto the EXISTING `worktree-lock.ts` — no parallel lock
  system.
- **Why:** Architect must never treat `master`/protected branches as a
  writable head, and must reuse the already-audited fencing/lease logic.
- **Responsibilities:** `isProtectedBase(branch)`, `isBranchAllowed(head)`
  (head must match `architect/<correlation_id>`); builds a
  `worktree-lock.ts` `AcquireInput` for Architect work instead of a new
  type.
- **Non-responsibilities:** no `git worktree add` execution (owner-run
  script territory, same boundary as today); no SHA staleness (AG-4).
- **Files:** NEW `architect/branch-policy.ts` (imports types from
  `../orchestration/worktree-lock.ts`, read-only). MODIFY
  `agent-contracts.ts` (add `force_push`, `merge_protected_branch`,
  `weaken_branch_protection` to `UNIVERSAL_PROHIBITIONS`; add
  `propose_github_change` to `Capability`). MODIFY `policy.ts` (add
  `\bmerge\b`, `\bforce[_-]?push\b`, `\bbranch[_-]?protection\b` to
  `MOBILE_GATE_MARKERS`) — both additive, ~4-8 lines each.
- **Inputs:** head/base branch names, current `WorktreeLock` state.
- **Outputs:** allow/deny + reason for head and base independently.
- **Invariants:** protected branches are never a valid Architect
  write-target; Architect head branches always carry the `architect/`
  prefix, trivially revocable.
- **Policy interaction:** protected-base write attempt is forced to
  `RED`/`requires_approval=true` via the extended `policy.ts`.
- **Evidence:** branch decision + reason code recorded.
- **Failure behavior:** protected/disallowed branch -> hard reject before
  any worktree acquisition.
- **Tests:** protected denial (`master`, `release/*`); allowed
  `architect/*` head accepted; base not on allowlist rejected;
  `UNIVERSAL_PROHIBITIONS`/`MOBILE_GATE_MARKERS` regression tests for the
  new entries.
- **Dependencies:** AG-1, AG-2.
- **Rollback:** delete `branch-policy.ts`; revert the two additive lines in
  `agent-contracts.ts`/`policy.ts`.
- **Codex overlap:** `worktree-lock.ts`/`worktree-provision.ts` are
  runtime-shared — Architect only imports their public types, never edits
  them. `agent-contracts.ts`/`policy.ts` are shared core files — **verify
  Codex has not touched the same lines this week before committing.**

### AG-4 — Exact Commit SHA / Diff Binding *(coverage D)*
- **Objective:** extend the canonical `crypto-binding.ts` envelope pattern
  with a GitHub-specific envelope binding `repo`, `base_branch`,
  `base_sha`, `head_sha`, `diff_hash` as separate fields.
- **Why:** the single most safety-critical package — all stale-approval
  and replay protection depends on this binding being exact.
- **Responsibilities:** `GithubChangeEnvelope` type; canonical
  serialization + SHA-256 digest (reuse/import the existing
  canonicalization helper from `crypto-binding.ts`, do not duplicate it);
  `diffHash()` over the durable patch text (Node `crypto`, no new dep);
  pure `isStale(envelope, currentBaseSha, currentDiffHash)`.
- **Non-responsibilities:** does not compute the diff (consumes the
  durable patch + sha256 sidecar `real-executor.ts` already writes); no
  policy decisions.
- **Files:** NEW `architect/change-binding.ts`.
- **Inputs:** repo/branch/shas, diff text or its existing sha256 sidecar,
  approval metadata.
- **Outputs:** canonical envelope + digest; staleness verdict.
- **Invariants:** digest changes if ANY bound field changes; `base_sha`
  must equal the ACTUAL current tip of `base_branch` at evaluation time,
  not the value true at proposal time.
- **Policy interaction:** the digest is the `presented_hash`/`action_hash`
  equivalent the mobile approval decision must match exactly.
- **Evidence:** the envelope + digest is itself an evidence artifact.
- **Failure behavior:** any mismatch -> stale -> approval invalid -> back
  to AG-1 for a fresh proposal.
- **Tests:** determinism (same inputs -> same digest); each single-field
  change -> different digest; base moved -> stale; diff edited
  post-approval -> stale; unchanged -> not stale.
- **Dependencies:** AG-1, AG-2, AG-3.
- **Rollback:** delete file; `crypto-binding.ts` untouched.
- **Codex overlap:** reads the durable patch directory
  (`PATCH_DIR_ENV`) `real-executor.ts` writes — read-only.
  `OVERLAP_REQUIRES_RECONCILIATION` only if the patch file format changes
  concurrently.

### AG-5 — Actor Attribution *(coverage E)*
- **Objective:** one mandatory attribution record on every Architect
  artifact: `requested_by`, `proposer`, `approver`, `executor`,
  `correlation_id`, `run_id`.
- **Why:** explicit requirement; closes "ambiguous actor identity."
- **Responsibilities:** `ActorAttribution` type;
  `requireAttribution()` fail-closed on any missing field; enforces
  `proposer !== approver` (reuses the existing `self_approve`
  prohibition, no new rule invented).
- **Non-responsibilities:** does not decide WHO may approve (that's
  `owner_identity` in `approvals.ts`) — only shape completeness/
  consistency.
- **Files:** NEW `architect/actor.ts`.
- **Inputs:** candidate attribution object.
- **Outputs:** validated `ActorAttribution` or errors.
- **Invariants:** all 5 fields match `RUNTIME_ID_RE` (existing ID format,
  no new one); `executor` is always one of `claude`/`codex`/`hermes`/
  `audit` — never `chatgpt` (chatgpt is intake/architect, never
  implementer, per the existing `AgentRole` contract).
- **Policy interaction:** feeds `agent-contracts.ts`'s per-role capability
  check.
- **Evidence:** the attribution record is itself an evidence_ref.
- **Failure behavior:** incomplete or self-approving attribution -> hard
  reject.
- **Tests:** complete passes; each missing field rejected; proposer ==
  approver rejected; `executor='chatgpt'` rejected; executor holding a
  `UNIVERSAL_PROHIBITIONS` capability rejected.
- **Dependencies:** AG-1.
- **Rollback:** delete file.
- **Codex overlap:** none.

### AG-6 — Architecture / Change Proposal Model *(coverage F)*
- **Objective:** the proposal lifecycle state machine (mirrors
  `transitions.ts`'s style, scoped to Architect):
  `proposed -> evaluated -> awaiting_approval -> approved -> prepared`,
  with `stale`, `rejected`, `withdrawn` as terminal/recoverable states.
- **Why:** without an explicit machine, stale-approval and
  changed-payload-after-approval have nowhere deterministic to land.
- **Responsibilities:** `ArchitectProposal` type; pure
  `proposalTransition(current, event)` with an explicit allow-table.
- **Non-responsibilities:** no persistence (that's a store's job, and is
  explicitly deferred — see File Map); no execution.
- **Files:** NEW `architect/proposal.ts`.
- **Inputs:** current status + event (`approve`, `reject`, `sha_moved`,
  `diff_changed`, `expire`, `withdraw`).
- **Outputs:** new status or invalid-transition error.
- **Invariants:** `sha_moved`/`diff_changed` force ANY status to `stale`,
  never silently preserve `approved`; only `evaluated` can enter
  `awaiting_approval`; only `approved` + freshly-reverified-non-stale can
  enter `prepared`.
- **Policy interaction:** entering `awaiting_approval` requires
  `policy.ts`'s `requires_approval=true` decision to have actually run.
- **Evidence:** every transition appends an evidence_ref (audit trail).
- **Failure behavior:** illegal transition -> reject, no mutation.
- **Tests:** full happy path; every stale-forcing event from every status;
  full illegal-transition table.
- **Dependencies:** AG-1, AG-4, AG-5.
- **Rollback:** delete file.
- **Codex overlap:** none.

### AG-7 — Validation / Evidence Contract *(coverage G)*
- **Objective:** the required-evidence checklist a proposal must satisfy
  before leaving `evaluated`.
- **Why:** explicit requirement; closes "missing evidence."
- **Responsibilities:** per-`RiskClass` evidence requirement list; pure
  `hasRequiredEvidence(proposal)`.
- **Non-responsibilities:** does not run tests/scanners — only checks
  that references to already-produced results exist and match this exact
  `head_sha`.
- **Files:** NEW `architect/evidence.ts`.
- **Inputs:** `proposal.evidence_refs[]`, `risk_class`.
- **Outputs:** `{ complete: boolean; missing: string[] }`.
- **Invariants:** minimum for any GitHub-facing proposal: `tests_ref`,
  `typecheck_ref`, `secret_scan_ref`, `red_boundary_scan_ref`, all
  referencing THIS `head_sha` — evidence from an earlier sha does not
  count (ties into AG-4 staleness).
- **Policy interaction:** feeds `policy.ts`'s evidence-required concept.
- **Evidence:** the check's own result becomes an evidence_ref.
- **Failure behavior:** missing/stale evidence -> cannot reach
  `awaiting_approval`.
- **Tests:** complete passes; each missing item individually rejected;
  evidence referencing a different sha rejected.
- **Dependencies:** AG-4, AG-6.
- **Rollback:** delete file.
- **Codex overlap:** reads Codex-produced test/scan output references,
  read-only, no shared writes.

### AG-8 — GitHub PR Preparation & Provenance (bounded execution) *(coverage H)*
- **Objective:** build the exact PR payload from an APPROVED, non-stale
  proposal, and perform the one bounded, idempotent write: push the
  pinned commit to its `architect/*` branch and open the PR. **No merge,
  ever.**
- **Why:** this is the only place live GitHub state changes; every
  upstream package exists to make this call safe.
- **Responsibilities:** pure `buildPrPayload(proposal)`; impure
  `executeGithubPush(proposal, approvalDecision)` which, on every call,
  re-verifies (1) `approvalDecision.presented_hash` equals the CURRENT
  AG-4 digest, (2) not stale, (3) attribution complete and executor holds
  `propose_github_change` and not a self-grant of `push`, (4) then runs a
  plain `git push` (never `--force`) of the exact pinned commit plus one
  native `fetch()` call to GitHub's REST API to open the PR; idempotent —
  a PR already existing for this exact `head_sha` is returned, never
  duplicated.
- **Non-responsibilities:** never merges; never force-pushes; never
  targets a protected branch as head.
- **Files:** NEW `architect/pr-provenance.ts` (pure payload builder); NEW
  `architect/github-execute.ts` (the one impure I/O module — kept
  isolated so it is the smallest possible audit surface). Env vars
  `ARCHITECT_GITHUB_TOKEN` (name only), `ARCHITECT_GITHUB_API_BASE`,
  `ARCHITECT_GITHUB_EXECUTE_ENABLED` (default false).
- **Inputs:** approved `ArchitectProposal`, matching `ApprovalDecision`.
- **Outputs:** `{ pr_url, pr_number, head_sha, created_at }` evidence
  record, or a typed refusal reason.
- **Invariants:** every precondition is RE-CHECKED at execution time, not
  trusted from earlier state (same defense-in-depth style as
  `real-executor.ts`'s own re-audit); replaying the same
  `approval_id`+digest returns the SAME PR reference.
- **Policy interaction:** hard dependency on `policy.ts`
  `requires_approval=true` and a present, valid, unexpired
  `ApprovalDecision` whose `decided_by` is the sole `owner_identity`.
- **Evidence:** PR URL/number/sha is the proposal's terminal evidence_ref.
- **Failure behavior:** any re-check failure -> refuse, no push attempted;
  proposal transitions to `stale`/`rejected`, never a partial push.
- **Tests:** full happy path (mocked git/GitHub); stale digest at
  execution time refused even after earlier approval; replay returns
  cached PR, no second push; protected-branch-as-head refused; missing
  evidence refused; self-approval refused; `ARCHITECT_GITHUB_EXECUTE_ENABLED=false` refuses everything.
- **Dependencies:** AG-1..AG-7.
- **Rollback:** flip `ARCHITECT_GITHUB_EXECUTE_ENABLED` to false (default) —
  fully reverts Architect to advisory-only with zero live GitHub writes;
  delete both files to remove the capability entirely.
- **Codex overlap:** none by file, but this is the first-ever live
  external-network write capability in the repository — flagged in ADR-6
  below as the invariant boundary the rest of the codebase currently
  holds everywhere else.

### AG-9 — Merge-Readiness Evaluation *(coverage I)*
- **Objective:** read-only, deterministic readiness check on an
  already-open PR (from AG-8). **Never merges.**
- **Why:** explicit requirement; closes "GitHub/Preston state
  disagreement."
- **Responsibilities:** `evaluateMergeReadiness(proposal, liveGithubState)`
  comparing Preston's recorded expectation against one more native
  `fetch()` read of GitHub facts (PR mergeable flag, live base tip,
  check/review status, branch protection rules).
- **Non-responsibilities:** never calls merge; never modifies branch
  protection.
- **Files:** NEW `architect/merge-readiness.ts`.
- **Inputs:** proposal record, live GitHub PR/branch-protection JSON.
- **Outputs:** `{ ready: boolean; disagreements: string[] }`.
- **Invariants:** default is NOT ready; live base tip must equal the
  pinned `base_sha` exactly or `ready=false` ("stale base" — merge-time
  staleness, distinct from AG-4's proposal-time staleness); any failing
  required check or zero approving reviews where required -> not ready.
- **Policy interaction:** advisory input to the owner's own merge
  decision (in GitHub's UI, or a future, separately-designed,
  more-heavily-gated merge capability) — Architect never acts on this
  verdict.
- **Evidence:** verdict + disagreement list recorded as evidence_ref.
- **Failure behavior:** any disagreement -> `ready=false`, reasons
  surfaced as a recommendation only.
- **Tests:** fully-ready case; each disagreement type individually forces
  `ready=false`; base moved after PR opened -> not ready.
- **Dependencies:** AG-8.
- **Rollback:** delete file; no write capability lost (never wrote
  anything).
- **Codex overlap:** none (read-only, isolated file).

### AG-10 — Governed Execution Handoff to Preston Control *(coverage J)*
- **Objective:** the narrow interface exposing AG-1..AG-9 to the EXISTING
  ChatGPT tool surface so the owner/ChatGPT can see proposals,
  approve/reject, and see readiness — without Architect becoming a second
  control plane.
- **Why:** explicit requirement; closes the loop back into "OWNER ->
  CHATGPT SUPERVISOR -> PRESTON CONTROL."
- **Responsibilities:** new tool entries —
  `list_architect_proposals`, `get_architect_proposal`,
  `decide_architect_proposal` (delegates straight into `approvals.ts`'s
  existing decision validator, no new approval mechanism).
  `decide_architect_proposal` only RECORDS the decision; AG-8
  re-checks it before ever acting.
- **Non-responsibilities:** does not call GitHub itself; does not bypass
  `owner_identity` checks; no new tool-calling protocol.
- **Files:** MODIFY `apps/dashboard/src/lib/preston-control/tools.ts`
  (additive entries only); MODIFY
  `apps/dashboard/src/lib/preston-control/schemas.ts` (additive schemas);
  NEW `architect/index.ts` (barrel re-exporting AG-1..AG-9 pure functions).
- **Inputs:** ChatGPT tool-call payloads (already authenticated via the
  existing `auth.ts`).
- **Outputs:** proposal list/detail JSON; decision acknowledgement.
- **Invariants:** every tool function is a thin wrapper over AG-1..AG-9's
  pure functions — no duplicated logic; auth/session checks are 100%
  delegated to the existing `auth.ts`, never a parallel path.
- **Policy interaction:** this IS the wiring, not a new authority.
- **Evidence:** existing `preston-control` tool-call audit logging,
  unmodified.
- **Failure behavior:** any AG-1..AG-9 rejection surfaces verbatim; never
  swallowed into a generic success.
- **Tests:** each new tool function unit-tested against mocked AG
  modules; full existing `tools.ts` suite re-run green (regression
  guard); auth-rejection passthrough test.
- **Dependencies:** AG-1..AG-9 (integration package, last in order).
- **Rollback:** revert the additive diff on the two MODIFY files;
  `architect/` folder deletable independently.
- **Codex overlap:** `tools.ts`/`schemas.ts` are shared, high-traffic
  files. **HIGH risk** if Codex is concurrently adding staging-reporting
  tools there. `OVERLAP_REQUIRES_RECONCILIATION` — diff-check both files
  against Codex's branch before this commit lands.

## 3. Dependency order

Linear, matches numbering: **AG-1 -> AG-2 -> AG-3 -> AG-4 -> AG-5 -> AG-6
-> AG-7 -> AG-8 -> AG-9 -> AG-10.** (AG-2/AG-3 only depend on AG-1 and
could theoretically run in parallel, but linear, one-small-commit-per-
package delivery is kept for a v1 to avoid parallel-merge complexity.)

## 4. ADR list

1. **ADR-1: Preston Control remains sole authority; Architect is
   advisory-only.** Architect never becomes a second control plane —
   every governed action routes through the existing policy/approval
   surfaces.
2. **ADR-2: GitHub is an evidence/integration surface, never an authority
   source.** No fact read from GitHub (branch protection, PR state, CI
   status) can itself authorize anything — it can only inform AG-9's
   recommendation or block AG-8's execution.
3. **ADR-3: Exact SHA + diff binding is the sole staleness/replay
   defense.** The extended `crypto-binding.ts` envelope (AG-4) is
   authoritative; no approval is valid against any drifted field, no
   exceptions.
4. **ADR-4: Merge and force-push are permanently outside Architect's
   capability set.** `UNIVERSAL_PROHIBITIONS` gains `force_push` and
   `merge_protected_branch`; AG-9 evaluates readiness but never acts on
   it. This boundary requires a NEW ADR (not just a code change) because
   reversing it later is a governance decision, not an implementation
   detail.
5. **ADR-5: Stale-proposal invalidation is automatic, not by silence.**
   AG-6's state machine forces any base-sha or diff drift into `stale`
   immediately; nothing can be "re-approved implicitly."
6. **ADR-6: GitHub API access is native `fetch()` only — no SDK
   dependency.** Smallest external surface; consistent with the
   codebase's existing zero-added-dependency posture. Also records that
   AG-8 is the first-ever live external-network write capability in this
   repository, changing an invariant every other module currently holds.

## 5. File map

**NEW (isolated, `apps/dashboard/src/lib/ai-os/architect/`):**

| File | AG | Codex overlap | Runtime | Migration |
|---|---|---|---|---|
| `intake.ts` | AG-1 | none | no | no |
| `repo-policy.ts` | AG-2 | none | no | no |
| `branch-policy.ts` | AG-3 | reads `worktree-lock.ts` types (read-only) | no | no |
| `change-binding.ts` | AG-4 | reads durable patch dir (read-only) | no | no |
| `actor.ts` | AG-5 | none | no | no |
| `proposal.ts` | AG-6 | none | no | no |
| `evidence.ts` | AG-7 | reads Codex evidence refs (read-only) | no | no |
| `pr-provenance.ts` | AG-8 | none | no | no |
| `github-execute.ts` | AG-8 | none (first live network writer) | no | no |
| `merge-readiness.ts` | AG-9 | none | no | no |
| `index.ts` | AG-10 | none (barrel) | no | no |
| `test/architect-*.test.ts` x10 | AG-1..10 | none | no | no |
| `docs/PRESTON_ARCHITECT_GITHUB_GATE_CONTRACT_v1.md` | this doc | none | no | no |
| `env.template` additions (4 names) | AG-2/AG-8 | none | no | no |

**MODIFY (additive only, minimized):**

| File | AG | Change | Overlap risk |
|---|---|---|---|
| `orchestration/agent-contracts.ts` | AG-3 | +3 prohibitions, +1 capability | MEDIUM — shared core file |
| `orchestration/policy.ts` | AG-3 | +3 regex markers | MEDIUM — shared core file |
| `preston-control/tools.ts` | AG-10 | +3 tool entries | **HIGH** — shared ChatGPT surface |
| `preston-control/schemas.ts` | AG-10 | +3 schemas | **HIGH** — shared ChatGPT surface |

**Explicitly NOT touched:** `supabase/migrations/**`, any staging
deployment script, `real-executor.ts`, `worktree-provision.ts`, runtime
host config, worker host auth. `ArchitectProposal` persistence to a
durable Supabase table is **explicitly out of scope for v1** — proposals
are tool-call-session-scoped in this design. A durable
`architect_proposals` table is a natural AG-11 follow-up, deliberately
deferred to avoid any migration-file collision with Codex's active
staging/runtime work.

## 6. Codex overlap map

- `supabase/migrations/**` — not touched, by design.
- `real-executor.ts`, `worktree-provision.ts`, `ORCH_BASE_COMMIT`
  handling — read-only consumption only (durable patch dir, worktree-lock
  records). `OVERLAP_REQUIRES_RECONCILIATION` only if their public output
  shape changes during Codex's concurrent work.
- `agent-contracts.ts`, `policy.ts` — additive MODIFY, ~4-8 lines each.
  Diff-check against Codex's branch before committing AG-3.
- `preston-control/tools.ts`, `schemas.ts` — additive MODIFY.
  `OVERLAP_REQUIRES_RECONCILIATION` — flagged HIGH; diff-check against
  Codex's branch before committing AG-10.
- Staging deployment, migration execution, runtime host config, worker
  host auth, staging evidence — not touched at all.

## 7. Test matrix

| Concern | AG | Covered by |
|---|---|---|
| Repository allowlist | AG-2 | allow/deny/empty-allowlist/case tests |
| Branch allowlist | AG-3 | allowed `architect/*` vs disallowed head |
| Protected branch denial | AG-3 | `master`/`release/*` as base or head |
| Stale SHA rejection | AG-4 | base moved -> stale |
| Stale diff rejection | AG-4 | diff edited post-approval -> stale |
| Missing evidence rejection | AG-7 | each required ref individually absent |
| Actor attribution | AG-5 | each field missing; self-approval |
| Provenance | AG-5, AG-8 | attribution + PR record round-trip |
| Replay/idempotency | AG-8 | same approval+digest returns cached PR |
| Approval-state mismatch | AG-4, AG-8 | digest mismatch at execution refused |
| GitHub/Preston disagreement | AG-9 | each disagreement type |
| PR provenance | AG-8 | payload fields match envelope exactly |
| Merge-readiness | AG-9 | fully-ready + each blocking condition |
| Fail-closed behavior | all | every package's default-deny path |

Plus, run every package against: TypeScript (`tsc --noEmit`), ESLint,
`build:os-runtime` (only if `tools.ts`/`schemas.ts` changed pull it into
the dashboard build), secret scanner, RED-boundary scanner.

## 8. Owner-gated operations

- Setting `ARCHITECT_REPO_ALLOWLIST` / editing it later.
- Provisioning `ARCHITECT_GITHUB_TOKEN` (name only, real value never in
  chat or committed).
- Flipping `ARCHITECT_GITHUB_EXECUTE_ENABLED` to true.
- Every individual push+PR-open call — fresh mobile approval per exact
  envelope digest, every time, no standing grant.
- Any change to `UNIVERSAL_PROHIBITIONS` itself (including the AG-3
  additions proposed here) is itself owner-reviewable, not a routine
  code change.
- Actual merge of any PR — always manual, always the owner (or a
  separate, not-yet-designed, more heavily gated future capability).

## 9. Rollback strategy

- `ARCHITECT_GITHUB_EXECUTE_ENABLED=false` (default) fully reverts
  Architect to advisory-only with zero live GitHub writes, no file
  changes needed.
- The entire `architect/` folder is deletable independently of the rest
  of the codebase.
- All shared-file changes (`agent-contracts.ts`, `policy.ts`,
  `tools.ts`, `schemas.ts`) are additive-only, one AG per commit, so
  `git revert` of any single AG commit cleanly removes it.
- Zero migrations created; zero migrations to roll back.

## 10. Recommended implementation sequence

Ten small commits, one per AG package, in dependency order, tests green
before moving to the next. Full matrix + `/ponytail-review` only after
AG-10 lands, per the standing instruction. `preston-control/tools.ts` and
`schemas.ts` diffs get checked against Codex's active branch immediately
before the AG-10 commit, not after.

---

**ARCHITECT PLAN STATUS: OWNER_APPROVED**

First implementation package: **AG-1 — Architect Request Intake
Contract** (`apps/dashboard/src/lib/ai-os/architect/intake.ts`).
