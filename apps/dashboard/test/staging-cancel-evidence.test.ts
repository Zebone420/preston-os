import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import { requestJobCancel } from '../src/lib/ai-os/store';
import { runStagingWorkerCycle } from '../src/lib/ai-os/staging-sim';

// Preston AI OS - staging worker OWNER-CANCEL and EVIDENCE contracts.
//
// The staging worker cycle (dispatcher `worker-loop`, shipped in
// deploy/systemd/preston-worker.service) is simulation-only and never
// executes anything, but it owns two durable contracts that had no
// behavioral coverage:
//
//   1. OWNER CANCEL. requestJobCancel deliberately sets a flag and never
//      touches status/leases - "the worker/dispatcher loop remains solely
//      responsible for observing the flag and stopping at its own next
//      safe checkpoint". `leased` is a cancellable status, so a cancel can
//      land WHILE a job is leased. The cycle reads os_jobs exactly once
//      (listJobsByStatus) and every later check runs off that snapshot, so
//      the observation must happen in the terminal write itself.
//
//   2. EVIDENCE. The cycle exists to produce evidence (checkpoint +
//      attempt rows). A job may not reach the drill-terminal
//      'checkpointed' status - which selection never re-picks - unless
//      its evidence actually persisted.
//
// Both are pinned here behaviorally: each test fails against the
// pre-repair code (cancel overrun / terminal-without-evidence).

const NOW = '2026-07-20T12:00:00.000Z';
const LATER = '2026-07-20T13:00:00.000Z';

const NONE: QueryResult = { data: [], error: null };
const BOOM: QueryResult = { data: null, error: { message: 'permission denied' } };

const LIVE_CONTROLS = {
  id: 'global', execution_enabled: false, owner_stop: false, paused: false,
  hermes_mode: 'disabled', remote_runner_enabled: false, updated_at: NOW,
};

function jobRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'queued', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: LATER, lease_owner: null, lease_token: null,
    lease_expires_at: null, attempts: 0, max_attempts: 3, timeout_ms: 60000,
    retry_backoff_ms: 1000, idempotency_key: 'i1', correlation_id: 'corr-1',
    checkpoint_ref: null, result_ref: null, error_class: null, execution_enabled: false,
    cancel_requested: false, created_at: NOW, updated_at: NOW, ...over,
  };
}

const agent: AgentRecord = {
  id: 'preston-worker', display_name: 'W', provider: 'anthropic', model: 'dispatcher',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'owner',
};

// Row-honoring fake (the orchestration-durable idiom): eq() filters are
// applied to LIVE rows, so a CAS guard is genuinely exercised rather than
// scripted. The scripted fake in staging-sim.test.ts ignores filters and
// therefore cannot demonstrate a fencing condition.
function makeRowDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  rowsOf('system_controls').push({ ...LIVE_CONTROLS });
  const hooks: Array<{ op: string; table: string; fn: () => void | Promise<void> }> = [];
  // Awaited so an interception that itself performs DB work is guaranteed to
  // have landed before the intercepted operation resolves - the hook must not
  // depend on how many awaits happen to sit downstream in production code.
  const fire = async (op: string, table: string) => {
    for (let i = hooks.length - 1; i >= 0; i--) {
      if (hooks[i].op === op && hooks[i].table === table) {
        const [h] = hooks.splice(i, 1);
        await h.fn();
      }
    }
  };
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return {
            async select() {
              await fire('insert', table);
              const rows = rowsOf(table);
              if (row.id !== undefined && rows.some((r) => r.id === row.id)) {
                return {
                  data: null,
                  error: { message: 'duplicate key value violates unique constraint' },
                };
              }
              rows.push({ ...row });
              return { data: [{ id: row.id ?? 'x' }], error: null };
            },
          };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: unknown) {
              return chain([...f, (r) => String(r[c]) === String(v)]);
            },
            order() {
              return {
                async limit(n: number) {
                  await fire('select', table);
                  return {
                    data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n),
                    error: null,
                  };
                },
              };
            },
            async limit(n: number) {
              await fire('select', table);
              return {
                data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n),
                error: null,
              };
            },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: unknown) {
              return chain([...f, (r) => String(r[c]) === String(v)]);
            },
            lte(c: string, v: unknown) {
              return chain([...f, (r) => String(r[c] ?? '') <= String(v)]);
            },
            gt(c: string, v: unknown) {
              return chain([...f, (r) => String(r[c] ?? '') > String(v)]);
            },
            async select() {
              await fire('update', table);
              const matched = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of matched) Object.assign(r, patch);
              return { data: matched.map((r) => ({ id: r.id })), error: null };
            },
          });
          return chain([]);
        },
      };
    },
  };
  // Run fn once, just before the next matching operation resolves.
  const onceBefore = (op: string, table: string, fn: () => void) =>
    hooks.push({ op, table, fn });
  return { client, rowsOf, onceBefore };
}

const opts = (over: Record<string, unknown> = {}) => ({
  agent, maxJobs: 5, leaseTtlMs: 120000, now: NOW,
  tokenFactory: () => 'tok-1', ...over,
});

