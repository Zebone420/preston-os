// Preston AI OS - Phase 3 composition of the business capability path.
// The ONE place that wires sandbox adapters + the no-credential broker +
// the fail-closed kill-switch reader into the EXISTING trusted executor
// deps. Callers of the business path go through here so the kill behavior
// cannot be forgotten. Nothing here is imported by the orchestrator tick.

import type { RuntimeClient } from '../../store';
import { readSystemControlsChecked } from '../../store';
import { DEFAULT_CONTROLS, type SystemControls } from '../../controls';
import type { CapabilityAdapter, CapabilityExecutorDeps } from '../executor';
import type { CredentialBroker } from '../credentials';
import { makeNoCredentialBroker } from '../providers/sandbox-credentials';
import { makeGmailSandboxAdapter } from '../providers/gmail-sandbox';
import { makeCalendarSandboxAdapter } from '../providers/calendar-sandbox';
import { makeDriveSandboxAdapter } from '../providers/drive-sandbox';
import { makeInternalRunnerAdapter } from '../providers/internal-runner';
import {
  BUSINESS_PROVIDER, CALENDAR_PROVIDER, DRIVE_PROVIDER, GMAIL_PROVIDER,
  BUSINESS_CAPABILITY_NAMES,
} from './definitions';
import { deploymentEnvironment } from '../../runtime-environment';
import { makeSandboxConnectorPassport } from '../../connectors/passport';

export function makeBusinessAdapters(
  broker: CredentialBroker = makeNoCredentialBroker(),
): Record<string, CapabilityAdapter> {
  return {
    [GMAIL_PROVIDER]: makeGmailSandboxAdapter(broker),
    [CALENDAR_PROVIDER]: makeCalendarSandboxAdapter(broker),
    [DRIVE_PROVIDER]: makeDriveSandboxAdapter(broker),
    [BUSINESS_PROVIDER]: makeInternalRunnerAdapter(broker),
  };
}

// Fail-closed controls reader: an unreadable or missing controls row is
// treated as owner_stop (the executor then refuses runtime_halted).
export async function readControlsFailClosed(client: RuntimeClient): Promise<SystemControls> {
  const r = await readSystemControlsChecked(client);
  if (!r.readOk) return { ...DEFAULT_CONTROLS, owner_stop: true };
  return r.controls;
}

export function makeBusinessExecutorDeps(args: {
  client: RuntimeClient;
  actorId: string;
  ownerIdentity: string;
  now: () => number;
  readApproval: CapabilityExecutorDeps['readApproval'];
  readControls?: CapabilityExecutorDeps['readControls'];
  broker?: CredentialBroker;
  log?: CapabilityExecutorDeps['log'];
}): CapabilityExecutorDeps {
  return {
    client: args.client,
    adapters: makeBusinessAdapters(args.broker ?? makeNoCredentialBroker()),
    actorId: args.actorId,
    ownerIdentity: args.ownerIdentity,
    now: args.now,
    readApproval: args.readApproval,
    readControls: args.readControls ?? readControlsFailClosed,
    connectorMode: 'sandbox_only',
    readConnectorPassport: async (_client, provider) =>
      makeSandboxConnectorPassport({
        provider,
        capabilities: BUSINESS_CAPABILITY_NAMES.filter((name) =>
          name === provider || name.startsWith(provider + '.') ||
          provider === BUSINESS_PROVIDER),
        environment: deploymentEnvironment(),
        now_ms: args.now(),
      }),
    log: args.log,
  };
}
