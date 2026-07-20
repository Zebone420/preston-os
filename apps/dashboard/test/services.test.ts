import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import type { EligibilityInput } from '../src/lib/ai-os/leases';
import type { Job } from '../src/lib/ai-os/queue';
import type { ExecutionEnvelope } from '../src/lib/ai-os/runner';
import type { Checkpoint } from '../src/lib/ai-os/checkpoint';
import { normalizeCommand } from '../src/lib/ai-os/commands';
import type { HermesInput } from '../src/lib/ai-os/hermes';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  workerHealth,
  workerOnce,
  workerSimulateLoop,
  type WorkerOnceInput,
} from '../src/lib/ai-os/worker-service';
import { hermesObserveLoop } from '../src/lib/ai-os/hermes-service';

const NOW = '2026-07-14T12:00:00.000Z';

// Fake client returning a fixed controls row + write result.
function fakeClient(controlsRow: Record<string, unknown> | null, write: QueryResult = { data: [{ id: 'x' }], error: null }): RuntimeClient {
  const w = async () => write;
  const readControls = async () => ({ data: controlsRow ? [controlsRow] : [], error: null });
  return {
    from() {
      return {
        insert() {
          return { select: w };
        },
        select() {
          type EqNode = { limit: () => Promise<QueryResult>; eq: () => EqNode; order: () => { limit: () => Promise<QueryResult> } };
          const eqNode: EqNode = { limit: readControls, eq: () => eqNode, order: () => ({ limit: readControls }) };
          return { eq: () => eqNode, order: () => ({ limit: w }), limit: readControls };
        },
        update() {
          // Arbitrary-depth guard chain (releaseLease filters job_id+owner+token).
          type Node = { select: typeof w; eq: () => Node; lte: () => Node; gt: () => Node };
          const node: Node = { select: w, eq: () => node, lte: () => node, gt: () => node };
          return node;
        },
      };
    },
  };
}

const agent: AgentRecord = {
  id: 'claude-worker', display_name: 'CW', provider: 'anthropic', model: 'm',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'info@preston.nyc',
};
function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'leased', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: '2026-07-14T13:00:00.000Z',
    lease_owner: 'claude-worker', lease_token: 't', lease_expires_at: '2026-07-14T12:05:00.000Z',
    attempts: 0, max_attempts: 3, timeout_ms: 60000, retry_backoff_ms: 1000,
    idempotency_key: 'i', correlation_id: 'corr', checkpoint_ref: null, result_ref: null,
    error_class: null, execution_enabled: true, cancel_requested: false, created_at: NOW, updated_at: NOW, ...over,
  };
}
const liveControls: SystemControls = { ...DEFAULT_CONTROLS, execution_enabled: true };
function elig(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return { agent, job: job(), controls: liveControls, requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW, ...over };
}
const envelope: ExecutionEnvelope = {
  runner_id: 'r1', repo_root: '/srv/preston-os', executable: 'git', args: ['status'],
  cwd: '/srv/preston-os', timeout_ms: 60000, allow_network: false, correlation_id: 'c1',
};
const checkpoint: Checkpoint = {
  project: 'preston-os', phase: 'Phase 4B', gate: 'drill', goal: 'sim', job_id: 'j1', agent_id: 'claude-worker',
  worktree: 'wt-j1', branch: 'master', base_commit: 'a', current_commit: 'b', files_changed: [], tests_run: 'n/a',
  validation: 'n/a', blockers: [], owner_actions: [], next_action: 'none', rollback: 'n/a', correlation_id: 'corr',
  created_at: NOW, status: 'in_progress',
};
function candidate(client: RuntimeClient): WorkerOnceInput {
  return { client, cycle: { eligibility: elig({ controls: liveControls }), envelope, now: NOW }, jobId: 'j1', agentId: 'claude-worker', checkpoint, now: NOW };
}

