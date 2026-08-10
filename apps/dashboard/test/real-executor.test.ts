// Phase 8 - the os-runtime real-execution composer (buildRealExecutor).
// Pins: capability gating, worktree provisioning, post-run PATH ENFORCEMENT
// (the allowlist is enforcement, not advice), guaranteed worktree removal,
// per-job capability re-resolution, and decline-to-simulation on every
// precondition gap.

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  buildRealExecutor,
  CANONICAL_REPO_ENV,
  GIT_EXECUTABLE_ENV,
} from '../src/os-runtime/real-executor';
import { EXECUTION_LEVEL_ENV } from '../src/lib/ai-os/execution-capability';
import type {
  ProvisionOutcome,
  ProvisionSpec,
} from '../src/lib/ai-os/worktree-provision';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-08-07T04:00:00.000Z';
const nowMs = Date.parse(NOW);
const BASE = 'abc1234abc1234abc1234abc1234abc1234abc12';

function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? {
    id: 'global', execution_enabled: true, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: true, updated_at: NOW,
  });
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() { rowsOf(table).push({ ...row }); return Promise.resolve({ data: [{ id: 'x' }], error: null }); } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() { return Promise.resolve({ data: [], error: null }); },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

const fullEnv: Record<string, string> = {
  [EXECUTION_LEVEL_ENV]: 'bounded_code_execution',
  SUPABASE_RUNTIME_ENV: 'staging',
  DISABLE_REMOTE_RUNNER: 'false',
  ORCH_REAL_CLAUDE_ENABLED: 'true',
  ORCH_CLAUDE_EXECUTABLE: '/usr/local/bin/claude',
  ORCH_WORKTREES_ROOT: '/srv/worktrees',
  ORCH_BASE_COMMIT: BASE,
  ORCH_ALLOWED_PATHS: 'apps/dashboard/,docs/',
  [GIT_EXECUTABLE_ENV]: '/usr/bin/git',
  [CANONICAL_REPO_ENV]: '/srv/preston-os',
};

function job(over: Partial<GoalJob> = {}): GoalJob {
  return {
    id: 'job-real-0001', goal_id: 'goal-real-0001', kind: 'documentation',
    title: 'write marker', objective: 'add a drill marker', risk_class: 'GREEN',
    assigned_role: 'claude', depends_on: [], status: 'in_progress',
    attempts: 0, requires_approval: false, approval_id: null,
    runtime_job_id: null, correlation_id: 'corr-real',
    evidence_refs: [], failure_reason: null,
    run_id: 'job-real-0001:run-1',
    run_lease_expires_at: new Date(nowMs + 600_000).toISOString(),
    created_at: NOW, updated_at: NOW,
    ...over,
  };
}

const execInput = (j: GoalJob = job()) => ({
  job: j,
  goal: { requested_by: 'owner@preston.nyc', environment: 'staging', simulation_only: true },
  runId: 'job-real-0001:run-1',
  nowMs,
  lock: {
    worktree_id: `wt-${j.id}`, job_id: j.id, owner: 'claude',
    token: 'tok-1', fence: 1, base_commit: BASE, branch: `wt/${j.id}`,
    allowed_paths: ['apps/dashboard/', 'docs/'],
    expires_at: new Date(nowMs + 600_000).toISOString(),
  },
});

// Recording git runner: worktree add / status / remove.
function makeGitFake(statusStdout: string, opts: { addFails?: boolean; statusFails?: boolean } = {}) {
  const calls: string[][] = [];
  const runner = async (s: ProvisionSpec): Promise<ProvisionOutcome> => {
    calls.push(s.args);
    const op = s.args.includes('add') ? 'add'
      : s.args.includes('status') ? 'status' : 'remove';
    if (op === 'add' && opts.addFails) return { status: 'ok', exit_code: 128, stdout: '', stderr: 'exists' };
    if (op === 'status' && opts.statusFails) return { status: 'error', exit_code: 1, stdout: '', stderr: '' };
    return { status: 'ok', exit_code: 0, stdout: op === 'status' ? statusStdout : '', stderr: '' };
  };
  return { calls, runner };
}

const claudeOk = async () => ({
  spawned: true, exit_code: 0, timed_out: false, truncated: false,
  stdout: '{"result":"done"}', stderr: '', error: null, duration_ms: 1200,
});

const seams = {
  fileExists: () => true,
  realpath: (p: string) => p,
};

