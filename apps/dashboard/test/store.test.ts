import { describe, expect, it } from 'vitest';
import { normalizeCommand } from '../src/lib/ai-os/commands';
import { DEFAULT_CONTROLS } from '../src/lib/ai-os/controls';
import { makeEnvelope } from '../src/lib/ai-os/transport';
import {
  RUNTIME_TABLES,
  insertAttempt,
  insertCommandPacket,
  insertDeadLetter,
  insertEvent,
  insertJob,
  insertMemory,
  insertOrchestrationDecision,
  readSystemControls,
  releaseLease,
  updateJobStatus,
  type QueryResult,
  type RuntimeClient,
} from '../src/lib/ai-os/store';

const NOW = '2026-07-14T12:00:00.000Z';

interface Captured {
  table: string;
  op: 'insert' | 'select' | 'update';
  row?: Record<string, unknown>;
  filters?: Array<[string, unknown]>;
}

// Fake RuntimeClient capturing every call, returning a scripted result across
// insert().select(), select().eq()/.order()/.limit(), and update().eq()[.eq()].select().
function fakeClient(result: QueryResult): { client: RuntimeClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const thenable = async () => result;
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, op: 'insert', row });
          return { select: thenable };
        },
        select() {
          calls.push({ table, op: 'select' });
          return {
            eq() {
              return { limit: thenable };
            },
            order() {
              return { limit: thenable };
            },
            limit: thenable,
          };
        },
        update(row: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = [];
          calls.push({ table, op: 'update', row, filters });
          // Arbitrary-depth eq chain, capturing every (column, value) filter.
          type Node = { select: () => Promise<QueryResult>; eq: (col: string, val: unknown) => Node };
          const node: Node = {
            select: thenable,
            eq(col: string, val: unknown) { filters.push([col, val]); return node; },
          };
          return node;
        },
      };
    },
  };
  return { client, calls };
}

const okResult: QueryResult = { data: [{ id: 'row-1' }], error: null };
const errResult = (message: string): QueryResult => ({ data: null, error: { message } });

const cmd = normalizeCommand({
  id: 'c1', actor: 'owner', source: 'chatgpt', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os',
  correlation_id: 'corr', idempotency_key: 'idem-1', now: NOW,
});

describe('store adapters - command packets', () => {
  it('writes to runtime_command_packets, NEVER legacy command_packets', () => {
    expect(RUNTIME_TABLES.commandPackets).toBe('runtime_command_packets');
    expect(RUNTIME_TABLES.commandPackets).not.toBe('command_packets');
  });

  it('inserts a valid packet and forces execution_eligible=false on write', async () => {
    const { client, calls } = fakeClient(okResult);
    const r = await insertCommandPacket(client, cmd);
    expect(r.ok).toBe(true);
    expect(calls[0].table).toBe('runtime_command_packets');
    expect(calls[0].row?.execution_eligible).toBe(false);
  });

  it('rejects an invalid (eligible-at-intake) packet before any write', async () => {
    const { client, calls } = fakeClient(okResult);
    const r = await insertCommandPacket(client, { ...cmd, execution_eligible: true });
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0); // never touched the DB
  });

  it('treats a unique-violation as an idempotent success', async () => {
    const { client } = fakeClient(errResult('duplicate key value violates unique constraint'));
    const r = await insertCommandPacket(client, cmd);
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
  });

  it('fails closed on a non-idempotent DB error', async () => {
    const { client } = fakeClient(errResult('permission denied for table runtime_command_packets'));
    const r = await insertCommandPacket(client, cmd);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('permission denied');
  });
});

describe('store adapters - system controls (fail-closed reads)', () => {
  it('returns DEFAULT_CONTROLS (fully stopped) when the row is missing', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await readSystemControls(client)).toEqual(DEFAULT_CONTROLS);
  });

  it('returns DEFAULT_CONTROLS on an RLS/permission error', async () => {
    const { client } = fakeClient(errResult('permission denied for table system_controls'));
    const c = await readSystemControls(client);
    expect(c.execution_enabled).toBe(false);
    expect(c.hermes_mode).toBe('disabled');
    expect(c.remote_runner_enabled).toBe(false);
  });

  it('maps a live row and coerces unknown hermes_mode to disabled', async () => {
    const { client } = fakeClient({
      data: [{ execution_enabled: true, owner_stop: false, paused: false, hermes_mode: 'bogus', remote_runner_enabled: true, updated_at: NOW }],
      error: null,
    });
    const c = await readSystemControls(client);
    expect(c.execution_enabled).toBe(true);
    expect(c.remote_runner_enabled).toBe(true);
    expect(c.hermes_mode).toBe('disabled'); // unknown -> fail-closed
  });
});

