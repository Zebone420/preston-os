import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { EXIT, parseArgs, runDispatcher } from '../src/os-runtime/dispatcher';
import {
  insertGoalJob,
  insertJobApproval,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

// ===========================================================================
// orchestrate-once: the deployed Phase-7 goal-driving dispatcher command.
// Every test runs against a fake in-memory store (call-recording), proving
// the command's routing, fail-closed gates, single-goal selection, driver
// integration (approvals/leases/locks/retries), evidence persistence, and
// simulation-only containment. Real-DB semantics stay owner-verified on the
// migrated staging database per the go-live packet.
// ===========================================================================

const NOW = '2026-07-23T12:00:00.000Z';
const OWNER = 'owner@preston.nyc';
const ENV = {
  SUPABASE_URL: 'https://x',
  SUPABASE_RUNTIME_KEY: 'k',
  SUPABASE_RUNTIME_ENV: 'staging',
  ORCH_BASE_COMMIT: 'abc1234',
  ORCH_ALLOWED_PATHS: 'apps/dashboard/src/',
};

interface Call {
  table: string;
  op: 'insert' | 'select' | 'update';
  row?: Record<string, unknown>; // written payload (insert row / update patch)
}

function makeFakeDb(controls?: Record<string, unknown> | null) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const calls: Call[] = [];
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  if (controls !== null) {
    rowsOf('system_controls').push(controls ?? {
      id: 'global', execution_enabled: false, owner_stop: false, paused: false,
      hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
    });
  }
  const errors = new Map<string, string>(); // table -> select error message
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, op: 'insert', row });
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
          calls.push({ table, op: 'select' });
          const err = errors.get(table);
          const failed = () =>
            Promise.resolve({ data: null, error: { message: String(err) } });
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return err ? failed() : Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return err ? failed() : Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          calls.push({ table, op: 'update', row: patch });
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
  return { client, rowsOf, calls, errors };
}

function goal(over: Partial<MasterGoal> = {}): MasterGoal {
  return {
    id: 'goal-00000001', title: 'g', objective: 'o', source: 'owner_cli',
    requested_by: OWNER, status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-00000001',
    simulation_only: true, created_at: NOW, updated_at: NOW, ...over,
  };
}

// Seed one decomposed goal: GREEN code job a, then test job b depending on a.
async function seedChain(db: ReturnType<typeof makeFakeDb>) {
  await insertMasterGoal(db.client, goal());
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'a', objective: 'add x', depends_on_local: [] },
    { local_id: 'b', kind: 'test', title: 'b', objective: 'test x', depends_on_local: ['a'] },
  ];
  const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
  if (!d.ok) throw new Error('decompose');
  for (const j of d.jobs) await insertGoalJob(db.client, j);
  db.rowsOf('job_dependencies').push({
    goal_id: 'goal-00000001', job_id: 'job-0000-b', depends_on_job_id: 'job-0000-a',
  });
}

function noop(): void {}

// Deterministic seams: ticking clock + fixed lock seed + counting run ids.
function seams(t = Date.parse(NOW)) {
  let runs = 0;
  return {
    clock: () => (t += 1000),
    lockTokenSeed: () => 'seed1',
    newRunId: () => `r${++runs}`,
  };
}

function dispatch(
  db: ReturnType<typeof makeFakeDb>,
  over: Partial<Parameters<typeof runDispatcher>[0]> = {},
) {
  return runDispatcher({
    command: 'orchestrate-once', client: db.client, env: ENV, now: NOW,
    correlationId: 'c', log: noop, orchestrate: seams(), ...over,
  });
}

describe('orchestrate-once - dispatcher routing', () => {
  it('parseArgs maps the subcommand (and unknown still falls back to health)', () => {
    expect(parseArgs(['n', 'b', 'orchestrate-once']).command).toBe('orchestrate-once');
    expect(parseArgs(['n', 'b', 'orchestrate-once', '--max', '3']).maxIterations).toBe(3);
    expect(parseArgs(['n', 'b', 'unknown-cmd']).command).toBe('health');
  });
});

