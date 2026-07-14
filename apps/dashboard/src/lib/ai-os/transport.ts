import type { EventType } from './types';
import { redactSecrets } from './memory';

// Preston AI OS - durable event transport (Phase 3 runtime). PURE + adapter
// driven. Envelopes carry correlation/causation/idempotency + retry metadata.
// Supabase can become the production transport later via the EventStore
// interface; tests use the in-memory adapter (no credentials). No secret
// payloads; no business execution here - this only persists/reads facts.

const SECRET_KEY =
  /(secret|token|password|passwd|\bpat\b|api[_-]?key|client[_-]?secret|private[_-]?key|refresh[_-]?token|bearer|cookie|credential)/i;

export interface EventEnvelope {
  id: string;
  type: EventType;
  actor: string;
  source: string; // originating agent/subsystem
  correlation_id: string;
  causation_id: string | null; // event that caused this one
  idempotency_key: string;
  version: number;
  payload: Record<string, unknown>; // never secrets (redacted on make)
  created_at: string;
  attempts: number;
  max_attempts: number;
  dead_lettered: boolean;
}

export interface EnvelopeInput {
  id: string;
  type: EventType;
  actor: string;
  source: string;
  correlation_id: string;
  idempotency_key: string;
  now: string;
  causation_id?: string | null;
  version?: number;
  payload?: Record<string, unknown>;
  max_attempts?: number;
}

// True if the payload carries an UNREDACTED secret: a secret-shaped key whose
// value is not already '[REDACTED]' (recursively). A redacted payload (as
// produced by makeEnvelope) is considered clean.
export function hasSecretPayload(payload: Record<string, unknown>): boolean {
  const walk = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(walk);
    if (v && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>).some(
        ([k, val]) => (SECRET_KEY.test(k) && val !== '[REDACTED]') || walk(val),
      );
    }
    return false;
  };
  return walk(payload);
}

// Build a validated envelope. Payload is redacted defensively; secret-shaped
// keys become '[REDACTED]' rather than being stored raw.
export function makeEnvelope(input: EnvelopeInput): EventEnvelope {
  const payload = (redactSecrets(input.payload ?? {}) as Record<string, unknown>) ?? {};
  return {
    id: input.id,
    type: input.type,
    actor: input.actor,
    source: input.source,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id ?? null,
    idempotency_key: input.idempotency_key,
    version: input.version ?? 1,
    payload,
    created_at: input.now,
    attempts: 0,
    max_attempts: input.max_attempts ?? 5,
    dead_lettered: false,
  };
}

export interface EnvelopeValidation {
  ok: boolean;
  errors: string[];
}

export function validateEnvelope(e: Partial<EventEnvelope>): EnvelopeValidation {
  const errors: string[] = [];
  if (!e.id) errors.push('id required');
  if (!e.type) errors.push('type required');
  if (!e.actor) errors.push('actor required');
  if (!e.source) errors.push('source required');
  if (!e.correlation_id) errors.push('correlation_id required');
  if (!e.idempotency_key) errors.push('idempotency_key required');
  if (e.payload && hasSecretPayload(e.payload)) {
    errors.push('secret-shaped payload is not allowed');
  }
  return { ok: errors.length === 0, errors };
}

// Append-only transport abstraction. Production impl backs onto Supabase
// os_events; tests use InMemoryEventStore. Idempotent by idempotency_key.
export interface EventStore {
  append(e: EventEnvelope): Promise<{ stored: boolean }>;
  read(afterId?: string, limit?: number): Promise<EventEnvelope[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly log: EventEnvelope[] = [];
  private readonly seen = new Set<string>();

  async append(e: EventEnvelope): Promise<{ stored: boolean }> {
    const v = validateEnvelope(e);
    if (!v.ok) throw new Error('invalid envelope: ' + v.errors.join(', '));
    if (this.seen.has(e.idempotency_key)) return { stored: false }; // dedupe
    this.seen.add(e.idempotency_key);
    this.log.push(e);
    return { stored: true };
  }

  async read(afterId?: string, limit = 100): Promise<EventEnvelope[]> {
    let start = 0;
    if (afterId) {
      const i = this.log.findIndex((e) => e.id === afterId);
      start = i < 0 ? this.log.length : i + 1;
    }
    return this.log.slice(start, start + limit);
  }

  get size(): number {
    return this.log.length;
  }
}

// Replay-safe consumption: fold events from a cursor through a handler,
// skipping idempotency keys already processed. Returns the new cursor + the
// set of processed keys. No persistent polling loop is started here.
export interface ConsumeResult {
  cursor: string | null;
  processed: string[];
}

export async function consume(
  store: EventStore,
  cursor: string | null,
  processedKeys: Set<string>,
  handler: (e: EventEnvelope) => void,
  limit = 100,
): Promise<ConsumeResult> {
  const batch = await store.read(cursor ?? undefined, limit);
  let last = cursor;
  const processed: string[] = [];
  for (const e of batch) {
    last = e.id;
    if (processedKeys.has(e.idempotency_key)) continue; // replay-safe
    handler(e);
    processedKeys.add(e.idempotency_key);
    processed.push(e.idempotency_key);
  }
  return { cursor: last, processed };
}
