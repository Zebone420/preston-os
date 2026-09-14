# PRESTON AI OS - BUILD COMPLETION REPORT

Evidence date: 2026-09-08 (America/New_York)

## Repository identity

- Branch: `feature/hermes-native`
- Entry HEAD: `8d50db04a241641237f7c0815ff4c2d9aac8dafb`
- Preserved implementation: `0726b1d`
- Report preservation: the commit containing this file; the final handoff
  records its exact SHA because a commit cannot contain its own hash.
- Production touched: NO
- Production data changed: NO
- Credentials changed or exposed: NO
- Live customer/vendor messages: NONE
- Payments/refunds/orders executed: NONE

## Entry audit and preservation findings

- The main checkout contained uncommitted Phase 3-5 implementation and tests.
  They are now integrated and preserved in `0726b1d`.
- `pickup-starvation` held the old scheduler patch, already recovered into
  `599b869`; its test was byte-identical and its source was superseded by
  later mainline repairs.
- `phase7-approval-reconcile` held two old divergent commits plus an old
  Claude-adapter copy, all superseded by current mainline implementations.
- `canonical-prestaging` had no unpublished delta.
- The old migration-0010 stash and old hotfix/adapter branches are superseded;
  none contained a patch that should replace current code.
- A generated `packages/guards/src/index.js` was removed. Business capability
  imports now stay inside the OS runtime root and a parity test pins the local
  untrusted-text primitive to the canonical guard.
- No live staging database or worker host was accessed. Live dead-letter rows,
  leases, and runtime evidence therefore remain an owner-gated staging check.
- Simulation-only risk is explicit: real Claude and Codex paths and true
  concurrency are unit/integration proven, but simultaneous real CLI execution
  on the staging host is not yet proven.

## Phase status

| Scope | Repository status | Acceptance still outside safe local work |
|---|---|---|
| Phase 0 control | Locally sealed. Starvation, eligibility/routing, both worker paths, leases/CAS, retries/dead letters, truth projection, expired approvals, actors, evidence/artifacts, patch preservation, stop/kill, intake/decomposition, and worktree dependencies are tested. Windows process-tree timeout defect repaired. | Staging worker concurrency, live stop/kill, and restore drill. |
| M8 ConnectorPassport | COMPLETE in repository. Strict environment/mode/scope/health/revision/freshness/evidence evaluation; DB-backed reader; pre-ledger executor refusal; RLS migration and rollback. | Apply 0036 in staging and capture live refusal/freshness evidence. |
| M9 soft launch | COMPLETE in repository. Deterministic readiness assessment and append-only RLS model; `production_ready=true` is structurally impossible. Current classification: `REPOSITORY_READY`. | Staging evidence before `STAGING_READY_OWNER_GATED`. |
| Phase 1 | Repository-complete: canonical Project ID/identity, document/Drive registry, knowledge fabric, read-only Gmail ingestion, Deal Intelligence. | Apply migrations/connectors and validate with authorized staging data. |
| Phase 2 | Repository-complete: Today, Project, Approvals, AI Workforce, Incidents/Evidence and Brief read models; bounded owner-view service exposed to Preston Control and Hermes as read-only. | Deploy/link Hermes staging and answer owner drills against staging truth. |
| Phase 3 | Repository-complete safe capability spine: deterministic contracts, sandbox adapters, ledger/idempotency, replay, stale approval rejection, injection/recipient/attachment guards, evidence. `gmail.message.send` remains disabled. | Owner must explicitly open any external side-effect class later. |
| Phase 4 | Repository implementation complete: Andersen core structure, vendor/Home Depot parsing, IQ+ reconciliation, quote/proposal generation, scheduling minimum, follow-up clocks, deterministic playbooks. | Master-plan pilot exit requires authorized real-project staging pilots. |
| Phase 5 safe subset | COMPLETE: contract/payment state models, final-measure rules, eligibility predicates, PO preparation. No financial/order executor exists. | Real integrations and the plan's end-to-end pilot remain owner-gated; charges/refunds/order placement remain prohibited. |
| Phase 6 | Existing implementation reconciled and green: receiving through closeout, document registration, warranty/BDF/survey/archive rules and RLS migration. | Exit requires one authorized real project through closeout. |
| Phase 7 | Existing graduated-autonomy implementation reconciled and green: ladder, criteria, grants, veto, outcomes, anomaly demotion. No class was promoted. | Every live class promotion is an owner decision after staging evidence. |
| Phase 8 | Correctly deferred by the authoritative plan until the core spine is stable in real operation. No current repository-critical gap reopened it. | LPC/DOB, advanced estimating, finance intelligence, routing, design modules after core acceptance. |
| Phase 9 | Correctly deferred and not on the current critical path. | Productization only after Preston Windows & Doors runs reliably on the core. |

