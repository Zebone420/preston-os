# PRESTON AI OS — FINAL GO-LIVE COMPLETION WORK ORDER

Date: 2026-09-14
Base commit: `23e641e2eb8f75d66e44620ee0cdfa7be3571c3f`
Branch: `integration/final-go-live-runtime-proof`
Owner directive: finish the remaining build work and prove a safe operational GO state.

## Authority and hard stops

Preston Control remains the sole authority/governance layer. Claude and Codex are bounded workers only.

Do not, without a separate explicit owner approval:
- deploy or mutate production infrastructure/database state;
- write or rotate credentials/secrets;
- send live customer/vendor messages;
- move money, refund, charge, or place orders;
- weaken RLS/policy/approval/kill/lease/CAS controls;
- force-push or rewrite history;
- activate a new external service;
- expand allowed paths or unrestricted execution.

Use forward-only commits, isolated worktrees/branches, exact-SHA evidence, and fail closed on uncertainty.

## Objective

Move Preston from "repository green + Vercel deployed" to "runtime-proven, owner-supervised limited operational GO" with real Claude + Codex execution, reliable orchestration, safety/restore proof, readable evidence, and a bounded business pilot.

## Lane A — Claude: audit, architecture, runtime proof, review

1. Reconcile current repository/runtime truth against exact base SHA.
2. Inspect the real orchestration host configuration using names/paths only; do not expose secret values.
3. Verify Claude service-identity execution is real, bounded, worktree-isolated, attributed, and produces durable evidence.
4. Audit scheduler/dispatcher/lease/CAS/retry/dead-letter semantics for any remaining runtime defect.
5. Verify owner-stop/executor-kill behavior live in staging or another approved non-production proof environment.
6. Verify goal/job/approval/event/Hermes status truth is semantically aligned.
7. Verify actor attribution and provider attribution end-to-end.
8. Verify artifact/result summaries are remotely retrievable and bound to exact job/run/commit.
9. Review Codex lane changes and reject any safety regression, control-plane duplication, or authority expansion.
10. Produce the final architecture/runtime acceptance report.

## Lane B — Codex: targeted implementation, repair, tests

1. Reconcile Codex CLI/service-identity readiness without exposing credentials.
2. Prefer HOME-directory/interactive service-user auth if already supported; do not add API-key environment variables to shared child-env allowlists as a shortcut.
3. Fix only defects proven by current evidence.
4. Keep provider-specific secret/env boundaries isolated; do not weaken Claude or git child-process hygiene.
5. Ensure real Codex execution is strict/fail-closed: no silent simulation when real execution is required.
6. Preserve allowed-path enforcement, shell=false argv execution, worktree isolation/removal, leases, approval envelope binding, evidence and actor/provider attribution.
7. Add/repair focused tests for every defect.
8. Run lint, TypeScript, OS-runtime build, dependency audit, full test suite, secret scan, and RED-boundary scan.
9. Return narrow forward-only commits for Claude review.

## Lane C — Claude + Codex true concurrency proof

Run a bounded staging/non-production proof with two independent jobs at the same time:
- one assigned to Claude;
- one assigned to Codex;
- separate worktrees/locks/leases/logs/artifacts;
- observable wall-clock overlap;
- no cross-job file contamination;
- no shared worker identity;
- exact provider attribution;
- no simulation fallback;
- clean cleanup after completion.

Then run one conflict/contended-resource negative test and prove Preston serializes/blocks safely rather than allowing unsafe overlap.

## Lane D — operational safety proof

Prove, with evidence:
1. executor kill / owner stop;
2. retryable vs non-retryable classification;
3. stale lease/fence behavior;
4. dead-letter behavior;
5. approval expiry/replay resistance;
6. artifact durability/retrieval;
7. event/status/read-model truth;
8. actor/provider attribution;
9. backup creation + isolated restore drill + health recovery;
10. no secret leakage and no RED-boundary violation.

## Lane E — limited business GO pilot

Do not wait for Ruflo or another orchestrator to launch. Ruflo remains optional/subordinate and must not replace Preston Control.

Prepare and prove a limited owner-supervised business pilot:
- canonical Project ID/identity flow;
- document registry + Drive file references;
- read-only Gmail/project linkage or deterministic importer where already authorized;
- Hermes live-read of project/approvals/workforce/evidence state;
- draft-only outputs where appropriate;
- cited Knowledge Fabric retrieval for at least one approved domain;
- no auto-send, payment, order placement, or broad production-write autonomy.

## Mandatory acceptance criteria

GO requires all of the following:
- exact current runtime SHA recorded;
- Claude real worker PASS;
- Codex real worker PASS;
- true simultaneous Claude + Codex PASS;
- worktree isolation/cleanup PASS;
- lease/CAS/retry/dead-letter PASS;
- owner-stop/kill PASS;
- status/event/approval truth PASS;
- actor/provider attribution PASS;
- artifacts/evidence retrieval PASS;
- backup/restore drill PASS;
- full repository validation PASS;
- secret scan 0 findings;
- RED-boundary scan 0 findings;
- limited business live-read/draft pilot PASS;
- no unresolved critical/high defect;
- no safety invariant weakened;
- final Claude review: ACCEPT;
- final Preston/ChatGPT review packet ready for owner GO decision.

## Required final report

Return one concise evidence-backed report containing:
- exact commit(s)/branch;
- host/runtime exact SHA;
- Claude result;
- Codex result;
- concurrency proof;
- test counts/results;
- safety/kill proof;
- restore proof;
- business-pilot proof;
- defects found and commits fixing them;
- remaining non-blocking backlog;
- explicit `GO` or `NO-GO` recommendation with reasons.

Do not declare complete from unit tests alone. Runtime claims require runtime evidence.