describe('worker service - simulation only', () => {
  it('workerOnce simulates, records checkpoint+attempt, releases lease, never executes', async () => {
    const client = fakeClient({ hermes_mode: 'disabled' });
    const r = await workerOnce(candidate(client));
    expect(r.executed).toBe(false);
    expect(r.simulatedOk).toBe(true);
    expect(r.checkpointWritten).toBe(true);
    expect(r.attemptWritten).toBe(true);
    expect(r.leaseReleased).toBe(true);
  });

  it('simulate-loop halts immediately when the runtime is stopped', async () => {
    const client = fakeClient({ execution_enabled: false, owner_stop: true, hermes_mode: 'disabled' });
    const r = await workerSimulateLoop({ client, candidates: [candidate(client), candidate(client)], maxIterations: 10, now: NOW });
    expect(r.stoppedReason).toBe('halted');
    expect(r.iterations).toBe(0);
  });

  it('simulate-loop respects the maxIterations cap', async () => {
    const client = fakeClient({ execution_enabled: true, owner_stop: false, paused: false, hermes_mode: 'disabled' });
    const r = await workerSimulateLoop({ client, candidates: [candidate(client), candidate(client), candidate(client)], maxIterations: 2, now: NOW });
    expect(r.iterations).toBe(2);
    expect(r.stoppedReason).toBe('max_iterations');
  });

  it('workerHealth reports fully-stopped defaults when no controls row', async () => {
    const client = fakeClient(null);
    const h = await workerHealth(client);
    expect(h.halted).toBe(true);
    expect(h.execution_enabled).toBe(false);
  });

  it('writes a distinct attempt id per attempt + lease generation (retry history)', async () => {
    const ids: string[] = [];
    const w = async () => ({ data: [{ id: 'x' }], error: null });
    const readControls = async () => ({ data: [{ hermes_mode: 'disabled' }], error: null });
    const capturing: RuntimeClient = {
      from() {
        return {
          insert(row: Record<string, unknown>) { if (String(row['id']).startsWith('att::')) ids.push(String(row['id'])); return { select: w }; },
          select() { type EqNode = { limit: () => Promise<{ data: Record<string, unknown>[]; error: null }>; eq: () => EqNode; order: () => { limit: typeof readControls } }; const eqNode: EqNode = { limit: readControls, eq: () => eqNode, order: () => ({ limit: readControls }) }; return { eq: () => eqNode, order: () => ({ limit: w }), limit: readControls }; },
          update() { type Node = { select: typeof w; eq: () => Node; lte: () => Node; gt: () => Node }; const node: Node = { select: w, eq: () => node, lte: () => node, gt: () => node }; return node; },
        };
      },
    };
    const mk = (attempts: number, lease: string): WorkerOnceInput => ({
      client: capturing,
      cycle: { eligibility: elig({ controls: liveControls, job: job({ attempts, lease_token: lease }) }), envelope, now: NOW },
      jobId: 'j1', agentId: 'w', checkpoint, now: NOW,
    });
    await workerOnce(mk(0, 't1'));
    await workerOnce(mk(1, 't2'));
    expect(ids).toEqual(['att::j1::1::t1', 'att::j1::2::t2']);
    expect(new Set(ids).size).toBe(2);
  });

  it('releases only its own lease generation (token-scoped release filters)', async () => {
    const filters: Array<[string, unknown]> = [];
    const w = async () => ({ data: [{ id: 'x' }], error: null });
    const readControls = async () => ({ data: [{ hermes_mode: 'disabled' }], error: null });
    const client: RuntimeClient = {
      from(table: string) {
        type Node = { select: typeof w; eq: (col: string, val: unknown) => Node; lte: (col: string, val: unknown) => Node; gt: (col: string, val: unknown) => Node };
        const node: Node = {
          select: w,
          eq: (col, val) => { if (table === 'worker_leases') filters.push([col, val]); return node; },
          lte: (col, val) => { if (table === 'worker_leases') filters.push([col, val]); return node; },
          gt: (col, val) => { if (table === 'worker_leases') filters.push([col, val]); return node; },
        };
        return {
          insert() { return { select: w }; },
          select() { type EqNode = { limit: () => Promise<{ data: Record<string, unknown>[]; error: null }>; eq: () => EqNode; order: () => { limit: typeof readControls } }; const eqNode: EqNode = { limit: readControls, eq: () => eqNode, order: () => ({ limit: readControls }) }; return { eq: () => eqNode, order: () => ({ limit: w }), limit: readControls }; },
          update() { return node; },
        };
      },
    };
    const r = await workerOnce(candidate(client));
    expect(r.leaseReleased).toBe(true);
    // A stale generation must never expire a successor's lease: the release is
    // scoped to owner AND token, not owner alone.
    expect(filters).toContainEqual(['owner', 'claude-worker']);
    expect(filters).toContainEqual(['token', 't']);
  });

  it('releases nothing when the job holds no lease token', async () => {
    let leaseUpdates = 0;
    const w = async () => ({ data: [{ id: 'x' }], error: null });
    const readControls = async () => ({ data: [{ hermes_mode: 'disabled' }], error: null });
    const client: RuntimeClient = {
      from(table: string) {
        type Node = { select: typeof w; eq: () => Node; lte: () => Node; gt: () => Node };
        const node: Node = { select: w, eq: () => node, lte: () => node, gt: () => node };
        return {
          insert() { return { select: w }; },
          select() { type EqNode = { limit: () => Promise<{ data: Record<string, unknown>[]; error: null }>; eq: () => EqNode; order: () => { limit: typeof readControls } }; const eqNode: EqNode = { limit: readControls, eq: () => eqNode, order: () => ({ limit: readControls }) }; return { eq: () => eqNode, order: () => ({ limit: w }), limit: readControls }; },
          update() { if (table === 'worker_leases') leaseUpdates++; return node; },
        };
      },
    };
    const input: WorkerOnceInput = {
      client,
      cycle: { eligibility: elig({ job: job({ lease_token: null }) }), envelope, now: NOW },
      jobId: 'j1', agentId: 'claude-worker', checkpoint, now: NOW,
    };
    const r = await workerOnce(input);
    expect(r.leaseReleased).toBe(false);
    expect(leaseUpdates).toBe(0); // no lease write was even attempted
  });
});

