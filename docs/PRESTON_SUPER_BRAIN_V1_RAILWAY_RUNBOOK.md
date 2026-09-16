# Preston Super Brain v1 — Railway staging runbook

This runbook is staging-only. It does not authorize a merge to `master` or a production deployment.

## Service A — isolated Letta App Server

Use the current official Letta self-hosting guidance for Railway. The Letta service must:

- run as a separate Railway service/project boundary from Preston production;
- persist `/root/.letta` on a Railway volume;
- expose its generated HTTPS/WSS domain;
- start App Server with the OpenAI-compatible API enabled (`--openai-api`);
- use `/readyz` as its health check;
- configure non-loopback App Server authentication and keep its token only in the hosting secret store;
- have no Preston repository, Supabase service-role key, production DB credentials, approval credentials, deployment credentials, payment credentials, or customer-send credentials;
- receive only the model-provider/subscription authorization required for staging reasoning and the App Server authentication token.

Current Letta documentation supports ChatGPT Plus/Pro Codex subscriptions as a local model-provider connection, in addition to API-key providers. Provider authorization is an account-level action and must not be committed to GitHub.

Create the staging agent headlessly with no tools attached, using a custom system prompt that limits it to advisory reasoning/memory. Record the resulting `agent_id` only; do not record model-provider credentials.

## Service B — Preston Brain Bridge

Source: `Zebone420/preston-os`
Branch: `feature/preston-super-brain-v1-staging`
Root directory: `packages/brain-bridge`

The package includes a Dockerfile and `railway.json`. Railway injects `PORT`; the bridge honors it and binds to `0.0.0.0` inside the container.

Required variables:

- `PRESTON_BRAIN_ENABLED=true`
- `PRESTON_BRAIN_LETTA_BACKEND=remote`
- `PRESTON_BRAIN_LETTA_URL=<Letta staging App Server HTTPS base URL>`
- `PRESTON_BRAIN_LETTA_AGENT_ID=<staging-only Letta agent id>`
- `PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED=true`
- `SUPABASE_RUNTIME_ENV=staging`
- `PRESTON_BRAIN_BRIDGE_TOKEN=<dedicated strong staging token>`
- `LETTA_APP_SERVER_TOKEN=<Letta App Server bearer token>`

The bridge has no external runtime npm dependency; it uses Node 24 native `fetch` against Letta App Server's `/v1/responses` endpoint.

Health check: `/healthz`

## Preston/dashboard staging variables

Only after both services are healthy:

- `PRESTON_BRAIN_ENABLED=true`
- `PRESTON_BRAIN_LETTA_BACKEND=remote`
- `PRESTON_BRAIN_BRIDGE_URL=<Brain Bridge staging URL>`
- `PRESTON_BRAIN_LETTA_AGENT_ID=<same staging agent id>`
- `PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED=true`
- `SUPABASE_RUNTIME_ENV=staging`
- `PRESTON_BRAIN_BRIDGE_TOKEN=<same dedicated bridge token>`

The dashboard must never receive the direct Letta URL or Letta App Server token.

## Live acceptance drill

1. Verify Letta `/readyz` returns 2xx.
2. Verify Brain Bridge `/healthz` returns 2xx.
3. Verify the Letta App Server exposes the staging agent through `GET /v1/models`.
4. Send one synthetic authenticated Brain request through Preston/Bridge and record only non-secret evidence.
5. Start a second synthetic conversation and verify the expected agent-memory/retrieval/reasoning behavior.
6. Run negative probes: no bridge token, wrong bridge token, wrong agent id, production runtime, missing isolation attestation, unavailable Letta provider, malformed response, oversized request.
7. Confirm every negative probe fails closed and no secret value appears in logs/evidence.
8. Re-run exact-head GitHub CI.
9. Only then mark `STAGING_OPERATIONAL`.
