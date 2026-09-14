// P0 defect C (2026-09-08): durable worker patch preservation.
//
// A completed code-changing run's edits used to exist ONLY in the isolated
// worktree, which the executor force-removes on every path. Unless the
// artifact platform was enabled (and the run touched <= 10 files) the work
// product vanished with the worktree. These suites pin the repair: the
// executor exports the worker's edits as ONE unified diff (tracked vs base
// plus a creation diff per untracked file), writes it with a sha256 sidecar
// to the host patch directory OUTSIDE the worktree BEFORE the worktree is
// removed, carries a patch:<...> evidence ref on the result, and rides the
// patch FIRST in the artifact pass when artifacts are enabled. A failure to
// preserve never fails or fabricates the job result - it surfaces as an
// explicit patch_unrecorded condition.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  buildRealExecutor,
  CANONICAL_REPO_ENV,
  GIT_EXECUTABLE_ENV,
  PATCH_DIR_ENV,
} from '../src/os-runtime/real-executor';
import { EXECUTION_LEVEL_ENV } from '../src/lib/ai-os/execution-capability';
import { ARTIFACTS_ENABLED_ENV, type ArtifactStorage } from '../src/lib/ai-os/artifacts';
import {
  auditTouchedPaths,
  buildPatchArgs,
  buildUntrackedPatchArgs,
  exportWorktreePatch,
  MAX_PATCH_BYTES,
  parsePorcelainUntracked,
  type ProvisionOutcome,
  type ProvisionSpec,
} from '../src/lib/ai-os/worktree-provision';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-09-08T04:00:00.000Z';
const nowMs = Date.parse(NOW);
const BASE = 'abc1234abc1234abc1234abc1234abc1234abc12';
const GIT = '/usr/bin/git';

function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
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
  [GIT_EXECUTABLE_ENV]: GIT,
  [CANONICAL_REPO_ENV]: '/srv/preston-os',
  [PATCH_DIR_ENV]: '/var/lib/preston/patches',
};

function job(over: Partial<GoalJob> = {}): GoalJob {
  return {
    id: 'job-patch-0001', goal_id: 'goal-patch-0001', kind: 'code',
    title: 'add helper', objective: 'add a helper', risk_class: 'GREEN',
    assigned_role: 'claude', depends_on: [], status: 'in_progress',
    attempts: 0, requires_approval: false, approval_id: null,
    runtime_job_id: null, correlation_id: 'corr-patch',
    evidence_refs: [], failure_reason: null,
    run_id: 'job-patch-0001:run-1',
    run_lease_expires_at: new Date(nowMs + 600_000).toISOString(),
    created_at: NOW, updated_at: NOW,
    ...over,
  };
}

const RUN_ID = 'job-patch-0001:run-1';
const RUN_SAFE = 'job-patch-0001-run-1';

const execInput = (j: GoalJob = job()) => ({
  job: j,
  goal: { requested_by: 'owner@preston.nyc', environment: 'staging', simulation_only: true },
  runId: RUN_ID,
  nowMs,
  lock: {
    worktree_id: `wt-${j.id}`, job_id: j.id, owner: 'claude',
    token: 'tok-1', fence: 1, base_commit: BASE, branch: `wt/${j.id}`,
    allowed_paths: ['apps/dashboard/', 'docs/'],
    expires_at: new Date(nowMs + 600_000).toISOString(),
  },
});

const TRACKED_PATCH = 'diff --git a/apps/dashboard/x.ts b/apps/dashboard/x.ts\n+edit\n';
const NEW_FILE_PATCH = 'diff --git a/docs/new.md b/docs/new.md\nnew file mode 100644\n+hello\n';

