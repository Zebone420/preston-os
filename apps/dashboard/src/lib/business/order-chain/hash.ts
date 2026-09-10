// Order chain - deterministic hashing helpers (Phase 5 SAFE units).
//
// SERVER-ONLY: uses node:crypto (trusted runtime primitive, no new
// dependency). Every binding in the order chain (measurement sha256,
// configuration hash, PO hash) is a SHA-256 over canonical JSON so
// key order can never change a digest. Pure: no clock, no I/O.

import { createHash } from 'node:crypto';

export const SHA256_RE = /^[0-9a-f]{64}$/;

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_RE.test(value);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// Canonical JSON: object keys sorted recursively, arrays kept in
// order, no whitespace. undefined values are dropped (as JSON does).
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] !== undefined) out[key] = sortKeys(src[key]);
    }
    return out;
  }
  return value;
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export interface PoHashBindings {
  measurement_sha256: string;
  configuration_hash: string;
  template_sha256: string;
}

// po_hash binds the exact approved measurement, the exact product
// configuration, and the exact contract template version. Any drift
// in any binding yields a different hash and the order gate blocks.
export function computePoHash(b: PoHashBindings): string | null {
  if (
    !isSha256(b.measurement_sha256) ||
    !isSha256(b.configuration_hash) ||
    !isSha256(b.template_sha256)
  ) {
    return null;
  }
  return sha256Hex(
    `po:${b.measurement_sha256}:${b.configuration_hash}:` +
      b.template_sha256,
  );
}
