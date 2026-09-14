// Preston AI OS - Phase 3 Gmail SANDBOX adapter. Handles gmail.message.
// draft only: it echoes the canonical draft (alias sender, allowlisted
// recipients, neutralized text, stripped attachment descriptors, manifest
// hash). gmail.message.send has NO handler here: even if the registry gate
// were flipped, this adapter cannot send - a live adapter is a separate,
// owner-gated, reviewed code change.

import type { CapabilityAdapter } from '../executor';
import type { CredentialBroker } from '../credentials';
import { GMAIL_MESSAGE_DRAFT, GMAIL_PROVIDER } from '../business/definitions';
import { makeNoCredentialBroker } from './sandbox-credentials';
import { makeSandboxAdapter, sandboxOk } from './sandbox-common';

export function makeGmailSandboxAdapter(
  broker: CredentialBroker = makeNoCredentialBroker(),
): CapabilityAdapter {
  return makeSandboxAdapter({
    provider: GMAIL_PROVIDER,
    broker,
    handlers: {
      [GMAIL_MESSAGE_DRAFT]: (def, canonical, attempt) => sandboxOk({
        capability: def.name,
        canonical,
        attempt,
        extra: {
          draft_state: 'rendered_not_created',
          sent: false,
        },
      }),
    },
  });
}
