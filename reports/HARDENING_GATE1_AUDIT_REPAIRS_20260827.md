# Gate 1 — Platform Hardening from the 2026-08-27 Live Audit Findings

Date: 2026-08-27
Branch: `hardening/audit-repairs-clone-proof` (from verified origin/master `6ea49a2`)
Production: UNTOUCHED throughout (no deploy, no repin, no data change).
Preserved untracked files: `packages/guards/src/index.js`, `scripts/p1/p1_diagnose.local.ps1` (not added, not modified, not committed).

## 1. Findings recovery

Sources: `reports/CHATGPT_COMMAND_PATH_DIAGNOSIS_REPAIR_20260827.md` (§A6
staging job 11a6dcf4, §P5b prod job eeaf3d37), the archived raw
`result_reports` in those sections, source inspection at `6ea49a2`, and
commit history. The two worker audits reported 5 (staging) and 8 (prod)
findings; the itemized detail of the staging "4 low" and prod "4 low"
findings was TRUNCATED by the bounded `result_excerpt` cap and is not
recoverable from any stored record (disposition in §3).

## 2. Repairs (all reproduced-first, minimal, fail-closed preserved)

### 2.1 PF1 — Post-run confinement blind to committed changes (HIGH)

Reproduced: `auditTouchedPaths('', 'packages/guards/src/index.ts', [...])`
and executor-level clean-status/dirty-diff fake; plus a REAL-git drill
(`test/worktree-real-git-drill.test.ts`) in which a worker-style local
commit hides `forbidden/evil.md` — pre-fix semantics passed vacuously.

Fix (`worktree-provision.ts`, `real-executor.ts`):
- New fixed READ-ONLY argv builder `buildDiffArgs`:
  `git -C <worktree> diff --name-only --no-renames <base> HEAD`
  (`--no-renames` keeps both sides of a committed rename visible, matching
  porcelain semantics).
- `auditWorktree` now enumerates BOTH surfaces and enforces over their
  normalized (backslash→`/`, `./`-stripped), deduplicated union.
- Fail-closed: malformed base → `base_commit_invalid`; absent/unreachable/
  uncomparable base → `base_unverifiable`; either fails the job as
  `worktree_audit_unreadable` with the specific reason in evidence.
- Workers gained NOTHING: the diff runs in the runtime's audit path with
  the same fixed-argv, shell:false, scrubbed-env runner; the worker tool
  allowlist (`Read,Glob,Grep,LS,Edit,Write,MultiEdit`) is unchanged.

Tests: 6 pure-function regressions + 3 executor-level (hidden-commit
violation; committed+uncommitted union in files_changed; uncomparable base
fails closed) + 2 real-git drills. The worktree lifecycle pin is now
`add → status → diff → remove`.

### 2.2 F1 — Codex `environment_mismatch` misclassified RETRYABLE (MEDIUM)

Reproduced: `classifyFailure('real_required:environment_mismatch')` →
`retryable:unrecognized:environment_mismatch` (burned the retry budget on
a deterministic refusal).

Fix (`orchestration/outcomes.ts`): `environment_mismatch` added to
`TERMINAL_REAL_REQUIRED`. This is the central-authority fix, so the SAME
spelling from `real-codex-adapter.ts:203`, `orchestration/store.ts:431`
(approval env pin), and `capabilities/executor.ts:139` (capability env
pin) — all deterministic re-checks — now classify TERMINAL, matching
Claude's `environment_not_staging`. Genuine retryables
(`timeout`, `provision_failed`, unknown shapes → bounded retry) and
UNCERTAIN prefixes are pinned unchanged.

### 2.3 PF2 — Worker prompt vs tool-capability mismatch (MEDIUM)