## Validation matrix - final results

| Validation | Exact final result |
|---|---|
| Dashboard full unit/integration suite | 208 files passed; 2,931 tests passed; 1 intentional expected-failure sentinel; 0 failed |
| Control/orchestration/worker focused matrix | 19 files passed; 379 tests passed |
| M8/M9 + owner-view/guard focused matrix | 5 files passed; 77 tests passed |
| Shared guards | 1 file passed; 25 tests passed |
| Hermes TypeScript | 4 files passed; 48 tests passed |
| Hermes Python | 34 tests passed with `ResourceWarning` promoted to error |
| Dashboard TypeScript | `npx tsc --noEmit`: exit 0 |
| Hermes TypeScript | `npm run typecheck`: exit 0 |
| Guards TypeScript | `npx tsc --noEmit`: exit 0 |
| ESLint | exit 0; 0 errors; 0 warnings |
| OS runtime build | `npm run build:os-runtime`: exit 0 |
| Next production build | exit 0; compiled, typechecked, generated all routes including `/api/control/owner-view` |
| Secret scanner | 0 findings |
| RED boundary scanner | 0 findings |
| Git whitespace check | clean |

The full dashboard suite includes authorization, RLS/migration structure,
negative/security, lease/CAS, concurrency, retry/dead-letter, idempotency and
replay, stale/expired approval, actor, artifact/evidence, kill/owner-stop,
backup/restore-script, identity, documents, knowledge, Gmail/deal, lifecycle,
and autonomy coverage.

Failures were not hidden. During the build, an outdated OpenAPI expectation,
an owner-view string syntax error, several test-fixture type errors, an OS
runtime `rootDir` leak, a reproducible Windows Claude timeout-kill hang, five
`bash`-not-on-PATH test failures, a stale ESLint suppression, and Python
HTTPError resource leaks were found and repaired. The first Next build could
not fetch Geist through the restricted sandbox; the approved network rerun
completed successfully. An attempted nonexistent `npm run typecheck` script
was replaced by the repository's actual `npx tsc --noEmit` validation.

## Worker and concurrency verdict

- Claude worker: repository READY; argv-only spawn, env allowlist, lease/fence,
  approval, path confinement, evidence and timeout tree-kill are green.
- Codex worker: repository READY under the same governed executor contract.
- True concurrency: implementation and integration tests PASS; LIVE STAGING
  PROOF PENDING. Production readiness cannot be inferred from simulation.

## Readiness and remaining defects

- Known critical repository defects: NONE.
- Staging readiness: NO, not yet. Repository status is `REPOSITORY_READY`.
- Production readiness: NO.
- Remaining gaps are governed external acceptance work: staging migration
  ledger reconciliation through 0036, host deployment and commit pin, real Claude+Codex overlap,
  live kill/owner-stop, restore drill, connector passports, Hermes live reads,
  and authorized real-project Phase 1-6 pilots.

## Exact owner gates remaining

1. Push `feature/hermes-native` (owner-run under the current no-agent-push rule).
2. Approve a staging-only migration window: reconcile the ledger, then apply
   any unapplied 0028-0036 in order with preflight and rollback evidence.
3. Deploy the preserved revision to the staging worker host and repin
   `ORCH_BASE_COMMIT`.
4. Re-authenticate the Codex CLI on the worker host without sharing credentials.
5. Approve the staging SSH/runtime window and execute S1-S10 in
   `STAGING_VALIDATION_PACKAGE_20260908.md`.
6. Run the local isolated PostgreSQL restore drill and preserve PASS evidence.
7. Authorize the specific non-customer staging datasets/projects used for the
   Phase 1-6 pilots.
8. Review staging evidence before any production promotion. No live send,
   payment/refund, order placement, paid service, or autonomy promotion is
   authorized by this build.

## Atomic Preston Control goals for governed continuation

1. `Reconcile and apply any unapplied migrations 0028-0036 in staging only.`
2. `Deploy revision 0726b1d to the staging worker and repin ORCH_BASE_COMMIT.`
3. `Prove eligible pickup and stalled-goal non-starvation in staging.`
4. `Prove one Claude job and one Codex job overlap with distinct leases.`
5. `Prove cancel and owner-stop prevent terminal result persistence.`
6. `Run the isolated restore drill and attach the PASS artifact.`
7. `Prove stale ConnectorPassports refuse before ledger and adapter calls.`
8. `Run Hermes owner-view drills and one authorized Phase 1-6 pilot.`

