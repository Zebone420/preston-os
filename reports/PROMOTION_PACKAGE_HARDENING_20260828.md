# Promotion Package — Hardening Branch + Three Live-Defect Fixes

Date: 2026-08-28. Prepared for OWNER-APPROVED promotion. Nothing in this
package has been pushed, merged, deployed, repinned, or configured on any
host; every live step below is owner-gated.

## 1. Branch and range

- **Branch:** `hardening/audit-repairs-clone-proof`
- **Base / master:** `6ea49a2` (sealed prod lineage; origin/master HEAD)
- **Promotion range:** `6ea49a2..f921c01` — 12 commits, in order:

| Commit | What |
|---|---|
| `53c010c` | Gate 1: the four verified audit repairs (PF1 confinement diff-union, F1 codex outcome parity, PF2 honest prompt, PF3 artifact path collision + PF4 code-artifact persistence) |
| `6bb5913` | Clone kit: instance configuration contract + scripts (Gate 2) |
| `33798e5` / `12ee42f` / `72dca71` / `2d4d54e` | Live Northstar clone-proof evidence — verdict CLONE PROOF PASS, teardown receipts |
| `b28a44f` | **Fix 1**: full run-report artifact when the excerpt cap truncates worker output |
| `552287f` | Fix 1 gate report |
| `47a1e53` | **Fix 2**: composer remap — repair/fix/remediate language → kind `code` (owner-approved; kills the live `kind_not_eligible` dead-letters) |
| `8d6d91c` | Fix 2 gate report |
| `040220d` | **Fix 3**: `ORCH_REAL_TIMEOUT_MS` bounded owner timeout knob + lease coupling (kills the live `timeout` dead-letters once configured) |
| `f921c01` | Fix 3 gate report |

The first 6 commits are already on the branch origin (owner-verified at
the time); the last 6 are local-only. Working tree clean except the two
long-preserved untracked local files (`packages/guards/src/index.js`,
`scripts/p1/p1_diagnose.local.ps1`) — never committed, never promoted.

## 2. Files / components changed (non-report)

Runtime core: `real-claude-adapter.ts`, `real-codex-adapter.ts`,
`real-timeout.ts` (new), `artifacts.ts`, `structured-result.ts`,
`runtime-environment.ts`, `worktree-provision.ts`,
`orchestration/{composer,driver,outcomes}.ts`,
`os-runtime/{dispatcher,real-executor}.ts`.
Clone kit: `scripts/clone/*.mjs`, `clone/*`, two docs.
Config: `env.template` (names only).
Tests: 11 suites touched/added (incl. new `composer-repair-kind-remap`,
`real-timeout`, `clone-preflight`, `worktree-real-git-drill`).
Total: 39 files, +3,458 / −50.

## 3. Test evidence (2026-08-28, this host)

| Check | Result |
|---|---|
| Combined three-fix + interaction batch (17 files: artifacts, remap, timeout, driver/lease, both adapters, executor, dispatcher, fast-track retry/dead-letter, routing, engine, read-model, control tools, hardening, durable, real-seam) | **415/415 PASS** |
| Second broader batch (19 files: e2e, drills, approvals, security regressions, structural, orchestrate-once, runtime, control jobs/artifact/follow-up/cancel, composer engine/lifecycle/persist/security, tmode, hermes) | **238 pass + 1 expected fail** |
| Repo-wide `eslint .` / `tsc --noEmit` / `build:os-runtime` | PASS (0) / PASS / PASS |
| FULL Vitest suite at the promoted code state (run at `040220d`; `f921c01` is report-only) | **128 files, 1,747 pass + 1 expected fail** |
| Interaction review | remap→adapter kind gate (pinned end-to-end); timeout→lease margin property (pinned for all configs); timeout→retry (RETRYABLE pinned); kind_not_eligible→TERMINAL (pinned); artifacts kind-independent (pinned); status/read-model + attention loop suites green |

### Known environmental-only failures

`test/worktree-prep.test.ts:268/:276` — two bash-scanner 120-second
timeouts, Windows dev host only (bash-driven scans are slow here; the
identical scanners run in PowerShell form at every commit). Reproduced
identically on pristine baselines; not code defects.

## 4. Rollback point

- Repo: master `6ea49a2` (sealed). Any single fix can also be reverted
  individually — each is one isolated commit with its own tests.
- Vercel: Instant Rollback to the current production deployment (sealed
  `6ea49a2` build).
- Host: current prod pin (promote-0020-0023 lineage / sealed dist).
- Env knob: unset `ORCH_REAL_TIMEOUT_MS` → prior 10-min behavior.

## 5. Production risks

1. **Composer remap changes live classification**: goals phrased with
   fix/repair verbs now compose EXECUTABLE code jobs instead of
   dead-lettering. Risk is bounded: risk/approval classification is
   text-based and unchanged (pinned); production wording still rejects;
   worktree confinement, path allowlist, risk ceiling, and approval gates
   unchanged. Residual risk: more real work actually executes.