// Recording git runner with an event log shared with the patch writer so
// ORDER (patch written before worktree remove) is provable.
function makeGit(statusStdout: string, opts: {
  patchFails?: boolean; removeFails?: boolean; events?: string[]; patchStdout?: string;
} = {}) {
  const calls: string[][] = [];
  const events = opts.events ?? [];
  const runner = async (s: ProvisionSpec): Promise<ProvisionOutcome> => {
    calls.push(s.args);
    const a = s.args;
    const op = a.includes('add') ? 'add'
      : a.includes('status') ? 'status'
      : a.includes('--no-index') ? 'untracked'
      : a.includes('--binary') ? 'patch'
      : a.includes('diff') ? 'diff' : 'remove';
    events.push(`git:${op}`);
    if (op === 'patch') {
      if (opts.patchFails) return { status: 'ok', exit_code: 128, stdout: '', stderr: 'fatal: bad object' };
      return { status: 'ok', exit_code: 0, stdout: opts.patchStdout ?? TRACKED_PATCH, stderr: '' };
    }
    if (op === 'remove' && opts.removeFails) {
      return { status: 'ok', exit_code: 1, stdout: '', stderr: 'worktree busy' };
    }
    if (op === 'untracked') return { status: 'ok', exit_code: 1, stdout: NEW_FILE_PATCH, stderr: '' };
    return { status: 'ok', exit_code: 0, stdout: op === 'status' ? statusStdout : '', stderr: '' };
  };
  return { calls, runner, events };
}

const claudeOk = async () => ({
  spawned: true, exit_code: 0, timed_out: false, truncated: false,
  stdout: '{"result":"done"}', stderr: '', error: null, duration_ms: 1200,
});

function makeWriter(events: string[]) {
  const writes: Array<{ path: string; bytes: Buffer }> = [];
  const writePatchFile = (path: string, bytes: Buffer) => {
    events.push(`write:${path}`);
    writes.push({ path, bytes });
  };
  return { writes, writePatchFile };
}

function fakeStorage(): { storage: ArtifactStorage; uploads: string[] } {
  const uploads: string[] = [];
  const storage: ArtifactStorage = {
    upload: async (objectPath: string) => { uploads.push(objectPath); return { ok: true }; },
  } as unknown as ArtifactStorage;
  return { storage, uploads };
}

const STATUS_TWO = ' M apps/dashboard/x.ts\n?? docs/new.md\n';

async function run(opts: {
  status: string; env?: Record<string, string>; patchFails?: boolean; removeFails?: boolean;
  storage?: ArtifactStorage; claude?: typeof claudeOk; patchStdout?: string;
}) {
  const db = makeFakeDb();
  const events: string[] = [];
  const git = makeGit(opts.status, {
    patchFails: opts.patchFails, removeFails: opts.removeFails,
    events, patchStdout: opts.patchStdout,
  });
  const writer = makeWriter(events);
  const exec = await buildRealExecutor({
    client: db.client, env: { ...fullEnv, ...(opts.env ?? {}) },
    gitRunner: git.runner, claudeRunner: opts.claude ?? claudeOk,
    fileExists: () => true, realpath: (p: string) => p,
    writePatchFile: writer.writePatchFile,
    ...(opts.storage ? { artifactStorage: opts.storage } : {}),
    readArtifactBytes: () => new TextEncoder().encode('file body'),
    log: (f) => events.push(`log:${String(f.event)}`),
  });
  if (!exec) throw new Error('executor did not compose');
  const res = await exec(execInput());
  return { res, db, git, writer, events };
}

