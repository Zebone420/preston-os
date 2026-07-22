import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  driveGoal,
  driverStep,
  loadGoalState,
} from '../src/lib/ai-os/orchestration/driver';
import {
  acquireWorktreeLock,
  releaseWorktreeLock,
  decodeLockId,
} from '../src/lib/ai-os/orchestration/worktree-lock-store';
import {
  insertGoalJob,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-07-22T12:00:00.000Z';

// Fake DB that also serves system_controls (fully-stopped-safe default: the
// controls row present with owner_stop=false so the durable worker may run
// SIMULATION jobs). Reuses PK-uniqueness + CAS eq semantics.
function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? {
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row[key] ?? 'x' }], error: null });
          } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() {
              const matched = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({ data: matched.map((r) => ({ id: r[pk(table)] })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

function goal(): MasterGoal {
  return {
    id: 'goal-00000001', title: 'g', objective: 'o', source: 'chatgpt',
    requested_by: 'owner@preston.nyc', status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-0001', simulation_only: true,
    created_at: NOW, updated_at: NOW,
  };
}

async function seedGoal(db: ReturnType<typeof makeFakeDb>) {
  await insertMasterGoal(db.client, goal());
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'impl', objective: 'add helper', depends_on_local: [] },
    { local_id: 'b', kind: 'test', title: 'test', objective: 'test helper', depends_on_local: ['a'] },
  ];
  const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
  if (!d.ok) throw new Error('decompose');
  for (const j of d.jobs) await insertGoalJob(db.client, j);
  // dependency map: job-0000-b depends on job-0000-a
  return (jobId: string) => (jobId === 'job-0000-b' ? ['job-0000-a'] : []);
}

describe('durable driver - persists transitions, restart-safe, fail-closed', () => {
  it('drives a persisted GREEN goal to completion in simulation', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends);
    expect(r.reason).toBe('completed');
    expect(db.rowsOf('goal_jobs').every((j) => j.status === 'completed')).toBe(true);
    // executed never set true
    expect(db.rowsOf('goal_jobs').every((j) => j.executed === false)).toBe(true);
  });

  it('is restart-safe: a fresh driver resumes from persisted status', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    // one step: job a runs+completes
    await driverStep(db.client, 'goal-00000001', (t += 1000), depends);
    const mid = await loadGoalState(db.client, 'goal-00000001', depends);
    const aDone = mid!.jobs.find((j) => j.id === 'job-0000-a')!.status === 'completed';
    expect(aDone).toBe(true);
    // "restart": brand-new driver call over the SAME persisted rows resumes;
    // job a stays completed (not re-run), job b now completes.
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends);
    expect(r.reason).toBe('completed');
    // job a attempts did not increase beyond its single run (idempotent resume)
    expect(Number(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.attempts)).toBe(1);
  });

  it('halts fail-closed on owner_stop', async () => {
    const db = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: true, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW });
    await seedGoal(db);
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW));
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('owner_stop_or_unreadable');
    expect(r.persisted).toBe(0);
  });

  it('halts fail-closed when controls are unreadable (no row)', async () => {
    const db = makeFakeDb();
    db.rowsOf('system_controls').length = 0; // unreadable
    await seedGoal(db);
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW));
    expect(r.halted).toBe(true);
  });
});

describe('driver + worktree lock integration', () => {
  const lockCtx = {
    base_commit: 'abc1234',
    allowed_paths: ['apps/dashboard/src/'],
    token: (jobId: string) => `tok-${jobId}`,
  };

  it('acquires and releases a worktree lock around each implementation run', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends, lockCtx);
    expect(r.reason).toBe('completed');
    // a worktree_workflows row exists per implementation job, released after use
    const wts = db.rowsOf('repository_worktrees');
    expect(wts.length).toBeGreaterThan(0);
    // all released (unassigned) at completion - no dangling live lock
    expect(wts.every((w) => w.status === 'unassigned')).toBe(true);
  });

  it('skips a run when the worktree is already held by another (concurrent)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    // pre-hold job a's worktree with a live foreign lock
    db.rowsOf('repository_worktrees').push({
      id: 'wt-job-0000-a', repo: 'preston-os', job_id: 'job-0000-a', agent: 'codex',
      base_commit: 'abc1234', target_branch: 'wt/job-0000-a',
      lock_id: 'foreign#1', status: 'assigned',
      lease_expires_at: '2026-07-22T13:00:00.000Z', updated_at: NOW,
    });
    let t = Date.parse(NOW);
    // one step: job a cannot run (worktree held) -> stays pending
    await driverStep(db.client, 'goal-00000001', (t += 1000), depends, lockCtx);
    const aStatus = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status;
    expect(aStatus).toBe('pending'); // run was skipped, not forced
  });
});

describe('store-backed worktree lock - atomic, fenced, concurrent-safe', () => {
  const baseInput = {
    worktree_id: 'wt-job-0001', repo: 'preston-os', job_id: 'job-0001',
    owner: 'claude', token: 'tok-00000001', base_commit: 'abc1234',
    branch: 'wt/job-0001', allowed_paths: ['apps/dashboard/src/'],
    now: NOW, tree_dirty: false, branch_exists: false,
  };

  it('first acquire inserts; a concurrent second acquire loses the race', async () => {
    const db = makeFakeDb();
    const first = await acquireWorktreeLock(db.client, baseInput);
    expect(first.ok).toBe(true);
    expect(db.rowsOf('repository_worktrees')).toHaveLength(1);
    expect(decodeLockId(String(db.rowsOf('repository_worktrees')[0].lock_id))!.fence).toBe(1);
    // a different agent tries the SAME worktree while live -> refused
    const second = await acquireWorktreeLock(db.client, { ...baseInput, owner: 'codex', token: 'tok-00000002' });
    expect(second.ok).toBe(false);
  });

  it('stale takeover bumps the fence and fences the old holder out of release', async () => {
    const db = makeFakeDb();
    await acquireWorktreeLock(db.client, baseInput);
    // make it stale by rewriting the row's lease far in the past
    const row = db.rowsOf('repository_worktrees')[0];
    row.expires_at = '2026-07-22T11:00:00.000Z';
    row.lease_expires_at = '2026-07-22T11:00:00.000Z';
    const takeover = await acquireWorktreeLock(db.client, { ...baseInput, owner: 'codex', token: 'tok-00000002' });
    expect(takeover.ok).toBe(true);
    if (takeover.ok) expect(takeover.lock.fence).toBe(2);
    // the OLD holder tries to release with fence 1 -> fenced out
    const oldRelease = await releaseWorktreeLock(db.client, 'wt-job-0001', 'tok-00000001', 1, NOW);
    expect(oldRelease.ok).toBe(false);
    // the new holder releases correctly
    const newRelease = await releaseWorktreeLock(db.client, 'wt-job-0001', 'tok-00000002', 2, NOW);
    expect(newRelease.ok).toBe(true);
    expect(db.rowsOf('repository_worktrees')[0].status).toBe('unassigned');
  });

  it('rejects dirty tree and branch collision before any write', async () => {
    const db = makeFakeDb();
    expect((await acquireWorktreeLock(db.client, { ...baseInput, tree_dirty: true })).ok).toBe(false);
    expect((await acquireWorktreeLock(db.client, { ...baseInput, branch_exists: true })).ok).toBe(false);
    expect(db.rowsOf('repository_worktrees')).toHaveLength(0);
  });
});
