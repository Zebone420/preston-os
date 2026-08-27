// Hardening regressions for the 2026-08-27 live audit findings (staging job
// 11a6dcf4 + prod job eeaf3d37). Each block first PINS the defect shape the
// audit reported, then the repaired behavior:
//
//   PF1  confinement audit blind to committed changes (worktree-provision)
//   F1   codex 'environment_mismatch' fell through to retryable (outcomes)
//   PF2  worker prompt required tests/commits the tool contract forbids
//   PF3  artifact object-path flattening collided across distinct sources
//   PF4  completed code-job outputs (source extensions) silently dropped
import { describe, expect, it } from 'vitest';
import { classifyFailure } from '../src/lib/ai-os/orchestration/outcomes';
import {
  auditTouchedPaths,
  auditWorktree,
  buildDiffArgs,
  parseNameOnlyPaths,
  type ProvisionOutcome,
  type ProvisionSpec,
} from '../src/lib/ai-os/worktree-provision';
import {
  artifactObjectPath,
  deriveArtifactId,
  ARTIFACTS_ENABLED_ENV,
  persistArtifacts,
  validateArtifactPath,
  type ArtifactStorage,
} from '../src/lib/ai-os/artifacts';
import { buildLevel1Prompt } from '../src/lib/ai-os/real-claude-adapter';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

const BASE = 'abc1234abc1234abc1234abc1234abc1234abc12';