2. **Lease default with real executor moves 10→15 min** (timeout + margin)
   even with the knob unset — orphan-recovery latency for a crashed real
   run grows by 5 min. Disclosed in the Fix 3 report.
3. **Run-report artifacts add storage writes** for truncated reports only;
   env-gated by ORCH_ARTIFACTS_ENABLED exactly like existing artifacts.
4. Gate 1 / clone-kit commits: already owner-reviewed in their own gates;
   clone kit is inert scripts + docs (nothing imports it at runtime).
5. Host repin lag: until BOTH Vercel and the host are updated, the host's
   remote-intake path keeps pre-fix composer behavior (mixed-version
   window). Keep the window short; manual-tick posture makes it benign.

## 6. Owner-gated steps required (exact, in order)

1. **Approve + push** the 6 local commits to
   `origin/hardening/audit-repairs-clone-proof` (branch push; no deploy).
2. **Approve + merge** the branch into `master` (non-force) and push —
   this FEEDS VERCEL production. Verify `/api/health` 200 + openapi op
   count after deploy; Instant Rollback is the reversal.
3. **Repin staging + prod hosts** to the merged master commit; rebuild
   dist; verify the systemd oneshot ticks clean (manual tick on prod).
4. **Set `ORCH_REAL_TIMEOUT_MS=2700000`** (45 min) in the prod + staging
   host env files (`/etc/preston/*.env`) — recommendation stands unless
   the live proof suggests otherwise; unset keeps 10 min.
5. Then execute the live proof plan below (E–H).
6. Owner-gated cleanup decisions per the historical-job classification.

---

## 7. Post-promotion LIVE PROOF PLAN

Preconditions: steps 1–4 above done; system_controls posture healthy
(`preston_status` → operating, no owner_stop/paused).

**E. Regression proof — kind_not_eligible class.** Submit via ChatGPT
(`preston_submit_goal`) one controlled goal in the exact previously-failing
phrasing, e.g. "Repair the repository classification lexicon comment in
apps/dashboard." Expected: composes ONE `code` job (not `repair`), GREEN
unless gated words present, real execution starts (evidence ref
`real:...:executed:true`), completes; NO `kind_not_eligible` anywhere.

**F. Regression proof — timeout class.** Submit one controlled goal known
to exceed 10 minutes (the class that previously timed out; a
documentation/audit-scale task over the large surface). Expected: run
CONTINUES past the old 10-min cutoff, completes within 45 min; job lease
(`run_lease_expires_at`) = claim + 50 min and never expires mid-run
(verify no recovery/requeue events, attempts stays 1).

**G. Wizard recovery workload.** Resubmit ONE Business Setup Wizard
repository-classification goal (owner picks the wording; both failure
classes historically). Expected: correct kinds, real execution, terminal
completed, artifacts persisted (incl. run-report artifact if the report
exceeds 2,000 chars).

**H. Verification matrix (each of E/F/G):**
- `preston_get_goal` / `preston_get_job`: correct kind; status
  completed/failed for the RIGHT reason; attempts as expected.
- Lease health: no `job_not_leased`/`lease_expired` evidence; no recovery
  requeue of a live run.
- Duration evidence: F's `duration_ms` > 600,000.
- Artifacts: `artifact:` refs present where files/report produced;
  `preston_get_artifact` returns metadata + signed URL.
- Retry/dead-letter: inject NOTHING; simply confirm no unexpected
  dead-letter and that failure_reason (if any) classifies as designed.
- Visibility: `preston_status` posture + needs_attention correct before/
  after; dashboard orchestration page shows the same counts; ChatGPT can
  read the terminal state end-to-end.

## 8. Historical dead-letter / failed job classification (decision aid)

Do NOT bulk-rerun. Classify each historical row (owner executes the
queries; runtime identity is read-only where applicable):

| Class | Definition | Action |
|---|---|---|
| **Rerun as regression proof** | A job whose failure_reason is `terminal:real_required:kind_not_eligible` or timeout-exhausted AND whose objective is still meaningful — pick ONE of each for steps E/F (the wizard goal covers G) | Resubmit as a NEW goal (never mutate dead-lettered rows) |
| **Obsolete diagnostic/repair job** | Drill/diagnostic jobs (e.g. command-path diagnosis era, audit drills) whose purpose is complete and archived in reports | Leave dead-lettered as historical record |
| **Still-relevant product work** | Wizard build tasks and other product objectives still wanted | Owner resubmits AFTER E/F pass, rephrased if previously `task_kind_unresolved` (setup/branch wording still rejects — separate work unit) |
| **Owner-gated cleanup** | The 3 pre-seal historical prod dead letters + parked goal `5d25fa51` (production seal backlog) | Owner-only decision; untouched by this package |

## 9. Next work unit after successful live proof

`docs/PRESTON_CHATGPT_SUPERVISOR_BRIDGE_DESIGN_v1.md` (in this range's
successor commit) — design note only; implementation starts on owner
direction after the live proof.
