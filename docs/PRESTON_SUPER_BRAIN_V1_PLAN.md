# Preston Super Brain v1

## Objective

Add persistent, provider-neutral cognition to Preston Control without moving any authority out of Preston Control.

The Brain may recall bounded context, reason over that context, propose memory, summarize lessons, and serve bounded context to Preston-controlled consumers.

The Brain may not approve actions, deploy, execute shell/SQL, change RLS/security policy, read or store credentials, send customer communications, make payments, create standing authorization, or bypass Preston Control.

## Authority and memory model

Preston `agent_memory` remains the authoritative institutional-memory store. Letta is a replaceable reasoning/working-memory provider behind an isolated Brain Bridge. Any provider-proposed durable memory must pass Preston memory policy before persistence.

No Supabase client, approval client, shell, deployment client, payment client, customer-send client, Preston repository access, or production-control capability is passed to the Brain Bridge or Letta.

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
      +--> HTTPS BOUNDED PROTOCOL
               |
               v
          BRAIN BRIDGE
          - staging only
          - bearer-authenticated
          - agent-bound
          - payload bounded
          - no Preston authority clients
          - zero runtime npm dependencies
          - Node native fetch -> Letta /v1/responses
               |
               v
          ISOLATED REMOTE LETTA APP SERVER
          - OpenAI-compatible API enabled
          - no Preston filesystem
          - no Preston DB
          - no Preston credentials
          - no Preston approval/control plane
```

The dashboard never imports Letta SDK/client packages. It can reach only the Brain Bridge. The Brain Bridge is the only Preston component that can reach the isolated Letta App Server.

## Configuration boundary

Dashboard-side configuration:

- `PRESTON_BRAIN_ENABLED=true`
- `PRESTON_BRAIN_LETTA_BACKEND=remote`
- `PRESTON_BRAIN_BRIDGE_URL=<isolated Brain Bridge HTTPS base URL>`
- `PRESTON_BRAIN_LETTA_AGENT_ID=<staging agent id>`
- `PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED=true`
- `SUPABASE_RUNTIME_ENV=staging`
- `PRESTON_BRAIN_BRIDGE_TOKEN=<shared bridge token; secret store only>`

Brain Bridge configuration:

- `PRESTON_BRAIN_ENABLED=true`
- `PRESTON_BRAIN_LETTA_BACKEND=remote`
- `PRESTON_BRAIN_LETTA_URL=<isolated Letta App Server HTTPS base URL>`
- `PRESTON_BRAIN_LETTA_AGENT_ID=<same staging agent id>`
- `PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED=true`
- `SUPABASE_RUNTIME_ENV=staging`
- `PRESTON_BRAIN_BRIDGE_TOKEN=<same bridge token; secret store only>`
- `LETTA_APP_SERVER_TOKEN=<App Server bearer token; secret store only>`
- optional `PRESTON_BRAIN_BRIDGE_HOST` and `PRESTON_BRAIN_BRIDGE_PORT`

Secrets are never committed and are never written into memory.

## Core acceptance

1. Brain capabilities are limited to `recall`, `reason`, and `propose_memory`.
2. Secret-shaped nested keys and values are rejected.
3. Memory claiming blanket/standing authority is rejected.
4. Approval-bypass instructions are rejected.
5. Poisoned candidates never reach the memory sink.
6. Recall and reasoning context are bounded.
7. Provider-proposed memory is filtered before persistence eligibility.
8. Dashboard has no Letta package dependency and cannot contact Letta directly.
9. Brain Bridge is remote-only and staging-only, with explicit isolation attestation.
10. Protocol requests are authenticated, bound to one agent, bounded, and fail closed.
11. Brain Bridge uses the current Letta App Server OpenAI-compatible Responses API, not legacy Letta REST paths.
12. Provider errors do not leak across the protocol boundary.
13. Production runtime is refused by configuration validation.
14. Dependency audit, security guards, lint/typecheck/runtime build, dashboard tests, bridge checks, bridge tests, and bridge container build must be green on the exact head commit.
15. No merge to `master`, production deployment, DB modification, production write, or authority change occurs as part of staging acceptance.

## Runtime acceptance — owner-gated

Repository acceptance is not sufficient to claim a live staging Brain. Before `STAGING_OPERATIONAL` may be recorded, all of the following must be observed against an isolated reachable runtime:

1. An isolated Letta App Server exists with no Preston filesystem, database, secrets, approval system, deployment system, payment system, customer-send system, or production-control access.
2. A staging-only Letta agent exists with no tools attached and advisory-only system instructions.
3. Brain Bridge is provisioned separately and can reach Letta; Preston can reach only Brain Bridge.
4. One synthetic Preston -> Brain Bridge -> Letta -> bounded response -> Preston round trip succeeds.
5. A cross-session synthetic memory/retrieval/reasoning drill proves durable Preston memory remains authoritative.
6. Negative runtime probes prove missing/invalid auth, wrong agent, provider failure, production environment, missing isolation attestation, and direct-dashboard-to-Letta configuration fail closed.
7. No secret is logged, committed, or returned in evidence.

Provisioning/deployment and secret/provider authorization remain explicit account-level actions and are not stored in the repository.

## Post-v1 integration

After runtime acceptance, bounded read-only Brain context can be exposed through Preston-controlled adapters to approved workers. Workers never write authoritative memory directly; memory candidates always pass the Preston policy gate.

The next locked foundation items remain separate from Super Brain v1 acceptance:

1. OpenTelemetry + Langfuse
2. Promptfoo
3. dependency-cruiser
4. Agentgateway