describe('owner cancel landing MID-LEASE is honored before completion', () => {
  it('a job cancelled after selection never reaches the terminal status', async () => {
    const db = makeRowDb();
    db.rowsOf('os_jobs').push(jobRow());
    // The owner cancels while the worker holds the lease: requestJobCancel
    // matches the `leased` arm and flips ONLY the flag, leaving status and
    // lease intact - exactly the production race. Fire it just before the
    // checkpoint insert, i.e. after the cycle's single os_jobs read and
    // after the lease was taken.
    db.onceBefore('insert', 'job_checkpoints', async () => {
      const out = await requestJobCancel(db.client, 'j1', NOW);
      expect(out.ok).toBe(true); // the cancel really landed on the leased row
    });

    const r = await runStagingWorkerCycle(db.client, opts());

    const row = db.rowsOf('os_jobs')[0];
    expect(row.cancel_requested).toBe(true); // flag observed mid-run
    expect(row.status).toBe('leased'); // lease intact; cancel changes no status
    // Fail closed: the cancelled job must NOT be driven to the drill's
    // terminal status, which selection never re-picks.
    expect(row.status).not.toBe('checkpointed');
    expect(r.evidence[0]?.completed).toBe(false);
    expect(r.evidence[0]?.outcome).toBe('completion_refused');
  });

  it('an uncancelled job still completes normally (guard is not over-broad)', async () => {
    const db = makeRowDb();
    db.rowsOf('os_jobs').push(jobRow());

    const r = await runStagingWorkerCycle(db.client, opts());

    expect(db.rowsOf('os_jobs')[0].status).toBe('checkpointed');
    expect(r.evidence[0]).toMatchObject({ outcome: 'simulated', completed: true });
  });

  it('a job cancelled BEFORE the cycle is rejected at selection, never leased', async () => {
    const db = makeRowDb();
    db.rowsOf('os_jobs').push(jobRow({ cancel_requested: true }));

    const r = await runStagingWorkerCycle(db.client, opts());

    expect(r.evidence).toHaveLength(0);
    expect(r.rejected.map((x) => x.id)).toContain('j1');
    expect(db.rowsOf('os_jobs')[0].status).toBe('queued');
    expect(db.rowsOf('worker_leases')).toHaveLength(0);
  });
});

describe('a job may not reach the terminal status without durable evidence', () => {
  // Scripted-failure idiom (staging-sim.test.ts): drive the evidence
  // inserts to fail while the simulation itself succeeds.
  function scriptedDb(script: Record<string, QueryResult[]>) {
    const calls: Array<{ op: string; table: string; row?: Record<string, unknown> }> = [];
    const next = (op: string, table: string): QueryResult =>
      script[`${op}:${table}`]?.shift() ?? { data: [{ id: 'x' }], error: null };
    const client: RuntimeClient = {
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            calls.push({ op: 'insert', table, row });
            return { select: async () => next('insert', table) };
          },
          update(row: Record<string, unknown>) {
            calls.push({ op: 'update', table, row });
            type Node = {
              select: () => Promise<QueryResult>;
              eq: (c: string, v: unknown) => Node;
              lte: (c: string, v: unknown) => Node;
              gt: (c: string, v: unknown) => Node;
            };
            const node: Node = {
              select: async () => next('update', table),
              eq: () => node, lte: () => node, gt: () => node,
            };
            return node;
          },
          select() {
            calls.push({ op: 'select', table });
            const limit = async () => next('select', table);
            type Node = {
              limit: (n: number) => Promise<QueryResult>;
              eq: (c: string, v: unknown) => Node;
              order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<QueryResult> };
            };
            const node: Node = { limit, eq: () => node, order: () => ({ limit }) };
            return node;
          },
        };
      },
    };
    return { client, calls };
  }

  const controlsQueue = () => [
    { data: [{ ...LIVE_CONTROLS }], error: null },
    { data: [{ ...LIVE_CONTROLS }], error: null },
  ];

  it('checkpoint write failure blocks completion and requeues instead', async () => {
    const { client, calls } = scriptedDb({
      'select:system_controls': controlsQueue(),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [NONE],
      'insert:job_checkpoints': [BOOM],
    });

    const r = await runStagingWorkerCycle(client, opts());

    expect(r.evidence[0]?.checkpointWritten).toBe(false);
    expect(r.evidence[0]?.completed).toBe(false);
    // The terminal transition must not have happened; the job goes back to
    // the queue so a later cycle can produce its evidence.
    const jobUpdates = calls.filter((c) => c.op === 'update' && c.table === 'os_jobs');
    expect(jobUpdates.some((c) => c.row?.status === 'checkpointed')).toBe(false);
    expect(jobUpdates.at(-1)?.row).toMatchObject({ status: 'queued' });
  });

  it('attempt write failure blocks completion and requeues instead', async () => {
    const { client, calls } = scriptedDb({
      'select:system_controls': controlsQueue(),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [NONE],
      'insert:job_attempts': [BOOM],
    });

    const r = await runStagingWorkerCycle(client, opts());

    expect(r.evidence[0]?.attemptWritten).toBe(false);
    expect(r.evidence[0]?.completed).toBe(false);
    const jobUpdates = calls.filter((c) => c.op === 'update' && c.table === 'os_jobs');
    expect(jobUpdates.some((c) => c.row?.status === 'checkpointed')).toBe(false);
  });

  it('with evidence intact the job still completes (guard is not over-broad)', async () => {
    const { client, calls } = scriptedDb({
      'select:system_controls': controlsQueue(),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [NONE],
    });

    const r = await runStagingWorkerCycle(client, opts());

    expect(r.evidence[0]).toMatchObject({
      outcome: 'simulated', checkpointWritten: true, attemptWritten: true, completed: true,
    });
    const jobUpdates = calls.filter((c) => c.op === 'update' && c.table === 'os_jobs');
    expect(jobUpdates.at(-1)?.row).toMatchObject({ status: 'checkpointed', attempts: 1 });
  });
});