describe('orchestrate-once - fail-closed configuration gates (exit 78)', () => {
  it('refuses missing runtime env, non-staging env, and production URLs', async () => {
    const db = makeFakeDb();
    expect((await dispatch(db, { env: {} })).exitCode).toBe(EXIT.config);
    const noMarker = { ...ENV } as Record<string, string | undefined>;
    delete noMarker['SUPABASE_RUNTIME_ENV'];
    expect((await dispatch(db, { env: noMarker })).exitCode).toBe(EXIT.config);
    expect((await dispatch(db, { env: { ...ENV, SUPABASE_URL: 'https://prod.supabase.co' } })).exitCode).toBe(EXIT.config);
  });

  it('refuses a missing or malformed ORCH_BASE_COMMIT', async () => {
    const db = makeFakeDb();
    const noBase = { ...ENV } as Record<string, string | undefined>;
    delete noBase['ORCH_BASE_COMMIT'];
    expect((await dispatch(db, { env: noBase })).exitCode).toBe(EXIT.config);
    expect((await dispatch(db, { env: { ...ENV, ORCH_BASE_COMMIT: 'not-hex!' } })).exitCode).toBe(EXIT.config);
    expect((await dispatch(db, { env: { ...ENV, ORCH_BASE_COMMIT: 'abc12' } })).exitCode).toBe(EXIT.config);
  });

  it('refuses missing, empty, absolute, or traversal ORCH_ALLOWED_PATHS', async () => {
    const db = makeFakeDb();
    const noPaths = { ...ENV } as Record<string, string | undefined>;
    delete noPaths['ORCH_ALLOWED_PATHS'];
    expect((await dispatch(db, { env: noPaths })).exitCode).toBe(EXIT.config);
    expect((await dispatch(db, { env: { ...ENV, ORCH_ALLOWED_PATHS: ' , ' } })).exitCode).toBe(EXIT.config);
    expect((await dispatch(db, { env: { ...ENV, ORCH_ALLOWED_PATHS: '/etc/' } })).exitCode).toBe(EXIT.config);
    expect((await dispatch(db, { env: { ...ENV, ORCH_ALLOWED_PATHS: 'apps/../secrets/' } })).exitCode).toBe(EXIT.config);
  });

  it('refuses migration-absent staging (0010 not applied)', async () => {
    const db = makeFakeDb();
    db.errors.set('master_goals', 'relation "master_goals" does not exist');
    const r = await dispatch(db);
    expect(r.exitCode).toBe(EXIT.config);
    expect(r.summary.error).toContain('0010');
  });
});

describe('orchestrate-once - control-plane gates', () => {
  it('halts (75) on owner_stop and on paused, before any goal read', async () => {
    for (const control of [{ owner_stop: true }, { paused: true }]) {
      const db = makeFakeDb({
        id: 'global', execution_enabled: false, owner_stop: false, paused: false,
        hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW, ...control,
      });
      await seedChain(db);
      const before = JSON.stringify(db.rowsOf('goal_jobs'));
      const r = await dispatch(db);
      expect(r.exitCode).toBe(EXIT.halted);
      expect(JSON.stringify(db.rowsOf('goal_jobs'))).toBe(before); // nothing advanced
      expect(db.rowsOf('goal_jobs').every((j) => !j.run_id)).toBe(true); // no claim
    }
  });

  it('errors (70) when controls are unreadable - never treated as a clean halt', async () => {
    const db = makeFakeDb(null); // no controls row at all
    const r = await dispatch(db);
    expect(r.exitCode).toBe(EXIT.error);
  });

  it('refuses (78) an unsafe posture: execution or remote runner enabled', async () => {
    for (const control of [{ execution_enabled: true }, { remote_runner_enabled: true }]) {
      const db = makeFakeDb({
        id: 'global', execution_enabled: false, owner_stop: false, paused: false,
        hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW, ...control,
      });
      await seedChain(db);
      const r = await dispatch(db);
      expect(r.exitCode).toBe(EXIT.config);
      expect(db.rowsOf('goal_jobs').every((j) => j.status === 'pending')).toBe(true);
    }
  });
});

