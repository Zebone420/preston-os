# Composer Repair-Kind Remap — Owner-Approved — Gate Report

Date: 2026-08-28
Branch: `hardening/audit-repairs-clone-proof`
Commit: `47a1e53` (local only, NOT pushed)
Production touched: **false**. Secrets exposed: **false**. Live messages/emails: **false**.

## Problem / root cause

Live production dead-letters (`real_required:kind_not_eligible`, TERMINAL)
on the Business Setup Wizard repository-classification repair goal.
Chain: `composer.ts` KIND_LEXICON minted kind `repair` from
`/\b(repair|fix|remediate)/i` (first-match-wins) → `repair` is in
SUPPORTED_JOB_KINDS so the engine dispatched it → the Level-1 real
adapters exclude `repair` BY DESIGN ("self-modification of failing
runtime state", real-claude-adapter.ts) → contract refused
`kind_not_eligible` → strict real mode persisted
`real_required:kind_not_eligible` → outcomes.ts (correctly) classified
TERMINAL → immediate dead-letter. The defect is the composer labeling
ordinary repository-fix work into the deliberately excluded kind.

## Change (owner ruling honored exactly)

`composer.ts` KIND_LEXICON: `['repair', /\b(repair|fix|remediate)/i]` →
`['code', /\b(repair|fix|remediate)/i]`, same position (precedence over
test/audit words unchanged). NOT done: no adapter eligible-set change,
no risk/approval change, no migration change, no production control
change, no setup/branch widening, no timeout change, no push.

## Before / after classification behavior

| Request | Before | After |
|---|---|---|
| "Fix the goal composer." | kind `repair` → real adapters refuse `kind_not_eligible` → strict mode dead-letters TERMINAL | kind `code` → passes BOTH adapter kind gates → executes |
| "Repair the repository classification lexicon." | same dead-letter path | kind `code`, executes |
| "Remediate the failing import path." | same dead-letter path | kind `code`, executes |
| "Fix the deploy script…" | kind `repair` + approval-gated (deploy marker) | kind `code` + STILL approval-gated (identical policy decision — pinned) |
| "Fix the production database config." | rejected `prohibited:production_access` | UNCHANGED — still rejected outright |
| "Migrate the schema…" | kind `migration`, approval-gated, adapter-ineligible | UNCHANGED |
| "Zorble the frobnicator." | rejected `task_kind_unresolved` | UNCHANGED |
| "Set up the wizard branch." | rejected `task_kind_unresolved` | UNCHANGED — pinned; widening is a separate work unit |
| Legitimately emitted `kind_not_eligible` (e.g. UI-created repair-kind job) | TERMINAL dead-letter | UNCHANGED — TERMINAL pinned |

## Files changed

- `apps/dashboard/src/lib/ai-os/orchestration/composer.ts` (one lexicon
  entry + comment)
- `apps/dashboard/test/composer-repair-kind-remap.test.ts` (NEW, 13 pins)
- `apps/dashboard/test/composer-bare-goal.test.ts` (one pin updated to
  the approved semantic)

## Validation

| Check | Result |
|---|---|
| New remap suite + updated bare-goal suite | **27/27 PASS** |
| Broader composer/orchestration/adapters/fast-track/routing (14 files) | **322 pass + 1 expected fail** |
| Control-surface + remaining orchestration suites (13 files) | **176 pass** |
| `eslint` / `tsc --noEmit` / `build:os-runtime` | PASS / PASS / PASS |
| FULL Vitest suite (127 files, full log captured) | **1,727 pass + 1 expected fail**; only failures = the two known environmental bash-scanner 120s timeouts in `worktree-prep.test.ts:268/:276` (Windows host; PowerShell scanner equivalents run at every commit) — cleaner than the pre-change baselines (no load flakes) |
| Pre-commit secret scan / RED-boundary scan | 0 / 0 |

## Setup/branch wording — inspected, deferred (owner condition)

Proven current behavior (pinned): "Set up the wizard branch." resolves to
NO kind → rejected fail-closed `task_kind_unresolved` at submission
(visible to ChatGPT; rephrasing with an edit verb composes fine —
"Implement the wizard setup branch." → `code`, pinned). Deferred because
bare `setup`/`configure`/`branch` have plausible non-repository readings;
mapping them converts a fail-closed rejection into composable work and
deserves its own reviewed unit.

## Separate follow-up defect (NOT changed here, per ruling)

Real-run timeout ceiling: `REAL_CLAUDE_DEFAULT_TIMEOUT_MS` 10 min /
`REAL_CLAUDE_MAX_TIMEOUT_MS` 15 min, hard-clamped, no production knob
(`timeoutMs` is a test seam). Long legitimate runs → `timeout`
(RETRYABLE) → retry budget exhausted → dead-letter. Owner decision
needed on an env-gated ceiling.

## Remaining local-vs-live discrepancy

Prod runs the sealed `6ea49a2`-lineage build: it still HAS this defect
until the branch is promoted and hosts repinned (owner gates). The live
dead-lettered wizard jobs stay dead-lettered (correct terminal record);
after promotion the goal needs owner resubmission. Historical prod
dead-letter cleanup remains owner-only.
