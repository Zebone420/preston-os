# Preston Super Brain v1

## Objective

Add persistent, provider-neutral cognition to Preston Control without moving any authority out of Preston Control.

The Brain may recall bounded context, propose memory, summarize lessons, and serve context to approved workers.

The Brain may not approve actions, deploy, execute shell/SQL, change RLS/security policy, read or store credentials, send customer communications, make payments, create standing authorization, or bypass Preston Control.

## Existing Preston substrate reused

Preston already has an append-only `agent_memory` table plus provenance validation and secret redaction. Super Brain v1 reuses that substrate instead of creating a competing SSOT.

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

Branch: `feature/preston-super-brain-v1-staging`

Acceptance:
1. Brain capabilities are limited to `recall` and `propose_memory`.
2. Secret-shaped nested keys are rejected.
3. Secret-shaped values are rejected.
4. Memory that claims blanket/standing authority is rejected.
5. Approval-bypass instructions are rejected.
6. Poisoned candidates never reach the memory sink.
7. Recall requests are bounded.
8. No DB migration, production write, runtime authority change, or external service is required.

## Phase 2 - Preston memory adapter

Create a narrow adapter from `BrainMemorySink` to the existing append-only Preston memory API. Keep owner/RLS boundaries unchanged. Add bounded retrieval from existing memory with provenance preserved. No direct provider access to Supabase.

## Phase 3 - Letta staging adapter

Evaluate/install Letta self-hosted in staging only. The adapter must implement the provider-neutral Brain contract. No owner token, service-role key, or credentials enter provider context. Provider removal must not break Preston Control.

## Phase 4 - Worker context integration

Expose bounded, read-only Brain context to Claude, Codex, Mini-SWE, and Hermes through Preston-controlled adapters. Workers cannot write memory directly; they submit candidates through the memory policy gate.

## Phase 5 - Acceptance / red team

Before real business ingestion: unit tests, typecheck/lint, security cleanup, memory-poisoning tests, fake-approval tests, secret-exfiltration tests, and full Preston regression must pass.

After Brain v1 is connected and green, the locked foundation roadmap is:
1. OpenTelemetry + Langfuse
2. Promptfoo
3. dependency-cruiser
4. Agentgateway