describe('orchestrate-once - goal selection', () => {
  it('exits 0 cleanly when no eligible goal exists (empty and proposed-only)', async () => {
    const empty = makeFakeDb();
    const r1 = await dispatch(empty);
    expect(r1.exitCode).toBe(EXIT.ok);
    expect(r1.summary.stoppedReason).toBe('no_eligible_goal');

    const proposedOnly = makeFakeDb();
    await insertMasterGoal(proposedOnly.client, goal({ status: 'proposed' }));
    const r2 = await dispatch(proposedOnly);
    expect(r2.exitCode).toBe(EXIT.ok);
    expect(r2.summary.stoppedReason).toBe('no_eligible_goal');
  });

  it('selects deterministically: the oldest eligible goal drives first', async () => {
    const db = makeFakeDb();
    await seedChain(db); // goal-00000001 created at NOW
    await insertMasterGoal(db.client, goal({
      id: 'goal-00000000', correlation_id: 'corr-00000000',
      created_at: '2026-07-22T12:00:00.000Z', // OLDER
    }));
    const r = await dispatch(db);
    expect(r.summary.goal).toBe('goal-00000000');
  });

  it('fails closed (70) when a driveable goal violates the simulation pins', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    db.rowsOf('master_goals')[0].simulation_only = false; // drifted/corrupt row
    const r = await dispatch(db);
    expect(r.exitCode).toBe(EXIT.error);
    expect(r.summary.error).toContain('simulation pin');
    expect(db.rowsOf('goal_jobs').every((j) => j.status === 'pending')).toBe(true);
  });

  it('fails closed (70) when dependency edges are unreadable', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    db.errors.set('job_dependencies', 'permission denied');
    const r = await dispatch(db);
    expect(r.exitCode).toBe(EXIT.error);
    expect(r.summary.error).toContain('dependencies');
  });
});

describe('orchestrate-once - drives one eligible goal end to end', () => {
  it('completes a dependency-ordered chain with persisted, run-bound evidence', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.summary.stoppedReason).toBe('completed');
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    const b = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!;
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    // evidence persisted, bound to goal/job/run/attempt/outcome
    for (const j of [a, b]) {
      const refs = j.evidence_refs as string[];
      expect(refs.length).toBe(1);
      expect(refs[0]).toContain(`sim:goal:goal-00000001:job:${j.id}:run:`);
      expect(refs[0].endsWith(':completed')).toBe(true);
    }
    expect(db.rowsOf('master_goals')[0].status).toBe('completed');
    // simulation containment: nothing ever marked executed
    expect(db.rowsOf('goal_jobs').every((j) => j.executed === false)).toBe(true);
  });

  it('a bounded invocation resumes on the next one (restart-safe progress)', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    // one cycle: job a completes, job b (depends on a) cannot run yet
    const first = await dispatch(db, { maxIterations: 1 });
    expect(first.exitCode).toBe(EXIT.ok); // bounded progress is success
    expect(first.summary.stoppedReason).toBe('cycle_budget_exhausted');
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.status)
      .not.toBe('completed');
    const second = await dispatch(db, { maxIterations: 10 });
    expect(second.summary.stoppedReason).toBe('completed');
    // job a ran exactly once across both invocations (no re-run on resume)
    expect(Number(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.attempts)).toBe(1);
  });

  it('mints crypto-random run ids and per-invocation lock tokens by default', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const db = makeFakeDb();
      await seedChain(db);
      // no orchestrate seams injected: production defaults are in effect
      const r = await runDispatcher({
        command: 'orchestrate-once', client: db.client, env: ENV, now: NOW,
        correlationId: 'c', log: noop, maxIterations: 10,
      });
      expect(r.summary.stoppedReason).toBe('completed');
      const refs = db.rowsOf('goal_jobs')
        .flatMap((j) => j.evidence_refs as string[]);
      // driver-minted run id: <jobId>:<uuid> (crypto randomUUID)
      expect(refs.some((x) => /:run:job-0000-a:[0-9a-f-]{36}:/.test(x))).toBe(true);
      // capture the lock ownership token WRITTEN for job a's worktree
      // (release clears lock_id on the row afterwards, by design)
      const written = db.calls.find(
        (c) => c.table === 'repository_worktrees' &&
          String(c.row?.id) === 'wt-job-0000-a' &&
          String(c.row?.lock_id ?? '').startsWith('orch-'),
      );
      expect(written).toBeDefined();
      tokens.push(String(written!.row!.lock_id));
    }
    expect(tokens[0]).not.toBe(tokens[1]); // per-invocation uniqueness
  });
});

