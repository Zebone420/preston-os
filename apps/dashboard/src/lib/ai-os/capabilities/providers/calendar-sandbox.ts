// Preston AI OS - Phase 3 Calendar SANDBOX adapter. Echoes the canonical
// event (confirmed project, allowlisted attendees, neutralized text). No
// invitation is created or sent (CLAUDE.md rule 5: never create, edit, or
// delete live calendar events).

import type { CapabilityAdapter } from '../executor';
import type { CredentialBroker } from '../credentials';
import { CALENDAR_EVENT_CREATE, CALENDAR_PROVIDER } from '../business/definitions';
import { makeNoCredentialBroker } from './sandbox-credentials';
import { makeSandboxAdapter, sandboxOk } from './sandbox-common';

export function makeCalendarSandboxAdapter(
  broker: CredentialBroker = makeNoCredentialBroker(),
): CapabilityAdapter {
  return makeSandboxAdapter({
    provider: CALENDAR_PROVIDER,
    broker,
    handlers: {
      [CALENDAR_EVENT_CREATE]: (def, canonical, attempt) => sandboxOk({
        capability: def.name,
        canonical,
        attempt,
        extra: {
          event_state: 'rendered_not_created',
          invitations_sent: false,
        },
      }),
    },
  });
}
