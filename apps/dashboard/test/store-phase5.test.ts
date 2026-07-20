import { describe, expect, it } from 'vitest';
import {
  acquireLease,
  completeSimulatedJob,
  insertStagingJob,
  listJobsByStatus,
  markJobLeased,
  readLatestCheckpoint,
  readSystemControlsChecked,
  recordTelegramUpdate,
  recoverExpiredLeasedJobs,
  renewLeaseDb,
  requeueJob,
  type QueryResult,
  type RuntimeClient,
} from '../src/lib/ai-os/store';

const NOW = '2026-07-20T12:00:00.000Z';
const OK: QueryResult = { data: [{ id: 'x', job_id: 'j1', update_id: 1 }], error: null };
const NONE: QueryResult = { data: [], error: null };
const UNIQUE: QueryResult = { data: null, error: { message: 'duplicate key value violates unique constraint' } };
const BOOM: QueryResult = { data: null, error: { message: 'permission denied' } };

interface Call {
  op: 'insert' | 'update' | 'select';
  table: string;
  row?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>; // [method, column, value]
}

// Scripted, table-agnostic fake: pops the next result per op kind, records
// every filter (method+column+value) for guard assertions.
function scripted(script: { insert?: QueryResult[]; update?: QueryResult[]; select?: QueryResult[] }) {
  const calls: Call[] = [];
  const next = (kind: 'insert' | 'update' | 'select'): QueryResult => script[kind]?.shift() ?? OK;
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          const call: Call = { op: 'insert', table, row, filters: [] };
          calls.push(call);
          return { select: async () => next('insert') };
        },
        update(row: Record<string, unknown>) {
          const call: Call = { op: 'update', table, row, filters: [] };
          calls.push(call);
          type Node = {
            select: () => Promise<QueryResult>;
            eq: (c: string, v: unknown) => Node;
            lte: (c: string, v: unknown) => Node;
            gt: (c: string, v: unknown) => Node;
          };
          const node: Node = {
            select: async () => next('update'),
            eq: (c, v) => { call.filters.push(['eq', c, v]); return node; },
            lte: (c, v) => { call.filters.push(['lte', c, v]); return node; },
            gt: (c, v) => { call.filters.push(['gt', c, v]); return node; },
          };
          return node;
        },
        select() {
          const call: Call = { op: 'select', table, filters: [] };
          calls.push(call);
          const limit = async () => next('select');
          type Node = {
            limit: (n: number) => Promise<QueryResult>;
            eq: (c: string, v: unknown) => Node;
            order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<QueryResult> };
          };
          const node: Node = {
            limit,
            eq: (c, v) => { call.filters.push(['eq', c, v]); return node; },
            order: (c, o) => { call.filters.push(['order', c, o.ascending]); return { limit }; },
          };
          return node;
        },
      };
    },
  };
  return { client, calls };
}

