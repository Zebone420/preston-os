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
// Selection-window growth (P0 item G, 2026-09-08). The dispatcher reads a
// bounded oldest-first window per driveable status (50). Parked goals are
// skipped, but a status whose window is FILLED by parked goals hides every
// younger goal of that status beyond the window - a residual head-of-line
// starvation. The fix: when the scan exhausts a FULL window without a
// selection, re-read with a doubled window (bounded) and rescan. A window
// that was not full proves nothing lies beyond it, so no extra read happens.
// ===========================================================================

const NOW = '2026-09-08T12:00:00.000Z';
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

function goal(id: string, createdAt: string): MasterGoal {
  return {
    id, title: 'g', objective: 'o', source: 'owner_cli',
    requested_by: OWNER, status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: `corr-${id}`,
    simulation_only: true, created_at: createdAt, updated_at: createdAt,
  };
}

// One GREEN, approval-free code job (the live shape).
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

// A PARKED goal in the SAME status as the young goal ('decomposed'): its only
// job awaits an approval whose record does not exist (quiet park reason).
async function seedParkedGoal(db: Db, n: number) {
  const id = `goal-parked-${String(n).padStart(4, '0')}`;
  const createdAt = `2026-08-01T${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000Z`;
  const g = goal(id, createdAt);
  await insertMasterGoal(db.client, g);
  const specs: TaskSpec[] = [
    { local_id: 'gate', kind: 'code', title: 'deploy the service', objective: 'deploy the service', depends_on_local: [] },
  ];
  const d = decomposeGoal(g, specs, () => `job-parked-${n}`, createdAt);
  if (!d.ok) throw new Error('decompose');
  for (const j of d.jobs) {
    await insertGoalJob(db.client, {
      ...j, status: 'awaiting_approval', approval_id: `apr-missing-${n}`,
    });
  }
}

const YOUNG = '2026-09-07T00:00:00.000Z';
const YOUNG_GOAL = 'goal-young-0001';
const YOUNG_JOB = 'job-young-0001';

function seams(t = Date.parse(NOW)) {
  let runs = 0;
  return { clock: () => (t += 1000), lockTokenSeed: () => 'seed1', newRunId: () => `r${++runs}` };
}

function dispatch(db: Db, log: (l: Record<string, unknown>) => void = () => {}) {
  return runDispatcher({
    command: 'orchestrate-once', client: db.client, env: ENV, now: NOW,
    correlationId: 'c', log, orchestrate: seams(), maxIterations: 10,
  });
}

describe('orchestrate-once - selection window grows past a window full of parked goals', () => {
  it('drives a younger GREEN goal hidden behind 60 older parked goals of the same status', async () => {
    const db = makeFakeDb();
    for (let n = 1; n <= 60; n++) await seedParkedGoal(db, n);
    await seedGreenGoal(db, YOUNG_GOAL, YOUNG, YOUNG_JOB);
    const lines: Record<string, unknown>[] = [];

    const r = await dispatch(db, (l) => lines.push(l));

    expect(r.exitCode).toBe(EXIT.ok);
    const yj = db.rowsOf('goal_jobs').find((j) => j.id === YOUNG_JOB)!;
    expect(yj.status).toBe('completed');
    expect(r.summary.goal).toBe(YOUNG_GOAL);
    expect(r.summary.stoppedReason).toBe('completed');
    // Every parked goal was scanned and skipped, none was driven or altered.
    expect((r.summary.skippedParked as string[]).length).toBe(60);
    const grown = lines.filter((l) => l.event === 'orchestrate_once' && typeof l.windowGrown === 'number');
    expect(grown.length).toBe(1);
    expect(grown[0].windowGrown).toBe(100);
    for (let n = 1; n <= 60; n++) {
      expect(db.rowsOf('goal_jobs').find((j) => j.id === `job-parked-${n}`)!.status).toBe('awaiting_approval');
    }
  });

  it('a window that was not full never grows (no extra reads)', async () => {
    const db = makeFakeDb();
    for (let n = 1; n <= 10; n++) await seedParkedGoal(db, n);
    await seedGreenGoal(db, YOUNG_GOAL, YOUNG, YOUNG_JOB);
    const lines: Record<string, unknown>[] = [];
    const r = await dispatch(db, (l) => lines.push(l));
    expect(r.exitCode).toBe(EXIT.ok);
    expect(db.rowsOf('goal_jobs').find((j) => j.id === YOUNG_JOB)!.status).toBe('completed');
    expect(lines.some((l) => typeof l.windowGrown === 'number')).toBe(false);
  });

  it('a full window with nothing driveable beyond it exits 0 awaiting_owner_approval (bounded growth)', async () => {
    const db = makeFakeDb();
    for (let n = 1; n <= 60; n++) await seedParkedGoal(db, n);
    const lines: Record<string, unknown>[] = [];
    const r = await dispatch(db, (l) => lines.push(l));
    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.summary.stoppedReason).toBe('awaiting_owner_approval');
    expect((r.summary.skippedParked as string[]).length).toBe(60);
    // Grew once (50 -> 100); the 100-window was not full, so growth stopped.
    const grown = lines.filter((l) => typeof l.windowGrown === 'number').map((l) => l.windowGrown);
    expect(grown).toEqual([100]);
  });
});
