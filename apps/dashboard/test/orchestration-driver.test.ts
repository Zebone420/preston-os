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
import { clearGateRpc } from './_clear-gate-rpc';
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
  (client as unknown as { rpc?: unknown }).rpc = clearGateRpc(rowsOf);
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
    expect(r.reason).toBe('owner_stop_or_paused');
    expect(r.persisted).toBe(0);
  });

  it('halts fail-closed when controls are unreadable (no row)', async () => {
    const db = makeFakeDb();
    db.rowsOf('system_controls').length = 0; // unreadable
    await seedGoal(db);
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW));
    expect(r.halted).toBe(true);
    // outage, not an owner halt - the reasons are distinct exit classes
    expect(r.reason).toBe('controls_unreadable');
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

// --- owner stop honored MID-RUN (post-lock and post-adapter gates) ----------
//
// driverStep reads system_controls THREE times per run action: at the top of
// the step (driver.ts gate 1), after acquiring the worktree lock (gate at
// "audit #9", pre-claim), and after the adapter but BEFORE persisting the
// result ("gate2"). Every pre-existing stop test flips controls BETWEEN
// steps, so only gate 1 was ever exercised - coverage showed the gate bodies
// (halt at post-lock; requeue + owner_stop_during_run /
// controls_unreadable_during_run / :requeue_deferred at gate2) had zero
// hits. These tests land the stop INSIDE the run window by flipping the
// controls row after the Nth read, and pin the kill-switch contract: a
// mid-run stop persists NO completion, appends NO evidence, and returns the
// job to a re-runnable state owned by lease recovery when the requeue loses.

function interceptControls(
  db: ReturnType<typeof makeFakeDb>,
  afterReads: number,
  effect: () => void,
) {
  let reads = 0;
  const orig = db.client.from.bind(db.client);
  (db.client as { from: RuntimeClient['from'] }).from = (table: string) => {
    if (table === 'system_controls') {
      reads += 1;
      if (reads > afterReads) effect();
    }
    return orig(table);
  };
}

function jobRow(db: ReturnType<typeof makeFakeDb>, id: string) {
  return db.rowsOf('goal_jobs').find((j) => j.id === id)!;
}

describe('owner stop honored MID-RUN (kill-switch inside a single step)', () => {
  const stopRow = (db: ReturnType<typeof makeFakeDb>) =>
    Object.assign(db.rowsOf('system_controls')[0], { owner_stop: true });

  it('stop between lock acquisition and job claim: halts, nothing runs', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    interceptControls(db, 1, () => stopRow(db)); // read 2 = post-lock gate
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('owner_stop_or_paused');
    // No job was claimed or completed; no attempt consumed; no evidence.
    for (const j of db.rowsOf('goal_jobs')) {
      expect(['in_progress', 'completed']).not.toContain(j.status);
      expect(Number(j.attempts ?? 0)).toBe(0);
      expect((j.evidence_refs as string[] | undefined) ?? []).toHaveLength(0);
    }
  });

  it('stop after the adapter, before persist: NO completion, job requeued', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    interceptControls(db, 2, () => stopRow(db)); // read 3 = gate2
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('owner_stop_during_run');
    const a = jobRow(db, 'job-0000-a');
    // Result NOT persisted: the run's outcome is discarded, the job returns
    // to ready with the lease cleared so it re-runs once the stop clears.
    expect(a.status).toBe('ready');
    expect(a.run_id).toBeNull();
    expect(a.run_lease_expires_at).toBeNull();
    expect(Number(a.attempts ?? 0)).toBe(0);
    expect((a.evidence_refs as string[] | undefined) ?? []).toHaveLength(0);
    expect(db.rowsOf('goal_jobs').some((j) => j.status === 'completed')).toBe(false);
  });

  it('unreadable control plane at the post-lock gate fails closed pre-claim', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    interceptControls(db, 1, () => { db.rowsOf('system_controls').length = 0; });
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('controls_unreadable');
    for (const j of db.rowsOf('goal_jobs')) {
      expect(['in_progress', 'completed']).not.toContain(j.status);
      expect((j.evidence_refs as string[] | undefined) ?? []).toHaveLength(0);
    }
  });

  it('pause is honored at gate2 exactly like owner_stop', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    interceptControls(db, 2, () =>
      Object.assign(db.rowsOf('system_controls')[0], { paused: true }));
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('owner_stop_during_run');
    expect(jobRow(db, 'job-0000-a').status).toBe('ready');
  });

  it('unreadable control plane mid-run fails closed, distinct reason', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    // Emptying the singleton row makes readSystemControlsChecked readOk=false.
    interceptControls(db, 2, () => { db.rowsOf('system_controls').length = 0; });
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('controls_unreadable_during_run');
    const a = jobRow(db, 'job-0000-a');
    expect(a.status).toBe('ready');
    expect((a.evidence_refs as string[] | undefined) ?? []).toHaveLength(0);
  });

  it('superseded run cannot requeue: stop + lost ownership defers to lease recovery', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    interceptControls(db, 2, () => {
      stopRow(db);
      // Another incarnation stole the row between adapter and gate2: the
      // owned requeue CAS must lose, and the halt reason must say the
      // requeue was deferred (lease recovery will reclaim it later).
      const a = db.rowsOf('goal_jobs').find((j) => j.status === 'in_progress');
      if (a) a.run_id = 'stolen-by-recovery';
    });
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW) + 1000, depends, editLockCtx);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('owner_stop_during_run:requeue_deferred');
    const a = jobRow(db, 'job-0000-a');
    // The stolen row is untouched by OUR run: no terminal status, no
    // evidence from the superseded incarnation.
    expect(a.run_id).toBe('stolen-by-recovery');
    expect(a.status).toBe('in_progress');
    expect((a.evidence_refs as string[] | undefined) ?? []).toHaveLength(0);
  });
});

