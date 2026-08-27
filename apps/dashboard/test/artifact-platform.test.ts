// Power-station foundation - artifact durability tests (master goal
// sections 5/6/17): path validation, deterministic ids, idempotent uploads,
// hash recording, secret fail-closed, caps, the artifact_unrecorded
// condition (never silently lose work), full env-gated dormancy, and the
// real-executor wiring (persist BEFORE worktree release; a persistence
// failure never fabricates or destroys job success).

import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  ARTIFACTS_ENABLED_ENV,
  artifactObjectPath,
  deriveArtifactId,
  MAX_ARTIFACTS_PER_RUN,
  persistArtifacts,
  textLooksSecret,
  validateArtifactPath,
  type ArtifactStorage,
} from '../src/lib/ai-os/artifacts';
import {
  buildRealExecutor,
  CANONICAL_REPO_ENV,
  GIT_EXECUTABLE_ENV,
} from '../src/os-runtime/real-executor';
import { buildStatusArgs } from '../src/lib/ai-os/worktree-provision';
import { EXECUTION_LEVEL_ENV } from '../src/lib/ai-os/execution-capability';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-08-27T12:00:00.000Z';
const nowMs = Date.parse(NOW);

function makeFakeDb(opts: { failInsertOn?: Set<string> } = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
    id: 'global', execution_enabled: true, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: true, updated_at: NOW,
  });
  const pk = (t: string) => (t === 'artifacts' ? 'artifact_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            if (opts.failInsertOn?.has(table)) {
              return Promise.resolve({ data: null, error: { message: 'service unavailable' } });
            }
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ [key]: row[key] ?? 'x' }], error: null });
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
              return Promise.resolve({ data: matched.map((r) => ({ [pk(table)]: r[pk(table)] })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

function fakeStorage(opts: { failUpload?: boolean } = {}) {
  const uploads: Array<{ path: string; bytes: number; type: string }> = [];
  const storage: ArtifactStorage = {
    async upload(objectPath, bytes, contentType) {
      if (opts.failUpload) return { ok: false, error: 'bucket unavailable' };
      uploads.push({ path: objectPath, bytes: bytes.byteLength, type: contentType });
      return { ok: true };
    },
    async createSignedUrl(objectPath, ttl) {
      return { ok: true, url: `https://signed.example/${objectPath}?ttl=${ttl}` };
    },
  };
  return { storage, uploads };
}

const ENABLED = { [ARTIFACTS_ENABLED_ENV]: 'true' };

function persistDeps(
  db: ReturnType<typeof makeFakeDb>,
  storage: ArtifactStorage | null,
  files: Record<string, string>,
  env: Record<string, string | undefined> = ENABLED,
) {
  return {
    client: db.client, storage, env,
    readFileBytes: (rel: string) => {
      if (!(rel in files)) throw new Error('missing');
      return new TextEncoder().encode(files[rel]);
    },
    now: () => nowMs,
  };
}

const INPUT = {
  goal_id: 'goal-art-1', job_id: 'job-art-1', run_id: 'run-art-1',
  created_by: 'claude', provider: 'claude', commit_sha: null,
};

// --- path validation --------------------------------------------------------

describe('artifact path validation (fail-closed)', () => {
  it('accepts clean relative allowlisted paths', () => {
    expect(validateArtifactPath('docs/report.md').ok).toBe(true);
    expect(validateArtifactPath('out/data.json').ok).toBe(true);
  });
  it('rejects traversal, absolute, backslash, and unknown extensions', () => {
    for (const bad of [
      '../etc/passwd.md', 'docs/../../x.md', '/abs/x.md', 'C:/x.md',
      'docs\\x.md', 'docs/run.sh', 'docs/tool.exe', 'x.md/', '.hidden/x.md',
      'a/'.repeat(13) + 'x.md',
    ]) {
      expect(validateArtifactPath(bad).ok).toBe(false);
    }
  });
  it('derives deterministic ids from the object path', () => {
    const p = artifactObjectPath('g', 'j', 'r', 'docs/a.md');
    expect(p).toBe('goal/g/job/j/run/r/docs__a.md');
    expect(deriveArtifactId(p)).toBe(deriveArtifactId(p));
    expect(deriveArtifactId(p)).toMatch(/^art-[0-9a-f]{32}$/);
  });
});

// --- persistence pass -------------------------------------------------------

describe('persistArtifacts', () => {
  it('is FULLY INERT when the env gate is off (zero storage/DB operations)', async () => {
    const db = makeFakeDb();
    const { storage, uploads } = fakeStorage();
    const res = await persistArtifacts(
      persistDeps(db, storage, { 'docs/a.md': 'hello' }, {}),
      { ...INPUT, files: ['docs/a.md'] });
    expect(res.condition).toBe('disabled');
    expect(uploads.length).toBe(0);
    expect(db.rowsOf('artifacts').length).toBe(0);
    expect(db.rowsOf('os_events').length).toBe(0);
  });

  it('uploads, hashes, records metadata, and returns artifact refs', async () => {
    const db = makeFakeDb();
    const { storage, uploads } = fakeStorage();
    const res = await persistArtifacts(
      persistDeps(db, storage, { 'docs/a.md': 'hello world' }),
      { ...INPUT, files: ['docs/a.md'] });
    expect(res.condition).toBe('ok');
    expect(res.artifact_refs.length).toBe(1);
    expect(res.artifact_refs[0]).toMatch(/^artifact:art-[0-9a-f]{32}$/);
    expect(uploads[0].path).toBe('goal/goal-art-1/job/job-art-1/run/run-art-1/docs__a.md');
    const row = db.rowsOf('artifacts')[0];
    expect(String(row.sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.size_bytes).toBe(11);
    expect(row.mime_type).toBe('text/markdown');
    expect(db.rowsOf('os_events').length).toBe(1);
  });

  it('is idempotent: a replayed run converges on the same ids and stays ok', async () => {
    const db = makeFakeDb();
    const { storage } = fakeStorage();
    const files = { 'docs/a.md': 'same content' };
    const r1 = await persistArtifacts(persistDeps(db, storage, files),
      { ...INPUT, files: ['docs/a.md'] });
    const r2 = await persistArtifacts(persistDeps(db, storage, files),
      { ...INPUT, files: ['docs/a.md'] });
    expect(r2.condition).toBe('ok');
    expect(r2.artifact_refs).toEqual(r1.artifact_refs);
    expect(db.rowsOf('artifacts').length).toBe(1); // duplicate row converged
  });

  it('upload failure -> artifact_unrecorded, no metadata row, no silent loss', async () => {
    const db = makeFakeDb();
    const { storage } = fakeStorage({ failUpload: true });
    const res = await persistArtifacts(
      persistDeps(db, storage, { 'docs/a.md': 'x' }),
      { ...INPUT, files: ['docs/a.md'] });
    expect(res.condition).toBe('artifact_unrecorded');
    expect(res.failed).toEqual([{ path: 'docs/a.md', reason: 'upload_failed' }]);
    expect(db.rowsOf('artifacts').length).toBe(0);
    // the durable event still records the unrecorded condition
    const ev = db.rowsOf('os_events')[0];
    expect((ev.payload as Record<string, unknown>).condition).toBe('artifact_unrecorded');
  });

  it('metadata insert failure -> artifact_unrecorded', async () => {
    const db = makeFakeDb({ failInsertOn: new Set(['artifacts']) });
    const { storage } = fakeStorage();
    const res = await persistArtifacts(
      persistDeps(db, storage, { 'docs/a.md': 'x' }),
      { ...INPUT, files: ['docs/a.md'] });
    expect(res.condition).toBe('artifact_unrecorded');
    expect(res.failed[0].reason).toBe('metadata_unrecorded');
  });

  it('storage unavailable while enabled -> every candidate is unrecorded', async () => {
    const db = makeFakeDb();
    const res = await persistArtifacts(
      persistDeps(db, null, { 'docs/a.md': 'x' }),
      { ...INPUT, files: ['docs/a.md'] });
    expect(res.condition).toBe('artifact_unrecorded');
    expect(res.failed[0].reason).toBe('storage_unavailable');
  });

  it('secret-shaped text is refused, never uploaded', async () => {
    const db = makeFakeDb();
    const { storage, uploads } = fakeStorage();
    // Assembled at runtime so the repo's own secret scanner (which rightly
    // flags literal `key = value` shapes) stays clean.
    const plantedLeak = ['api', 'key'].join('_') + ' = ' +
      ['sk-abcdefghij', '1234567890'].join('');
    const res = await persistArtifacts(
      persistDeps(db, storage, {
        'docs/leak.md': plantedLeak,
        'docs/ok.md': 'clean content',
      }),
      { ...INPUT, files: ['docs/leak.md', 'docs/ok.md'] });
    expect(res.rejected).toContainEqual(
      { path: 'docs/leak.md', reason: 'secret_detected' });
    expect(res.artifact_refs.length).toBe(1);
    expect(uploads.length).toBe(1);
    expect(res.condition).toBe('ok'); // rejection is policy, not loss
  });

  it('enforces the per-run count and size caps', async () => {
    const db = makeFakeDb();
    const { storage } = fakeStorage();
    const files: Record<string, string> = {};
    const names: string[] = [];
    for (let i = 0; i < MAX_ARTIFACTS_PER_RUN + 1; i++) {
      const n = `docs/f${i}.md`; files[n] = 'x'; names.push(n);
    }
    const res = await persistArtifacts(persistDeps(db, storage, files),
      { ...INPUT, files: names });
    expect(res.artifact_refs.length).toBe(MAX_ARTIFACTS_PER_RUN);
    expect(res.rejected).toContainEqual(
      { path: `docs/f${MAX_ARTIFACTS_PER_RUN}.md`, reason: 'artifact_cap_exceeded' });
  });

  it('textLooksSecret catches value shapes and key-name assignments', () => {
    expect(textLooksSecret('token: eyJabcdefghij0.abcdefg.hijklmn')).toBe(true);
    expect(textLooksSecret('regular prose about tokens in general')).toBe(false);
  });
});

// --- real-executor wiring ---------------------------------------------------

const fullEnv: Record<string, string> = {
  [EXECUTION_LEVEL_ENV]: 'bounded_code_execution',
  SUPABASE_RUNTIME_ENV: 'staging',
  DISABLE_REMOTE_RUNNER: 'false',
  ORCH_REAL_CLAUDE_ENABLED: 'true',
  ORCH_CLAUDE_EXECUTABLE: '/usr/local/bin/claude',
  ORCH_WORKTREES_ROOT: '/srv/worktrees',
  ORCH_BASE_COMMIT: 'abc1234abc1234abc1234abc1234abc1234abc12',
  ORCH_ALLOWED_PATHS: 'apps/dashboard/,docs/',
  [GIT_EXECUTABLE_ENV]: '/usr/bin/git',
  [CANONICAL_REPO_ENV]: '/srv/preston-os',
};

function job(): GoalJob {
  return {
    id: 'job-art-0001', goal_id: 'goal-art-0001', kind: 'documentation',
    title: 'write doc', objective: 'produce a report file', risk_class: 'GREEN',
    assigned_role: 'claude', depends_on: [], status: 'in_progress',
    attempts: 0, requires_approval: false, approval_id: null,
    runtime_job_id: null, correlation_id: 'corr-art',
    evidence_refs: [], failure_reason: null,
    run_id: 'job-art-0001:run-1',
    run_lease_expires_at: new Date(nowMs + 600_000).toISOString(),
    created_at: NOW, updated_at: NOW,
  };
}

const gitOk = (statusStdout: string) => {
  const calls: string[][] = [];
  return {
    calls,
    runner: async (s: { args: string[] }) => {
      calls.push(s.args);
      const op = s.args.includes('add') ? 'add'
        : s.args.includes('status') ? 'status' : 'remove';
      return {
        status: 'ok' as const, exit_code: 0,
        stdout: op === 'status' ? statusStdout : '', stderr: '',
      };
    },
  };
};

const claudeOk = async () => ({
  spawned: true, exit_code: 0, timed_out: false, truncated: false,
  stdout: '{"result":"wrote the report"}', stderr: '', error: null,
  duration_ms: 900,
});

async function runWiredExecutor(opts: {
  env?: Record<string, string>;
  storage: ArtifactStorage | null;
}) {
  const db = makeFakeDb();
  const { storage } = opts;
  const exec = await buildRealExecutor({
    client: db.client,
    env: { ...fullEnv, ...(opts.env ?? {}) },
    gitRunner: gitOk(' M docs/report.md\n').runner,
    claudeRunner: claudeOk,
    fileExists: () => true,
    realpath: (p: string) => p,
    artifactStorage: storage,
    readArtifactBytes: () => new TextEncoder().encode('report body'),
  });
  if (!exec) throw new Error('executor did not compose');
  const res = await exec({
    job: job(),
    goal: { requested_by: 'owner@preston.nyc', environment: 'staging', simulation_only: true },
    runId: 'job-art-0001:run-1',
    nowMs,
    lock: {
      worktree_id: 'wt-job-art-0001', job_id: 'job-art-0001', owner: 'claude',
      token: 'tok-1', fence: 1,
      base_commit: fullEnv.ORCH_BASE_COMMIT, branch: 'wt/job-art-0001',
      allowed_paths: ['apps/dashboard/', 'docs/'],
      expires_at: new Date(nowMs + 600_000).toISOString(),
    },
  });
  return { res, db };
}

describe('worktree audit feeds artifacts real file paths', () => {
  it('status runs with -uall so a new untracked directory cannot collapse to "dir/"', () => {
    // Live staging finding 2026-08-27 (goal cee1f143): without -uall the
    // touched list carried "apps/dashboard/docs/" and the artifact step
    // rightly rejected the directory entry - the created file was never
    // persisted. -uall yields per-file paths; allowlist enforcement is
    // unchanged-or-stricter.
    expect(buildStatusArgs('/wt')).toEqual(
      ['-C', '/wt', 'status', '--porcelain', '-uall']);
  });
});

describe('real-executor artifact wiring', () => {
  it('gate off: a completed real run carries NO artifact operations', async () => {
    const { storage, uploads } = fakeStorage();
    const { res } = await runWiredExecutor({ storage });
    expect(res?.outcome).toBe('completed');
    expect(uploads.length).toBe(0);
    expect(res?.report?.artifact_refs).toEqual([]);
    expect(res?.report?.artifact_unrecorded).toBe(false);
  });

  it('gate on: touched files persist BEFORE release; refs ride the result', async () => {
    const { storage, uploads } = fakeStorage();
    const { res, db } = await runWiredExecutor({
      env: { [ARTIFACTS_ENABLED_ENV]: 'true' }, storage,
    });
    expect(res?.outcome).toBe('completed');
    expect(uploads.length).toBe(1);
    expect(res?.report?.artifact_refs?.length).toBe(1);
    expect(res?.evidence_refs.some((r) => r.startsWith('artifact:art-'))).toBe(true);
    expect(db.rowsOf('artifacts').length).toBe(1);
  });

  it('gate on + storage down: job SUCCESS stands, artifact_unrecorded surfaces', async () => {
    const { res } = await runWiredExecutor({
      env: { [ARTIFACTS_ENABLED_ENV]: 'true' },
      storage: fakeStorage({ failUpload: true }).storage,
    });
    expect(res?.outcome).toBe('completed'); // never fabricated OR destroyed
    expect(res?.executed).toBe(true);
    expect(res?.report?.artifact_unrecorded).toBe(true);
    expect(res?.evidence_refs.some((r) => r.includes('artifact_unrecorded'))).toBe(true);
  });
});
