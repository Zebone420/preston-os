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
  insertJobApproval,
  insertMasterGoal,
  transitionJob,
  transitionJobOwned,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { canonicalActionHash, jobApprovalEnvelope } from '../src/lib/ai-os/orchestration/crypto-binding';
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

// Edit-capable jobs (code/test) require a worktree lock (audit #2), so the
// drive-to-completion tests supply the lock context the real deployed worker
// always has. base_commit matches decideAcquire's hex requirement.
const editLockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/src/'],
  token: (jobId: string) => `tok-${jobId}`,
};

describe('durable driver - persists transitions, restart-safe, fail-closed', () => {
  it('drives a persisted GREEN goal to completion in simulation (with lock)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends, editLockCtx);
    expect(r.reason).toBe('completed');
    expect(db.rowsOf('goal_jobs').every((j) => j.status === 'completed')).toBe(true);
    // executed never set true
    expect(db.rowsOf('goal_jobs').every((j) => j.executed === false)).toBe(true);
  });

  it('fails closed: an edit job never runs without a lock context (#2)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db); // code + test jobs (edit kinds)
    let t = Date.parse(NOW);
    // no lockCtx => edit jobs must not run; the driver halts, does NOT complete
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('lock_context_required');
    // no job was driven to completion without its isolation lock
    expect(db.rowsOf('goal_jobs').some((j) => j.status === 'completed')).toBe(false);
  });

  it('is restart-safe: a fresh driver resumes from persisted status', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    // one step: job a runs+completes (under its lock)
    await driverStep(db.client, 'goal-00000001', (t += 1000), depends, editLockCtx);
    const mid = await loadGoalState(db.client, 'goal-00000001', depends);
    const aDone = mid!.jobs.find((j) => j.id === 'job-0000-a')!.status === 'completed';
    expect(aDone).toBe(true);
    // "restart": brand-new driver call over the SAME persisted rows resumes;
    // job a stays completed (not re-run), job b now completes.
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends, editLockCtx);
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