describe('store adapters - events', () => {
  it('rejects an event carrying an unredacted secret', async () => {
    const { client, calls } = fakeClient(okResult);
    const bad = { ...makeEnvelope({ id: 'e1', type: 'TaskCreated', actor: 'a', source: 's', correlation_id: 'c', idempotency_key: 'k', now: NOW }), payload: { api_key: 'sk-raw' } };
    const r = await insertEvent(client, bad);
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('writes a clean event to os_events', async () => {
    const { client, calls } = fakeClient(okResult);
    const e = makeEnvelope({ id: 'e1', type: 'TaskCreated', actor: 'a', source: 's', correlation_id: 'c', idempotency_key: 'k', now: NOW, payload: { note: 'ok' } });
    const r = await insertEvent(client, e);
    expect(r.ok).toBe(true);
    expect(calls[0].table).toBe('os_events');
  });
});

describe('store adapters - remaining runtime tables', () => {
  it('exposes distinct, unique table names', () => {
    const vals = Object.values(RUNTIME_TABLES);
    expect(new Set(vals).size).toBe(vals.length);
    expect(RUNTIME_TABLES.jobs).toBe('os_jobs');
    expect(RUNTIME_TABLES.memory).toBe('agent_memory');
  });

  it('insertJob targets os_jobs and forces execution_enabled=false', async () => {
    const { client, calls } = fakeClient(okResult);
    const r = await insertJob(client, { id: 'j1', command_id: 'c1', correlation_id: 'corr', idempotency_key: 'k', risk_class: 'GREEN', expires_at: NOW, not_before: NOW });
    expect(r.ok).toBe(true);
    expect(calls[0].table).toBe('os_jobs');
    expect(calls[0].row?.execution_enabled).toBe(false);
  });

  it('updateJobStatus is a conditional CAS - zero matched rows fails closed', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    const r = await updateJobStatus(client, 'j1', 'queued', 'leased', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('lost race');
    expect(calls[0].op).toBe('update');
  });

  it('releaseLease updates worker_leases guarded by owner AND lease token', async () => {
    const { client, calls } = fakeClient(okResult);
    await releaseLease(client, 'j1', 'w1', 'tok-1', NOW);
    expect(calls[0].table).toBe('worker_leases');
    expect(calls[0].op).toBe('update');
    // Token guard fences the lease generation: a stale release must not be
    // able to expire a successor's live lease (owner match alone is not enough).
    expect(calls[0].filters).toContainEqual(['job_id', 'j1']);
    expect(calls[0].filters).toContainEqual(['owner', 'w1']);
    expect(calls[0].filters).toContainEqual(['token', 'tok-1']);
  });

  it('insertMemory redacts secret-shaped values before write', async () => {
    const { client, calls } = fakeClient(okResult);
    await insertMemory(client, { id: 'm1', memory_type: 'decision', key: 'k', value: { client_secret: 'x', note: 'ok' }, actor: 'a', source: 's', version: 1, correlation_id: 'c' });
    expect(calls[0].table).toBe('agent_memory');
    expect((calls[0].row?.value as Record<string, unknown>).client_secret).toBe('[REDACTED]');
    expect((calls[0].row?.value as Record<string, unknown>).note).toBe('ok');
  });

  it('insertMemory rejects a secret-shaped key before any write', async () => {
    const { client, calls } = fakeClient(okResult);
    const r = await insertMemory(client, { id: 'm2', memory_type: 'connector', key: 'openai_api_key', value: {}, actor: 'a', source: 's', version: 1, correlation_id: 'c' });
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('append-only writers target their tables', async () => {
    const { client, calls } = fakeClient(okResult);
    await insertDeadLetter(client, { id: 'd1', reason: 'x', correlation_id: 'c' });
    await insertOrchestrationDecision(client, { id: 'o1', hermes_mode: 'observe_only', decision: 'observe', reasons: [], correlation_id: 'c' });
    await insertAttempt(client, { id: 'a1', job_id: 'j1', attempt_no: 1, worker: 'w', correlation_id: 'c' });
    expect(calls.map((c) => c.table)).toEqual(['dead_letters', 'orchestration_decisions', 'job_attempts']);
  });
});
