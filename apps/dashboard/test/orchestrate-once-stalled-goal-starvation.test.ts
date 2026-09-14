import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { EXIT, runDispatcher } from '../src/os-runtime/dispatcher';
import {
  insertGoalJob,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';
import { clearGateRpc } from './_clear-gate-rpc';

// ===========================================================================
// Scheduler pickup starvation (live production finding, 2026-09-04):
// GREEN, approval-free jobs of a YOUNGER goal stayed pending with attempts=0
// and no lease while posture read "operating" and running_goals=0.
//
// Mechanism (repo evidence): the dispatcher drives goals OLDEST-FIRST and
// RETURNS the whole tick when driveGoal reports halted. driveGoal, in turn,
// re-stepped a goal that made NO progress (every run action skipped: worktree
// lock held elsewhere, orphaned in_progress lease, or a partially parked
// graph) until its harness cycle bound, reserving one goal iteration per
// cycle, then reported halted:'scheduled' -> the dispatcher mapped it to
// cycle_budget_exhausted (exit 0, looks healthy) and never reached the next
// goal. One stalled older goal therefore starved EVERY younger goal on EVERY
// tick, and the read model (10 newest goals) could not show the stalled one.
//
// These suites pin the fix: a no-progress step ends the drive for THIS goal
// (no iteration burn beyond the one already reserved), driveGoal reports it
// as a non-halting stall with the per-job skip reasons, and the tick moves on
// to the next eligible goal.
// ===========================================================================

const NOW = '2026-09-04T12:00:00.000Z';
const OWNER = 'owner@preston.nyc';
const ENV = {
  SUPABASE_URL: 'https://x',
  SUPABASE_RUNTIME_KEY: 'k',
  SUPABASE_RUNTIME_ENV: 'staging',
  ORCH_BASE_COMMIT: 'abc1234',
  ORCH_ALLOWED_PATHS: 'apps/dashboard/src/',
};

function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
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
            order(col: string, o?: { ascending?: boolean }) {
              return { limit(n: number) {
                const asc = o?.ascending !== false;
                const rows = rowsOf(table).filter((r) => f.every((g) => g(r)))
                  .sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
                return Promise.resolve({ data: rows.slice(0, n), error: null });
              } };
            },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte(c: string, v: string) { return chain([...f, (r) => String(r[c]) <= v]); },
            gt(c: string, v: string) { return chain([...f, (r) => String(r[c]) > v]); },
            select() {
              const m = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of m) Object.assign(r, patch);
              return Promise.resolve({ data: m.map((r) => ({ id: r[pk(table)] })), error: null });
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

type Db = ReturnType<typeof makeFakeDb>;

function goal(id: string, createdAt: string, over: Partial<MasterGoal> = {}): MasterGoal {
  return {
    id, title: 'g', objective: 'o', source: 'owner_cli',
    requested_by: OWNER, status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: `corr-${id}`,
    simulation_only: true, created_at: createdAt, updated_at: createdAt, ...over,
  };
}

// One GREEN, approval-free code job per goal (the live shape).
async function seedGreenGoal(db: Db, goalId: string, createdAt: string, jobId: string) {
  const g = goal(goalId, createdAt);
  await insertMasterGoal(db.client, g);
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'add x', objective: 'add x', depends_on_local: [] },
  ];
  const d = decomposeGoal(g, specs, () => jobId, createdAt);
  if (!d.ok) throw new Error('decompose');
  for (const j of d.jobs) await insertGoalJob(db.client, j);
}

const OLD = '2026-09-01T00:00:00.000Z'; // older goal: selected first (oldest-first)
const YOUNG = '2026-09-03T00:00:00.000Z'; // the goal the owner is waiting on
const OLD_GOAL = 'goal-old-0001';
const OLD_JOB = 'job-old-0001';
const YOUNG_GOAL = 'goal-young-001';
const YOUNG_JOB = 'job-young-001';

function seams(t = Date.parse(NOW)) {
  let runs = 0;
  return { clock: () => (t += 1000), lockTokenSeed: () => 'seed1', newRunId: () => `r${++runs}` };
}

function dispatch(db: Db, log: (l: Record<string, unknown>) => void = () => {}) {
  // --max 10, exactly as deploy/systemd/preston-orchestrator.service runs it.
  return runDispatcher({
    command: 'orchestrate-once', client: db.client, env: ENV, now: NOW,
    correlationId: 'c', log, orchestrate: seams(), maxIterations: 10,
  });
}