// ---------------------------------------------------------------------------
describe('PF1: confinement audit covers committed AND uncommitted changes', () => {
  it('a committed out-of-allowlist path is a violation even with a clean tree', () => {
    // Reproduction: clean status (the agent committed), diff names the file.
    const audit = auditTouchedPaths('', 'packages/guards/src/index.ts\n',
      ['apps/dashboard/']);
    expect(audit.ok).toBe(false);
    expect(audit.violations).toEqual(['packages/guards/src/index.ts']);
  });

  it('union is normalized and deduplicated across the two surfaces', () => {
    const audit = auditTouchedPaths(
      ' M apps/dashboard/x.md\n?? apps\\dashboard\\y.md\n',
      'apps/dashboard/x.md\n./apps/dashboard/z.md\n',
      ['apps/dashboard/']);
    expect(audit.ok).toBe(true);
    expect(audit.touched.sort()).toEqual([
      'apps/dashboard/x.md', 'apps/dashboard/y.md', 'apps/dashboard/z.md',
    ]);
  });

  it('buildDiffArgs is the fixed read-only two-commit compare', () => {
    expect(buildDiffArgs('/wt', BASE)).toEqual(
      ['-C', '/wt', 'diff', '--name-only', '--no-renames', BASE, 'HEAD']);
  });

  it('parseNameOnlyPaths handles CRLF, quoting, and blanks', () => {
    expect(parseNameOnlyPaths('a/b.md\r\n"we ird.md"\n\n')).toEqual(
      ['a/b.md', 'we ird.md']);
  });

  const runnerWith = (diff: Partial<ProvisionOutcome>) =>
    async (s: ProvisionSpec): Promise<ProvisionOutcome> => {
      if (s.args.includes('diff')) {
        return { status: 'ok', exit_code: 0, stdout: '', stderr: '', ...diff };
      }
      return { status: 'ok', exit_code: 0, stdout: '', stderr: '' };
    };

  it('FAIL-CLOSED: malformed base SHA refuses before any git call', async () => {
    const r = await auditWorktree({
      gitExecutable: '/usr/bin/git', worktreePath: '/wt',
      allowedPaths: ['apps/'], baseCommit: 'not-a-sha',
      runner: runnerWith({}),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('base_commit_invalid');
  });

  it('FAIL-CLOSED: an uncomparable base (bad object) is base_unverifiable', async () => {
    const r = await auditWorktree({
      gitExecutable: '/usr/bin/git', worktreePath: '/wt',
      allowedPaths: ['apps/'], baseCommit: BASE,
      runner: runnerWith({ exit_code: 128, stderr: 'fatal: bad object' }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('base_unverifiable');
  });
});

// ---------------------------------------------------------------------------
describe('F1: environment_mismatch classifies TERMINAL like its Claude twin', () => {
  it('the codex spelling is terminal (was retryable:unrecognized)', () => {
    const c = classifyFailure('real_required:environment_mismatch');
    expect(c.outcome_class).toBe('TERMINAL');
    expect(c.reason).toBe('terminal:real_required:environment_mismatch');
  });

  it('claude and codex environment refusals land in the SAME class', () => {
    expect(classifyFailure('real_required:environment_not_staging').outcome_class)
      .toBe('TERMINAL');
    expect(classifyFailure('real_required:environment_mismatch').outcome_class)
      .toBe('TERMINAL');
  });

  it('genuine retryable and uncertain outcomes are preserved', () => {
    expect(classifyFailure('real_required:timeout').outcome_class)
      .toBe('RETRYABLE');
    expect(classifyFailure('real_required:provision_failed').outcome_class)
      .toBe('RETRYABLE');
    expect(classifyFailure('side_effect_uncertain:call').outcome_class)
      .toBe('UNCERTAIN');
    expect(classifyFailure('real_required:some_new_unknown').outcome_class)
      .toBe('RETRYABLE'); // fail-open-to-bounded-retry stays
  });
});

// ---------------------------------------------------------------------------
describe('PF2: the worker prompt matches the FILE-TOOLS-ONLY contract', () => {
  const prompt = () => buildLevel1Prompt({
    job: {
      id: 'j1', goal_id: 'g1', kind: 'code', title: 't', objective: 'o',
      risk_class: 'GREEN', assigned_role: 'claude', depends_on: [],
      status: 'in_progress', attempts: 0, requires_approval: false,
      approval_id: null, runtime_job_id: null, correlation_id: 'c',
      evidence_refs: [], failure_reason: null, run_id: null,
      run_lease_expires_at: null,
      created_at: '2026-08-27T00:00:00.000Z',
      updated_at: '2026-08-27T00:00:00.000Z',
    } as unknown as GoalJob,
    config: {
      executable: '/bin/claude', baseCommit: 'abc1234',
      allowedPaths: ['apps/dashboard/'], worktreesRoot: '/srv/wt',
    },
  });

  it('no longer requires tests, scanners, or a local commit', () => {
    const p = prompt();
    expect(p).not.toContain('Run the repository tests');
    expect(p).not.toContain('LOCAL commit');
  });

  it('states the capability bound and demands honest limitations', () => {
    const p = prompt();
    expect(p).toContain('FILE TOOLS ONLY');
    expect(p).toContain('no way to run commands');
    expect(p).toContain('Never commit');
    expect(p).toContain('limitations');
  });
});

// ---------------------------------------------------------------------------
describe('PF3: artifact object paths are collision-resistant', () => {
  it('the historical collision pair now maps to distinct destinations', () => {
    // Pre-fix both flattened to .../a__b.md - one object, two sources.
    const p1 = artifactObjectPath('g', 'j', 'r', 'a/b.md');
    const p2 = artifactObjectPath('g', 'j', 'r', 'a__b.md');
    expect(p1).not.toBe(p2);
    expect(deriveArtifactId(p1)).not.toBe(deriveArtifactId(p2));
  });

  it('same source stays deterministic (idempotent replay converges)', () => {
    expect(artifactObjectPath('g', 'j', 'r', 'docs/a.md'))
      .toBe(artifactObjectPath('g', 'j', 'r', 'docs/a.md'));
  });
});

// ---------------------------------------------------------------------------
// Minimal PostgREST fake + storage fake for persistArtifacts.
function makeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const pk = (t: string) => (t === 'artifacts' ? 'artifact_id' : 'id');
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ [key]: row[key] ?? 'x' }], error: null });
          } };
        },
        select() {
          const chain = () => ({
            eq() { return chain(); },
            order() { return { limit() { return Promise.resolve({ data: [], error: null }); } }; },
            limit() { return Promise.resolve({ data: [], error: null }); },
          });
          return chain();
        },
        update() {
          const chain = () => ({
            eq() { return chain(); }, lte() { return chain(); }, gt() { return chain(); },
            select() { return Promise.resolve({ data: [], error: null }); },
          });
          return chain();
        },
      };
    },
  } as unknown as RuntimeClient;
  return { client, rowsOf };
}

