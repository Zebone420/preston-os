// Preston AI OS - Phase 3 stale-approval rejection (master build plan
// section 11). PURE. An EXTERNAL / STEP_UP approval must bind, in addition
// to the whole-payload SHA-256 already verified by
// executor.verifySideEffectApproval (approval id, capability, target,
// side_effect_id, owner, environment, validity window):
//
//   actor, action, project_id, exact payload hash, document/version hash,
//   amount where applicable, recipient where applicable, expiry, nonce.
//
// The executor composes BOTH checks; this module never re-implements the
// canonical action hash (no parallel crypto authority) - it hashes the
// field-level envelope with the same canonical JSON and compares it to the
// approval record's binding_hash. Stale payload = stale approval = reject.
//
// One-time use: the canonical action hash binds side_effect_id, and
// side_effect_id is derived from the idempotency key, so one approval can
// only ever match ONE ledger row, and that row executes at most once
// (executing CAS). A nonce must be present; a missing nonce rejects.

import { sha256Canonical } from '../contract';

export interface ApprovalBinding {
  actor: string;
  action: string; // capability name
  project_id: string | null;
  payload_hash: string; // exact params hash
  document_hash: string | null; // document/version hash where applicable
  amount: number | null; // integer cents where applicable
  recipient: string | null; // sorted comma-joined recipients where applicable
}

export type ApprovalBindingReason =
  | 'binding_missing'
  | 'binding_mismatch'
  | 'nonce_missing'
  | 'expired_at_execution'
  | 'execution_clock_invalid';

export function approvalBindingHash(b: ApprovalBinding): string {
  return sha256Canonical({
    actor: String(b.actor),
    action: String(b.action),
    project_id: b.project_id ?? null,
    payload_hash: String(b.payload_hash),
    document_hash: b.document_hash ?? null,
    amount: typeof b.amount === 'number' && Number.isFinite(b.amount) ? b.amount : null,
    recipient: b.recipient ?? null,
  });
}

// Field-level verification against the approval record. Fail closed on any
// missing element. `expectedBindingHash` is approvalBindingHash(...) of the
// binding derived from the CURRENT request (never from the record).
export function verifyApprovalBinding(
  record: Record<string, unknown> | undefined,
  expectedBindingHash: string,
  nowMs: number,
): { ok: true; reason: 'binding_verified' } | { ok: false; reason: ApprovalBindingReason } {
  const stored = String(record?.binding_hash ?? '').trim();
  if (!stored) return { ok: false, reason: 'binding_missing' };
  if (stored !== expectedBindingHash) return { ok: false, reason: 'binding_mismatch' };
  if (!record?.nonce) return { ok: false, reason: 'nonce_missing' };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'execution_clock_invalid' };
  const expires = Date.parse(String(record?.expires_at ?? ''));
  if (!Number.isFinite(expires) || nowMs >= expires) {
    return { ok: false, reason: 'expired_at_execution' };
  }
  return { ok: true, reason: 'binding_verified' };
}

// Convenience predicate for callers that only need a boolean.
export function isStaleApproval(
  record: Record<string, unknown> | undefined,
  expected: ApprovalBinding,
  nowMs: number,
): boolean {
  return !verifyApprovalBinding(record, approvalBindingHash(expected), nowMs).ok;
}