function youngJob(db: Db) {
  return db.rowsOf('goal_jobs').find((j) => j.id === YOUNG_JOB)!;
}
function iterationOf(db: Db, goalId: string) {
  return Number(db.rowsOf('master_goals').find((g) => g.id === goalId)!.iteration ?? 0);
}

// The three live stall shapes an OLDER goal can be in. Each makes every step
// of that goal a no-progress step while leaving it driveable (not parked).
const STALLS: Array<{ name: string; seed: (db: Db) => Promise<void>; skipReason: RegExp | null }> = [
  {
    name: 'worktree lock for its job is held by another live holder',
    seed: async (db) => {
      await seedGreenGoal(db, OLD_GOAL, OLD, OLD_JOB);
      db.rowsOf('repository_worktrees').push({
        id: `wt-${OLD_JOB}`, repo: 'preston-os', path: `/srv/worktrees/wt-${OLD_JOB}`,
        job_id: OLD_JOB, agent: 'claude', base_commit: 'abc1234', target_branch: `wt/${OLD_JOB}`,
        lock_id: 'orch-otherseed-token#3', fence: 3, allowed_paths: ['apps/dashboard/src/'],
        status: 'in_use',
        lease_expires_at: new Date(Date.parse(NOW) + 60 * 60 * 1000).toISOString(),
        updated_at: NOW,
      });
    },
    skipReason: /^lock_refused:held_by_another$/,
  },
  {
    name: 'its job is in_progress under an unexpired (orphaned) run lease',
    seed: async (db) => {
      await seedGreenGoal(db, OLD_GOAL, OLD, OLD_JOB);
      const j = db.rowsOf('goal_jobs').find((r) => r.id === OLD_JOB)!;
      j.status = 'in_progress';
      j.run_id = `${OLD_JOB}:r-prior`;
      j.run_lease_expires_at = new Date(Date.parse(NOW) + 30 * 60 * 1000).toISOString();
    },
    skipReason: null, // engine reports jobs_in_flight; there is no run action to skip
  },
  {
    name: 'its graph is partially parked (gated job + dependent GREEN job)',
    seed: async (db) => {
      const g = goal(OLD_GOAL, OLD);
      await insertMasterGoal(db.client, g);
      const specs: TaskSpec[] = [
        { local_id: 'gate', kind: 'code', title: 'deploy the service', objective: 'deploy the service', depends_on_local: [] },
        { local_id: 'after', kind: 'code', title: 'add x', objective: 'add x', depends_on_local: ['gate'] },
      ];
      const d = decomposeGoal(g, specs, (l) => `job-old-${l}`, OLD);
      if (!d.ok) throw new Error('decompose');
      // Already parked (a prior tick moved the gated job); the dependent GREEN
      // job stays pending, so the park-scan does NOT skip this goal.
      for (const j of d.jobs) {
        await insertGoalJob(db.client, {
          ...j, status: j.requires_approval ? 'awaiting_approval' : 'pending',
        });
      }
      db.rowsOf('job_dependencies').push({
        goal_id: OLD_GOAL, job_id: 'job-old-after', depends_on_job_id: 'job-old-gate',
      });
      expect(d.jobs.find((j) => j.id === 'job-old-gate')!.requires_approval).toBe(true);
    },
    skipReason: null,
  },
];