describe('buildRealExecutor - composition gate', () => {
  it('returns null when the capability level is not resolved', async () => {
    const db = makeFakeDb();
    expect(await buildRealExecutor({ client: db.client, env: {} })).toBeNull();
  });

  it('returns null when owner controls forbid (owner_stop)', async () => {
    const db = makeFakeDb({ id: 'global', execution_enabled: true, owner_stop: true, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: true, updated_at: NOW });
    expect(await buildRealExecutor({ client: db.client, env: fullEnv })).toBeNull();
  });

  it('returns null when git/canonical-repo host config is missing', async () => {
    const db = makeFakeDb();
    const env = { ...fullEnv };
    delete env[GIT_EXECUTABLE_ENV];
    expect(await buildRealExecutor({ client: db.client, env })).toBeNull();
  });
});

describe('buildRealExecutor - the real bounded run', () => {
  it('provisions, runs, audits inside allowlist, completes, removes worktree', async () => {
    const db = makeFakeDb();
    const git = makeGitFake(' M apps/dashboard/docs-change.md\n');
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, ...seams,
    });
    expect(exec).not.toBeNull();
    const r = await exec!(execInput());
    expect(r).not.toBeNull();
    expect(r!.outcome).toBe('completed');
    expect(r!.executed).toBe(true);
    expect(r!.evidence_refs.join()).toContain('executed:true');
    expect(r!.evidence_refs.join()).toContain('paths_ok');
    // worktree lifecycle: add -> status -> remove, confined shapes
    const ops = git.calls.map((a) => a.includes('add') ? 'add' : a.includes('status') ? 'status' : 'remove');
    expect(ops).toEqual(['add', 'status', 'remove']);
    const addArgs = git.calls[0];
    expect(addArgs.join(' ')).toContain('/srv/worktrees/wt-job-real-0001');
    expect(addArgs.join(' ')).toContain(BASE);
  });

  it('PATH VIOLATION: an edit outside the allowlist FAILS the job even on exit 0', async () => {
    const db = makeFakeDb();
    const git = makeGitFake([
      ' M apps/dashboard/legit.ts',
      ' M packages/guards/src/index.ts', // outside allowlist - the violation
    ].join('\n') + '\n');
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, ...seams,
    });
    const r = await exec!(execInput());
    expect(r!.outcome).toBe('failed');
    expect(r!.failure_reason).toBe('path_violation');
    expect(r!.executed).toBe(true); // honest: work happened, then was discarded
    // worktree removed => the offending edits are gone with it
    expect(git.calls.some((a) => a.includes('remove'))).toBe(true);
  });

  it('rename escaping the allowlist is a violation (both sides audited)', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('R  apps/dashboard/a.ts -> secrets/b.ts\n');
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, ...seams,
    });
    const r = await exec!(execInput());
    expect(r!.outcome).toBe('failed');
    expect(r!.failure_reason).toBe('path_violation');
  });

  it('unreadable post-run status cannot prove confinement => failed', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('', { statusFails: true });
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, ...seams,
    });
    const r = await exec!(execInput());
    expect(r!.outcome).toBe('failed');
    expect(r!.failure_reason).toBe('worktree_audit_unreadable');
    expect(git.calls.some((a) => a.includes('remove'))).toBe(true);
  });

  it('provision failure declines to simulation (null), nothing spawned', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('', { addFails: true });
    const claude = vi.fn(claudeOk);
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claude, ...seams,
    });
    const r = await exec!(execInput());
    expect(r).toBeNull();
    expect(claude).not.toHaveBeenCalled();
  });

  it('ineligible kind (migration) declines to simulation, worktree removed', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('');
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, ...seams,
    });
    const r = await exec!(execInput(job({ kind: 'migration', risk_class: 'YELLOW' })));
    expect(r).toBeNull();
    expect(git.calls.some((a) => a.includes('remove'))).toBe(true);
  });

  it('per-job re-resolve: owner_stop flipped after composition declines the job', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('');
    const claude = vi.fn(claudeOk);
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claude, ...seams,
    });
    Object.assign(db.rowsOf('system_controls')[0], { owner_stop: true });
    const r = await exec!(execInput());
    expect(r).toBeNull();
    expect(claude).not.toHaveBeenCalled();
    expect(git.calls.length).toBe(0); // declined BEFORE provisioning anything
  });

  it('agent process failure (nonzero exit) is a FAILED result with evidence', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('');
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: async () => ({
        spawned: true, exit_code: 1, timed_out: false, truncated: false,
        stdout: '', stderr: 'lint failed', error: null, duration_ms: 900,
      }),
      ...seams,
    });
    const r = await exec!(execInput());
    expect(r).not.toBeNull();
    expect(r!.outcome).toBe('failed');
    expect(git.calls.some((a) => a.includes('remove'))).toBe(true);
  });
});

