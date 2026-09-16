import { randomUUID } from 'node:crypto';
import {
  insertMemory,
  RUNTIME_TABLES,
  type RuntimeClient,
} from '../ai-os/store';
import type { MemoryType } from '../ai-os/types';
import { evaluateMemoryCandidate } from './policy';
import type {
  BrainContextItem,
  BrainMemoryCandidate,
  BrainMemoryClass,
  BrainMemorySink,
  BrainProvider,
  BrainQuery,
} from './types';

const CLASS_BY_TYPE: Record<MemoryType, BrainMemoryClass> = {
  project: 'business',
  architecture: 'institutional',
  decision: 'institutional',
  task: 'working',
  execution: 'working',
  deployment: 'working',
  connector: 'working',
  agent: 'institutional',
  checkpoint: 'working',
  conversation: 'working',
};

function asMemoryType(value: unknown): MemoryType | null {
  const type = String(value ?? '') as MemoryType;
  return type in CLASS_BY_TYPE ? type : null;
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 20);
}

function scoreRow(row: Record<string, unknown>, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 1;
  const haystack = [row['memory_type'], row['key'], row['value']]
    .map((value) => {
      try {
        return typeof value === 'string' ? value : JSON.stringify(value);
      } catch {
        return '';
      }
    })
    .join(' ')
    .toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function rowToContext(row: Record<string, unknown>): BrainContextItem | null {
  const memoryType = asMemoryType(row['memory_type']);
  if (!memoryType) return null;

  const candidate: BrainMemoryCandidate = {
    memory_type: memoryType,
    memory_class: CLASS_BY_TYPE[memoryType],
    key: String(row['key'] ?? ''),
    value: row['value'],
    actor: String(row['actor'] ?? ''),
    source: String(row['source'] ?? ''),
    version: Number(row['version'] ?? 0),
    correlation_id: String(row['correlation_id'] ?? ''),
    audit_ref: row['audit_ref'] ? String(row['audit_ref']) : null,
  };

  // Stored memory is still treated as untrusted input on recall. This blocks
  // legacy/poisoned rows from becoming authority simply because they persisted.
  const policy = evaluateMemoryCandidate(candidate);
  if (!policy.allowed) return null;

  return {
    ...candidate,
    audit_ref: candidate.audit_ref ?? null,
    value: policy.sanitized_value,
    created_at: String(row['created_at'] ?? ''),
  };
}

export class PrestonMemoryAdapter implements BrainProvider, BrainMemorySink {
  readonly id = 'preston-agent-memory';
  readonly capabilities = ['recall', 'propose_memory'] as const;

  constructor(private readonly client: RuntimeClient) {}

  async append(candidate: BrainMemoryCandidate): Promise<{ ok: boolean; id?: string; error?: string }> {
    const policy = evaluateMemoryCandidate(candidate);
    if (!policy.allowed) {
      return { ok: false, error: `brain memory blocked: ${policy.reasons.join(',')}` };
    }

    return insertMemory(this.client, {
      id: randomUUID(),
      memory_type: candidate.memory_type,
      key: candidate.key,
      value: policy.sanitized_value,
      actor: candidate.actor,
      source: candidate.source,
      version: candidate.version,
      correlation_id: candidate.correlation_id,
      audit_ref: candidate.audit_ref ?? null,
    });
  }

  async recall(query: BrainQuery): Promise<BrainContextItem[]> {
    const limit = Math.max(1, Math.min(query.limit ?? 12, 50));
    const scanLimit = Math.min(Math.max(limit * 5, 25), 100);
    const result = await this.client
      .from(RUNTIME_TABLES.memory)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(scanLimit);

    if (result.error) return [];

    const queryTerms = terms(query.query);
    const candidates: Array<BrainContextItem | null> = (result.data ?? []).map(
      (row): BrainContextItem | null => {
        const item = rowToContext(row);
        if (!item) return null;
        if (query.memory_types && !query.memory_types.includes(item.memory_type)) return null;
        if (query.memory_classes && !query.memory_classes.includes(item.memory_class)) return null;
        const score = scoreRow(row, queryTerms);
        if (queryTerms.length > 0 && score === 0) return null;
        return { ...item, score };
      },
    );

    return candidates
      .filter((item): item is BrainContextItem => item !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
}
