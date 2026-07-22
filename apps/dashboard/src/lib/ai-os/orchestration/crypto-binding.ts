// Preston AI OS - Phase 7 CANONICAL cryptographic action binding.
// SERVER-ONLY (uses node:crypto - a trusted runtime primitive, no new dep).
// This is the hash that WILL be used as authorization evidence at the
// Telegram/ChatGPT activation gate. The simulation approvals.actionHash
// (32-bit FNV) is a NON-authoritative UI/dedup binding and must NEVER be
// accepted as activation evidence (documented in the threat model).
//
// The canonical hash is SHA-256 over a deterministic, canonicalized JSON
// envelope so field order can never change the digest.

import { createHash } from 'node:crypto';

export interface ActionEnvelope {
  approval_id: string;
  action: string;
  affected_resource: string;
  environment: 'staging';
  owner_identity: string;
  risk_class: string;
  created_at: string;
  expires_at: string;
}

// Canonical serialization: keys sorted, strings trimmed, no whitespace. Any
// change to any bound field changes the digest.
function canonicalize(e: ActionEnvelope): string {
  const ordered: Record<string, string> = {
    action: String(e.action),
    affected_resource: String(e.affected_resource),
    approval_id: String(e.approval_id),
    created_at: String(e.created_at),
    environment: String(e.environment),
    expires_at: String(e.expires_at),
    owner_identity: String(e.owner_identity),
    risk_class: String(e.risk_class),
  };
  return JSON.stringify(ordered, Object.keys(ordered).sort());
}

// SHA-256 hex digest of the canonical envelope. 256-bit; collision-resistant.
export function canonicalActionHash(e: ActionEnvelope): string {
  return createHash('sha256').update(canonicalize(e), 'utf8').digest('hex');
}

// Verify a presented hash against a rebuilt envelope. Constant-time-ish
// compare on equal-length hex strings.
export function verifyActionHash(
  e: ActionEnvelope,
  presented: string,
): boolean {
  const expected = canonicalActionHash(e);
  if (typeof presented !== 'string' || presented.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}
