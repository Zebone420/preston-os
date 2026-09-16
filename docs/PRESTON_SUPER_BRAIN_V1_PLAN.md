# Preston Super Brain v1

## Objective

Add persistent, provider-neutral cognition to Preston Control without moving any authority out of Preston Control.

The Brain may recall bounded context, reason over that context, propose memory, summarize lessons, and serve context to approved workers.

The Brain may not approve actions, deploy, execute shell/SQL, change RLS/security policy, read or store credentials, send customer communications, make payments, create standing authorization, or bypass Preston Control.

## Existing Preston substrate reused

Preston already has an append-only `agent_memory` table plus provenance validation and secret redaction. Super Brain v1 reuses that substrate instead of creating a competing SSOT.

Preston `agent_memory` remains the authoritative institutional-memory store. Letta is a stateful reasoning/working-memory engine behind a narrow adapter. Any Letta-proposed durable memory must pass Preston's memory policy before persistence.

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
      +--> reason
      +--> propose_memory
      |
      +--> PRESTON MEMORY ADAPTER --> agent_memory SSOT
      |
      +--> LETTA REASONER PORT --> Letta local/self-hosted runtime
                                   (no Preston authority clients)

All durable memory proposals
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
Preston agent_memory
```

## Phase 1 - Core scaffold

Branch: `feature/preston-super-brain-v1-staging`

Acceptance:
1. Brain capabilities are limited to `recall`, `reason`, and `propose_memory`.
2. Secret-shaped nested keys are rejected.
3. Secret-shaped values are rejected.
4. Memory that claims blanket/standing authority is rejected.
5. Approval-bypass instructions are rejected.
6. Poisoned candidates never reach the memory sink.
7. Recall and reasoning context are bounded.
8. Provider-proposed memory is filtered before becoming eligible for persistence.
9. No DB migration, production write, runtime authority change, or external service is required for the core scaffold.

## Phase 2 - Preston memory adapter

Use a narrow adapter from `BrainMemorySink`/`BrainProvider` to the existing append-only Preston memory API. Keep owner/RLS boundaries unchanged. Retrieval is bounded and stored memory is re-evaluated by the Brain policy on read, so legacy or poisoned rows are not automatically trusted. No external provider receives a Supabase client.

## Phase 3 - Letta staging adapter

Use Letta self-hosted/local in staging only. The Preston-side adapter exposes a narrow `runTurn` port: bounded context in; reasoning text and proposed memories out. No owner token, service-role key, approval client, shell, deployment client, or database client enters Letta context. Provider removal must not break Preston Control or the authoritative memory store.

The current Letta Agent SDK supports local and remote/self-hosted App Server backends. Actual SDK installation is a separate dependency change and remains staging-only until acceptance.

## Phase 4 - Worker context integration

Expose bounded, read-only Brain context to Claude, Codex, Mini-SWE, and Hermes through Preston-controlled adapters. Workers cannot write authoritative memory directly; they submit candidates through the memory policy gate.

## Phase 5 - Acceptance / red team

Before real business ingestion: unit tests, typecheck/lint, security cleanup, memory-poisoning tests, fake-approval tests, secret-exfiltration tests, Letta-adapter isolation tests, and full Preston regression must pass.

After Brain v1 is connected and green, the locked foundation roadmap is:
1. OpenTelemetry + Langfuse
2. Promptfoo
3. dependency-cruiser
4. Agentgateway
