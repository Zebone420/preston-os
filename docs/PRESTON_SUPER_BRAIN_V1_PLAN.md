# Preston Super Brain v1

## Objective

Add persistent, provider-neutral cognition to Preston Control without moving any authority out of Preston Control.

The Brain may:
- recall bounded context;
- propose new memory;
- summarize lessons and institutional knowledge;
- serve context to approved workers.

The Brain may **not**:
- approve actions;
- deploy;
- execute shell/SQL;
- change RLS or security policy;
- read or store credentials/secrets;
- send customer communications;
- make payments;
- create standing or remembered authorization;
- bypass Preston Control.

## Existing Preston substrate reused

Preston already has an append-only `agent_memory` table plus provenance validation and secret redaction. Super Brain v1 must reuse this substrate instead of creating a competing SSOT.

The provider layer is intentionally abstract. Letta can be attached later as a provider/long-term-memory engine without becoming Preston's authority or system of record.

## Architecture

```text
Owner / ChatGPT
      |
      v
PRESTON CONTROL
Authority / approvals / policy / execution gates
      |
      v
PRESTON SUPER BRAIN
Provider-neutral cognition
      |
      +--> recall
      +--> propose_memory
      |
      v
MEMORY POLICY GATE
- provenance required
- secret-key detection
- secret-value detection
- authority-claim rejection
- bounded capabilities
      |
      v
Preston agent_memory / approved memory adapter
```

## Phase 1 - Core scaffold

Branch: `feature/preston-super-brain-v1`

Files:
- `apps/dashboard/src/lib/brain/types.ts`
- `apps/dashboard/src/lib/brain/policy.ts`
- `apps/dashboard/src/lib/brain/service.ts`
- `apps/dashboard/src/lib/brain/index.ts`
- `apps/dashboard/test/brain-policy.test.ts`

Acceptance:
1. Brain capabilities are limited to `recall` and `propose_memory`.
2. Secret-shaped nested keys are rejected.
3. Secret-shaped values are rejected.
4. Memory that claims blanket/standing authority is rejected.
5. Approval-bypass instructions are rejected.
6. Poisoned candidates never reach the memory sink.
7. Recall requests are bounded.
8. No DB migration, production write, runtime authority change, or new external service is required for the scaffold.

## Phase 2 - Preston memory adapter

Create a narrow adapter from `BrainMemorySink` to the existing append-only Preston memory API. Keep owner/RLS boundaries unchanged. Add bounded retrieval from existing memory with provenance preserved.

No direct provider access to Supabase is allowed.

## Phase 3 - Letta staging adapter

Evaluate/install Letta self-hosted in staging only. The Letta adapter must implement the provider-neutral Brain contract. Requirements:
- Preston Control remains sole authority;
- no service-role key or owner token enters Letta context;
- no credentials stored as memory;
- provider removal does not break Preston Control;
- all persisted institutional memory is policy-gated;
- all provider output is treated as untrusted input.

## Phase 4 - Worker context integration

Expose bounded, read-only Brain context to Claude, Codex, Mini-SWE, and Hermes through Preston-controlled adapters. Workers cannot write memory directly; they submit memory candidates through the policy gate.

## Phase 5 - Acceptance / red team

Before real business ingestion:
- unit tests green;
- typecheck/lint green;
- OSV/Gitleaks findings addressed;
- memory-poisoning cases pass;
- fake owner-approval/standing-authority cases pass;
- secret exfiltration cases pass;
- no regression in existing Preston approval/runtime tests.

After Brain v1 is connected and green, the locked foundation roadmap is:
1. OpenTelemetry + Langfuse
2. Promptfoo
3. dependency-cruiser
4. Agentgateway
