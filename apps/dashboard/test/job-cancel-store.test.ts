import { describe, expect, it } from 'vitest';
import {
  requestJobCancel,
  type QueryResult,
  type RuntimeClient,
} from '../src/lib/ai-os/store';

// Phase 5 test-audit F3: store-layer coverage for requestJobCancel's
// per-status CAS loop, with a FILTER-AWARE fake (an eq-blind fake would pass
// wrong-column or no-early-stop bugs - the historical H1 masking shape).
// Pins: the update patch shape, the exact (id, status) filter pairs tried in
// order, early stop on first match, fail-closed on DB error, and the
// not-cancellable fallthrough.

const NOW = '2026-07-21T12:00:00.000Z';
const JOB = '33333333-3333-4333-8333-333333333333';

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<[string, string]>;
}

// matchStatus: the job's current status; an update "matches a row" only when
// its status filter equals it (and the id filter equals JOB).
function casClient(matchStatus: string | null, error?: string) {
  const updates: UpdateCall[] = [];
  const client = {
    from(table: string) {
      return {
        insert() {
          throw new Error('requestJobCancel must never insert');
        },
        select() {
          throw new Error('requestJobCancel must never read');
        },
        update(patch: Record<string, unknown>) {
          const filters: Array<[string, string]> = [];
          updates.push({ table, patch, filters });
          const resolve = async (): Promise<QueryResult> => {
            if (error) return { data: null, error: { message: error } };
            const idOk = filters.some(([c, v]) => c === 'id' && v === JOB);
            const stOk = filters.some(([c, v]) => c === 'status' && v === matchStatus);
            return { data: idOk && stOk ? [{ id: JOB }] : [], error: null };
          };
          type Node = {
            select: () => Promise<QueryResult>;
            eq: (col: string, val: string) => Node;
            lte: (col: string, val: string) => Node;
            gt: (col: string, val: string) => Node;
          };
          const node: Node = {
            select: resolve,
            eq(col: string, val: string) { filters.push([col, val]); return node; },
            lte(col: string, val: string) { filters.push([col, val]); return node; },
            gt(col: string, val: string) { filters.push([col, val]); return node; },
          };
          return node;
        },
      };
    },
  } as unknown as RuntimeClient;
  return { client, updates };
}

describe('store.requestJobCancel - per-status CAS loop', () => {
  it('flags a queued job with the exact patch and (id,status) guards, then stops', async () => {
    const { client, updates } = casClient('queued');
    const r = await requestJobCancel(client, JOB, NOW);
    expect(r).toMatchObject({ ok: true, id: JOB });
    // Tried proposed, validated, then matched queued - and stopped there.
    expect(updates.map((u) => u.filters.find(([c]) => c === 'status')?.[1])).toEqual([
      'proposed', 'validated', 'queued',
    ]);
    for (const u of updates) {
      expect(u.table).toBe('os_jobs');
      expect(u.patch).toEqual({ cancel_requested: true, updated_at: NOW });
      expect(u.filters).toContainEqual(['id', JOB]);
    }
  });

  it('walks every cancellable status for a terminal/unknown job, then fails closed', async () => {
    const { client, updates } = casClient(null);
    const r = await requestJobCancel(client, JOB, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not in a cancellable state');
    expect(updates.map((u) => u.filters.find(([c]) => c === 'status')?.[1])).toEqual([
      'proposed', 'validated', 'queued', 'leased', 'running', 'checkpointed',
    ]);
  });

  it('fails closed on the first DB error without trying further statuses', async () => {
    const { client, updates } = casClient('queued', 'permission denied');
    const r = await requestJobCancel(client, JOB, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('permission denied');
    expect(updates.length).toBe(1);
  });

  it('never touches status, leases, or execution fields in its patch', async () => {
    const { client, updates } = casClient('leased');
    await requestJobCancel(client, JOB, NOW);
    for (const u of updates) {
      expect(Object.keys(u.patch).sort()).toEqual(['cancel_requested', 'updated_at']);
    }
  });
});