function makeStorage() {
  const uploads: Array<{ path: string; bytes: number }> = [];
  const storage: ArtifactStorage = {
    async upload(objectPath, bytes) {
      uploads.push({ path: objectPath, bytes: bytes.byteLength });
      return { ok: true };
    },
    async createSignedUrl(objectPath, ttl) {
      return { ok: true, url: `https://signed.example/${objectPath}?ttl=${ttl}` };
    },
  };
  return { storage, uploads };
}

const ENABLED = { [ARTIFACTS_ENABLED_ENV]: 'true' };
const INPUT = {
  goal_id: 'g-hard-1', job_id: 'j-hard-1', run_id: 'r-hard-1',
  created_by: 'claude', provider: 'claude', commit_sha: null,
};

describe('PF4: completed code-job source outputs persist as artifacts', () => {
  it('a .ts source file persists with metadata, sha, and evidence ref', async () => {
    // Pre-fix this rejected extension_not_allowed and the entire work
    // product vanished with the worktree.
    const db = makeDb();
    const { storage, uploads } = makeStorage();
    const res = await persistArtifacts({
      client: db.client, storage, env: ENABLED,
      readFileBytes: () => new TextEncoder().encode('export const x = 1;\n'),
      now: () => Date.parse('2026-08-27T12:00:00.000Z'),
    }, { ...INPUT, files: ['apps/dashboard/src/new-helper.ts'] });
    expect(res.condition).toBe('ok');
    expect(res.rejected).toEqual([]);
    expect(res.artifact_refs).toHaveLength(1);
    expect(res.artifact_refs[0]).toMatch(/^artifact:art-[0-9a-f]{32}$/);
    expect(uploads).toHaveLength(1);
    const row = db.rowsOf('artifacts')[0];
    expect(row.name).toBe('apps/dashboard/src/new-helper.ts');
    expect(row.artifact_type).toBe('code');
    expect(row.mime_type).toBe('text/plain');
    expect(String(row.sha256)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a secret-shaped source file still fails closed (never uploaded)', async () => {
    const db = makeDb();
    const { storage, uploads } = makeStorage();
    const res = await persistArtifacts({
      client: db.client, storage, env: ENABLED,
      readFileBytes: () => new TextEncoder().encode(
        'const k = "sk-' + 'ABCDEFGHIJKLMNOP12345678";\n'),
      now: () => Date.parse('2026-08-27T12:00:00.000Z'),
    }, { ...INPUT, files: ['apps/dashboard/src/leaky.ts'] });
    expect(res.artifact_refs).toEqual([]);
    expect(res.rejected).toContainEqual(
      { path: 'apps/dashboard/src/leaky.ts', reason: 'secret_detected' });
    expect(uploads).toHaveLength(0);
  });

  it('shell scripts remain refused (pinned least-privilege stance)', () => {
    expect(validateArtifactPath('scripts/run.sh').ok).toBe(false);
    expect(validateArtifactPath('scripts/run.ps1').ok).toBe(false);
  });

  it('an in-pass destination conflict is refused, never overwritten', async () => {
    // Belt test: force the conflict guard with the SAME rel twice in one
    // pass (identical destination). The second candidate must be refused
    // as object_path_conflict rather than upserted over the first.
    const db = makeDb();
    const { storage, uploads } = makeStorage();
    const res = await persistArtifacts({
      client: db.client, storage, env: ENABLED,
      readFileBytes: () => new TextEncoder().encode('same file\n'),
      now: () => Date.parse('2026-08-27T12:00:00.000Z'),
    }, { ...INPUT, files: ['docs/a.md', 'docs/a.md'] });
    expect(res.artifact_refs).toHaveLength(1);
    expect(res.rejected).toContainEqual(
      { path: 'docs/a.md', reason: 'object_path_conflict' });
    expect(uploads).toHaveLength(1);
  });
});