// Stage 11R-02 regression: every decline-to-simulation must surface a
// structured reason (silent null returns cost a live drill to diagnose).
describe('buildRealExecutor - decline observability', () => {
  it('compose-stage decline logs capability_not_resolved with reasons', async () => {
    const db = makeFakeDb();
    const entries: Record<string, unknown>[] = [];
    const exec = await buildRealExecutor({
      client: db.client, env: {}, log: (f) => entries.push(f),
    });
    expect(exec).toBeNull();
    expect(entries.length).toBe(1);
    expect(entries[0].event).toBe('real_executor_decline');
    expect(entries[0].stage).toBe('compose');
    expect(entries[0].reason).toBe('capability_not_resolved');
    expect(Array.isArray(entries[0].reasons)).toBe(true);
  });

  it('provision failure logs the exact provision reason (worktree_add_failed)', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('', { addFails: true });
    const entries: Record<string, unknown>[] = [];
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, log: (f) => entries.push(f), ...seams,
    });
    const r = await exec!(execInput());
    expect(r).toBeNull(); // decline -> simulation, unchanged semantics
    const d = entries.find((e) => e.reason === 'worktree_add_failed');
    expect(d).toBeDefined();
    expect(d!.event).toBe('real_executor_decline');
    expect(d!.stage).toBe('job');
    // detail carries git's stderr tail (11R-05 live finding: a bare
    // "ok:255" forced blind diagnosis of a service-only failure).
    expect(d!.detail).toBe('ok:128:exists');
    expect(d!.job_id).toBe('job-real-0001');
    expect(d!.goal_id).toBe('goal-real-0001');
  });

  it('provision decline detail bounds and collapses long stderr', async () => {
    const db = makeFakeDb();
    const noisy = 'fatal: something went wrong\n' + 'x'.repeat(2000);
    const git = {
      runner: async (s: ProvisionSpec): Promise<ProvisionOutcome> => {
        if (s.args.includes('add')) {
          return { status: 'ok', exit_code: 255, stdout: '', stderr: noisy };
        }
        return { status: 'ok', exit_code: 0, stdout: '', stderr: '' };
      },
    };
    const entries: Record<string, unknown>[] = [];
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, log: (f) => entries.push(f), ...seams,
    });
    const r = await exec!(execInput());
    expect(r).toBeNull();
    const d = entries.find((e) => e.reason === 'worktree_add_failed');
    expect(d).toBeDefined();
    const detail = String(d!.detail);
    expect(detail.startsWith('ok:255:')).toBe(true);
    expect(detail.length).toBeLessThanOrEqual('ok:255:'.length + 400);
    expect(detail).not.toContain('\n');
  });

  it('per-job capability downgrade logs capability_downgraded with job binding', async () => {
    const db = makeFakeDb();
    const git = makeGitFake('');
    const entries: Record<string, unknown>[] = [];
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, log: (f) => entries.push(f), ...seams,
    });
    Object.assign(db.rowsOf('system_controls')[0], { owner_stop: true });
    const r = await exec!(execInput());
    expect(r).toBeNull();
    const d = entries.find((e) => e.reason === 'capability_downgraded');
    expect(d).toBeDefined();
    expect(d!.stage).toBe('job');
    expect(d!.job_id).toBe('job-real-0001');
    expect(git.calls.length).toBe(0);
  });

  it('a successful real run emits NO decline entries (observability only)', async () => {
    const db = makeFakeDb();
    const git = makeGitFake(' M apps/dashboard/docs-change.md\n');
    const entries: Record<string, unknown>[] = [];
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner,
      claudeRunner: claudeOk, log: (f) => entries.push(f), ...seams,
    });
    const r = await exec!(execInput());
    expect(r!.outcome).toBe('completed');
    expect(r!.executed).toBe(true);
    expect(entries.length).toBe(0);
  });
});