describe('driver - recovery, iteration, terminal reflection (audit #3/#4/#12/#14)', () => {
  it('recovers an orphaned in_progress job (expired run lease) back to ready (#4)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    // strand job a as in_progress under an EXPIRED execution lease (crashed run)
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    a.status = 'in_progress';
    a.run_id = 'run:job-0000-a:0:x';
    a.run_lease_expires_at = '2026-07-22T11:00:00.000Z'; // in the past
    // one step WITHOUT lockCtx: recovery requeues it to ready, then the edit
    // job cannot run (no lock) - so it ends at 'ready', NOT stuck in_progress.
    await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends);
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).toBe('ready');
  });

  it('does NOT recover an in_progress job with a live lease (fail-closed) (#4)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    a.status = 'in_progress';
    a.run_id = 'run:job-0000-a:0:x';
    a.run_lease_expires_at = '2026-07-22T13:00:00.000Z'; // still valid (future)
    await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends);
    // live lease => left in_progress (a genuinely running worker is not disturbed)
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).toBe('in_progress');
  });

  it('persists the durable iteration (reserved before work) (#12)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    await driverStep(db.client, 'goal-00000001', (t += 1000), depends, editLockCtx);
    expect(Number(db.rowsOf('master_goals')[0].iteration)).toBeGreaterThanOrEqual(1);
  });

  it('reports failed (not completed) and reflects it on the goal row (#14)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    // realistic: the goal reached 'running' before its jobs became terminal.
    db.rowsOf('master_goals')[0].status = 'running';
    // terminal but NOT all-completed: a dead-lettered + a completed
    db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status = 'dead_lettered';
    db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.status = 'completed';
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends, editLockCtx);
    expect(r.reason).toMatch(/^failed/); // NOT 'completed'
    expect(db.rowsOf('master_goals')[0].status).toBe('failed');
  });

  it('incarnation fencing: a stale run cannot complete a job a NEW run re-claimed (BLOCKER)', async () => {
    const db = makeFakeDb();
    await seedGoal(db);
    const runA = 'job-0000-a:incarnation-A';
    const runC = 'job-0000-a:incarnation-C';
    // A claims job a (in_progress under runA)
    await transitionJob(db.client, 'job-0000-a', 'pending', 'in_progress',
      { run_id: runA, run_lease_expires_at: '2026-07-22T11:00:00.000Z' /* already stale */ }, NOW);
    // recovery requeues a -> ready (owned by runA, clears run_id)
    await transitionJobOwned(db.client, 'job-0000-a', 'in_progress', 'ready', runA,
      { run_id: null, run_lease_expires_at: null }, NOW);
    // a NEW incarnation C claims the ready job
    await transitionJob(db.client, 'job-0000-a', 'ready', 'in_progress',
      { run_id: runC, run_lease_expires_at: '2026-07-22T12:10:00.000Z' }, NOW);
    // the OLD run A resumes and tries to persist its stale result, owned by runA:
    const lateA = await transitionJobOwned(db.client, 'job-0000-a', 'in_progress', 'completed', runA,
      { run_id: null, run_lease_expires_at: null }, NOW);
    expect(lateA.ok).toBe(false); // run_id mismatch: A cannot complete C's incarnation
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).toBe('in_progress');
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.run_id).toBe(runC);
  });

  it('each claim gets a globally unique run_id (no time/token derivation)', async () => {
    const produced: string[] = [];
    const gen = (() => { let n = 0; return () => { const id = `uuid-${n++}`; produced.push(id); return id; }; })();
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    let t = Date.parse(NOW);
    await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, depends, editLockCtx, gen);
    // two edit jobs => at least two claims => at least two ids, ALL distinct
    expect(produced.length).toBeGreaterThanOrEqual(2);
    expect(new Set(produced).size).toBe(produced.length); // every claim id is unique
  });

  it('does not persist completion when a newer fence superseded it (#3)', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    a.status = 'ready'; // ready to run
    // Pre-seat a FOREIGN live lock on job a's worktree at a higher generation
    // than the driver will acquire, and make the driver's own acquire a no-op by
    // having the row already held by another owner -> the run is skipped, so job
    // a stays ready (never force-completed under a superseded/foreign lock).
    db.rowsOf('repository_worktrees').push({
      id: 'wt-job-0000-a', repo: 'preston-os', job_id: 'job-0000-a', agent: 'codex',
      path: '/srv/worktrees/wt-job-0000-a', base_commit: 'abc1234',
      target_branch: 'wt/job-0000-a', lock_id: 'foreign#9', fence: 9,
      allowed_paths: ['apps/dashboard/src/'], status: 'in_use',
      lease_expires_at: '2026-07-22T13:00:00.000Z', updated_at: NOW,
    });
    await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).not.toBe('completed');
  });
});

