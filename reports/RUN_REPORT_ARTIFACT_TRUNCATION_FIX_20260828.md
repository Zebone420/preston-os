# Gate 1 Truncation Follow-up — Full Run-Report Artifact

Date: 2026-08-28
Branch: `hardening/audit-repairs-clone-proof`
Production touched: **false**. Secrets exposed: **false**. Live messages/emails sent: **false**.

## Problem / root cause

Two live worker audits (staging job `11a6dcf4`, prod job `eeaf3d37`,
2026-08-27) permanently lost their itemized findings — 4 staging low + 4
prod low findings, unrecoverable from any stored record (Gate 1 §3
disposition: NOT RECOVERABLE). Root cause: the readable result text is
persisted only as `result_excerpt`, bounded to `REAL_CLAUDE_EXCERPT_CHARS`
(2,000 chars) by `sanitizeProcessText`, while process capture allows 2MB
(`REAL_CLAUDE_MAX_OUTPUT_BYTES`). Audit-kind runs touch no files, so the
artifact platform persisted nothing else: everything past the cap was
destroyed with the worktree. Gate 1 recorded the fix path ("audit-kind
runs could persist their FULL report as a `.md` artifact") and deferred it
out of that gate's minimal-repair scope; this session's owner instruction
(continue hardening the completion/notification flow) directs it.

## Implementation (minimal, fail-closed preserved)

- `real-claude-adapter.ts`: redaction split from bounding — new exported
  `redactProcessText` (secret patterns, no slice); `sanitizeProcessText`
  is now exactly `redactProcessText(t).slice(0, REAL_CLAUDE_EXCERPT_CHARS)`
  (pinned). `extractResultParts` additionally returns `full_text`: the SAME
  human text (machine block stripped), redacted but NOT excerpt-bounded.
  `RealAdapterResult` gains `result_full_text` (null on refusals).
- `real-codex-adapter.ts`: parity — `result_full_text` on the result
  interface, refusal path, and success path (shared `extractResultParts`).
- `os-runtime/real-executor.ts`: when a COMPLETED run's report was
  actually truncated by the cap (`full_text.length > excerpt.length`), the
  full redacted text persists as artifact `run-report/<runId>.md` (runId
  sanitized to path-safe chars) in the SAME `persistArtifacts` pass as the
  touched files: identical validation, secret screen (fail-closed
  rejection, never scrubbed-after-hash), size cap, in-pass conflict belt,
  and `ArtifactRecorded` event. Past the per-run artifact cap it is
  refused visibly (`artifact_cap_exceeded`), never silently. Short reports
  (excerpt == full) persist nothing extra — prior behavior byte-identical.
  Gate off (`ORCH_ARTIFACTS_ENABLED` unset) remains fully inert.
- Event rows stay bounded: `result_full_text` never reaches
  JobResultRecorded or the control surface raw — only the artifact holds
  it, retrievable via `preston_get_job` (evidence ref `artifact:<id>`) →
  `preston_get_artifact` (signed URL). The ChatGPT read loop is closed.

## Files changed

- `apps/dashboard/src/lib/ai-os/real-claude-adapter.ts`
- `apps/dashboard/src/lib/ai-os/real-codex-adapter.ts`
- `apps/dashboard/src/os-runtime/real-executor.ts`
- `apps/dashboard/test/artifact-platform.test.ts` (helper parametrized:
  configurable claude result + git status; defaults unchanged)

## Tests added (6, all in artifact-platform.test.ts)

1. `extractResultParts`: `full_text` redacted but NOT excerpt-bounded;
   excerpt is exactly its bounded prefix; secrets `[REDACTED]` in both.
2. `sanitizeProcessText` = redact + bound of `redactProcessText` (pin).
3. Clean worktree + truncated report → the FULL report persists as a
   `document` artifact named `run-report/<runId>.md`; ref rides
   evidence_refs; `artifact_unrecorded` false.
4. Truncated report + touched file → BOTH persist in one pass.
5. Short report → ZERO artifact operations (prior behavior pinned).
6. Gate off + truncated report → ZERO artifact operations.

## Validation

| Check | Result |
|---|---|
| Focused suites (artifact-platform, real-claude-adapter, real-codex-adapter, real-executor, hardening-audit-repairs) | **168/168 PASS** |
| `tsc --noEmit` (app) | PASS |
| `tsc -p tsconfig.osruntime.json` (build:os-runtime) | PASS |
| `eslint` (changed files) | PASS (0) |
| Full Vitest suite BEFORE (this host, 2026-08-28, 126 files) | **1,705 pass + 1 expected fail; 3 failed tests / 2 failed files** — visible failures are the known environmental bash-scanner 120s timeouts in `worktree-prep.test.ts` (Windows host; the same scanners run in PowerShell form at every commit) |
| Full Vitest suite AFTER (same host, same day, 126 files) | **1,711 pass + 1 expected fail; 3 failed tests / 2 failed files** — failure counts IDENTICAL to baseline; the +6 passes are exactly the new pins |
| Failure identity check | Suite re-run EXCLUDING `worktree-prep.test.ts` (full log captured): its two 120s bash-scanner timeouts vanished; two OTHER tests (preston-control-audit, preston-control-gpt) timed out at 5s plus one vitest worker-pool startup timeout — all under deliberate CPU load (a concurrent repo-wide eslint+tsc sweep). Immediate re-run of those three files on a quiet host: **43/43 PASS in 15s** — load-induced flakiness, not defects. Conclusion: no non-environmental failure exists before or after the change. |
| Full `eslint .` / full `tsc --noEmit` (post-commit sweep) | PASS / PASS |

## Commit

- Fix + tests: `b28a44f` on `hardening/audit-repairs-clone-proof`
  (local; NOT pushed — owner push/merge gate). Pre-commit secret scan
  0 findings, RED-boundary scan 0 findings.
- This report: the docs commit following `b28a44f`.

## Gate close block

- Gate result: **PASS**
- Commits: `b28a44f` (fix + 6 tests), this report's docs commit
- Files changed: the four files listed above + this report
- Commands run: focused vitest (5 suites), full vitest x2 (before/after),
  exclusion-run + quiet-host re-run, tsc app + osruntime, eslint full
- Environment: local Windows dev host only
- Production touched: false | Secrets exposed: false
- Live messages sent: false | Live emails sent: false
- Next gate: owner review of this branch (push/merge feeds Vercel)
- Owner action required: none for this work unit; branch promotion
  remains owner-gated

## Remaining risks / limitations

- The report artifact is refused (visibly) when a run already has
  `MAX_ARTIFACTS_PER_RUN` touched files; audit-kind runs touch none, so
  the motivating loss cannot recur.
- Redaction happens BEFORE hashing, so the stored sha256 truthfully
  describes the stored (redacted) bytes; a report that still trips the
  artifact secret screen after redaction is rejected fail-closed.
- Storage-layer persistence still requires `ORCH_ARTIFACTS_ENABLED=true`
  and the `artifacts` bucket (owner Gate C posture) — unchanged.

## Owner-gated next actions (NOT performed)

- Push/merge `hardening/audit-repairs-clone-proof` → master (feeds Vercel).
- Prod/staging host repin + any deploy.
- Worktree dependency provisioning design (Gate 1 §2.6) activation.
- Parking-lot gates in NEXT_GATES.md.