// B5 liveness fix (2026-08-26, live staging finding): a goal whose wall
// deadline expired while still 'decomposed' derived a TERMINAL engine status
// that decomposed->terminal could never legally reflect, so the goal row
// stayed driveable forever and the dispatcher's oldest-first selection
// re-picked it every tick - starving every younger goal (staging goal
// ef99816e pinned the queue). The driver now routes terminal reflection
// through the legal chain decomposed -> running -> terminal.
describe('terminal reflection from decomposed (starvation liveness fix)', () => {
  it('a wall-deadline-expired decomposed goal terminalizes on the goal ROW (no goal_cas_unapplied loop)', async () => {
    const db = makeFakeDb();
    const expired: MasterGoal = {
      ...goal(),
      id: 'goal-b5-stall-01',
      correlation_id: 'corr-b5-stall-01',
      budget: { ...DEFAULT_BUDGET, max_wall_ms: 1000 },
    };
    await insertMasterGoal(db.client, expired);
    const d = decomposeGoal(expired, [
      { local_id: 'a', kind: 'documentation', title: 't', objective: 'o', depends_on_local: [] },
    ], (l) => `job-b5-stall-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);

    // Clock far past created_at + max_wall_ms: the engine's verdict is
    // terminal before any run happens.
    let t = Date.parse(NOW) + 3_600_000;
    const r = await driveGoal(db.client, 'goal-b5-stall-01', () => (t += 1000), 10, () => [], editLockCtx);

    const row = db.rowsOf('master_goals').find((g) => g.id === 'goal-b5-stall-01')!;
    // The ROW is terminal - the dispatcher will never re-select this goal.
    expect(['dead_lettered', 'failed', 'cancelled', 'completed']).toContain(String(row.status));
    expect(String(r.reason)).not.toContain('goal_cas_unapplied');
  });

  it('an all-jobs-terminal decomposed goal completes on the row through the legal chain', async () => {
    const db = makeFakeDb();
    const g2: MasterGoal = { ...goal(), id: 'goal-b5-stall-02', correlation_id: 'corr-b5-stall-02' };
    await insertMasterGoal(db.client, g2);
    const d = decomposeGoal(g2, [
      { local_id: 'a', kind: 'documentation', title: 't', objective: 'o', depends_on_local: [] },
    ], (l) => `job-b5-stall2-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);
    // Terminalize the only job out-of-band while the goal row stays decomposed.
    await transitionJob(db.client, 'job-b5-stall2-a', 'pending', 'cancelled', {}, NOW);

    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-b5-stall-02', () => (t += 1000), 10, () => [], editLockCtx);
    const row = db.rowsOf('master_goals').find((g) => g.id === 'goal-b5-stall-02')!;
    expect(String(row.status)).toBe('cancelled'); // all-terminal, anyCancelled
    expect(r.reason).toBe('cancelled');
  });
});