describe('orchestrate-once - approval parking (owner-only unlock)', () => {
  async function seedGated(db: ReturnType<typeof makeFakeDb>) {
    await insertMasterGoal(db.client, goal());
    const specs: TaskSpec[] = [{
      local_id: 'b', kind: 'migration', title: 'apply 0011',
      objective: 'migrate the database and deploy', depends_on_local: [],
    }];
    const d = decomposeGoal(goal(), specs, (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    await insertGoalJob(db.client, d.jobs[0]);
  }

  it('parks the gated job, then skips without burning the iteration budget', async () => {
    const db = makeFakeDb();
    await seedGated(db);
    const r1 = await dispatch(db, { maxIterations: 10 });
    expect(r1.exitCode).toBe(EXIT.ok);
    expect(r1.summary.stoppedReason).toBe('awaiting_owner_approval');
    expect(db.rowsOf('goal_jobs')[0].status).toBe('awaiting_approval');
    const burned = Number(db.rowsOf('master_goals')[0].iteration);
    // repeated timer ticks while the owner decides: no budget burn
    for (let i = 0; i < 3; i++) {
      const rn = await dispatch(db, { maxIterations: 10 });
      expect(rn.exitCode).toBe(EXIT.ok);
      expect(rn.summary.stoppedReason).toBe('awaiting_owner_approval');
    }
    expect(Number(db.rowsOf('master_goals')[0].iteration)).toBe(burned);
    expect(db.rowsOf('goal_jobs')[0].status).toBe('awaiting_approval');
  });

  it('an approved-but-unverifiable record still parks AND still burns nothing', async () => {
    const db = makeFakeDb();
    await seedGated(db);
    await dispatch(db, { maxIterations: 10 }); // parks
    const burned = Number(db.rowsOf('master_goals')[0].iteration);
    // forged: claims approved, but the hash binds nothing
    db.rowsOf('goal_jobs')[0].approval_id = 'apr-forged';
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-forged', goal_id: 'goal-00000001', job_id: 'job-0000-b',
      status: 'approved', owner_identity: OWNER, action_hash: 'wrong',
      environment: 'staging', nonce: 'n', decided_at: NOW,
      created_at: NOW, expires_at: '2026-07-23T13:00:00.000Z',
    });
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.summary.stoppedReason).toBe('awaiting_owner_approval');
    expect(db.rowsOf('goal_jobs')[0].status).toBe('awaiting_approval'); // never unlocked
    expect(Number(db.rowsOf('master_goals')[0].iteration)).toBe(burned); // no burn
  });

  it('completes after a genuine owner approval (internally derived hash)', async () => {
    const db = makeFakeDb();
    await seedGated(db);
    await dispatch(db, { maxIterations: 10 }); // parks; role assigned by engine? no - assign first
    const jb = db.rowsOf('goal_jobs')[0];
    expect(jb.status).toBe('awaiting_approval');
    jb.assigned_role = 'claude';
    jb.approval_id = 'apr-00000001';
    const created = await insertJobApproval(db.client, {
      approval_id: 'apr-00000001', goal_id: 'goal-00000001',
      job: {
        id: 'job-0000-b', kind: 'migration',
        objective: 'migrate the database and deploy', title: 'apply 0011',
        risk_class: 'RED', assigned_role: 'claude',
      },
      owner_identity: OWNER, created_at: NOW, expires_at: '2026-07-23T13:00:00.000Z',
    });
    expect(created.ok).toBe(true);
    // simulated effect of the owner-only decide RPC (pending -> approved)
    Object.assign(db.rowsOf('orchestration_approvals')[0], {
      status: 'approved', decided_at: NOW, nonce: 'decide-1',
    });
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.summary.stoppedReason).toBe('completed');
    expect(db.rowsOf('goal_jobs')[0].status).toBe('completed');
    expect(db.rowsOf('goal_jobs')[0].requires_approval).toBe(false);
    expect(db.rowsOf('goal_jobs')[0].executed).toBe(false);
  });
});

