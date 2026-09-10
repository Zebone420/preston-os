// Preston AI OS - Phase 3 Drive SANDBOX adapter. Echoes the canonical
// file-create (project, folder binding, canonical filename, sha256). No
// file is written, moved, or deleted anywhere.

import type { CapabilityAdapter } from '../executor';
import type { CredentialBroker } from '../credentials';
import { DRIVE_FILE_WRITE, DRIVE_PROVIDER } from '../business/definitions';
import { makeNoCredentialBroker } from './sandbox-credentials';
import { makeSandboxAdapter, sandboxOk } from './sandbox-common';

export function makeDriveSandboxAdapter(
  broker: CredentialBroker = makeNoCredentialBroker(),
): CapabilityAdapter {
  return makeSandboxAdapter({
    provider: DRIVE_PROVIDER,
    broker,
    handlers: {
      [DRIVE_FILE_WRITE]: (def, canonical, attempt) => sandboxOk({
        capability: def.name,
        canonical,
        attempt,
        extra: {
          file_state: 'rendered_not_written',
          drive_file_id: null,
        },
      }),
    },
  });
}