// Owner-approved timeout work unit (2026-08-28): the run lease is now a
// driveGoal/driverStep parameter derived (by the dispatcher) from the
// configured worker timeout, so a configured timeout can never outlive the
// lease protecting its run. These pins prove the stamp end-to-end and that
// the default is byte-identical to the prior fixed 10-minute lease.
describe('run lease duration parameter (timeout work unit)', () => {
  const captureLeases = () => {
    const seen: Array<{ leaseMs: number; lockMs: number }> = [];
    const executeReal = async (input: {
      job: { run_lease_expires_at: string | null };
      nowMs: number;
      lock: { expires_at: string };
    }) => {
      seen.push({
        leaseMs: Date.parse(String(input.job.run_lease_expires_at)) - input.nowMs,
        lockMs: Date.parse(input.lock.expires_at) - input.nowMs,
      });
      return null; // decline -> simulation completes the job as before
    };
    return { seen, executeReal };
  };

  it('default (param omitted): the stamped lease is the prior 10 minutes', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    const cap = captureLeases();
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100,
      depends, editLockCtx, undefined,
      cap.executeReal as unknown as Parameters<typeof driveGoal>[7]);
    expect(r.reason).toBe('completed');
    expect(cap.seen.length).toBeGreaterThan(0);
    for (const s of cap.seen) {
      expect(s.leaseMs).toBe(10 * 60 * 1000);
      expect(s.lockMs).toBe(10 * 60 * 1000);
    }
  });

  it('a passed runLeaseMs stamps BOTH the job lease and the executor lock expiry', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    const cap = captureLeases();
    const runLeaseMs = 50 * 60 * 1000; // e.g. 45-min timeout + 5-min margin
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100,
      depends, editLockCtx, undefined,
      cap.executeReal as unknown as Parameters<typeof driveGoal>[7],
      1, runLeaseMs);
    expect(r.reason).toBe('completed');
    expect(cap.seen.length).toBeGreaterThan(0);
    for (const s of cap.seen) {
      expect(s.leaseMs).toBe(runLeaseMs);
      expect(s.lockMs).toBe(runLeaseMs);
    }
  });

  it('lease recovery still leaves a LIVE lease alone at the stamped horizon', async () => {
    // A worker running at minute 49 of a 50-minute lease is untouchable:
    // driverStep's recovery only requeues DEFINITELY-expired leases.
    const db = makeFakeDb();
    const depends = await seedGoal(db);
    const runLeaseMs = 50 * 60 * 1000;
    const t0 = Date.parse(NOW);
    // Stamp an in_progress row with a live long lease (as a claim with the
    // derived runLeaseMs would), then step at minute 49: the job must NOT
    // be requeued (run_id preserved) - a still-running worker is safe.
    const rows = db.rowsOf('goal_jobs');
    const a = rows.find((r) => String(r.id) === 'job-0000-a')!;
    Object.assign(a, {
      status: 'in_progress', run_id: 'job-0000-a:live-run',
      run_lease_expires_at: new Date(t0 + runLeaseMs).toISOString(),
    });
    await driverStep(db.client, 'goal-00000001', t0 + 49 * 60 * 1000, depends,
      editLockCtx, undefined, undefined, 1, runLeaseMs);
    expect(String(a.run_id)).toBe('job-0000-a:live-run'); // untouched
    expect(String(a.status)).toBe('in_progress');
    // Past the horizon the same row IS recovered (existing semantics).
    await driverStep(db.client, 'goal-00000001', t0 + runLeaseMs + 1000, depends,
      editLockCtx, undefined, undefined, 1, runLeaseMs);
    expect(a.run_id ?? null).toBeNull(); // requeued for a fresh claim
  });
});