describe('orchestrate-once - leases, locks, and recovery', () => {
  it('never disturbs a LIVE execution lease held by another run', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    a.status = 'in_progress';
    a.run_id = 'other-run';
    a.run_lease_expires_at = '2026-07-23T23:00:00.000Z'; // far future = live
    const r = await dispatch(db, { maxIterations: 3 });
    expect(r.exitCode).toBe(EXIT.ok);
    expect(a.run_id).toBe('other-run'); // untouched
    expect(a.status).toBe('in_progress');
  });

  it('recovers an EXPIRED execution lease and completes the goal (restart/retry)', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    a.status = 'in_progress';
    a.run_id = 'crashed-run';
    a.run_lease_expires_at = '2026-07-23T11:00:00.000Z'; // in the past
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.summary.stoppedReason).toBe('completed');
    expect(a.status).toBe('completed');
    expect(Number(a.attempts)).toBe(1); // recovered, then ran once
  });

  it('skips a job whose worktree lock is held by another owner (lease conflict)', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    // a LIVE foreign lock on job a's worktree
    db.rowsOf('repository_worktrees').push({
      id: 'wt-job-0000-a', repo: 'preston-os', path: 'wt', agent: 'codex',
      job_id: 'job-0000-a', status: 'locked', dirty: false,
      lock_id: 'foreign-token#7', fence: 7, base_commit: 'abc1234',
      target_branch: 'wt/job-0000-a', allowed_paths: ['apps/dashboard/src/'],
      lease_expires_at: '2026-07-23T23:00:00.000Z', updated_at: NOW,
    });
    const r = await dispatch(db, { maxIterations: 3 });
    expect(r.exitCode).toBe(EXIT.ok); // clean bounded run, no takeover
    const a = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!;
    expect(a.status).not.toBe('completed'); // never ran under a foreign lock
    const wt = db.rowsOf('repository_worktrees').find((w) => w.id === 'wt-job-0000-a')!;
    expect(wt.lock_id).toBe('foreign-token#7'); // lock not stolen
  });
});