describe('acquireLease - DB unique(job_id) CAS', () => {
  it('fresh acquisition inserts and never falls through to takeover', async () => {
    const { client, calls } = scripted({ insert: [OK] });
    const r = await acquireLease(client, 'j1', 'w', 't1', 60000, NOW);
    expect(r).toEqual({ ok: true, via: 'fresh' });
    expect(calls.filter((c) => c.op === 'update').length).toBe(0);
  });
  it('takes over ONLY an expired lease (lte guard) when the row exists', async () => {
    const { client, calls } = scripted({ insert: [UNIQUE], update: [OK] });
    const r = await acquireLease(client, 'j1', 'w', 't2', 60000, NOW);
    expect(r).toEqual({ ok: true, via: 'takeover' });
    const upd = calls.find((c) => c.op === 'update')!;
    expect(upd.filters).toContainEqual(['eq', 'job_id', 'j1']);
    expect(upd.filters).toContainEqual(['lte', 'expires_at', NOW]);
  });
  it('loses cleanly to a live lease (zero takeover rows)', async () => {
    const { client } = scripted({ insert: [UNIQUE], update: [NONE] });
    const r = await acquireLease(client, 'j1', 'w2', 't3', 60000, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not stealable');
  });
  it('fails closed on ttl<=0, missing identity, and non-unique insert errors', async () => {
    const { client, calls } = scripted({});
    expect((await acquireLease(client, 'j1', 'w', 't', 0, NOW)).ok).toBe(false);
    expect((await acquireLease(client, 'j1', '', 't', 1000, NOW)).ok).toBe(false);
    expect(calls.length).toBe(0);
    const { client: c2 } = scripted({ insert: [BOOM] });
    expect((await acquireLease(c2, 'j1', 'w', 't', 1000, NOW)).ok).toBe(false);
  });
});

describe('renewLeaseDb - live-only, owner+token bound', () => {
  it('renews with owner+token+gt(expires_at) guards', async () => {
    const { client, calls } = scripted({ update: [OK] });
    const r = await renewLeaseDb(client, 'j1', 'w', 't', 60000, NOW);
    expect(r.ok).toBe(true);
    const f = calls[0].filters;
    expect(f).toContainEqual(['eq', 'owner', 'w']);
    expect(f).toContainEqual(['eq', 'token', 't']);
    expect(f).toContainEqual(['gt', 'expires_at', NOW]);
  });
  it('reports lease loss on zero matched rows (caller must stop work)', async () => {
    const { client } = scripted({ update: [NONE] });
    const r = await renewLeaseDb(client, 'j1', 'w', 't', 60000, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('lease lost');
  });
});

describe('job CAS transitions - fenced by status and lease token', () => {
  it('markJobLeased loses the race on zero rows', async () => {
    const { client, calls } = scripted({ update: [NONE] });
    const r = await markJobLeased(client, 'j1', 'w', 't', NOW, NOW);
    expect(r.ok).toBe(false);
    expect(calls[0].filters).toContainEqual(['eq', 'status', 'queued']);
  });
  it('completeSimulatedJob is token-fenced: a stale generation changes nothing', async () => {
    const { client, calls } = scripted({ update: [NONE] });
    const r = await completeSimulatedJob(client, 'j1', 'stale-token', 2, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('fenced');
    expect(calls[0].filters).toContainEqual(['eq', 'lease_token', 'stale-token']);
    expect(calls[0].row?.status).toBe('checkpointed');
  });
  it('requeueJob is token-fenced and stamps attempts', async () => {
    const { client, calls } = scripted({ update: [OK] });
    const r = await requeueJob(client, 'j1', 't', 2, NOW);
    expect(r.ok).toBe(true);
    expect(calls[0].row).toMatchObject({ status: 'queued', attempts: 2 });
    expect(calls[0].filters).toContainEqual(['eq', 'lease_token', 't']);
  });
});

describe('insertStagingJob - queue-only, forced fail-closed posture', () => {
  const input = {
    id: 'j1', command_id: 'c1', approval_id: 'a1', risk_class: 'GREEN',
    not_before: NOW, expires_at: '2026-07-20T13:00:00.000Z',
    idempotency_key: 'i1', correlation_id: 'corr',
  };
  it('forces queued/non-executable/zero-attempt state on write', async () => {
    const { client, calls } = scripted({ insert: [OK] });
    const r = await insertStagingJob(client, input);
    expect(r.ok).toBe(true);
    expect(calls[0].row).toMatchObject({
      status: 'queued', execution_enabled: false, cancel_requested: false, attempts: 0, risk_class: 'GREEN',
    });
  });
  it('refuses non-GREEN and missing approval before any write', async () => {
    const { client, calls } = scripted({});
    expect((await insertStagingJob(client, { ...input, risk_class: 'YELLOW' })).ok).toBe(false);
    expect((await insertStagingJob(client, { ...input, approval_id: '' })).ok).toBe(false);
    expect(calls.length).toBe(0);
  });
  it('dedupes a replayed idempotency_key (no second job, duplicate:true)', async () => {
    const { client } = scripted({ insert: [UNIQUE] });
    const r = await insertStagingJob(client, input);
    expect(r).toMatchObject({ ok: true, duplicate: true });
  });
});

describe('recordTelegramUpdate - durable replay dedup (migration 0006)', () => {
  it('records a fresh update and flags a replayed one as duplicate', async () => {
    const { client } = scripted({ insert: [OK] });
    expect((await recordTelegramUpdate(client, 100, 'corr')).ok).toBe(true);
    const { client: c2 } = scripted({ insert: [UNIQUE] });
    const replay = await recordTelegramUpdate(c2, 100, 'corr');
    expect(replay).toMatchObject({ ok: true, duplicate: true });
  });
  it('fails closed on invalid ids and DB errors', async () => {
    const { client, calls } = scripted({});
    expect((await recordTelegramUpdate(client, 0, 'c')).ok).toBe(false);
    expect((await recordTelegramUpdate(client, 1.5, 'c')).ok).toBe(false);
    expect(calls.length).toBe(0);
    const { client: c2 } = scripted({ insert: [BOOM] });
    expect((await recordTelegramUpdate(c2, 100, 'c')).ok).toBe(false);
  });
});

describe('recoverExpiredLeasedJobs - time-fenced crash recovery', () => {
  it('requeues only leased jobs whose lease has expired (eq status + lte expiry)', async () => {
    const { client, calls } = scripted({ update: [{ data: [{ id: 'j1' }, { id: 'j2' }], error: null }] });
    const r = await recoverExpiredLeasedJobs(client, NOW);
    expect(r.recovered).toBe(2);
    expect(calls[0].row).toMatchObject({ status: 'queued' });
    expect(calls[0].filters).toContainEqual(['eq', 'status', 'leased']);
    expect(calls[0].filters).toContainEqual(['lte', 'lease_expires_at', NOW]);
  });
  it('reports zero (with the error) on a failed sweep - never throws', async () => {
    const { client } = scripted({ update: [BOOM] });
    const r = await recoverExpiredLeasedJobs(client, NOW);
    expect(r.recovered).toBe(0);
    expect(r.error).toContain('permission denied');
  });
});

describe('readSystemControlsChecked - distinguishes unreadable from stopped', () => {
  it('readOk=false on error/missing row; true with mapped controls otherwise', async () => {
    const { client } = scripted({ select: [BOOM] });
    expect((await readSystemControlsChecked(client)).readOk).toBe(false);
    const { client: c2 } = scripted({ select: [NONE] });
    expect((await readSystemControlsChecked(c2)).readOk).toBe(false);
    const { client: c3 } = scripted({ select: [{ data: [{ owner_stop: true, hermes_mode: 'disabled' }], error: null }] });
    const r = await readSystemControlsChecked(c3);
    expect(r.readOk).toBe(true);
    expect(r.controls.owner_stop).toBe(true);
  });
});

describe('read paths', () => {
  it('readLatestCheckpoint reads newest-first bounded to one', async () => {
    const cpRow = { job_id: 'j1', correlation_id: 'corr', status: 'complete' };
    const { client, calls } = scripted({ select: [{ data: [cpRow], error: null }] });
    const r = await readLatestCheckpoint(client, 'j1');
    expect(r.row).toEqual(cpRow);
    expect(calls[0].filters).toContainEqual(['eq', 'job_id', 'j1']);
    expect(calls[0].filters).toContainEqual(['order', 'created_at', false]);
  });
  it('listJobsByStatus filters by status and orders by priority desc', async () => {
    const { client, calls } = scripted({ select: [NONE] });
    await listJobsByStatus(client, 'queued', 5);
    expect(calls[0].filters).toContainEqual(['eq', 'status', 'queued']);
    expect(calls[0].filters).toContainEqual(['order', 'priority', false]);
  });
});
