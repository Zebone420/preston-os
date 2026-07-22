import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  decideApproval,
  insertGoalJob,
  insertMasterGoal,
  listJobsForGoal,
  persistDecomposedGoal,
  transitionGoal,
  transitionJob,
  verifyAuthoritativeApproval,
} from '../src/lib/ai-os/orchestration/store';
import {
  canTransitionGoal,
  canTransitionJob,
  isTerminalJob,
} from '../src/lib/ai-os/orchestration/transitions';
import {
  canRelease,
  decideAcquire,
  fenceValid,
  pathAllowed,
  type WorktreeLock,
} from '../src/lib/ai-os/orchestration/worktree-lock';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-07-22T12:00:00.000Z';

// Fake RuntimeClient enforcing PK uniqueness + CAS eq() semantics.
function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              const rows = rowsOf(table);
              const key = pk(table);
              if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
                return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
              }
              // simulate unique(nonce) on approvals decide
              if (table === 'orchestration_approvals' && row.nonce && rows.some((r) => r.nonce && r.nonce === row.nonce)) {
                return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint (nonce)' } });
              }
              rows.push({ ...row });
              return Promise.resolve({ data: [{ id: row[key] ?? 'x', approval_id: row.approval_id }], error: null });
            },
          };
        },
        select() {
          const chain = (filters: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(col: string, val: string) { return chain([...filters, (r) => String(r[col]) === val]); },
            order() { return { limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => filters.every((f) => f(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => filters.every((f) => f(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (filters: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(col: string, val: string) { return chain([...filters, (r) => String(r[col]) === val]); },
            lte() { return chain(filters); },
            gt() { return chain(filters); },
            select() {
              // enforce unique(nonce) on approval decide
              if (table === 'orchestration_approvals' && patch.nonce) {
                if (rowsOf(table).some((r) => r.nonce === patch.nonce)) {
                  return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint (nonce)' } });
                }
              }
              const matched = rowsOf(table).filter((r) => filters.every((f) => f(r)));
              for (const r of matched) Object.assign(r, patch);
              const key = pk(table);
              return Promise.resolve({ data: matched.map((r) => ({ id: r[key], approval_id: r.approval_id })), error: null });
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
    requested_by: 'owner@preston.nyc', status: 'proposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-0001', simulation_only: true,
    created_at: NOW, updated_at: NOW,
  };
}

describe('durable store - simulation pins forced, idempotent, CAS', () => {
  it('forces simulation_only + environment on goal insert and is idempotent', async () => {
    const db = makeFakeDb();
    const bad = { ...goal(), simulation_only: false as never, environment: 'production' as never };
    // validation rejects the tampered goal before any write
    expect((await insertMasterGoal(db.client, bad)).ok).toBe(false);
    const ok = await insertMasterGoal(db.client, goal());
    expect(ok.ok).toBe(true);
    const dup = await insertMasterGoal(db.client, goal());
    expect(dup.duplicate).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    expect(db.rowsOf('master_goals')[0].simulation_only).toBe(true);
    expect(db.rowsOf('master_goals')[0].environment).toBe('staging');
  });

  it('forces executed:false on job insert', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    const specs: TaskSpec[] = [{ local_id: 'a', kind: 'code', title: 't', objective: 'add', depends_on_local: [] }];
    const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    const j = await insertGoalJob(db.client, d.jobs[0]);
    expect(j.ok).toBe(true);
    expect(db.rowsOf('goal_jobs')[0].executed).toBe(false);
  });

  it('persists a decomposed goal with dependency edges', async () => {
    const db = makeFakeDb();
    const specs: TaskSpec[] = [
      { local_id: 'a', kind: 'code', title: 'a', objective: 'x', depends_on_local: [] },
      { local_id: 'b', kind: 'test', title: 'b', objective: 'y', depends_on_local: ['a'] },
    ];
    const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    const state = { goal: { ...goal(), status: 'decomposed' as const }, jobs: d.jobs, iteration: 0, started_at: NOW };
    const r = await persistDecomposedGoal(db.client, state);
    expect(r.ok).toBe(true);
    expect(db.rowsOf('goal_jobs')).toHaveLength(2);
    expect(db.rowsOf('job_dependencies')).toHaveLength(1);
    const list = await listJobsForGoal(db.client, 'goal-00000001');
    expect(list.rows).toHaveLength(2);
  });

  it('CAS transition only fires from the expected status; rejects illegal edges', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    // illegal transition rejected before any write
    const illegal = await transitionGoal(db.client, 'goal-00000001', 'proposed', 'completed', NOW);
    expect(illegal.ok).toBe(false);
    const legal = await transitionGoal(db.client, 'goal-00000001', 'proposed', 'decomposed', NOW);
    expect(legal.ok).toBe(true);
    // stale from-status loses CAS
    const stale = await transitionGoal(db.client, 'goal-00000001', 'proposed', 'decomposed', NOW);
    expect(stale.ok).toBe(false);
  });

  it('job transition applies patch fields under CAS', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    const specs: TaskSpec[] = [{ local_id: 'a', kind: 'code', title: 't', objective: 'add', depends_on_local: [] }];
    const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    await insertGoalJob(db.client, d.jobs[0]);
    const t = await transitionJob(db.client, 'job-0000-a', 'pending', 'assigned', { assigned_role: 'claude' }, NOW);
    expect(t.ok).toBe(true);
    expect(db.rowsOf('goal_jobs')[0].status).toBe('assigned');
  });
});

describe('durable approval decision - one-time, durable nonce replay', () => {
  it('decides pending->approved once; replay by nonce or status fails', async () => {
    const db = makeFakeDb();
    db.rowsOf('orchestration_approvals').push({ approval_id: 'apr-00000001', status: 'pending', nonce: null });
    const first = await decideApproval(db.client, 'apr-00000001', 'approved', 'nonce-1', NOW);
    expect(first.ok).toBe(true);
    expect(db.rowsOf('orchestration_approvals')[0].status).toBe('approved');
    // second decision: no longer pending
    const second = await decideApproval(db.client, 'apr-00000001', 'rejected', 'nonce-2', NOW);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('not_pending');
    // a different pending approval reusing an already-seen nonce fails on unique(nonce)
    db.rowsOf('orchestration_approvals').push({ approval_id: 'apr-00000002', status: 'pending', nonce: null });
    const replay = await decideApproval(db.client, 'apr-00000002', 'approved', 'nonce-1', NOW);
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe('nonce_replay');
  });
  it('requires a nonce', async () => {
    const db = makeFakeDb();
    db.rowsOf('orchestration_approvals').push({ approval_id: 'a', status: 'pending' });
    expect((await decideApproval(db.client, 'a', 'approved', '', NOW)).ok).toBe(false);
  });
});

describe('authoritative approval verification - fail closed (P7-CX-01 defect A)', () => {
  const job = { id: 'job-0000-a', goal_id: 'goal-00000001', approval_id: 'apr-00000001' };
  const expected = { owner_identity: 'owner@preston.nyc', action_hash: 'abc12345' };
  const goodRecord = {
    approval_id: 'apr-00000001', status: 'approved', owner_identity: 'owner@preston.nyc',
    action_hash: 'abc12345', job_id: 'job-0000-a', goal_id: 'goal-00000001',
    environment: 'staging', nonce: 'n1', decided_at: NOW, expires_at: '2026-07-22T12:15:00.000Z',
  };
  it('accepts only a fully-bound, approved, non-expired record', () => {
    expect(verifyAuthoritativeApproval(goodRecord, job, expected).ok).toBe(true);
  });
  it('rejects forged/absent/mismatched records (no bare-id unlock)', () => {
    expect(verifyAuthoritativeApproval(undefined, job, expected).reason).toBe('no_approval_record');
    expect(verifyAuthoritativeApproval(goodRecord, { ...job, approval_id: null }, expected).reason).toBe('job_has_no_approval_id');
    expect(verifyAuthoritativeApproval({ ...goodRecord, status: 'pending' }, job, expected).reason).toBe('not_approved');
    expect(verifyAuthoritativeApproval({ ...goodRecord, owner_identity: 'intruder' }, job, expected).reason).toBe('owner_mismatch');
    expect(verifyAuthoritativeApproval({ ...goodRecord, action_hash: 'deadbeef' }, job, expected).reason).toBe('action_hash_mismatch');
    expect(verifyAuthoritativeApproval({ ...goodRecord, job_id: 'other' }, job, expected).reason).toBe('job_scope_mismatch');
    expect(verifyAuthoritativeApproval({ ...goodRecord, goal_id: 'other' }, job, expected).reason).toBe('goal_scope_mismatch');
    expect(verifyAuthoritativeApproval({ ...goodRecord, environment: 'production' }, job, expected).reason).toBe('environment_mismatch');
    expect(verifyAuthoritativeApproval({ ...goodRecord, nonce: null }, job, expected).reason).toBe('nonce_missing');
    expect(verifyAuthoritativeApproval({ ...goodRecord, decided_at: 'bad' }, job, expected).reason).toBe('decision_timestamp_invalid');
    expect(verifyAuthoritativeApproval({ ...goodRecord, decided_at: '2026-07-22T12:20:00.000Z' }, job, expected).reason).toBe('decision_expired');
  });
});

describe('transition graphs - fail closed', () => {
  it('goal + job legal/illegal edges', () => {
    expect(canTransitionGoal('running', 'completed')).toBe(true);
    expect(canTransitionGoal('completed', 'running')).toBe(false); // terminal
    expect(canTransitionJob('failed', 'ready')).toBe(true); // retry
    expect(canTransitionJob('completed', 'ready')).toBe(false);
    expect(canTransitionJob('pending', 'completed')).toBe(false); // must pass through
    expect(isTerminalJob('dead_lettered')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
function acquireInput(over: Record<string, unknown> = {}) {
  return {
    worktree_id: 'wt-job-0001', repo: 'preston-os', job_id: 'job-0001',
    owner: 'claude', token: 'tok-00000001', base_commit: 'abc1234',
    branch: 'wt/job-0001', allowed_paths: ['apps/dashboard/src/'],
    now: NOW, tree_dirty: false, branch_exists: false, existing: null,
    ...over,
  };
}

describe('worktree lock - atomic allocation, collisions, fencing', () => {
  it('acquires a clean lock and pins base commit + branch', () => {
    const r = decideAcquire(acquireInput());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.lock.fence).toBe(1); expect(r.lock.base_commit).toBe('abc1234'); }
  });

  it('rejects a dirty tree and a branch collision', () => {
    expect(decideAcquire(acquireInput({ tree_dirty: true })).ok).toBe(false);
    expect(decideAcquire(acquireInput({ branch_exists: true })).ok).toBe(false);
  });

  it('rejects unsafe paths and non-wt branches', () => {
    expect(decideAcquire(acquireInput({ allowed_paths: ['../etc'] })).ok).toBe(false);
    expect(decideAcquire(acquireInput({ allowed_paths: ['/abs'] })).ok).toBe(false);
    expect(decideAcquire(acquireInput({ branch: 'main' })).ok).toBe(false);
    expect(decideAcquire(acquireInput({ allowed_paths: [] })).ok).toBe(false);
    expect(decideAcquire(acquireInput({ base_commit: 'nothex!' })).ok).toBe(false);
  });

  it('concurrent allocation: second holder is refused a live lock', () => {
    const first = decideAcquire(acquireInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // another agent tries to take the same worktree while it is live
    const second = decideAcquire(acquireInput({ owner: 'codex', token: 'tok-00000002', existing: first.lock }));
    expect(second.ok).toBe(false);
    expect((second as { reason: string }).reason).toBe('held_by_another');
  });

  it('stale-lock takeover bumps the fence; revived stale holder is fenced out', () => {
    const first = decideAcquire(acquireInput());
    if (!first.ok) return;
    const staleLock: WorktreeLock = { ...first.lock, expires_at: '2026-07-22T11:00:00.000Z' }; // expired
    const takeover = decideAcquire(acquireInput({ owner: 'codex', token: 'tok-00000002', existing: staleLock }));
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) return;
    expect(takeover.lock.fence).toBe(2); // higher fence wins
    // the revived original holder tries to act with the old fence -> rejected
    expect(fenceValid(takeover.lock, first.lock.fence)).toBe(false);
    expect(fenceValid(takeover.lock, takeover.lock.fence)).toBe(true);
  });

  it('path allowlist + release require the current fenced owner+token', () => {
    const r = decideAcquire(acquireInput());
    if (!r.ok) return;
    expect(pathAllowed(r.lock, 'apps/dashboard/src/lib/x.ts')).toBe(true);
    expect(pathAllowed(r.lock, 'apps/dashboard/other.ts')).toBe(false);
    expect(pathAllowed(r.lock, '../escape')).toBe(false);
    expect(canRelease(r.lock, 'claude', 'tok-00000001', r.lock.fence)).toBe(true);
    expect(canRelease(r.lock, 'codex', 'tok-00000001', r.lock.fence)).toBe(false);
    expect(canRelease(r.lock, 'claude', 'tok-00000001', 999)).toBe(false); // wrong fence
  });
});
