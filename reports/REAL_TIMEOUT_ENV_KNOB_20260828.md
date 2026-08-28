# Real Worker Timeout Env Knob — Owner-Approved — Gate Report

Date: 2026-08-28
Branch: `hardening/audit-repairs-clone-proof`
Production touched: **false**. Secrets exposed: **false**. Live messages/emails: **false**.
No env variable was set on staging or production (owner gate).

## Problem

Live `timeout` dead-letters: real runs were hard-clamped to a 10-minute
default / 15-minute maximum with NO production-tunable knob (`timeoutMs`
was a test seam only). Legitimate long jobs timed out (RETRYABLE), burned
the retry budget, and dead-lettered. A second latent hazard: the run lease
(`RUN_LEASE_MS`) was exactly 10 minutes — identical to the child timeout,
ZERO margin for worktree provisioning, post-run audit, and artifact
persistence, so a full-length run could outlive its own lease.

## Design (as ruled)

ONE shared knob — both providers run the same execution policy:

- **Env variable:** `ORCH_REAL_TIMEOUT_MS` (milliseconds, named in the var)
- **Default (env absent):** 600,000 ms = 10 min — prior behavior preserved
- **Configurable range:** 60,000 ms (1 min) … 3,600,000 ms (60 min)
- **Compiled absolute maximum:** `REAL_TIMEOUT_ABS_MAX_MS` = 3,600,000 ms;
  values above it CLAMP to it — no environment value can create an
  unbounded process
- **Fail-closed:** malformed / non-integer / negative / zero / NaN / float /
  exponent / below-minimum → the 10-min default (strict `/^\d{1,12}$/`
  integer-string parse; nothing else is accepted)
- **Test seam:** `i.timeoutMs` keeps precedence and still passes the
  compiled clamp — existing tests unaffected

## Lease interaction (proven, not assumed)

`resolveRunLeaseMs(env) = resolveRealTimeoutMs(env) + 5 min margin`.
The dispatcher passes it into `driveGoal`/`driverStep` ONLY when a real
executor is composed; the simulation path keeps the driver's fixed 10-min
default byte-identical. The stamped lease covers provisioning + child run
+ audit + persistence for EVERY configuration (property-pinned across the
whole input space, including the clamped worst case: 65-min lease for a
60-min run). Driver pins prove the parameter stamps BOTH the job row lease
and the executor lock expiry, that recovery leaves a live long lease alone
at minute 49, and that recovery past the horizon still requeues (existing
semantics). The 30-min per-job worktree-lock TTL is uncontested during a
long run because takeover requires the job to be reschedulable, which the
live lease prevents; it is deliberately unchanged.

NOTE (disclosed deviation): with a real executor composed and env ABSENT,
the run lease becomes 15 min (10-min timeout + margin) instead of the
prior 10 min. The child timeout default is unchanged; the margin closes
the proven zero-margin hazard above. Orphan-recovery latency for crashed
real runs grows accordingly (bounded by lease = timeout + 5 min).

## Not changed (per ruling)

Retry counts, dead-letter semantics (`timeout` still RETRYABLE — pinned),
risk classification, approvals, owner-stop, lease-recovery semantics,
production controls, worktree-lock TTL, and simulation-path behavior.

## Files changed

- `apps/dashboard/src/lib/ai-os/real-timeout.ts` (NEW — the shared bounds
  + resolvers; pure)
- `apps/dashboard/src/lib/ai-os/real-claude-adapter.ts` (constants now
  reference the shared bounds; spec resolves the env knob; seam precedence)
- `apps/dashboard/src/lib/ai-os/real-codex-adapter.ts` (same one-line spec
  change — shared policy)
- `apps/dashboard/src/lib/ai-os/orchestration/driver.ts` (`runLeaseMs`
  parameter on `driverStep`/`driveGoal`, default = prior constant)
- `apps/dashboard/src/os-runtime/dispatcher.ts` (passes
  `resolveRunLeaseMs(env)` when a real executor is composed)
- `env.template` (documents the knob; names only)
- Tests: `test/real-timeout.test.ts` (NEW, 14 tests),
  `test/orchestration-driver.test.ts` (+3 lease pins)

## Validation

| Check | Result |
|---|---|
| Focused (real-timeout, orchestration-driver, both adapters) | **150/150 PASS** |
| Broader runtime/orchestration (dispatcher, executor, durable, seam, e2e, drills, fast-track, artifacts, hardening, orchestrate-once, routing, remap) | **270 pass + 1 expected fail** |
| `tsc --noEmit` / `build:os-runtime` / repo-wide `eslint .` | PASS / PASS / PASS (0) |
| FULL Vitest suite (128 files, full log captured) | **1,747 pass + 1 expected fail**; only failures = the two known environmental bash-scanner 120s timeouts in `worktree-prep.test.ts:268/:276` (identical to the pre-change run; the +20 pass delta is exactly the 20 new pins) |
| Pre-commit secret scan / RED-boundary scan | 0 / 0 on the commits below |

## Recommended production configuration after promotion (owner action)

Set on the prod (and staging) host env — NOT done in this work unit:

    ORCH_REAL_TIMEOUT_MS=2700000

45 minutes: covers the observed long legitimate runs with headroom while
staying under the 60-min compiled ceiling; the derived lease becomes 50
minutes. If 45 min proves unnecessary, 1800000 (30 min) is the
conservative alternative. Unset keeps today's 10 minutes.

## Owner-gated next actions (NOT performed)

- Push/merge the branch; host repin; setting the env var on staging/prod.