describe('executor - patch preserved BEFORE worktree removal', () => {
  it('exports tracked + untracked edits, writes patch + sha256 sidecar, refs the result', async () => {
    const { res, git, writer, events } = await run({ status: STATUS_TWO });
    expect(res?.outcome).toBe('completed');
    // Both read-only builders ran, with the expected argv shapes.
    expect(git.calls).toContainEqual(buildPatchArgs('/srv/worktrees/wt-job-patch-0001', BASE));
    expect(git.calls).toContainEqual(
      buildUntrackedPatchArgs('/srv/worktrees/wt-job-patch-0001', 'docs/new.md'));
    // Patch + sidecar written under ORCH_PATCH_DIR/<job>/<run>.patch.
    const patchPath = `/var/lib/preston/patches/job-patch-0001/${RUN_SAFE}.patch`;
    expect(writer.writes.map((w) => w.path)).toEqual([patchPath, `${patchPath}.sha256`]);
    const bytes = writer.writes[0].bytes;
    expect(bytes.toString('utf8')).toBe(TRACKED_PATCH + NEW_FILE_PATCH);
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(writer.writes[1].bytes.toString('utf8')).toBe(`${sha}  ${RUN_SAFE}.patch\n`);
    // Evidence ref + report fields.
    const ref = `patch:job:job-patch-0001:run:${RUN_ID}:sha256:${sha.slice(0, 16)}`;
    expect(res?.evidence_refs).toContain(ref);
    const report = res?.report as Record<string, unknown>;
    expect(report.patch_ref).toBe(ref);
    expect(report.patch_sha256).toBe(sha);
    expect(report.patch_bytes).toBe(bytes.length);
    expect(report.patch_path).toBe(patchPath);
    expect(report.patch_unrecorded).toBe(false);
    // ORDER: every write happened before the worktree remove.
    const removeAt = events.indexOf('git:remove');
    const writeAts = events.map((e, i) => (e.startsWith('write:') ? i : -1)).filter((i) => i >= 0);
    expect(writeAts.length).toBe(2);
    expect(writeAts.every((i) => i < removeAt)).toBe(true);
    expect(events.indexOf('git:patch')).toBeLessThan(removeAt);
    expect(events).toContain('log:patch_preserve');
  });

  it('artifacts enabled: the patch rides FIRST in the artifact pass', async () => {
    const { storage, uploads } = fakeStorage();
    const { res, db } = await run({
      status: STATUS_TWO, env: { [ARTIFACTS_ENABLED_ENV]: 'true' }, storage,
    });
    expect(res?.outcome).toBe('completed');
    const names = db.rowsOf('artifacts').map((r) => String(r.name));
    expect(names[0]).toBe(`patch/${RUN_SAFE}.patch`);
    expect(names).toContain('apps/dashboard/x.ts');
    expect(uploads.length).toBe(names.length);
    const patchRow = db.rowsOf('artifacts')[0];
    expect(patchRow.artifact_type).toBe('diff');
    const sha = createHash('sha256').update(TRACKED_PATCH + NEW_FILE_PATCH, 'utf8').digest('hex');
    expect(patchRow.sha256).toBe(sha);
  });

  it('patch export failure: job stays completed, patch_unrecorded surfaces, nothing thrown', async () => {
    const { res, writer } = await run({ status: STATUS_TWO, patchFails: true });
    expect(res?.outcome).toBe('completed');
    expect(res?.executed).toBe(true);
    expect(res?.evidence_refs.some((r) => r.includes('patch_unrecorded:patch_unreadable'))).toBe(true);
    expect(res?.evidence_refs.some((r) => r.startsWith('patch:job:'))).toBe(false);
    expect((res?.report as Record<string, unknown>).patch_unrecorded).toBe(true);
    expect(writer.writes.length).toBe(0);
  });

  it('a write failure is patch_unrecorded:write_failed, never a failed job', async () => {
    const db = makeFakeDb();
    const git = makeGit(STATUS_TWO);
    const exec = await buildRealExecutor({
      client: db.client, env: fullEnv, gitRunner: git.runner, claudeRunner: claudeOk,
      fileExists: () => true, realpath: (p: string) => p,
      writePatchFile: () => { throw new Error('disk full'); },
    });
    const res = await exec!(execInput());
    expect(res?.outcome).toBe('completed');
    expect(res?.evidence_refs.some((r) => r.includes('patch_unrecorded:write_failed'))).toBe(true);
  });

  it('a failed worktree removal is explicit in the runtime log', async () => {
    const { res, events } = await run({
      status: STATUS_TWO, removeFails: true,
    });
    expect(res?.outcome).toBe('completed');
    expect(events).toContain('log:worktree_release');
  });

  it('a secret-shaped string in the worker edits is never written: patch_unrecorded:secret_screen', async () => {
    // Same screen the artifact platform applies. The token below is a
    // synthetic secret-shaped string assembled at test time (never a real
    // credential, never present in the repository text).
    const fake = 'ghp_' + 'A'.repeat(36);
    const { res, writer, events } = await run({
      status: STATUS_TWO,
      patchStdout: `diff --git a/apps/dashboard/x.ts b/apps/dashboard/x.ts\n+const t = "${fake}";\n`,
      env: { [ARTIFACTS_ENABLED_ENV]: 'true' },
    });
    expect(res?.outcome).toBe('completed'); // the job result stands
    expect(writer.writes).toHaveLength(0); // nothing reached the patch dir
    const report = res?.report as Record<string, unknown>;
    expect(report.patch_unrecorded).toBe(true);
    expect(report.patch_unrecorded_reason).toBe('secret_screen');
    expect(res?.evidence_refs.some((r) => r.includes('patch_unrecorded:secret_screen'))).toBe(true);
    expect(res?.evidence_refs.some((r) => r.startsWith('patch:job:'))).toBe(false);
    expect(JSON.stringify(res).includes(fake)).toBe(false); // the value never leaks into the result
    expect(events).toContain('log:patch_preserve');
  });

  it('a relative ORCH_PATCH_DIR is patch_unrecorded:patch_dir_invalid (executor still composes)', async () => {
    const { res, writer } = await run({ status: STATUS_TWO, env: { [PATCH_DIR_ENV]: 'relative/patches' } });
    expect(res?.outcome).toBe('completed');
    expect(res?.evidence_refs.some((r) => r.includes('patch_unrecorded:patch_dir_invalid'))).toBe(true);
    expect(writer.writes.length).toBe(0);
  });

  it('unset ORCH_PATCH_DIR defaults to <ORCH_WORKTREES_ROOT>/patches', async () => {
    const env = { ...fullEnv };
    delete env[PATCH_DIR_ENV];
    const db = makeFakeDb();
    const git = makeGit(STATUS_TWO);
    const writer = makeWriter([]);
    const exec = await buildRealExecutor({
      client: db.client, env, gitRunner: git.runner, claudeRunner: claudeOk,
      fileExists: () => true, realpath: (p: string) => p,
      writePatchFile: writer.writePatchFile,
    });
    const res = await exec!(execInput());
    expect(res?.outcome).toBe('completed');
    expect(writer.writes[0].path).toBe(`/srv/worktrees/patches/job-patch-0001/${RUN_SAFE}.patch`);
  });

  it('audit-kind run with zero touched files: no patch export, no write', async () => {
    const { res, git, writer } = await run({ status: '' });
    expect(res?.outcome).toBe('completed');
    expect(git.calls.some((a) => a.includes('--binary'))).toBe(false);
    expect(writer.writes.length).toBe(0);
    // (the job id itself contains "patch"; test the ref shapes, not the substring)
    expect(res?.evidence_refs.some((r) => r.startsWith('patch:') ||
      r.includes('patch_unrecorded'))).toBe(false);
  });

  it('path_violation run: edits are discarded, NEVER preserved', async () => {
    const { res, git, writer } = await run({
      status: ' M apps/dashboard/legit.ts\n M packages/guards/src/index.ts\n',
    });
    expect(res?.outcome).toBe('failed');
    expect(res?.failure_reason).toBe('path_violation');
    expect(git.calls.some((a) => a.includes('--binary'))).toBe(false);
    expect(writer.writes.length).toBe(0);
    // The worktree was still removed.
    expect(git.calls.some((a) => a.includes('remove'))).toBe(true);
  });
});

