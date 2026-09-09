import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  insertGoalJob,
  insertMasterGoal,
  recoverStrandedChildJobs,
  transitionJob,
} from '../src/lib/ai-os/orchestration/store';
import { DEFAULT_BUDGET, type GoalJob, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

// M1: terminal-parent/nonterminal-child stale-state recovery. The dispatcher
// only ever selects driveable-status goals, so once a goal is terminal,
// driveGoal/driverStep (including its own in_progress lease recovery) never
// runs for it again. recoverStrandedChildJobs is the standalone sweep that
// closes that gap. Fake DB copied from orchestration-driver.test.ts (same
// CAS/eq semantics as the real RuntimeClient).

const NOW = '2026-09-09T12:00:00.000Z';

function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
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

function goal(id: string, status: MasterGoal['status']): MasterGoal {
  return {
    id, title: 'g', objective: 'o', source: 'chatgpt', requested_by: 'owner-0001',
    status, environment: 'staging', budget: DEFAULT_BUDGET, correlation_id: `c-${id}`,
    simulation_only: true, created_at: NOW, updated_at: NOW,
  };
}

function job(id: string, goalId: string, status: GoalJob['status']): GoalJob {
  return {
    id, goal_id: goalId, kind: 'code', title: 't', objective: 'o', risk_class: 'GREEN',
    assigned_role: null, depends_on: [], status, attempts: 0, requires_approval: false,
    approval_id: null, runtime_job_id: null, correlation_id: `c-${id}`, evidence_refs: [],
    failure_reason: null, created_at: NOW, updated_at: NOW,
  };
}

async function seedTerminalGoalWithJob(
  goalStatus: MasterGoal['status'], jobStatus: GoalJob['status'], extraPatch?: Record<string, unknown>,
) {
  const db = makeFakeDb();
  await insertMasterGoal(db.client, goal('goal-aaaaaaaa', goalStatus));
  await insertGoalJob(db.client, job('job-aaaaaaaa', 'goal-aaaaaaaa', 'pending'));
  if (jobStatus !== 'pending') {
    await transitionJob(db.client, 'job-aaaaaaaa', 'pending', jobStatus, extraPatch ?? {}, NOW);
  } else if (extraPatch) {
    Object.assign(db.rowsOf('goal_jobs')[0], extraPatch);
  }
  return db;
}

describe('M1 recoverStrandedChildJobs', () => {
  it('cancels a ready child stranded under a dead_lettered (max_iterations) goal', async () => {
    const db = await seedTerminalGoalWithJob('dead_lettered', 'ready');
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r).toEqual({ recovered: 1, scanned: 1 });
    expect(db.rowsOf('goal_jobs')[0].status).toBe('cancelled');
    expect(db.rowsOf('goal_jobs')[0].failure_reason).toBe('stranded_under_terminal_goal');
  });

  it('cancels a child stranded under a deadline-exceeded (also dead_lettered) goal', async () => {
    const db = await seedTerminalGoalWithJob('dead_lettered', 'assigned');
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r.recovered).toBe(1);
    expect(db.rowsOf('goal_jobs')[0].status).toBe('cancelled');
  });

  it('detects and recovers a stuck-graph child (pending, no dependency progress) under a terminal goal', async () => {
    const db = await seedTerminalGoalWithJob('failed', 'pending');
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r.recovered).toBe(1);
    expect(db.rowsOf('goal_jobs')[0].status).toBe('cancelled');
  });

  it('recovers an in_progress child whose lease has DEFINITELY expired', async () => {
    const db = await seedTerminalGoalWithJob('cancelled', 'in_progress', {
      run_id: 'run-1', run_lease_expires_at: '2026-09-09T11:00:00.000Z', // 1h before NOW
    });
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r.recovered).toBe(1);
    const row = db.rowsOf('goal_jobs')[0];
    expect(row.status).toBe('cancelled');
    expect(row.run_id).toBeNull();
    expect(row.run_lease_expires_at).toBeNull();
  });

  it('preserves an active (unexpired) lease - never touches a live in_progress run', async () => {
    const db = await seedTerminalGoalWithJob('cancelled', 'in_progress', {
      run_id: 'run-1', run_lease_expires_at: '2026-09-09T13:00:00.000Z', // 1h after NOW
    });
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r).toEqual({ recovered: 0, scanned: 1 });
    expect(db.rowsOf('goal_jobs')[0].status).toBe('in_progress');
  });

  it('handles a null run_id on an in_progress child without crashing, and does not recover it (fail-closed)', async () => {
    const db = await seedTerminalGoalWithJob('cancelled', 'in_progress', {
      run_id: null, run_lease_expires_at: '2026-09-09T11:00:00.000Z', // expired
    });
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r).toEqual({ recovered: 0, scanned: 1 });
    expect(db.rowsOf('goal_jobs')[0].status).toBe('in_progress');
  });

  it('is idempotent: a second replay recovers nothing further', async () => {
    const db = await seedTerminalGoalWithJob('dead_lettered', 'ready');
    await recoverStrandedChildJobs(db.client, NOW);
    const second = await recoverStrandedChildJobs(db.client, NOW);
    expect(second).toEqual({ recovered: 0, scanned: 0 });
  });

  it('is restart-safe: a fresh call against the same durable rows converges identically (no process state)', async () => {
    const db = await seedTerminalGoalWithJob('failed', 'awaiting_review');
    const first = await recoverStrandedChildJobs(db.client, NOW);
    // Simulate a process restart: a brand-new call, same client/rows, no carried state.
    const afterRestart = await recoverStrandedChildJobs(db.client, NOW);
    expect(first.recovered).toBe(1);
    expect(afterRestart).toEqual({ recovered: 0, scanned: 0 });
  });

  it('never touches jobs under a still-driveable (non-terminal) goal', async () => {
    const db = await seedTerminalGoalWithJob('running', 'ready');
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r).toEqual({ recovered: 0, scanned: 0 });
    expect(db.rowsOf('goal_jobs')[0].status).toBe('ready');
  });

  it('leaves an already-terminal child under a terminal goal alone (nothing to recover)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal('goal-aaaaaaaa', 'completed'));
    // Inserted directly at a terminal status (a legal transition chain to get
    // here isn't the point of this test - only that a terminal child is left alone).
    await insertGoalJob(db.client, job('job-aaaaaaaa', 'goal-aaaaaaaa', 'completed'));
    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r).toEqual({ recovered: 0, scanned: 0 });
  });

  it('proves the full terminal-parent/nonterminal-child convergence: mixed statuses across multiple terminal goals converge to all-terminal', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal('goal-xxxxxxxx', 'dead_lettered'));
    await insertMasterGoal(db.client, goal('goal-yyyyyyyy', 'cancelled'));
    await insertGoalJob(db.client, job('job-x1aaaaaaa', 'goal-xxxxxxxx', 'pending'));
    await insertGoalJob(db.client, job('job-x2aaaaaaa', 'goal-xxxxxxxx', 'pending'));
    await transitionJob(db.client, 'job-x2aaaaaaa', 'pending', 'assigned', {}, NOW);
    await insertGoalJob(db.client, job('job-y1aaaaaaa', 'goal-yyyyyyyy', 'pending'));
    await transitionJob(db.client, 'job-y1aaaaaaa', 'pending', 'awaiting_approval', {}, NOW);

    const r = await recoverStrandedChildJobs(db.client, NOW);
    expect(r.recovered).toBe(3);
    const jobs = db.rowsOf('goal_jobs');
    expect(jobs.every((j) => j.status === 'cancelled')).toBe(true);
  });
});