describe('orchestrate-once - a stalled older goal must not starve younger goals', () => {
  for (const stall of STALLS) {
    it(`drives the younger GREEN goal when the older goal's ${stall.name}`, async () => {
      const db = makeFakeDb();
      await stall.seed(db);
      await seedGreenGoal(db, YOUNG_GOAL, YOUNG, YOUNG_JOB);
      const lines: Record<string, unknown>[] = [];

      const r = await dispatch(db, (l) => lines.push(l));

      // The tick is still a clean exit; nothing fail-closed was weakened.
      expect(r.exitCode).toBe(EXIT.ok);
      // THE live symptom, inverted: the younger goal's job was claimed under a
      // lease, ran (simulation) and completed on this very tick.
      const yj = youngJob(db);
      expect(yj.status).toBe('completed');
      expect(Number(yj.attempts)).toBe(1);
      expect(db.rowsOf('master_goals').find((g) => g.id === YOUNG_GOAL)!.status).toBe('completed');
      // Both goals were attempted this tick: the stalled one first (oldest-
      // first is preserved), then the younger one.
      expect(r.summary.goalsDriven).toBe(2);
      const goals = r.summary.goals as Array<{ goal: string; reason: string }>;
      expect(goals.map((g) => g.goal)).toEqual([OLD_GOAL, YOUNG_GOAL]);
      // The stalled goal is reported as a STALL, not as an exhausted cycle
      // budget, and the tick carries the reason so it is diagnosable.
      expect(goals[0].reason.startsWith('no_progress:')).toBe(true);
      expect(goals[1].reason).toBe('completed');
      // The stalled goal burned exactly the ONE iteration its single step
      // reserved - not the whole --max 10 harness budget every tick.
      expect(iterationOf(db, OLD_GOAL)).toBe(1);
      // Per-job skip reasons surface on the tick log line for the stalled goal.
      const stallLine = lines.find((l) => l.event === 'orchestrate_once' && l.goal === OLD_GOAL);
      expect(stallLine).toBeDefined();
      if (stall.skipReason) {
        const skips = stallLine!.stalledJobs as Array<{ job_id: string; reason: string }>;
        expect(skips.length).toBe(1);
        expect(skips[0].job_id).toBe(OLD_JOB);
        expect(skips[0].reason).toMatch(stall.skipReason);
      }
    });
  }

  it('the stalled goal itself is untouched: its rows are exactly as seeded except the reserved iteration', async () => {
    const db = makeFakeDb();
    await STALLS[0].seed(db);
    await seedGreenGoal(db, YOUNG_GOAL, YOUNG, YOUNG_JOB);
    const before = JSON.stringify(db.rowsOf('goal_jobs').find((j) => j.id === OLD_JOB));
    const lockBefore = JSON.stringify(db.rowsOf('repository_worktrees')[0]);
    await dispatch(db);
    expect(JSON.stringify(db.rowsOf('goal_jobs').find((j) => j.id === OLD_JOB))).toBe(before);
    expect(JSON.stringify(db.rowsOf('repository_worktrees')[0])).toBe(lockBefore); // never taken over
  });

  it('several stalled older goals do not consume the per-tick drive slots (default 2)', async () => {
    const db = makeFakeDb();
    // Three stalled goals older than the one the owner is waiting on.
    for (let i = 1; i <= 3; i++) {
      const gid = `goal-stall-000${i}`;
      const jid = `job-stall-000${i}`;
      await seedGreenGoal(db, gid, `2026-09-0${i}T00:00:00.000Z`, jid);
      db.rowsOf('repository_worktrees').push({
        id: `wt-${jid}`, repo: 'preston-os', path: `/srv/worktrees/wt-${jid}`,
        job_id: jid, agent: 'claude', base_commit: 'abc1234', target_branch: `wt/${jid}`,
        lock_id: 'orch-otherseed-token#3', fence: 3, allowed_paths: ['apps/dashboard/src/'],
        status: 'in_use',
        lease_expires_at: new Date(Date.parse(NOW) + 60 * 60 * 1000).toISOString(),
        updated_at: NOW,
      });
    }
    await seedGreenGoal(db, YOUNG_GOAL, YOUNG, YOUNG_JOB);
    const r = await dispatch(db);
    expect(r.exitCode).toBe(EXIT.ok);
    expect(youngJob(db).status).toBe('completed');
    const goals = r.summary.goals as Array<{ goal: string; reason: string }>;
    expect(goals.map((g) => g.goal)).toEqual(['goal-stall-0001', 'goal-stall-0002', 'goal-stall-0003', YOUNG_GOAL]);
    expect(goals.slice(0, 3).every((g) => g.reason.startsWith('no_progress:'))).toBe(true);
    for (let i = 1; i <= 3; i++) expect(iterationOf(db, `goal-stall-000${i}`)).toBe(1);
  });

  it('a lone stalled goal still exits 0 with the stall reason (no false success narrative)', async () => {
    const db = makeFakeDb();
    await STALLS[0].seed(db);
    const r = await dispatch(db);
    expect(r.exitCode).toBe(EXIT.ok);
    expect(String(r.summary.stoppedReason).startsWith('no_progress:')).toBe(true);
    expect(iterationOf(db, OLD_GOAL)).toBe(1);
  });
});
