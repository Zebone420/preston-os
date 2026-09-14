// Preston AI OS - Phase 3 shared sandbox adapter mechanics. A sandbox
// adapter never opens a socket, never imports a provider SDK, never reads
// a credential: it re-validates the request through the SAME definition
// validator the executor used (defense in depth), renders/echoes the
// canonical payload, and returns provider_state 'sandbox_only' with
// provider identity 'sandbox'. The ledger row the executor records is the
// only durable effect.

import type { AdapterOutcome, CapabilityAdapter } from '../executor';
import type { CredentialBroker } from '../credentials';
import type { CapabilityDefinition } from '../registry';
import { sha256Canonical } from '../contract';

export const SANDBOX_PROVIDER_IDENTITY = 'sandbox';
export const SANDBOX_PROVIDER_STATE = 'sandbox_only';
export const SANDBOX_CREDENTIAL_STATE = 'no_credential';

export interface SandboxEcho extends Record<string, unknown> {
  provider_identity: 'sandbox';
  provider_state: 'sandbox_only';
  credential_state: 'no_credential';
  capability: string;
  canonical: Record<string, unknown>;
}

// Refuses if the broker ever presents a credential (sandbox proof).
export function sandboxCredentialGate(
  broker: CredentialBroker, provider: string,
): AdapterOutcome | null {
  const cred = broker.resolve(provider);
  if (cred.ok) return { status: 'terminal', reason: 'sandbox_refuses_credential' };
  if (cred.reason !== 'no_credential') {
    return { status: 'terminal', reason: 'sandbox_broker_unexpected_state' };
  }
  return null;
}

export function sandboxOk(args: {
  capability: string;
  canonical: Record<string, unknown>;
  attempt: number;
  extra?: Record<string, unknown>;
}): AdapterOutcome {
  const fingerprint = sha256Canonical(args.canonical).slice(0, 16);
  const echo: SandboxEcho = {
    provider_identity: 'sandbox',
    provider_state: 'sandbox_only',
    credential_state: 'no_credential',
    capability: args.capability,
    canonical: args.canonical,
    ...(args.extra ?? {}),
  };
  return {
    status: 'ok',
    provider_result_id: `sandbox-${args.capability}-${fingerprint}`,
    summary: `sandbox ${args.capability} attempt ${args.attempt}: canonical payload ` +
      'rendered; no provider called (provider_state=sandbox_only)',
    artifact_refs: [],
    provider_state: 'sandbox_only',
    output: echo,
  };
}

// Builds a sandbox adapter for one provider from a per-capability renderer
// table. Unknown capability for this adapter => terminal (fail closed).
export function makeSandboxAdapter(args: {
  provider: string;
  broker: CredentialBroker;
  handlers: Record<string, (
    definition: CapabilityDefinition,
    canonical: Record<string, unknown>,
    attempt: number,
  ) => AdapterOutcome>;
}): CapabilityAdapter {
  return {
    async execute(input): Promise<AdapterOutcome> {
      const gate = sandboxCredentialGate(args.broker, args.provider);
      if (gate) return gate;
      const def = input.definition;
      if (def.provider !== args.provider || def.enabled !== true) {
        return { status: 'terminal', reason: 'sandbox_capability_not_handled' };
      }
      const handler = args.handlers[def.name];
      if (!handler) return { status: 'terminal', reason: 'sandbox_capability_not_handled' };
      if (!def.validate_params) return { status: 'terminal', reason: 'sandbox_validator_missing' };
      const pv = def.validate_params(input.request.params);
      if (!pv.ok) return { status: 'terminal', reason: pv.reason };
      return handler(def, pv.canonical, input.attempt);
    },
  };
}