describe('driver - canonical SHA-256 approval binding + execution expiry (#7/#8)', () => {
  function seedGatedJob(db: ReturnType<typeof makeFakeDb>, hash: string, expiresAt: string) {
    // a RED migration job parked awaiting owner approval
    db.rowsOf('goal_jobs').push({
      id: 'job-0000-g', goal_id: 'goal-00000001', kind: 'migration', title: 'apply',
      objective: 'apply 0011', risk_class: 'RED', assigned_role: 'claude',
      status: 'awaiting_approval', attempts: 0, requires_approval: true,
      approval_id: 'apr-00000009', runtime_job_id: null, correlation_id: 'corr-0001',
      evidence_refs: [], failure_reason: null, created_at: NOW, updated_at: NOW,
    });
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-00000009', goal_id: 'goal-00000001', job_id: 'job-0000-g',
      status: 'approved', owner_identity: 'owner@preston.nyc', action_hash: hash,
      environment: 'staging', nonce: 'n9', decided_at: NOW, created_at: NOW, expires_at: expiresAt,
    });
  }
  const expiresAt = '2026-07-22T12:30:00.000Z';
  const goodHash = canonicalActionHash(jobApprovalEnvelope({
    approval_id: 'apr-00000009', job_kind: 'migration', job_id: 'job-0000-g',
    job_objective: 'apply 0011', job_title: 'apply', risk_class: 'RED',
    assigned_role: 'claude', owner_identity: 'owner@preston.nyc',
    created_at: NOW, expires_at: expiresAt,
  }));

  it('clears a gated job when a CANONICAL-hash approval binds the exact action (#8)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    seedGatedJob(db, goodHash, expiresAt);
    // execute BEFORE expiry
    await driverStep(db.client, 'goal-00000001', Date.parse('2026-07-22T12:05:00.000Z'), () => []);
    const j = db.rowsOf('goal_jobs').find((x) => x.id === 'job-0000-g')!;
    expect(j.status).toBe('ready');
    expect(j.requires_approval).toBe(false);
  });

  it('does NOT clear a gated job when the hash does not bind the action (#8)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    seedGatedJob(db, 'not-the-canonical-hash', expiresAt);
    await driverStep(db.client, 'goal-00000001', Date.parse('2026-07-22T12:05:00.000Z'), () => []);
    const j = db.rowsOf('goal_jobs').find((x) => x.id === 'job-0000-g')!;
    expect(j.status).toBe('awaiting_approval');
    expect(j.requires_approval).toBe(true);
  });

  // Every action-defining field must be bound (BLOCKER): approve action A, then
  // mutate one field so the executed action differs - the approval must NOT clear.
  for (const mut of [
    { field: 'title', value: 'sneaky-title' },      // title bound even when objective set
    { field: 'objective', value: 'apply 0099' },
    { field: 'kind', value: 'code' },
    { field: 'risk_class', value: 'GREEN' },
    { field: 'assigned_role', value: 'codex' },      // executing role bound
  ] as const) {
    it(`does NOT clear when "${mut.field}" was changed after approval (BLOCKER)`, async () => {
      const db = makeFakeDb();
      await insertMasterGoal(db.client, goal());
      seedGatedJob(db, goodHash, expiresAt); // hash bound to the ORIGINAL action
      // owner-facing action swapped after the approval was issued
      db.rowsOf('goal_jobs').find((x) => x.id === 'job-0000-g')![mut.field] = mut.value;
      await driverStep(db.client, 'goal-00000001', Date.parse('2026-07-22T12:05:00.000Z'), () => []);
      const j = db.rowsOf('goal_jobs').find((x) => x.id === 'job-0000-g')!;
      expect(j.status).toBe('awaiting_approval'); // swapped action cannot inherit the approval
    });
  }

  it('end-to-end: insertJobApproval derives the hash so the driver clears it (BLOCKER)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    // gated job (no pre-seeded approval)
    db.rowsOf('goal_jobs').push({
      id: 'job-0000-g', goal_id: 'goal-00000001', kind: 'migration', title: 'apply',
      objective: 'apply 0011', risk_class: 'RED', assigned_role: 'claude',
      status: 'awaiting_approval', attempts: 0, requires_approval: true,
      approval_id: 'apr-00000009', runtime_job_id: null, correlation_id: 'corr-0001',
      evidence_refs: [], failure_reason: null, created_at: NOW, updated_at: NOW,
    });
    // creation derives the hash INTERNALLY from the job - no caller-supplied hash
    const ins = await insertJobApproval(db.client, {
      approval_id: 'apr-00000009', goal_id: 'goal-00000001',
      job: { id: 'job-0000-g', kind: 'migration', objective: 'apply 0011', title: 'apply', risk_class: 'RED', assigned_role: 'claude' },
      owner_identity: 'owner@preston.nyc', created_at: NOW, expires_at: expiresAt,
    });
    expect(ins.ok).toBe(true);
    // owner decides it approved
    Object.assign(db.rowsOf('orchestration_approvals')[0], { status: 'approved', decided_at: NOW, nonce: 'n9' });
    await driverStep(db.client, 'goal-00000001', Date.parse('2026-07-22T12:05:00.000Z'), () => []);
    expect(db.rowsOf('goal_jobs').find((x) => x.id === 'job-0000-g')!.status).toBe('ready');
  });

  it('does NOT clear a gated job whose approval expired by execution time (#7)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    seedGatedJob(db, goodHash, expiresAt);
    // execute AFTER expiry (12:45 > 12:30): correct hash, but expired now
    await driverStep(db.client, 'goal-00000001', Date.parse('2026-07-22T12:45:00.000Z'), () => []);
    const j = db.rowsOf('goal_jobs').find((x) => x.id === 'job-0000-g')!;
    expect(j.status).toBe('awaiting_approval');
  });

  it('halts fail-closed on a non-finite execution clock', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    const r = await driverStep(db.client, 'goal-00000001', Number.NaN, () => []);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('execution_clock_invalid');
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
