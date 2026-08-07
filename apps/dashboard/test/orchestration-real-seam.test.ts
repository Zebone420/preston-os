// Phase 8 - the driver's injected real-execution seam.
// Pins: (1) omitted executor => byte-identical Phase 7 simulation;
// (2) a real result persists real evidence under the run-owned CAS;
// (3) null decline falls back to simulation; (4) a throwing executor is
// contained as a failed attempt, never a stranded lease; (5) the executor
// is NEVER invoked for a job still gated on owner approval; (6) a mid-run
// owner stop still discards the result exactly as in Phase 7.

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  driveGoal,
  driverStep,
  type RealJobExecutor,
} from '../src/lib/ai-os/orchestration/driver';
import {
  insertGoalJob,
  insertJobApproval,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-08-07T03:00:00.000Z';

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
    id: 'goal-seam-0001', title: 'g', objective: 'o', source: 'dashboard',
    requested_by: 'owner@preston.nyc', status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-seam', simulation_only: true,
    created_at: NOW, updated_at: NOW,
  };
}

async function seedPlainGoal(db: ReturnType<typeof makeFakeDb>) {
  await insertMasterGoal(db.client, goal());
  db.rowsOf('master_goals')[0].created_at = NOW;
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'impl', objective: 'add helper', depends_on_local: [] },
  ];
  const d = decomposeGoal(goal(), specs, (l) => `job-seam-${l}`, NOW);
  if (!d.ok) throw new Error('decompose');
  for (const j of d.jobs) await insertGoalJob(db.client, j);
}

const lockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/'],
  token: (jobId: string) => `tok-${jobId}`,
};

const clock = (startMs: number) => { let t = startMs; return () => (t += 1000); };

const realCompleted = (refs: string[] = []) => ({
  outcome: 'completed' as const, executed: true,
  evidence_refs: refs.length ? refs : ['real:evidence:1'],
  failure_reason: null, summary: 'real run ok',
});

describe('driver real-execution seam', () => {
  it('no executor => pure Phase 7 simulation with sim: evidence', async () => {
    const db = makeFakeDb();
    await seedPlainGoal(db);
    const r = await driveGoal(db.client, 'goal-seam-0001', clock(Date.parse(NOW)), 20, () => [], lockCtx);
    expect(r.reason).toBe('completed');
    const job = db.rowsOf('goal_jobs')[0];
    expect(job.status).toBe('completed');
    expect((job.evidence_refs as string[]).join()).toContain('sim:goal:');
    expect(job.executed).toBe(false);
  });

  it('real result persists REAL evidence refs and completes the goal', async () => {
    const db = makeFakeDb();
    await seedPlainGoal(db);
    const exec: RealJobExecutor = vi.fn(async () => realCompleted(['real:goal:g:job:j:run:r:attempt:1:completed:executed:true']));
    const r = await driveGoal(db.client, 'goal-seam-0001', clock(Date.parse(NOW)), 20, () => [], lockCtx, undefined, exec);
    expect(r.reason).toBe('completed');
    const job = db.rowsOf('goal_jobs')[0];
    expect(job.status).toBe('completed');
    const refs = job.evidence_refs as string[];
    expect(refs.join()).toContain('executed:true');
    expect(refs.join()).not.toContain('sim:goal:');
    // the DB executed COLUMN stays false (0010 CHECK pin) - real execution
    // is recorded in evidence, never by violating the schema pin.
    expect(job.executed).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('null decline falls back to the simulation adapter', async () => {
    const db = makeFakeDb();
    await seedPlainGoal(db);
    const exec: RealJobExecutor = vi.fn(async () => null);
    const r = await driveGoal(db.client, 'goal-seam-0001', clock(Date.parse(NOW)), 20, () => [], lockCtx, undefined, exec);
    expect(r.reason).toBe('completed');
    const job = db.rowsOf('goal_jobs')[0];
    expect((job.evidence_refs as string[]).join()).toContain('sim:goal:');
    expect(exec).toHaveBeenCalled();
  });

  it('a throwing executor is contained as a failed attempt (no stranded lease)', async () => {
    const db = makeFakeDb();
    await seedPlainGoal(db);
    const exec: RealJobExecutor = vi.fn(async () => { throw new Error('boom'); });
    await driverStep(db.client, 'goal-seam-0001', Date.parse(NOW) + 1000, () => [], lockCtx, undefined, exec);
    const job = db.rowsOf('goal_jobs')[0];
    expect(job.status).toBe('failed');
    expect(job.failure_reason).toBe('real_executor_threw');
    expect(job.run_id).toBeNull(); // lease cleared on the terminal CAS
  });

  it('executor is NEVER invoked while the job is still approval-gated', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    db.rowsOf('master_goals')[0].created_at = NOW;
    db.rowsOf('goal_jobs').push({
      id: 'job-seam-g', goal_id: 'goal-seam-0001', kind: 'code', title: 'gated',
      objective: 'gated work', risk_class: 'YELLOW', assigned_role: 'claude',
      status: 'pending', attempts: 0, requires_approval: true,
      approval_id: 'apr-seam-0001', runtime_job_id: null, correlation_id: 'corr-seam',
      evidence_refs: [], failure_reason: null, run_id: null,
      run_lease_expires_at: null, executed: false, created_at: NOW, updated_at: NOW,
    });
    await insertJobApproval(db.client, {
      approval_id: 'apr-seam-0001', goal_id: 'goal-seam-0001',
      job: { id: 'job-seam-g', kind: 'code', objective: 'gated work', title: 'gated', risk_class: 'YELLOW', assigned_role: 'claude' },
      owner_identity: 'owner@preston.nyc', created_at: NOW,
      expires_at: '2026-08-08T03:00:00.000Z',
    });
    const exec: RealJobExecutor = vi.fn(async () => realCompleted());
    const r = await driveGoal(db.client, 'goal-seam-0001', clock(Date.parse(NOW)), 20, () => [], lockCtx, undefined, exec);
    expect(r.reason).toBe('awaiting_owner_approval');
    expect(exec).not.toHaveBeenCalled(); // approval boundary precedes the seam
    expect(db.rowsOf('goal_jobs')[0].status).toBe('awaiting_approval');
  });

  it('mid-run owner stop discards a REAL result exactly like a simulated one', async () => {
    const db = makeFakeDb();
    await seedPlainGoal(db);
    // flip owner_stop AFTER the executor has produced its result but before
    // the persist gate reads controls (3rd system_controls read in the step).
    let reads = 0;
    const orig = db.client.from.bind(db.client);
    (db.client as { from: RuntimeClient['from'] }).from = (table: string) => {
      if (table === 'system_controls') {
        reads += 1;
        if (reads > 2) Object.assign(db.rowsOf('system_controls')[0], { owner_stop: true });
      }
      return orig(table);
    };
    const exec: RealJobExecutor = vi.fn(async () => realCompleted());
    const r = await driverStep(db.client, 'goal-seam-0001', Date.parse(NOW) + 1000, () => [], lockCtx, undefined, exec);
    expect(r.halted).toBe(true);
    expect(r.reason).toBe('owner_stop_during_run');
    const job = db.rowsOf('goal_jobs')[0];
    expect(job.status).toBe('ready'); // requeued, result discarded
    expect((job.evidence_refs as string[] | undefined) ?? []).toHaveLength(0);
  });
});
