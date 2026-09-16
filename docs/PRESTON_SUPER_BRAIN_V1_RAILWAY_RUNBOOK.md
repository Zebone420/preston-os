# Preston Super Brain v1 — Railway staging runbook

This runbook is staging-only. It does not authorize a merge to `master` or a production deployment.

## Service A — isolated Letta App Server

Use the current official Letta self-hosting deployment guidance for Railway. The Letta service must:

- run as a separate Railway service/project boundary from Preston production;
- persist `/root/.letta` on a Railway volume;
- expose its generated HTTPS/WSS domain;
- use `/readyz` as its health check;
- have no Preston repository, Supabase service-role key, production DB credentials, approval credentials, deployment credentials, payment credentials, or customer-send credentials;
- receive only the model-provider credential required for staging reasoning and an App Server authentication token.

Required Letta-side secrets/configuration are created in Railway's secret store, never in GitHub.

## Service B — Preston Brain Bridge

Source: `Zebone420/preston-os`
Branch: `feature/preston-super-brain-v1-staging`
Root directory: `packages/brain-bridge`

The package includes a Dockerfile and `railway.json`. Railway injects `PORT`; the bridge honors it and binds to `0.0.0.0` inside the container.

Required variables:

- `PRESTON_BRAIN_ENABLED=true`
- `PRESTON_BRAIN_LETTA_BACKEND=remote`
- `PRESTON_BRAIN_LETTA_URL=<Letta staging App Server URL>`
- `PRESTON_BRAIN_LETTA_AGENT_ID=<staging-only Letta agent id>`
- `PRESTON_BRAIN_LETTA_ISOLATION_ATTESTED=true`
- `SUPABASE_RUNTIME_ENV=staging`
- `PRESTON_BRAIN_BRIDGE_TOKEN=<dedicated strong staging token>`
- `LETTA_API_KEY=<Letta/App Server auth token if required by the REST client>`

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

The dashboard must never receive the direct Letta URL.

## Live acceptance drill

1. Verify Letta `/readyz` returns 2xx.
2. Verify Brain Bridge `/healthz` returns 2xx.
3. Send one synthetic authenticated Brain request through Preston/Bridge and record only non-secret evidence.
4. Start a second synthetic session and verify the expected memory/retrieval/reasoning behavior.
5. Run negative probes: no bridge token, wrong bridge token, wrong agent id, production runtime, missing isolation attestation, unavailable Letta provider, malformed response, oversized request.
6. Confirm every negative probe fails closed and no secret value appears in logs/evidence.
7. Re-run exact-head GitHub CI.
8. Only then mark `STAGING_OPERATIONAL`.
