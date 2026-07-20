import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import { buildHermesObserveBatch, runStagingWorkerCycle } from '../src/lib/ai-os/staging-sim';

const NOW = '2026-07-20T12:00:00.000Z';
const LATER = '2026-07-20T13:00:00.000Z';

const OK: QueryResult = { data: [{ id: 'x' }], error: null };
const NONE: QueryResult = { data: [], error: null };
const UNIQUE: QueryResult = { data: null, error: { message: 'duplicate key value violates unique constraint' } };
const BOOM: QueryResult = { data: null, error: { message: 'permission denied' } };

const LIVE_CONTROLS = { execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'disabled', remote_runner_enabled: false };
const HALTED_CONTROLS = { ...LIVE_CONTROLS, owner_stop: true };

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

interface Call {
  op: 'insert' | 'update' | 'select';
  table: string;
  row?: Record<string, unknown>;
}

// Table-aware scripted fake: per (op,table) result queues, OK default, and a
// full call log for evidence assertions. Controls reads consume the
// 'select:system_controls' queue so halt can flip mid-batch.
function fake(script: Record<string, QueryResult[]>) {
  const calls: Call[] = [];
  const next = (op: string, table: string): QueryResult => script[`${op}:${table}`]?.shift() ?? OK;
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

const controls = (rows: Record<string, unknown>[]) => rows.map((r) => ({ data: [r], error: null }));
let n = 0;
const tokens = () => 'tok-' + ++n;

function opts(over: Partial<Parameters<typeof runStagingWorkerCycle>[1]> = {}) {
  return { agent, maxJobs: 5, leaseTtlMs: 120000, now: NOW, tokenFactory: tokens, ...over };
}

describe('runStagingWorkerCycle - evidence-producing, fail-closed, fenced', () => {
  it('produces the full evidence chain for one queued job (executed never true)', async () => {
    n = 0;
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE], // upsert falls through to insert
      'select:job_checkpoints': [NONE],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.halted).toBe(false);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]).toMatchObject({
      jobId: 'j1', outcome: 'simulated', leaseVia: 'fresh',
      attemptWritten: true, checkpointWritten: true, completed: true,
    });
    // Evidence rows actually written, generation-fenced attempt id included.
    const attempt = calls.find((c) => c.op === 'insert' && c.table === 'job_attempts');
    expect(attempt?.row?.id).toBe('att::j1::1::tok-1');
    expect(calls.some((c) => c.op === 'insert' && c.table === 'job_checkpoints')).toBe(true);
    const lease = calls.find((c) => c.op === 'insert' && c.table === 'worker_leases');
    expect(lease?.row).toMatchObject({ job_id: 'j1', owner: 'preston-worker', token: 'tok-1' });
    // Final CAS: leased -> checkpointed with the attempt counted.
    const finals = calls.filter((c) => c.op === 'update' && c.table === 'os_jobs');
    expect(finals.at(-1)?.row).toMatchObject({ status: 'checkpointed', attempts: 1 });
  });

  it('cannot steal a live lease: lease_unavailable, zero job/attempt writes', async () => {
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'insert:worker_leases': [UNIQUE],
      'update:worker_leases': [NONE], // takeover finds no expired row
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.evidence[0].outcome).toBe('lease_unavailable');
    // Only the recovery sweep touched os_jobs; the job was never marked leased.
    expect(calls.filter((c) => c.op === 'update' && c.table === 'os_jobs' && c.row?.status === 'leased')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'job_attempts')).toHaveLength(0);
  });

  it('takes over an expired lease and completes (leaseVia takeover)', async () => {
    const { client } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'insert:worker_leases': [UNIQUE],
      'update:worker_leases': [OK, OK], // takeover CAS wins, then release
      'select:job_checkpoints': [NONE],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.evidence[0]).toMatchObject({ outcome: 'simulated', leaseVia: 'takeover', completed: true });
  });

  it('compensates and skips when the job CAS is lost (no attempt written)', async () => {
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'update:os_jobs': [NONE, NONE], // recovery sweep (no rows), then queued -> leased CAS loses
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.evidence[0].outcome).toBe('lost_race');
    // Compensating release of the just-acquired lease generation:
    expect(calls.filter((c) => c.op === 'update' && c.table === 'worker_leases')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'job_attempts')).toHaveLength(0);
  });

  it('is idempotent after a crash: a matching complete checkpoint skips rework', async () => {
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [{ data: [{ job_id: 'j1', correlation_id: 'corr-1', status: 'complete' }], error: null }],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.evidence[0]).toMatchObject({ outcome: 'skipped_completed', attemptWritten: false, completed: true });
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'job_attempts')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'job_checkpoints')).toHaveLength(0);
  });

  it('rejects corrupt/stale checkpoints fail-closed (nothing written)', async () => {
    for (const bad of [
      { job_id: 'j1', correlation_id: 'corr-1', status: 'garbage' },
      { job_id: 'other', correlation_id: 'corr-1', status: 'complete' },
      { job_id: 'j1', correlation_id: 'stale', status: 'in_progress' },
    ]) {
      const { client, calls } = fake({
        'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
        'select:os_jobs': [{ data: [jobRow()], error: null }],
        'update:agents': [NONE],
        'select:job_checkpoints': [{ data: [bad], error: null }],
      });
      const r = await runStagingWorkerCycle(client, opts());
      expect(r.evidence[0].outcome).toBe('resume_rejected');
      expect(calls.filter((c) => c.op === 'insert' && c.table === 'job_attempts')).toHaveLength(0);
    }
  });

  it('requeues (attempt counted) when the simulation is blocked', async () => {
    const noCode = { ...agent, capabilities: [] }; // capability gate fails -> blocked
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [NONE],
    });
    const r = await runStagingWorkerCycle(client, opts({ agent: noCode }));
    expect(r.evidence[0]).toMatchObject({ outcome: 'requeued', attemptWritten: true, completed: false });
    const finals = calls.filter((c) => c.op === 'update' && c.table === 'os_jobs');
    expect(finals.at(-1)?.row).toMatchObject({ status: 'queued', attempts: 1 });
  });

  it('halts mid-batch the moment controls flip (second candidate never runs)', async () => {
    const { client } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS, HALTED_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow(), jobRow({ id: 'j2', idempotency_key: 'i2' })], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [NONE],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.halted).toBe(true);
    expect(r.evidence).toHaveLength(1);
  });

  it('does nothing at all when halted at cycle start', async () => {
    const { client, calls } = fake({ 'select:system_controls': controls([HALTED_CONTROLS]) });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r).toMatchObject({ halted: true, considered: 0, evidence: [] });
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });

  it('treats an UNREADABLE control plane as halted (halt gate fails closed)', async () => {
    const { client, calls } = fake({ 'select:system_controls': [BOOM] });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r).toMatchObject({ halted: true, considered: 0, evidence: [] });
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0); // no write of any kind
  });

  it('halts mid-batch when the controls read starts FAILING (not just when halted)', async () => {
    const { client } = fake({
      'select:system_controls': [...controls([LIVE_CONTROLS, LIVE_CONTROLS]), BOOM],
      'select:os_jobs': [{ data: [jobRow(), jobRow({ id: 'j2', idempotency_key: 'i2' })], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [NONE],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.halted).toBe(true);
    expect(r.evidence).toHaveLength(1);
  });

  it('rejects fail-closed when the checkpoint READ errors (no rework on a blind spot)', async () => {
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS, LIVE_CONTROLS]),
      'select:os_jobs': [{ data: [jobRow()], error: null }],
      'update:agents': [NONE],
      'select:job_checkpoints': [BOOM],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.evidence[0].outcome).toBe('resume_rejected');
    expect(r.evidence[0].reason).toContain('checkpoint read failed');
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'job_attempts')).toHaveLength(0);
  });

  it('sweeps expired-lease strandings back to queued at cycle start (crash recovery)', async () => {
    const { client, calls } = fake({
      'select:system_controls': controls([LIVE_CONTROLS]),
      'update:os_jobs': [{ data: [{ id: 'j-stranded' }], error: null }], // the sweep matches one row
      'select:os_jobs': [NONE], // queue empty this cycle
      'update:agents': [NONE],
    });
    const r = await runStagingWorkerCycle(client, opts());
    expect(r.recovered).toBe(1);
    const sweep = calls.find((c) => c.op === 'update' && c.table === 'os_jobs');
    expect(sweep?.row).toMatchObject({ status: 'queued' });
    expect(sweep?.row && 'attempts' in sweep.row).toBe(false); // attempts untouched by recovery
  });
});

