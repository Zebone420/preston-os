import type { MemoryEntry, MemoryType } from './types';

// Preston AI OS - shared memory validation + secret redaction (Phase 2).
// PURE. Enforces provenance fields on every entry and guarantees no
// secret-shaped data enters shared memory. Shared memory holds operational
// state only, never credentials.

const MEMORY_TYPES: readonly MemoryType[] = [
  'project',
  'architecture',
  'decision',
  'task',
  'execution',
  'deployment',
  'connector',
  'agent',
  'checkpoint',
  'conversation',
];

// Secret-shaped key patterns that must never be stored in shared memory.
const SECRET_KEY =
  /(secret|token|password|passwd|\bpat\b|api[_-]?key|client[_-]?secret|private[_-]?key|refresh[_-]?token|bearer|cookie|credential)/i;

export interface MemoryValidation {
  ok: boolean;
  errors: string[];
}

// Validate provenance + reject secret-shaped keys. Required: memory_type, key,
// actor, source, version >= 1, correlation_id.
export function validateMemoryEntry(e: Partial<MemoryEntry>): MemoryValidation {
  const errors: string[] = [];
  if (!e.memory_type || !MEMORY_TYPES.includes(e.memory_type)) {
    errors.push('invalid memory_type');
  }
  if (!e.key || e.key.trim() === '') errors.push('key required');
  if (!e.actor || e.actor.trim() === '') errors.push('actor required');
  if (!e.source || e.source.trim() === '') errors.push('source required');
  if (typeof e.version !== 'number' || e.version < 1) {
    errors.push('version must be a number >= 1');
  }
  if (!e.correlation_id || e.correlation_id.trim() === '') {
    errors.push('correlation_id required');
  }
  if (e.key && SECRET_KEY.test(e.key)) {
    errors.push('secret-shaped key is not allowed in shared memory');
  }
  return { ok: errors.length === 0, errors };
}

// Recursively replace values under secret-shaped keys with '[REDACTED]'.
// Defense in depth for any value about to be persisted or logged.
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}
