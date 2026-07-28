# PHASE 7 - COMPOSER DIVERGENCE RECONCILIATION (canonical disposition)

Date: 2026-07-28. Author: Claude (reconciliation gate, read-only against
both lines; no deployment, no activation, no push).

Two independent Composer implementations existed:

- CANONICAL (retained): origin/master `466e5f9` - commits
  `347d65c..466e5f9`, files
  `apps/dashboard/src/lib/ai-os/orchestration/composer.ts` (391 lines),
  `composer-persist.ts` (341), route `/os/composer` (4 files, 489 lines),
  6 composer test files + `orchestration-approval-decide.test.ts`.
- DIVERGENT (retired): local branch `phase7/reconcile-approval-enforcement`
  @ `a141055` - `src/lib/ai-os/composer/{engine,interpreter,policy,
  proposal-schema}.ts` (2,388 lines), form on `/os/orchestration`,
  6 test files (80 tests). NOT pushed; parallel reimplementation of the
  same objective on the same base (`0c287b0`).

The owner ruling for this gate: the remote implementation is canonical.
This document records what each line uniquely had, what was ported, and
what was rejected and why. Per the remote composer packet's own warning,
the two lines were never merged blindly - they modify overlapping
surfaces (`/os/orchestration` page, env.template, test tree).

## 1. Feature comparison

| Area | Canonical 466e5f9 | Divergent a141055 | Disposition |
|---|---|---|---|
| NL interpretation | Pure deterministic parser (no I/O, no clock, no randomness); sentence/enumeration grammar | LLM provider call (OpenAI Responses API) behind a disabled-by-default fail-closed gate (`COMPOSER_INTERPRET_ENABLED`, `OPENAI_API_KEY/MODEL`), strict JSON-schema output, one bounded retry | RETAIN canonical. Deterministic-only is strictly safer (no network path at all, no provider dependency, reproducible interpretation). Provider path REJECTED - would add a gated outbound-network surface the canonical architecture deliberately lacks |
| Proposal schema | Typed in-engine structures + engine-level caps (3 goals, 10 tasks/goal, 4000 chars) | Versioned `composer-v1` 32KB strict validator, 6-task cap, contradiction checks | RETAIN canonical. The versioned validator exists to check LLM output; with no LLM there is nothing untyped to validate. REJECTED as architecture-specific |
| Policy classification | Per-task `classifyJob` (the SAME deterministic policy engine the decomposer persists); injection/prohibited scans REJECT hostile text outright | Same `classifyJob` per task PLUS package-level stricter-wins overlay (`classifyRisk`, `evaluatePolicy`, protected-marker OR-merge, downgrade rejection) | RETAIN canonical. Both lines get gating from the same policy engine; the overlay exists because an LLM could under-claim risk - the deterministic engine cannot. REJECTED as redundant in canonical architecture |
| Owner confirmation | Two-step separate-form confirm; server recomputes the interpretation from the raw request and refuses on `proposal_hash_mismatch`; owner re-checked per action | Ack checkbox + confirmation sentence + Enter-key-safe button order + revise/edit loop | RETAIN canonical (tamper-proof server recompute is the stronger property). Ack checkbox noted as OPTIONAL future hardening, not ported: canonical confirm is already a deliberate separate-form act and porting would rewrite canonical UI + tests for no missing safety property |
| Idempotency | Deterministic sha256-derived uuids from a per-proposal request key; payload digest bound into `correlation_id`; RPC advisory-lock replay => `{created:false}`; key reuse with different payload => `idempotency_conflict` | Goal id minted at interpret time and round-tripped; same RPC lock; `{created:false}` treated as idempotent match | RETAIN canonical (derivation from the request key is replay-safe across sessions, not just within one review) |
| Approval creation | Born pending, owner-bound, hash-bound (sha256 envelope in store), 24h TTL, CAS-linked to the job, compensating cancellation on failure | Same store surface, same TTL, same CAS link, compensation + `compensation_incomplete` audit | EQUIVALENT - both use the canonical store/crypto-binding layer unchanged |
| Owner decision path | Dashboard Approve/Reject buttons on `/os/orchestration` calling `decide_orchestration_approval` RPC (`orchestration/actions.ts`) | None (SQL/RPC only) | RETAIN canonical (net-new owner surface, already tested) |
| Failure compensation | Compensating cancellation of every goal created by the confirmation; nothing deleted | Compensation + honest `compensation_incomplete` reporting | EQUIVALENT in effect |
| Audit | `composer_confirm` audit row on every confirm (ok or not) | Three audit actions + memory snapshot records (`composer:request/proposal/package`) preserving the original model proposal | RETAIN canonical. Snapshot records existed to preserve LLM output vs owner edits; canonical has no model output and no owner edits (raw text is re-interpreted). REJECTED as architecture-specific |
| Drafts | None | `Save as Draft` memory rows | REJECTED - feature addition outside this gate's scope; record as future work if wanted |
| Dashboard navigation | None (per-page ad-hoc links) | Central nav-config + desktop/mobile menu + auth-gated layout mount (8acb70d) | PORTED (adapted): see section 2 |
| Structural no-execution pin | Fixed-list pin did NOT cover the new composer modules | Structural suite pinned no spawn/network/send surface per composer module | PORTED (adapted): composer modules added to `non-execution-pin.test.ts` |
| Untrusted-text defense shape | REJECT-on-detection (injection, spoof, prohibited capability, secret, control chars, execution-mode) | Neutralize + classify + escalate (gate rather than reject) | RETAIN canonical. Reject-outright is the stricter posture for a request channel; the policy engine still gates anything that slips past wording |