describe('buildHermesObserveBatch - read-only assembly', () => {
  it('maps queued jobs to observe candidates with no command and no writes', async () => {
    const { client, calls } = fake({
      'select:system_controls': controls([{ ...LIVE_CONTROLS, hermes_mode: 'observe_only' }]),
      'select:os_jobs': [{ data: [jobRow()], error: null }, NONE],
    });
    const batch = await buildHermesObserveBatch(client, agent, 5, NOW);
    expect(batch).toHaveLength(1);
    expect(batch[0].id).toBe('j1');
    expect(batch[0].input.command).toBeNull();
    expect(calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('also observes CHECKPOINTED jobs, so worker-first timing cannot erase the decision evidence', async () => {
    const { client } = fake({
      'select:system_controls': controls([{ ...LIVE_CONTROLS, hermes_mode: 'observe_only' }]),
      'select:os_jobs': [NONE, { data: [jobRow({ id: 'j-done', idempotency_key: 'i9', status: 'checkpointed' })], error: null }],
    });
    const batch = await buildHermesObserveBatch(client, agent, 5, NOW);
    expect(batch.map((c) => c.id)).toEqual(['j-done']);
    // The candidate carries the JOB's correlation id so the decision/event rows
    // stay linkable to the drill chain (orchestrator falls back to it).
    expect(batch[0].input.eligibility.job.correlation_id).toBe('corr-1');
  });

  it('fails closed to an empty batch when the control plane is unreadable', async () => {
    const { client, calls } = fake({ 'select:system_controls': [BOOM] });
    expect(await buildHermesObserveBatch(client, agent, 5, NOW)).toEqual([]);
    expect(calls.filter((c) => c.table === 'os_jobs')).toHaveLength(0);
  });
});
