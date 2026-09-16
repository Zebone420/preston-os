# Preston Super Brain v1 — Staging Acceptance Evidence

Date: 2026-09-16
Branch: `feature/preston-super-brain-v1-staging`
PR: #9
Production merge/deploy: NOT AUTHORIZED / NOT PERFORMED

## Repository acceptance status

Repository controls are implemented and must remain green on the exact deployment head.

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
- Brain Bridge now has zero runtime npm dependencies and uses Node 24 native `fetch` against Letta App Server's official OpenAI-compatible `/v1/responses` interface;
- bridge install uses `--ignore-scripts` in CI;
- the bridge container build is a CI acceptance gate;
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

**BLOCKED BY EXTERNAL STAGING RUNTIME CONNECTION / ACCOUNT AUTHORIZATION — not repository code.**

A true `STAGING_OPERATIONAL` verdict requires evidence from an isolated reachable Letta staging server and staging Brain Bridge. The repository deliberately does not contain the required hosting account connection, provider/subscription authorization, URL values, agent id, or bearer tokens.

Required live proof after staging infrastructure is connected:

1. isolation attestation for the Letta host/agent;
2. Letta `/readyz` and Brain Bridge `/healthz` success;
3. Letta staging agent visible through `/v1/models`;
4. successful synthetic authenticated Preston -> Bridge -> Letta -> Preston round trip;
5. synthetic cross-session memory -> retrieval -> reasoning drill;
6. negative auth/wrong-agent/production/provider-failure probes;
7. evidence that Letta/Bridge have no Preston execution/control credentials or clients;
8. final exact-head CI remains green.

Until those observations exist, the correct overall verdict is:

**REPOSITORY_READY / RUNTIME_CONNECTION_REQUIRED**

This report grants no merge, production deployment, DB write, or production activation.
