# ChatGPT Command Path — Diagnosis and Repair Report

Date: 2026-08-27
Branch: `feature/final-build-fast-track`
Repair commit: `4fd7613` (local, UNPUSHED — owner pushes per H-6)
Baseline at diagnosis start: `4d82742` (production seal; branch = master `5f15afa` + 1 docs commit)

## 1. Executive summary

Symptom: valid ChatGPT requests were rejected before worker dispatch with
`ambiguous_request:goal_1_has_no_tasks`; simple goals ("Audit the
repository," "Fix the goal composer," implementation requests) produced
zero tasks, so no work ever reached Claude or Codex.

**Verdict: nothing was damaged.** No configuration, integration, migration,
service, or application code was broken. The rejection is the composer's
DESIGNED, test-pinned fail-closed behavior: it has never accepted free
prose without an explicit task sentence. The defect was a contract
mismatch — the MCP/GPT tool catalog told ChatGPT to submit missions "in
plain language" while the composer grammar required `Task 1: ...` /
`Create a task to ...` forms.

Repair (smallest defect, architecture preserved): the composer now derives
exactly one task from a bare single-sentence goal — in the owner's own
words, through the SAME kind resolution, prohibited scans, policy
classification, and approval gating — and the tool catalog now teaches the
multi-step grammar on both adapter surfaces. Everything genuinely
ambiguous, multi-step prose, and explicit task-less goal forms still
reject fail-closed. Full suite green. Not pushed, not deployed.

## 2. Was anything damaged?

No.

- Repo state at start: clean tree except 2 benign untracked files —
  `packages/guards/src/index.js` (compiled output of `index.ts`, dated
  2026-08-26) and `scripts/p1/p1_diagnose.local.ps1` (owner-run, local,
  read-only 401-isolation diagnostic). Both left untouched.
- The 1 unpushed commit (`4d82742`) is docs-only (production seal report).
- Staging reachable and healthy: `https://preston-os-staging.vercel.app/api/health`
  -> 200 `{"ok":true,"mode":"connected"}`; `/.well-known/oauth-protected-resource/mcp`
  -> 200 with correct resource + Supabase authorization server;
  `/api/control/openapi.json` -> 200.
- Production reachable and healthy: `https://preston-os-prod.vercel.app/api/health`
  -> 200 `{"ok":true,"mode":"connected"}`. Production not touched.
- MCP/OAuth registration intact (per the 2026-08-27 connector
  reconciliation: account-level connector holds all 10 tools; stale
  per-chat catalogue pinning is a ChatGPT-side behavior, use a NEW chat).

## 3. Exact root cause

- **File/function:** `apps/dashboard/src/lib/ai-os/orchestration/composer.ts`,
  `composeRequest()`. A sentence matching no goal/task marker becomes an
  implicit goal with zero tasks; the zero-task check then rejects
  `ambiguous_request:goal_<n>_has_no_tasks` ("the composer never invents
  work the owner did not describe").
- **Present since creation** — Phase 7 commit `347d65c`; pinned by
  `test/composer-engine.test.ts:88` ("rejects a goal without tasks") and
  `test/tmode-compose-repro.test.ts:39` (free prose "must keep being
  rejected, not silently mis-shaped"). **No regression commit exists.**
- **Contributing issue (the actionable defect):** the submit-goal contract
  surface — `preston-control/server.ts` tool description,
  `preston-control/schemas.ts` `request` description, and
  `preston-control/openapi.ts` — advertised "the owner's request in plain
  language" with no grammar guidance, so ChatGPT submitted exactly the
  form the composer rejects. All surfaces (dashboard composer form, MCP
  `preston_submit_goal`, GPT Actions facade, remote intake) share the same
  `composeRequest` with no preprocessing, so the failure was uniform, not
  ChatGPT-specific.
- **Prior live evidence:** `reports/PRESTON_CONTROL_GALAXY_G1_G8_EVIDENCE_20260825.md`
  G2/G3 hit this exact tag live on 2026-08-25 and ruled it
  "(A) input formulation, NOT a regression."
- **Unrelated warnings:** `test/worktree-prep.test.ts` fails 5 tests on
  this Windows host (`bash -n` unavailable) — reproduced identically on a
  pristine tree; long-standing environment limitation, not related. One
  flaky full-suite-concurrency failure in `preston-control-audit.test.ts`
  passed in isolation both before and after the change.
- **Unverified:** whether any specific past ChatGPT chat "used to work"
  with bare prose — no server evidence supports that; accepted live
  submissions on record all used the task grammar.

## 4. Reproduction (before)

Deterministic unit repro against the pure composer (no side effects, no
staging writes needed):

- `Audit the repository.` -> `ok:false`, `ambiguous_request:goal_1_has_no_tasks`
- `Fix the goal composer.` -> same
- `Implement a health endpoint for the dashboard.` -> same

Verified via a temporary vitest repro (3/3 asserting the rejection),
executed before any code change.

## 5. Repair (commit `4fd7613`)

Files changed:

1. `apps/dashboard/src/lib/ai-os/orchestration/composer.ts`
   - Implicit goals (bare opening sentence, no explicit marker) are
     flagged; when such a goal has zero tasks AND is the only goal AND no
     sentence was dropped unparsed, ONE task is derived from the goal
     objective (warning `task_derived_from_goal_objective`). The derived
     task flows through the same kind lexicon, prohibited-capability
     scans, role rules, and `classifyJob` policy classification.
   - The adapter-generated `Priority: high.` sentence (appended by
     `preston_submit_goal`) is recognized as metadata so it never counts
     as dropped content.
2. `apps/dashboard/src/lib/preston-control/schemas.ts` — `request`
   description now teaches the grammar (single sentence = one task;
   multi-step = `Task 1: ...` / `Create tasks to A, B, and C.`).
3. `apps/dashboard/src/lib/preston-control/openapi.ts` — same wording on
   the GPT Actions facade.
4. `apps/dashboard/src/lib/preston-control/server.ts` — MCP
   `preston_submit_goal` description now states the grammar.
5. `apps/dashboard/test/composer-bare-goal.test.ts` — NEW regression
   suite, 12 tests (see §6).

Explicitly preserved (validation NOT weakened):

- Unknown kinds still reject (`ambiguous_request:task_kind_unresolved`).
- Multi-step free prose still rejects (tmode pin intact — a dropped
  sentence blocks derivation).
- Explicit `Create a goal to ...` with no tasks still rejects (Phase 7 pin
  intact — the owner asked for decomposition they did not supply).
- Injection markers, prohibited capabilities, secret screening, execution-
  mode markers, classification spoof rejection, approval gating, RLS,
  owner boundaries, idempotency: untouched.
- Rejected requests persist nothing (proven in the E2E test).

## 6. Tests and results

- New `composer-bare-goal.test.ts` (12/12 PASS): 3 bare-goal derivations
  with correct kinds (audit/repair/code); policy classification from the
  policy engine only; constraint sentence recorded without blocking;
  `Priority: high.` suffix non-blocking; unresolvable kind rejects;
  explicit task-less goal rejects; multi-step prose rejects; prohibited
  capability rejects; tool-layer E2E through `prestonSubmitGoal` (accept
  -> compose -> classify -> persist `master_goals` + `goal_jobs` ->
  job kind `audit`, `assigned_role` in {claude, codex} = dispatchable) and
  reject path persisting zero rows.
- Composer-adjacent suites (94/94 PASS): composer-engine,
  composer-security, composer-persist, tmode-compose-repro,
  bounded-execution-routing, composer-bare-goal.
- Full suite: **122 files, 1,645 tests PASS** (+1 expected fail),
  excluding only the pre-existing environmental `worktree-prep.test.ts`
  (5 fails identical on pristine tree; `bash -n` unavailable on host).
- Typecheck: `npx tsc --noEmit` exit 0; `tsc -p tsconfig.osruntime.json
  --noEmit` exit 0.
- Pre-commit hooks at commit: secret scan 0 findings, RED boundary scan
  0 findings.

## 7. Before/after evidence

| Request | Before | After |
| --- | --- | --- |
| `Audit the repository.` | rejected `goal_1_has_no_tasks` | accepted, 1 task kind `audit`, job dispatchable to claude |
| `Fix the goal composer.` | rejected `goal_1_has_no_tasks` | accepted, 1 task kind `repair` |
| `Implement a health endpoint for the dashboard.` | rejected `goal_1_has_no_tasks` | accepted, 1 task kind `code` |
| `Zorble the frobnicator.` | rejected | still rejected (`task_kind_unresolved`), persists nothing |
| `Create a goal to improve the dashboard.` | rejected | still rejected (`goal_1_has_no_tasks`) |
| 3-step free prose (tmode PROSE_TEXT) | rejected | still rejected |

## 8. Current environment status

- **Staging:** healthy (200 connected), MCP metadata + OAuth live; still
  running the PRE-FIX build — live ChatGPT-path E2E awaits deployment.
- **Production:** healthy (200 connected), untouched, still at the sealed
  golden baseline (`5f15afa`).
- **Local:** branch 2 commits ahead of origin (`4d82742` docs seal +
  `4fd7613` fix). Working tree clean except the 2 pre-existing benign
  untracked files.

## 9. Remaining risks / limitations

- Bare sentence + separate `context` text still rejects (context sentences
  count as dropped content — fail-closed by design; ChatGPT normally sends
  `request` alone).
- Multi-step requests still require the explicit task grammar; the catalog
  now teaches it, but old ChatGPT chats pin stale catalogues — drill from
  a NEW chat.
- The staging live drill (real MCP round-trip post-deploy) has not run yet
  — local/tool-layer E2E only.

## 10. Gate close

- Gate result: **PASS (local repair + validation); owner-gated for deploy**
- Commit hash: `4fd7613`
- Files changed: composer.ts, preston-control/{schemas,openapi,server}.ts,
  test/composer-bare-goal.test.ts (5 files, +162/−8)
- Commands run: git status/log/diff/stash/grep/show, vitest (full + targeted),
  tsc x2, read-only HTTPS GETs to staging/prod health + metadata endpoints
- Tests run: 1,645 pass / 122 files (+ new 12-test regression suite)
- Environment: local Windows dev host; staging/prod read-only probes only
- Production touched: **false**
- Secrets exposed: **false**
- Live messages sent: **false**
- Live emails sent: **false**
- Next gate: owner push -> staging deploy -> live ChatGPT drill (NEW chat:
  submit "Audit the repository." expect `accepted`, 1 job) -> RED gate for
  production promotion
- Owner action required: push branch (H-6), deploy staging, run drill,
  authorize production promotion

## 11. Recommended next action

Push and deploy to staging, run the one-sentence drill from a fresh
ChatGPT chat, and on PASS schedule the production promotion under the
standard RED gate.

---

# ADDENDUM: Staging deployment + live ChatGPT drill — ALL PASS (2026-08-27)

Owner pushed the branch (origin = ce5e6c4, verified on GitHub) and
authorized staging deployment + the live drill.

## A1. Staging deployment

- Branch push produced Ready preview `CRMugvwp2Cc19DKi2dTAieLBqpM4`
  (commit ce5e6c4, feature/final-build-fast-track, build 29s).
- Promoted via Vercel dashboard (owner browser session) to Production of
  project preston-os-staging: deployment `8HsD472PsEpgF1r3gWcuMmRMGzLX`,
  aliased ONLY to preston-os-staging.vercel.app.
- **Staging deployment commit: ce5e6c4** (contains fix 4fd7613).
- Smoke: /api/health 200 `{"ok":true,"mode":"connected"}`; OpenAPI 200 with
  10 operations (getPrestonStatus, submitPrestonGoal, getPrestonGoal,
  followUpPrestonGoal, cancelPrestonGoal, getPrestonJob,
  listPrestonApprovals, decidePrestonApproval, getPrestonEvidence,
  getPrestonArtifact) and the NEW grammar description live; /api/control/
  status without token -> HTTP 401 fail-closed.
- Production project (preston-os-prod) untouched, not restarted, not
  redeployed; master not promoted.

## A2. Live one-sentence goal drill (ChatGPT path, NEW chat, connector
"Preston Control MCP - Staging Clean")

preston_submit_goal request="Audit the repository."
request_id=pc-drill-20260827-bare-1 -> raw result:

- status **accepted**, approvals_required 0,
  warnings ["task_derived_from_goal_objective"] (the repair's derivation
  path, observed live)
- goal_id **07646def-9581-428c-9305-294ffc4aea58**
  (correlation cmp-pc-drill-20260827-bare-1-g1-fb77f21f78f4, replayed false)
- exactly ONE job: **11a6dcf4-2273-4870-ae86-43885358d66c**
  "Audit the repository", requires_approval false

preston_get_job readback: kind **audit**, risk_class **GREEN**,
assigned_role **claude**, status **in_progress**, run.active **true**,
lease_expires_at 2026-08-27T21:24:55Z, created 21:14:41Z, leased 21:14:55Z
-> persisted AND actually dispatched: the staging runtime leased the job to
the Claude worker within one tick (~14s). Bounded audit execution was
in flight at report time; result reports/evidence land on completion and
are readable via preston_get_job / preston_get_evidence.

## A3. Fail-closed drills (live, same path; both persisted NOTHING)

- "Zorble the frobnicator." (pc-drill-20260827-neg-1) -> rejected
  `ambiguous_request:task_kind_unresolved:t1`, goals [].
- "Audit the repository. Then summarize what you found in a report."
  (pc-drill-20260827-neg-2) -> rejected
  `ambiguous_request:goal_1_has_no_tasks`, goals [] (multi-step prose pin
  holds live).

## A4. Controls intact (live)

- preston_status: posture operating; controls readable
  (execution_enabled true, remote_runner true, owner_stop false, paused
  false, hermes observe_only); needs_attention correctly surfaces the
  pre-existing 6 open approvals + 1 blocked goal (drill created no new
  approvals: approvals_required 0).
- preston_get_evidence(goal) ok:true with the live job row.
- Classification came from the policy engine (GREEN audit, no approval);
  approval/cancel/follow-up/artifact ops present in the live 10-op catalog;
  unauthenticated access 401.

## A5. Verdict

End-to-end staging validation **PASS** on all five owner criteria:
accepted; exactly one task; valid persisted + dispatched job; safety/
classification/approval/evidence/artifact surfaces intact; invalid and
ambiguous requests fail closed. **STOPPED at the production approval
gate** — production untouched; promotion of ce5e6c4 (or a master merge)
to preston-os-prod requires explicit owner RED-gate authorization.

Remaining watch item: drill job 11a6dcf4 completes in the background;
read its result via preston_get_job. Drill residue: one GREEN staging
goal/job (honest terminal state expected), two rejected intake rows'
worth of nothing (rejections persist no rows).

## A6. Drill job terminal results — COMPLETED CLEAN (read back 2026-08-27)

Job 11a6dcf4-2273-4870-ae86-43885358d66c reached its terminal state:

- status **completed**, attempts **1**, failure_reason **null**,
  run.active false, lease released (was 21:14:55Z -> null).
- result_reports[0]: outcome **completed**, executed **true**, mode
  **real**, provider_role **claude**, duration_ms **352486** (~5m52s),
  recorded_at **2026-08-27T21:20:50.699737Z**, structured_error null.
- summary: "REAL level-1 audit run completed (exit 0, bounded)".

Evidence refs (3, archived verbatim):

1. `real:goal:07646def-9581-428c-9305-294ffc4aea58:job:11a6dcf4-2273-4870-ae86-43885358d66c:run:11a6dcf4-2273-4870-ae86-43885358d66c:839cb2ad-5859-4cc0-8902-c8994b526cb2:attempt:1:completed:executed:true`
2. `real-audit:job:11a6dcf4-...:run:...839cb2ad-5859-4cc0-8902-c8994b526cb2:paths_ok:clean`
3. `real-provider:job:11a6dcf4-...:run:...839cb2ad-...:role:claude`

Safety confirmation — no unexpected production access, no violations:

- **paths_ok:clean** (allowed-path audit clean); files_changed [],
  files_touched [], commit_sha null — the audit worker modified NOTHING.
- artifacts [] — no artifacts produced (nothing to retrieve via
  preston_get_artifact; the artifact surface itself was verified live in
  the sealed 2026-08-27 prod smoke, unrelated to this GREEN drill).
- Worker ran in its bounded worktree on the staging host (checkout base
  8cf140e); zero secret-pattern and zero RED-boundary findings across the
  audited tree; no network installs (denied by contract and permission
  layer, honored).
- Fail-safe reporting intact: the worker declared vitest/tsc/eslint/
  os-runtime build UNRUNNABLE (node_modules absent in the worktree;
  offline install and scanner scripts permission-denied), reproduced both
  scanners' rule sets via search (0 findings), and explicitly did NOT
  claim the suite passed. Limitations recorded in structured.limitations
  (4 entries).

Audit content (worker's structured.summary, archived): static audit of
apps/dashboard (308 files, ~30k lines), no code changed; 5 findings -
1 medium correctness (F1) + 4 low. F1 verbatim substance: real-codex-
adapter.ts:203 returns `environment_mismatch` for the deployment-
environment pin while real-claude-adapter.ts:328 uses
`environment_not_staging`; orchestration/outcomes.ts TERMINAL_REAL_
REQUIRED (:57-66) lists only the Claude spelling and no retryable prefix
matches, so the codex refusal falls through classifyFailure (:105) to
`retryable:unrecognized:environment_mismatch` and burns the full retry
budget instead of terminating. Worker's recommended_next_action: add
`environment_mismatch` to TERMINAL_REAL_REQUIRED (or align the codex
adapter spelling) with a pinned regression test updating
test/real-codex-adapter.test.ts:208. **Backlog item for the owner - not
part of this gate.** Worktree provisioning gap (node_modules absent for
audit worktrees) is a second backlog item: audits currently cannot run
the suite, only static review.

Staging evidence is COMPLETE. Still stopped at the production approval
gate: no production deployment, modification, or master promotion has
occurred. Owner actions next: push the report commits, then rule on the
production RED gate.