## 2. What was ported

1. `feat(dashboard)` - navigation consolidation (intent of local `8acb70d`,
   adapted): central `src/components/nav/nav-config.ts` (single source of
   truth; `/os/composer` added to the Work group), `nav-menu.tsx`
   (desktop panel + mobile collapsible, active-route + aria contracts),
   auth-gated `main-nav.tsx` mounted from the root layout; per-page
   `<nav>` blocks removed from home, approvals, audit, brief, remote,
   `/os`, `/os/orchestration`, and `/os/composer`; business shell nav +
   sign-out removed (single sign-out control in the shared menu);
   `test/main-nav.test.ts` (route visibility incl. the composer route,
   active-state, duplicate prevention, single-sign-out, auth hiding) and
   `test/business-signout.test.ts` updated.
2. `test(7)` - non-execution structural pin extended to
   `orchestration/composer.ts`, `orchestration/composer-persist.ts`, and
   `os/composer/actions.ts` (ported intent of the a141055
   composer-structural "no execution surface" suite).

## 3. What was rejected (and why)

- The entire a141055 composer engine/interpreter/schema/policy-overlay
  and its form: parallel architecture, not an improvement to the
  canonical one; porting would duplicate or replace canonical modules
  (explicitly out of scope for this gate).
- The OpenAI provider path and its env names: adds a (gated) outbound
  network surface absent from canonical; canonical needs no provider.
- Ack-checkbox confirmation UX: optional hardening, no missing safety
  property; would rewrite canonical UI tests.
- Draft persistence, memory snapshot records, evidence_refs pre-pinning:
  feature additions tied to the retired architecture.
- a141055 test suites: they test retired modules. Their transferable
  intents (structural no-execution pin; secret/type-confusion/injection
  rejection) are already covered by canonical suites or ported above.

## 4. Data-loss check

Nothing unique to a141055 is lost that this gate was chartered to keep:
navigation consolidation is ported; the G-D3 real-Claude adapter
(uncommitted in the local worktree, deliberately NOT part of this
branch) is preserved verbatim as a patch
(`gd3-real-claude-adapter-uncommitted.patch`, session scratchpad) and
remains untouched on disk in the worktree; the retired composer line
remains intact on local branch `phase7/reconcile-approval-enforcement`
@ `a141055` for reference until the owner retires it.
