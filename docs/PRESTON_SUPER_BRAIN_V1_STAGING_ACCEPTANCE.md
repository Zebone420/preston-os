# Preston Super Brain v1 — Staging Acceptance Evidence

Date: 2026-09-16
Branch: `feature/preston-super-brain-v1-staging`
PR: #9
Production merge/deploy: NOT AUTHORIZED / NOT PERFORMED

## Repository acceptance status

**PASS, subject to the exact-head GitHub CI check remaining green.**

Implemented repository controls:

- provider-neutral `PrestonBrain` service with bounded `recall`, `reason`, and `propose_memory` capabilities;
- Preston `agent_memory` remains the authoritative institutional-memory store;
- memory candidates pass secret, provenance, and authority policy before persistence eligibility;
- dashboard contains no Letta runtime dependency;
- dashboard talks only to a separate Brain Bridge HTTP(S) protocol endpoint;
- direct dashboard-to-Letta endpoint configuration is structurally separated (`PRESTON_BRAIN_BRIDGE_URL` versus bridge-only `PRESTON_BRAIN_LETTA_URL`);
- Brain Bridge requires staging, remote backend, agent id, and isolation attestation;
- Brain Bridge protocol requires a strong bearer token, enforces the configured agent id, bounds request/response size and context, and redacts provider failures;
- Brain Bridge has no Preston authority clients;
- the prior `@letta-ai/letta-agent-sdk -> letta-code -> sharp` high-severity dependency chain was removed rather than waived;
- Brain Bridge runtime dependency surface is reduced to pinned `@letta-ai/letta-client@1.12.1`, with Node 24 native TypeScript execution and built-in `node:test`;
- bridge install uses `--ignore-scripts` in CI;
- production runtime remains refused by configuration validation;
- no database migration or production state change is required by this branch.

## Security posture

Preston Control remains the sole authority. Super Brain and Letta are advisory cognition only.

The following capabilities are intentionally absent from the Brain boundary:

- approvals or owner authorization;
- shell/command execution;
- SQL or Supabase service-role access;
- Preston repository/filesystem authority;
- deployment or production-control clients;
- credential management;
- payments;
- customer sends;
- safeguard/RLS weakening.

Provider output is untrusted. Provider-proposed durable memory is re-evaluated by Preston policy before it can reach the authoritative memory sink.

## Runtime acceptance status

**BLOCKED BY OWNER-GATED EXTERNAL RUNTIME PROVISIONING — not by repository code.**

A true `STAGING_OPERATIONAL` verdict requires evidence from an isolated reachable Letta staging server and staging Brain Bridge. The repository deliberately does not contain or manufacture the required URL, agent id, bridge token, or optional Letta API key.

Required live proof after the owner provisions/authorizes the staging runtime:

1. isolation attestation for the Letta host/agent;
2. Brain Bridge health response;
3. successful synthetic authenticated round trip;
4. synthetic cross-session memory -> retrieval -> reasoning drill;
5. negative auth/wrong-agent/production/provider-failure probes;
6. evidence that Letta/Bridge have no Preston execution/control credentials or clients;
7. final exact-head CI remains green.

Until those observations exist, the correct overall verdict is:

**REPOSITORY_READY / RUNTIME_BLOCKED**

This report grants no merge, deployment, production activation, secret write, or owner approval.
