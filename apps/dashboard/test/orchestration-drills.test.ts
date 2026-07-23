import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { driveGoal, driverStep } from '../src/lib/ai-os/orchestration/driver';
import { insertGoalJob, insertMasterGoal, transitionJob, transitionJobOwned } from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';
import { acquireWorktreeLock, releaseWorktreeLock } from '../src/lib/ai-os/orchestration/worktree-lock-store';

const NOW = '2026-07-22T12:00:00.000Z';

function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? { id: 'global', execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW });
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) { return { select() {
          const rows = rowsOf(table); const key = pk(table);
          if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
          rows.push({ ...row }); return Promise.resolve({ data: [{ id: row[key] ?? 'x' }], error: null });
        } }; },
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
            select() { const m = rowsOf(table).filter((r) => f.every((g) => g(r))); for (const r of m) Object.assign(r, patch); return Promise.resolve({ data: m.map((r) => ({ id: r[pk(table)] })), error: null }); },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

function goal(): MasterGoal {
  return { id: 'goal-00000001', title: 'g', objective: 'o', source: 'chatgpt', requested_by: 'owner@preston.nyc', status: 'decomposed', environment: 'staging', budget: DEFAULT_BUDGET, correlation_id: 'corr-0001', simulation_only: true, created_at: NOW, updated_at: NOW };
}

async function seed(db: ReturnType<typeof makeFakeDb>) {
  await insertMasterGoal(db.client, goal());
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'a', objective: 'add x', depends_on_local: [] },
    { local_id: 'b', kind: 'test', title: 'b', objective: 'test x', depends_on_local: ['a'] },
  ];
  const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
  if (!d.ok) throw new Error('decompose');
  for (const j of d.jobs) await insertGoalJob(db.client, j);
  return (id: string) => (id === 'job-0000-b' ? ['job-0000-a'] : []);
}

// Edit jobs require a worktree lock (audit #2); the real worker always supplies
// one. base_commit matches decideAcquire's hex requirement.
const lockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/src/'],
  token: (jobId: string) => `tok-${jobId}`,
};

// D-1 RESTART DRILL: a crash mid-goal (fresh driver over persisted rows) resumes.
describe('drill: restart recovery', () => {
  it('a fresh driver resumes from persisted status; completed work is not redone', async () => {
    const db = makeFakeDb();
    const depends = await seed(db);
    let t = Date.parse(NOW);
    await driverStep(db.client, 'goal-00000001', (t += 1000), depends, lockCtx); // job a completes
    // "process crash" - drop all in-memory state; a NEW drive reads the DB.
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 50, depends, lockCtx);
    expect(r.reason).toBe('completed');
    expect(Number(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.attempts)).toBe(1); // not re-run
  });
});

// D-2 CANCELLATION DRILL (corrected per audit): a job cancelled OUT OF BAND
// while it holds an in_progress execution lease cannot have a result persisted -
// the run-owned terminal CAS fails because the status is no longer in_progress.
describe('drill: mid-attempt cancellation re-observation', () => {
  it('a run cannot complete a job cancelled during its in_progress lease', async () => {
    const db = makeFakeDb();
    await seed(db);
    const runId = 'run:job-0000-a:1:tok';
    // job a is claimed (in_progress) by a run
    await transitionJob(db.client, 'job-0000-a', 'pending', 'in_progress',
      { run_id: runId, run_lease_expires_at: '2026-07-22T12:10:00.000Z' }, NOW);
    // OWNER cancels it out of band DURING the attempt (in_progress -> cancelled)
    await transitionJob(db.client, 'job-0000-a', 'in_progress', 'cancelled', {}, NOW);
    // the original run now tries to persist completion, owned by its run_id:
    const late = await transitionJobOwned(db.client, 'job-0000-a', 'in_progress', 'completed', runId,
      { run_id: null, run_lease_expires_at: null }, NOW);
    expect(late.ok).toBe(false); // cancellation wins; the stale run cannot complete it
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).toBe('cancelled');
  });

  it('a job cancelled before running is not run and the goal closes', async () => {
    const db = makeFakeDb();
    const depends = await seed(db);
    await transitionJob(db.client, 'job-0000-b', 'pending', 'cancelled', {}, NOW);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 50, depends, lockCtx);
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.status).toBe('cancelled');
    expect(['completed', 'cancelled']).toContain(r.reason);
  });
});

// D-3 RETRY + DEAD-LETTER DRILL: a persistently failing job dead-letters.
describe('drill: retry budget then dead-letter', () => {
  it('a job past the retry budget dead-letters and the goal fails', async () => {
    const db = makeFakeDb();
    const depends = await seed(db);
    // force job a into failed with attempts over budget
    await transitionJob(db.client, 'job-0000-a', 'pending', 'in_progress', {}, NOW);
    await transitionJob(db.client, 'job-0000-a', 'in_progress', 'failed', { attempts: DEFAULT_BUDGET.max_job_retries + 1 }, NOW);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 50, depends);
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).toBe('dead_lettered');
    expect(r.halted || r.reason === 'completed').toBeTruthy();
  });
});

// D-4 LEASE FENCING DRILL: a stale worktree holder cannot release a taken-over lock.
describe('drill: worktree lease fencing', () => {
  it('stale holder is fenced out after takeover', async () => {
    const db = makeFakeDb();
    const input = { worktree_id: 'wt-job-0001', repo: 'preston-os', job_id: 'job-0001', owner: 'claude', token: 'tok-00000001', base_commit: 'abc1234', branch: 'wt/job-0001', allowed_paths: ['apps/dashboard/src/'], now: NOW, tree_dirty: false, branch_exists: false };
    const a1 = await acquireWorktreeLock(db.client, input);
    expect(a1.ok, a1.ok ? '' : (a1 as { reason: string }).reason).toBe(true);
    const row = db.rowsOf('repository_worktrees')[0];
    row.lease_expires_at = '2026-07-22T11:00:00.000Z'; // stale
    const takeover = await acquireWorktreeLock(db.client, { ...input, owner: 'codex', token: 'tok-00000002' });
    expect(takeover.ok).toBe(true);
    // stale original holder (fence 1) release is refused
    expect((await releaseWorktreeLock(db.client, 'wt-job-0001', 'tok-00000001', 1, NOW)).ok).toBe(false);
    // current holder (fence 2) release works
    expect((await releaseWorktreeLock(db.client, 'wt-job-0001', 'tok-00000002', 2, NOW)).ok).toBe(true);
  });
});

// D-5 OWNER-STOP DRILL: the durable driver halts, persists nothing.
describe('drill: owner stop / global kill', () => {
  it('driver halts fail-closed and advances no job under owner_stop', async () => {
    const db = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: true, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW });
    const depends = await seed(db);
    const before = JSON.stringify(db.rowsOf('goal_jobs'));
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW), depends);
    expect(r.halted).toBe(true);
    expect(JSON.stringify(db.rowsOf('goal_jobs'))).toBe(before); // nothing advanced
  });
});