describe('worktree-provision - patch builders and export (unit)', () => {
  it('buildPatchArgs is the fixed read-only working-tree-vs-base diff', () => {
    expect(buildPatchArgs('/wt', BASE)).toEqual(
      ['-C', '/wt', 'diff', '--binary', '--no-color', '--no-ext-diff', '--no-renames', BASE]);
  });

  it('buildUntrackedPatchArgs is the fixed no-index creation diff', () => {
    expect(buildUntrackedPatchArgs('/wt', 'docs/new.md')).toEqual(
      ['-C', '/wt', 'diff', '--binary', '--no-color', '--no-ext-diff', '--no-index', '--',
        '/dev/null', 'docs/new.md']);
  });

  it('parsePorcelainUntracked yields only ?? paths (quoted names unquoted)', () => {
    const out = parsePorcelainUntracked(
      ' M a.ts\n?? docs/new.md\n?? "docs/with space.md"\nA  staged.ts\n');
    expect(out).toEqual(['docs/new.md', 'docs/with space.md']);
  });

  it('auditTouchedPaths carries the untracked subset (additive)', () => {
    const a = auditTouchedPaths(STATUS_TWO, '', ['apps/dashboard/', 'docs/']);
    expect(a.ok).toBe(true);
    expect(a.untracked).toEqual(['docs/new.md']);
    expect(a.touched).toEqual(['apps/dashboard/x.ts', 'docs/new.md']);
  });

  const runnerOf = (map: (a: string[]) => ProvisionOutcome) =>
    async (s: ProvisionSpec) => map(s.args);
  const ok = (stdout: string, code = 0): ProvisionOutcome =>
    ({ status: 'ok', exit_code: code, stdout, stderr: '' });

  it('concatenates tracked (exit 0) + untracked (exit 1) diffs in sorted order', async () => {
    const r = await exportWorktreePatch({
      gitExecutable: GIT, worktreePath: '/wt', baseCommit: BASE,
      untracked: ['docs/z.md', 'docs/a.md'],
      runner: runnerOf((a) => a.includes('--no-index')
        ? ok(`+${a[a.length - 1]}\n`, 1) : ok('tracked\n')),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).toBe('tracked\n+docs/a.md\n+docs/z.md\n');
      expect(r.bytes).toBe(Buffer.byteLength(r.patch, 'utf8'));
    }
  });

  it('an empty diff with no untracked files is ok with bytes 0', async () => {
    const r = await exportWorktreePatch({
      gitExecutable: GIT, worktreePath: '/wt', baseCommit: BASE, untracked: [],
      runner: runnerOf(() => ok('')),
    });
    expect(r).toEqual({ ok: true, patch: '', bytes: 0 });
  });

  it('tracked diff exit 2 / spawn error => patch_unreadable', async () => {
    const r = await exportWorktreePatch({
      gitExecutable: GIT, worktreePath: '/wt', baseCommit: BASE, untracked: [],
      runner: runnerOf(() => ok('', 2)),
    });
    expect(r).toEqual({ ok: false, reason: 'patch_unreadable' });
  });

  it('no-index exit 2 => untracked_patch_unreadable:<rel>', async () => {
    const r = await exportWorktreePatch({
      gitExecutable: GIT, worktreePath: '/wt', baseCommit: BASE, untracked: ['docs/n.md'],
      runner: runnerOf((a) => a.includes('--no-index') ? ok('', 2) : ok('')),
    });
    expect(r).toEqual({ ok: false, reason: 'untracked_patch_unreadable:docs/n.md' });
  });

  it('size cap: patch_too_large before any oversized concatenation', async () => {
    const r = await exportWorktreePatch({
      gitExecutable: GIT, worktreePath: '/wt', baseCommit: BASE, untracked: ['docs/n.md'],
      runner: runnerOf((a) => a.includes('--no-index') ? ok('x'.repeat(60), 1) : ok('y'.repeat(50))),
      maxBytes: 100,
    });
    expect(r).toEqual({ ok: false, reason: 'patch_too_large' });
    expect(MAX_PATCH_BYTES).toBe(5 * 1024 * 1024);
  });

  it('refuses traversal / absolute untracked paths without spawning', async () => {
    let spawned = 0;
    for (const bad of ['../escape.md', '/abs/file.md', 'C:/abs/file.md']) {
      const r = await exportWorktreePatch({
        gitExecutable: GIT, worktreePath: '/wt', baseCommit: BASE, untracked: [bad],
        runner: runnerOf(() => { spawned += 1; return ok(''); }),
      });
      expect(r).toEqual({ ok: false, reason: `path_invalid:${bad}` });
    }
    expect(spawned).toBe(0);
  });

  it('refuses a malformed base or non-absolute git without spawning', async () => {
    let spawned = 0;
    const runner = runnerOf(() => { spawned += 1; return ok(''); });
    expect(await exportWorktreePatch({
      gitExecutable: GIT, worktreePath: '/wt', baseCommit: 'nope', untracked: [], runner,
    })).toEqual({ ok: false, reason: 'base_commit_invalid' });
    expect(await exportWorktreePatch({
      gitExecutable: 'git', worktreePath: '/wt', baseCommit: BASE, untracked: [], runner,
    })).toEqual({ ok: false, reason: 'git_executable_not_absolute' });
    expect(spawned).toBe(0);
  });
});
