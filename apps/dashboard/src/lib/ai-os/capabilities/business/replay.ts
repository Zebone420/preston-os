// Preston AI OS - Phase 3 replay protection. PURE. REUSES the side-effect
// ledger's idempotency spine (contract.deriveSideEffectId + unique
// idempotency_key + executor.replayFromRow): a replayed request converges on
// the SAME ledger row and receives the STORED outcome without any second
// execution. This module adds only:
//
//   - the business idempotency-key strategy (capability + project + exact
//     payload hash) so identical proposals collapse to one row by
//     construction, not by caller discipline;
//   - the evidence-ref encoding that lets a replay carry the provider state
//     and the output hash of the original execution.

import type { CapabilityResult, ProviderState } from '../contract';
import { sha256Canonical } from '../contract';

export const EVIDENCE_PROVIDER_STATE_PREFIX = 'provider_state:';
export const EVIDENCE_OUTPUT_HASH_PREFIX = 'output_sha256:';
export const REPLAY_SUMMARY_PREFIX = 'replayed:';

// Idempotency key = capability : project : 32 hex chars of the payload
// hash. Stays inside the contract ID_RE ([A-Za-z0-9._:-]{1,128}).
export function deriveBusinessIdempotencyKey(args: {
  capability: string;
  project_id: string;
  payload_hash: string;
}): string {
  const cap = String(args.capability).replace(/[^a-z0-9._]/g, '');
  const proj = String(args.project_id).replace(/[^A-Za-z0-9-]/g, '');
  const hash = String(args.payload_hash).slice(0, 32);
  return `${cap}:${proj}:${hash}`.slice(0, 128);
}

// Evidence refs appended by the executor on a sandbox success so a replay
// (fresh process, same ledger) still reports provider_state and output hash.
export function sandboxEvidenceRefs(
  providerState: ProviderState | undefined,
  output: Record<string, unknown> | undefined,
): string[] {
  const refs: string[] = [];
  if (providerState) refs.push(EVIDENCE_PROVIDER_STATE_PREFIX + providerState);
  if (output) refs.push(EVIDENCE_OUTPUT_HASH_PREFIX + sha256Canonical(output));
  return refs;
}

export function providerStateFromEvidence(refs: string[]): ProviderState | null {
  for (const r of refs) {
    if (r === EVIDENCE_PROVIDER_STATE_PREFIX + 'sandbox_only') return 'sandbox_only';
  }
  return null;
}

export function outputHashFromEvidence(refs: string[]): string | null {
  for (const r of refs) {
    if (r.startsWith(EVIDENCE_OUTPUT_HASH_PREFIX)) {
      return r.slice(EVIDENCE_OUTPUT_HASH_PREFIX.length);
    }
  }
  return null;
}

export function isReplayedResult(r: CapabilityResult): boolean {
  return r.ok && String(r.summary ?? '').startsWith(REPLAY_SUMMARY_PREFIX);
}