## Exact changed-file manifest

The implementation commit plus this evidence update changed exactly these
paths from entry HEAD `8d50db0`:

```text
apps/dashboard/src/app/api/control/owner-view/route.ts
apps/dashboard/src/lib/ai-os/capabilities/business/attachment-manifest.ts
apps/dashboard/src/lib/ai-os/capabilities/business/calendar-event.ts
apps/dashboard/src/lib/ai-os/capabilities/business/compose.ts
apps/dashboard/src/lib/ai-os/capabilities/business/definitions.ts
apps/dashboard/src/lib/ai-os/capabilities/business/drive-file.ts
apps/dashboard/src/lib/ai-os/capabilities/business/gmail-draft.ts
apps/dashboard/src/lib/ai-os/capabilities/business/injection-boundary.ts
apps/dashboard/src/lib/ai-os/capabilities/business/iqplus-ingest.ts
apps/dashboard/src/lib/ai-os/capabilities/business/metadata-strip.ts
apps/dashboard/src/lib/ai-os/capabilities/business/proposal-render.ts
apps/dashboard/src/lib/ai-os/capabilities/business/recipient-allowlist.ts
apps/dashboard/src/lib/ai-os/capabilities/business/replay.ts
apps/dashboard/src/lib/ai-os/capabilities/business/schemas.ts
apps/dashboard/src/lib/ai-os/capabilities/business/stale-approval.ts
apps/dashboard/src/lib/ai-os/capabilities/business/untrusted.ts
apps/dashboard/src/lib/ai-os/capabilities/business/vendor-quote-parse.ts
apps/dashboard/src/lib/ai-os/capabilities/business/vendor-quote-reconcile.ts
apps/dashboard/src/lib/ai-os/capabilities/contract.ts
apps/dashboard/src/lib/ai-os/capabilities/credentials.ts
apps/dashboard/src/lib/ai-os/capabilities/executor.ts
apps/dashboard/src/lib/ai-os/capabilities/providers/calendar-sandbox.ts
apps/dashboard/src/lib/ai-os/capabilities/providers/drive-sandbox.ts
apps/dashboard/src/lib/ai-os/capabilities/providers/gmail-sandbox.ts
apps/dashboard/src/lib/ai-os/capabilities/providers/internal-runner.ts
apps/dashboard/src/lib/ai-os/capabilities/providers/sandbox-common.ts
apps/dashboard/src/lib/ai-os/capabilities/providers/sandbox-credentials.ts
apps/dashboard/src/lib/ai-os/capabilities/registry.ts
apps/dashboard/src/lib/ai-os/connectors/passport.ts
apps/dashboard/src/lib/ai-os/connectors/soft-launch.ts
apps/dashboard/src/lib/ai-os/real-claude-adapter.ts
apps/dashboard/src/lib/business/andersen/catalog.ts
apps/dashboard/src/lib/business/andersen/fixture.ts
apps/dashboard/src/lib/business/andersen/import.ts
apps/dashboard/src/lib/business/andersen/store.ts
apps/dashboard/src/lib/business/order-chain/actor.ts
apps/dashboard/src/lib/business/order-chain/contact-guard.ts
apps/dashboard/src/lib/business/order-chain/contract-state.ts
apps/dashboard/src/lib/business/order-chain/final-measure.ts
apps/dashboard/src/lib/business/order-chain/hash.ts
apps/dashboard/src/lib/business/order-chain/order-eligibility.ts
apps/dashboard/src/lib/business/order-chain/payment-state.ts
apps/dashboard/src/lib/business/order-chain/po-preparation.ts
apps/dashboard/src/lib/business/order-chain/store.ts
apps/dashboard/src/lib/business/owner-views/brief.ts
apps/dashboard/src/lib/business/owner-views/incidents.ts
apps/dashboard/src/lib/business/owner-views/project.ts
apps/dashboard/src/lib/business/owner-views/service.ts
apps/dashboard/src/lib/business/owner-views/today.ts
apps/dashboard/src/lib/business/owner-views/types.ts
apps/dashboard/src/lib/business/owner-views/workforce.ts
apps/dashboard/src/lib/business/runner/playbook.ts
apps/dashboard/src/lib/business/runner/playbooks/common.ts
apps/dashboard/src/lib/business/runner/playbooks/contract-proceed.ts
apps/dashboard/src/lib/business/runner/playbooks/deal-intelligence.ts
apps/dashboard/src/lib/business/runner/playbooks/final-measure.ts
apps/dashboard/src/lib/business/runner/playbooks/follow-up.ts
apps/dashboard/src/lib/business/runner/playbooks/index.ts
apps/dashboard/src/lib/business/runner/playbooks/lead-intake.ts
apps/dashboard/src/lib/business/runner/playbooks/order-cycle.ts
apps/dashboard/src/lib/business/runner/playbooks/quote-client.ts
apps/dashboard/src/lib/business/runner/playbooks/vendor-quote-cycle.ts
apps/dashboard/src/lib/business/runner/playbooks/visit-recap.ts
apps/dashboard/src/lib/business/runner/playbooks/visit-schedule.ts
apps/dashboard/src/lib/business/runner/runner.ts
apps/dashboard/src/lib/business/runner/steps.ts
apps/dashboard/src/lib/business/runner/store.ts
apps/dashboard/src/lib/business/sales/follow-up-clocks.ts
apps/dashboard/src/lib/business/sales/openings.ts
apps/dashboard/src/lib/business/sales/scheduling.ts
apps/dashboard/src/lib/business/sales/scope.ts
apps/dashboard/src/lib/preston-control/openapi.ts
apps/dashboard/src/lib/preston-control/schemas.ts
apps/dashboard/src/lib/preston-control/server.ts
apps/dashboard/src/lib/preston-control/tools.ts
apps/dashboard/test/andersen-catalog.test.ts
apps/dashboard/test/andersen-store.test.ts
apps/dashboard/test/business-capability-calendar-drive.test.ts
apps/dashboard/test/business-capability-gmail.test.ts
apps/dashboard/test/business-capability-harness.test.ts
apps/dashboard/test/business-capability-internal.test.ts
apps/dashboard/test/business-capability-shared.test.ts
apps/dashboard/test/capability-spine.test.ts
apps/dashboard/test/connector-passport-migration-0036.test.ts
apps/dashboard/test/connector-passport.test.ts
apps/dashboard/test/order-chain-contract.test.ts
apps/dashboard/test/order-chain-eligibility.test.ts
apps/dashboard/test/order-chain-final-measure.test.ts
apps/dashboard/test/order-chain-fixtures.ts
apps/dashboard/test/order-chain-migration-0032.test.ts
apps/dashboard/test/order-chain-payment.test.ts
apps/dashboard/test/order-chain-store.test.ts
apps/dashboard/test/owner-views-service.test.ts
apps/dashboard/test/preston-control-bridge-acceptance.test.ts
apps/dashboard/test/preston-control-gpt.test.ts
apps/dashboard/test/preston-control-hermes-surface.test.ts
apps/dashboard/test/preston-control-supervisor.test.ts
apps/dashboard/test/restore-drill-script.test.ts
apps/dashboard/test/runner-declaration.test.ts
apps/dashboard/test/runner-runner.test.ts
apps/dashboard/test/runner-store.test.ts
apps/dashboard/test/sales-clocks.test.ts
apps/dashboard/test/sales-openings-scope.test.ts
apps/dashboard/test/sales-scheduling.test.ts
apps/dashboard/test/soft-launch-readiness.test.ts
apps/dashboard/test/worktree-prep.test.ts
apps/hermes-preston-supervisor/dashboard/plugin_api.py
apps/hermes-preston-supervisor/dashboard/preston_client.py
apps/hermes-preston-supervisor/dashboard/src/domain/api.ts
apps/hermes-preston-supervisor/dashboard/test_preston_client.py
apps/hermes-preston-supervisor/dashboard/token_client.py
apps/hermes-preston-supervisor/test/security-boundary.test.ts
reports/PRESTON_AI_OS_BUILD_COMPLETION_20260908.md
reports/STAGING_VALIDATION_PACKAGE_20260908.md
reports/p2_evidence/rollback/rollback_0031.sql.txt
reports/p2_evidence/rollback/rollback_0032.sql.txt
reports/p2_evidence/rollback/rollback_0033.sql.txt
reports/p2_evidence/rollback/rollback_0034.sql.txt
reports/p2_evidence/rollback/rollback_0035.sql.txt
reports/p2_evidence/rollback/rollback_0036.sql.txt
supabase/migrations/0032_p5_order_chain_safe_models.sql
supabase/migrations/0033_p4_runner_playbooks_clocks.sql
supabase/migrations/0036_m8_connector_passports_m9_soft_launch.sql
```
