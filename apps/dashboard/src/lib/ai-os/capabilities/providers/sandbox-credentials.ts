// Preston AI OS - Phase 3 sandbox credential broker. Implements the
// EXISTING CredentialBroker interface (credentials.ts) and ALWAYS answers
// 'no_credential': no business provider holds any credential in this
// phase. It reads no env and no file. Sandbox adapters call it on every
// execution and REFUSE if a credential were ever presented (an adapter
// that could act for real is, by construction, not a sandbox adapter).

import type { CredentialBroker, CredentialResolution } from '../credentials';

export const NO_CREDENTIAL: CredentialResolution = Object.freeze({
  ok: false, reason: 'no_credential',
}) as CredentialResolution;

export function makeNoCredentialBroker(): CredentialBroker {
  let resolutions = 0;
  return {
    resolve(): CredentialResolution {
      resolutions++;
      return NO_CREDENTIAL;
    },
    stats: () => ({ resolutions, disk_reads: 0 }),
  };
}