const cmd = normalizeCommand({
  id: 'c1', actor: 'owner', source: 'dashboard', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os', correlation_id: 'corr', idempotency_key: 'i', now: NOW,
});
function hermesInput(): HermesInput {
  return { controls: { ...liveControls, hermes_mode: 'observe_only' }, command: cmd, eligibility: elig(), now: NOW };
}

describe('hermes service - observe-only, bounded', () => {
  it('loop stops immediately when Hermes is disabled (records nothing)', async () => {
    const client = fakeClient({ hermes_mode: 'disabled' });
    const r = await hermesObserveLoop(client, [[{ id: 'j1', input: hermesInput() }]], 5, NOW);
    expect(r.stoppedReason).toBe('disabled');
    expect(r.totalRecorded).toBe(0);
  });

  it('loop observes and records when in observe_only, capped by maxRounds', async () => {
    const client = fakeClient({ hermes_mode: 'observe_only' });
    const batch = [{ id: 'j1', input: hermesInput() }];
    const r = await hermesObserveLoop(client, [batch, batch, batch], 2, NOW);
    expect(r.rounds).toBe(2);
    expect(r.stoppedReason).toBe('max_rounds');
    expect(r.totalRecorded).toBe(2);
  });

  it('loop halts on a soft pause and records nothing', async () => {
    const client = fakeClient({ hermes_mode: 'observe_only', paused: true });
    const r = await hermesObserveLoop(client, [[{ id: 'j1', input: hermesInput() }]], 5, NOW);
    expect(r.stoppedReason).toBe('halted');
    expect(r.totalRecorded).toBe(0);
  });
});
