# Preston Internal Capability Contract v1

Status: FOUNDATION SHIPPED (code + tests), ALL DORMANT. No external
provider is registered, connected, or credentialed. This is NOT a public
Plugin SDK and never becomes a marketplace: every capability is code in
this repo, reviewed and shipped like any other change.

Master goal reference: power-station foundation sections 8-15.

## 1. Concept map

```text
CLAUDE / CODEX worker (bounded, credential-free)
      |
      |  CapabilityRequest (typed proposal; never an action)
      v
TRUSTED PRESTON EXECUTOR        lib/ai-os/capabilities/executor.ts
      |- validate contract      (invalid -> terminal)
      |- registry lookup        (unknown -> terminal, fail closed)
      |- side-effect ledger     (idempotent propose; replay stored outcome)
      |- policy classification  (existing GREEN/YELLOW/RED/BLACK; BLACK never)
      |- approval verification  (owner-decided, SHA-256 hash-bound)
      |- CAS claim              (exactly one executing claimant, ever)
      |- provider adapter       (bounded by the definition timeout)
      `- settle + os_events     (SideEffectRecorded history)
              |
              v
          PROVIDER (v1: preston.dryrun only - in-process, no external I/O)
```

## 2. Registry (`capabilities/registry.ts`)

In-code, frozen, versioned. Zero SSOT reads ever - the registry is a
constant map consulted only when a capability request exists. Names are
`provider.resource.action`. v1 registers exactly:

| capability | risk | approval | kind |
|---|---|---|---|
| preston.echo.read_test | GREEN | no | read |
| preston.echo.write_test | YELLOW | yes | write |

Risk classes are Preston's existing taxonomy - no parallel security
authority. If R0-R4 wording is ever useful in docs, map it as R0=GREEN,
R1=YELLOW-ungated, R2=YELLOW-gated, R3=RED, R4=BLACK; the enforced values
remain GREEN/YELLOW/RED/BLACK.

Adding a future capability = adding a definition here + an adapter +
tests + an owner activation gate. Unknown names fail closed always.

## 3. Request/result contract (`capabilities/contract.ts`)

CapabilityRequest: capability, version, target, params, goal/job/run ids,
request_id, idempotency_key, optional approval_id. CapabilityResult: ok,
side_effect_id, provider_result_id, summary, artifact_refs, error.

Errors carry exactly one class and map into the CENTRAL outcome authority
(orchestration/outcomes.ts) via `toJobFailureReason`:

```text
terminal  -> prohibited_action:<reason>       -> TERMINAL (dead-letter, no retry)
retryable -> capability_retryable:<reason>    -> RETRYABLE (existing bounded retry)
uncertain -> side_effect_uncertain:<reason>   -> UNCERTAIN (parks; reconcile only)
```

There is no second retry engine: the parent job's completion engine remains
the only scheduler, consuming the same classifyFailure it always has.

## 4. Side-effect ledger (`capabilities/ledger-store.ts`, migration 0026)

One universal table, CAS lifecycle, history in os_events. side_effect_id is
sha256-derived from idempotency_key, and unique(idempotency_key) makes any
duplicate/retry/restart converge on one row. The executing claim is fenced
on attempt_count; the durable cap is 3 attempts. Uncertain rows leave only
through `reconcileSideEffect` with provider evidence - never a blind retry,
and a parent-job retry replays the stored outcome without a second external
action.

## 5. Worker authority boundary

Workers never receive: provider credentials, provider network access, or
ledger write authority outside the executor. Structural guarantees:

- the child env allowlist (real-claude-adapter.CHILD_ENV_ALLOWLIST) is
  POSITIVE and contains no SUPABASE_/TELEGRAM_/PRESTON_PROVIDER_/token/
  secret/key names (pinned by test);
- the executor is imported by NOTHING on the orchestrator tick path; the
  only host entry point is the explicit `capability-dryrun` dispatcher
  command, itself env-gated (ORCH_CAPABILITY_DRYRUN_ENABLED);
- worker -> provider API paths (gmail/calendar/airtable) do not exist.

## 6. Credential boundary (section 14 - FOUNDATION ONLY)

`capabilities/credentials.ts` ships the broker interface: per-provider
root-owned token FILES named by env vars
(`PRESTON_PROVIDER_<PROVIDER>_TOKEN_FILE`), read on demand, cached
in-process, values never logged/serialized. No provider credential exists
in this goal. Migration trigger to Supabase Vault (or equivalent): when a
second token-minting host appears, or per-capability scoping of one
provider account is needed - the broker interface is the seam; executor
and adapters do not change.

## 7. Dry-run provider (section 15)

`capabilities/dryrun-adapter.ts` - in-process echo provider driven by
params.outcome (success/terminal/retryable/uncertain/hang) proving the
whole spine with zero external effect. Host drill:

```text
node dist/os-runtime/bin.js capability-dryrun --scenario success --key k1
  scenarios: success | terminal | retryable | uncertain | duplicate |
             gated | reconcile
```

Requires ORCH_CAPABILITY_DRYRUN_ENABLED=true + migration 0026 applied.

## 8. Test evidence

test/capability-spine.test.ts (37 tests: registry contract, fail-closed
lookup, executor lifecycle, idempotency acceptance A-F, approval binding +
tamper refusal, timeout->uncertain, credential broker, isolation),
test/capability-isolation.test.ts (idle-tick dormancy pins),
test/migration-0026-0027.test.ts (SQL pins).

## 9. What is deliberately NOT built (section 20)

Live providers, external webhooks, public SDK, marketplace, dynamic
provider installation, arbitrary MCP servers, generic HTTP capability,
worker provider credentials, broad OAuth broker, secrets service,
separate retry engine.