Fix (`real-claude-adapter.ts` `buildLevel1Prompt` — shared by BOTH
providers — and `structured-result.ts` prompt clause): the REQUIRED
section now states the FILE-TOOLS-ONLY bound (no shell, no git, no
command execution), forbids committing, and demands unrun validation be
declared in `limitations` instead of claimed. The impossible
requirements ("Run the repository tests...", "At most one LOCAL
commit") are gone and their ABSENCE is pinned. The tool allowlist was
NOT widened; `commit_sha` stays in the structured schema for
compatibility (always null going forward; PF1's diff audit is the belt
if any future worker ever commits).

### 2.4 PF3 — Artifact object-path collision (MEDIUM)

Reproduced: `artifactObjectPath(g,j,r,'a/b.md') ===
artifactObjectPath(g,j,r,'a__b.md')` pre-fix — the second upsert
overwrote the first object while its metadata row deduplicated as a
replay, leaving a stored sha256 describing the WRONG bytes.

Fix (`artifacts.ts`): the object key embeds an 8-hex sha256 tag of the
ORIGINAL relative path (`.../<tag>-<flat>`): distinct sources →
distinct destinations deterministically; identical source → identical
key (idempotent replay preserved). Belt: `persistArtifacts` tracks
in-pass destinations and refuses any residual conflict as
`object_path_conflict` (fail closed, never overwritten). Source
identity (`name` column), sha256, job/run binding, private bucket, and
signed retrieval are unchanged. Compatibility: existing artifact rows
keep their old object paths and remain retrievable via their stored
`object_path`; only NEW runs use the new key shape (a post-deploy
replay of a pre-deploy run creates a fresh key rather than converging —
acceptable: uniqueness is per object path and no old object is ever
overwritten).

### 2.5 PF4 — Completed code-job outputs silently dropped (MEDIUM)

Reproduced: a completed run touching only `x.ts` → `extension_not_allowed`
rejection, condition `ok`, zero artifacts — with the worktree
force-removed, the entire work product vanished silently.

Fix (`artifacts.ts` EXT_TABLE, the deliberate widening its header
requires): source types the platform's own code/test/migration jobs
produce — `.ts .tsx .js .mjs .cjs .sql .yml .yaml .css` — persist as
type `code`, served `text/plain` (never executable in a browser), all
TEXT and therefore secret-screened (a secret-shaped source file still
fails closed, pinned). Shell/PowerShell scripts stay refused (pinned
least-privilege stance). Out-of-scope files still never persist: the
executor persists only `completed` outcomes over path-audited files;
failed/uncertain runs persist nothing (existing pins).

### 2.6 Item 3 — Worktree dependency provisioning: GATED DESIGN (no code)

Intended model: fresh worktrees are source-only; `node_modules` was never
provisioned, so no validation command can run (both live audits declared
this honestly). A safe implementation REQUIRES host infrastructure the
runtime does not have today, so per instruction this is a design, not an
improvisation:

- New env-gated step (`ORCH_WORKTREE_DEPS_ENABLED`, default off) after
  `provisionWorktree`, run BY THE RUNTIME (never the worker), fixed argv:
  `npm ci --offline --ignore-scripts --no-audit --no-fund
  --cache <ORCH_NPM_CACHE>` in `apps/dashboard` of the worktree.
  - `--offline`: install fails rather than touching the network.
  - `--ignore-scripts`: no lifecycle script from any package executes.
  - `npm ci`: verifies integrity hashes against the committed
    `package-lock.json` — lockfile-integrity check is built in; any
    mismatch fails the provision (fail closed to the current behavior).
- Per-worktree `node_modules` (no shared writable state); the shared
  npm CACHE is content-addressed, owner-provisioned, and mounted
  read-only to the service identity (cache warming is an OWNER runbook
  step on the host: `npm ci --cache <path>` once per lockfile change).
- Worker tool allowlist unchanged: even with dependencies present the
  worker still cannot RUN them (no shell). The step's value today is
  limited to future runtime-side validation hooks; granting workers a
  test-runner is a SEPARATE owner gate and is NOT proposed here.
- Owner gate required for: cache directory provisioning + read-only
  mount on the prod/staging hosts, disk budget (~500MB/worktree),
  and the env flag. Until then the platform keeps the honest
  "validation unrunnable, declared in limitations" posture that PF2's
  prompt now makes explicit.

## 3. Disposition register (item 7)

| Finding | Disposition |
|---|---|
| Staging F1 codex env spelling | CONFIRMED → FIXED (§2.2) |
| Staging low findings ×4 | NOT RECOVERABLE — truncated by the result_excerpt cap before persistence; no stored record itemizes them. Mitigation path noted below. |
| Prod PF1 confinement blind spot | CONFIRMED → FIXED (§2.1) |
| Prod PF2 prompt/capability mismatch | CONFIRMED → FIXED (§2.3) |
| Prod PF3 artifact path collision | CONFIRMED → FIXED (§2.4) |
| Prod PF4 code-artifact omission | CONFIRMED → FIXED (§2.5) |
| Prod low findings ×4 | NOT RECOVERABLE — same truncation. |
| Worktree dependency gap | CONFIRMED → GATED DESIGN (§2.6, owner approval required) |

Truncation follow-up (deferred, owner-directed): audit-kind runs could
persist their FULL report as a `.md` artifact (the platform now persists
artifacts; audits touch no files so today nothing persists) — a narrow
future change, not performed here (out of the minimal-repair scope).

## 4. Gate 1 validation matrix

| Check | Result |
|---|---|
| Focused regressions (`hardening-audit-repairs.test.ts`) | 17/17 PASS |
| Real-git E2E drill (`worktree-real-git-drill.test.ts`) | 2/2 PASS (hidden-commit escape caught; unreachable base fails closed) |
| Touched suites (executor/artifacts/adapters/fast-track) | 197/197 PASS |
| Full Vitest suite | **1,695 pass + 1 expected fail**; only failures = 5 pre-existing environmental `bash -n` checks in `worktree-prep.test.ts` (identical on pristine master; this host has no bash — the same scanners run in PowerShell form at every commit) |
| `tsc --noEmit` (app + osruntime) | PASS / PASS |
| `eslint .` | PASS (0) |
| Secret scanner / RED-boundary scanner | 0 / 0 findings (pre-commit hook, every Gate 1 commit) |
| Worktree isolation + allowed-path tests | PASS (incl. new union/dedup/normalization + rename pins) |
| Claude + Codex outcome tests | PASS (terminal parity pinned; retryable/uncertain preserved) |
| Artifact collision/integrity/persistence/retrieval | PASS (incl. new conflict + code-type + secret-screen pins) |

**GATE 1 RESULT: PASS.**

Constraints honored: no worker tool/allowlist/privilege widening, no RLS
or approval change, no scanner change, no production contact, no push.