describe('orchestrate-once - completeness and mid-run boundaries', () => {
  it('refuses (70) a goal whose job read cannot be proven complete (1001 jobs)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    for (let i = 0; i < 1001; i++) {
      db.rowsOf('goal_jobs').push({
        id: `job-x-${i}`, goal_id: 'goal-00000001', kind: 'audit', title: 't',
        objective: 'o', risk_class: 'GREEN', assigned_role: 'audit',
        status: 'pending', attempts: 0, requires_approval: false,
        approval_id: null, runtime_job_id: null, correlation_id: 'corr-00000001',
        evidence_refs: [], failure_reason: null, created_at: NOW, updated_at: NOW,
        executed: false,
      });
    }
    const r = await dispatch(db, { maxIterations: 3 });
    expect(r.exitCode).toBe(EXIT.error);
    expect(r.summary.error).toContain('job graph overflow');
    // nothing advanced on the unprovable graph
    expect(db.rowsOf('goal_jobs').every((j) => j.status === 'pending')).toBe(true);
  });

  it('refuses (70) a dependency read that fills its bound (unprovably complete)', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    for (let i = 0; i < 10000; i++) {
      db.rowsOf('job_dependencies').push({
        goal_id: 'goal-00000001', job_id: 'job-0000-b', depends_on_job_id: `job-x-${i}`,
      });
    }
    const r = await dispatch(db, { maxIterations: 3 });
    expect(r.exitCode).toBe(EXIT.error);
    expect(r.summary.error).toContain('dependency graph overflow');
  });

  it('refuses (70) a pin violation ANYWHERE in master_goals, even outside every selection window', async () => {
    const db = makeFakeDb();
    await seedChain(db); // clean, driveable goal
    // corrupt row: TERMINAL status (never inside a driveable-status window)
    db.rowsOf('master_goals').push({
      id: 'goal-00000bad', title: 'x', objective: 'x', source: 'owner_cli',
      requested_by: OWNER, status: 'completed', environment: 'staging',
      budget: DEFAULT_BUDGET, correlation_id: 'corr-00000bad',
      simulation_only: false, iteration: 0, created_at: NOW, updated_at: NOW,
    });
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.exitCode).toBe(EXIT.error);
    expect(r.summary.error).toContain('simulation pin');
    expect(db.rowsOf('goal_jobs').every((j) => j.status === 'pending')).toBe(true);
  });

  it('drives an old goal even when hundreds of newer goals exist (no window mismatch)', async () => {
    const db = makeFakeDb();
    await seedChain(db); // the driveable goal, created at NOW
    for (let i = 0; i < 250; i++) {
      db.rowsOf('master_goals').push({
        id: `goal-newer-${String(i).padStart(4, '0')}`, title: 'n', objective: 'n',
        source: 'owner_cli', requested_by: OWNER, status: 'proposed',
        environment: 'staging', budget: DEFAULT_BUDGET,
        correlation_id: `corr-newer-${i}`, simulation_only: true, iteration: 0,
        created_at: '2026-07-24T12:00:00.000Z', updated_at: '2026-07-24T12:00:00.000Z',
      });
    }
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.summary.goal).toBe('goal-00000001');
    expect(r.summary.stoppedReason).toBe('completed');
  });

  it('maps a mid-run pause to 75 and a mid-run controls outage to 70', async () => {
    // pause flips between cycles via the injected clock seam
    const paused = makeFakeDb();
    await seedChain(paused);
    let ticks = 0; let t = Date.parse(NOW);
    const rp = await dispatch(paused, {
      maxIterations: 10,
      orchestrate: {
        clock: () => {
          if (++ticks === 2) paused.rowsOf('system_controls')[0].paused = true;
          return (t += 1000);
        },
        lockTokenSeed: () => 's', newRunId: () => `r${ticks}`,
      },
    });
    expect(rp.exitCode).toBe(EXIT.halted);

    const outage = makeFakeDb();
    await seedChain(outage);
    let ticks2 = 0; let t2 = Date.parse(NOW);
    const ro = await dispatch(outage, {
      maxIterations: 10,
      orchestrate: {
        clock: () => {
          if (++ticks2 === 2) outage.rowsOf('system_controls').length = 0;
          return (t2 += 1000);
        },
        lockTokenSeed: () => 's', newRunId: () => `r${ticks2}`,
      },
    });
    expect(ro.exitCode).toBe(EXIT.error);
  });
});

describe('orchestrate-once - simulation-only containment (no external writes)', () => {
  it('touches ONLY the orchestration control-plane tables, and only via CAS writes', async () => {
    const db = makeFakeDb();
    await seedChain(db);
    db.calls.length = 0; // observe the dispatcher run only
    const r = await dispatch(db, { maxIterations: 10 });
    expect(r.summary.stoppedReason).toBe('completed');
    const writes = db.calls.filter((c) => c.op !== 'select');
    const allowed = new Set(['master_goals', 'goal_jobs', 'repository_worktrees']);
    expect(writes.every((w) => allowed.has(w.table))).toBe(true);
    // decisively: no runtime job queue, no messaging, no business tables
    for (const banned of ['os_jobs', 'telegram_updates', 'agents', 'os_events', 'clients', 'quote_versions']) {
      expect(db.calls.some((c) => c.table === banned && c.op !== 'select')).toBe(false);
    }
  });
});
