// PF1 end-to-end drill with REAL git (no fakes): provision a real worktree,
// simulate a worker that hides an out-of-allowlist edit inside a LOCAL
// commit, and prove the union audit catches it. Skips cleanly on hosts
// without a git executable (the fake-runner suites still pin the logic).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditWorktree,
  provisionWorktree,
  releaseWorktree,
} from '../src/lib/ai-os/worktree-provision';
import { makeGitProcessRunner } from '../src/os-runtime/real-executor';

function findGit(): string | null {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(probe, ['git'], { encoding: 'utf8' });
    const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

const GIT = findGit();
const JOB_ID = 'drill-pf1-0001';

describe.skipIf(!GIT)('PF1 real-git worktree drill', () => {
  let root = '';
  let repo = '';
  let wtRoot = '';
  let base = '';
  const env = { PATH: process.env.PATH, HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE };
  const runner = makeGitProcessRunner(env as Record<string, string | undefined>);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(GIT!, ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: {
        ...env,
        GIT_AUTHOR_NAME: 'drill', GIT_AUTHOR_EMAIL: 'drill@test.local',
        GIT_COMMITTER_NAME: 'drill', GIT_COMMITTER_EMAIL: 'drill@test.local',
      } as unknown as NodeJS.ProcessEnv,
    });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'pf1-drill-'));
    repo = join(root, 'canonical');
    wtRoot = join(root, 'worktrees');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wtRoot, { recursive: true });
    git(repo, 'init', '-b', 'main');
    mkdirSync(join(repo, 'apps', 'dashboard'), { recursive: true });
    writeFileSync(join(repo, 'apps', 'dashboard', 'seed.md'), 'seed\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'seed');
    base = git(repo, 'rev-parse', 'HEAD').trim();
  });

  afterAll(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('catches an out-of-allowlist edit hidden in a local commit', async () => {
    const prov = await provisionWorktree({
      gitExecutable: GIT!, canonicalRepo: repo, worktreesRoot: wtRoot,
      jobId: JOB_ID, baseCommit: base, runner,
    });
    expect(prov.ok).toBe(true);
    if (!prov.ok) return;
    const wt = prov.target.worktreePath;

    // Worker-style activity: an allowed uncommitted edit, plus a forbidden
    // edit COMMITTED so the working tree ends clean for that path.
    writeFileSync(join(wt, 'apps', 'dashboard', 'ok.md'), 'allowed\n');
    mkdirSync(join(wt, 'forbidden'), { recursive: true });
    writeFileSync(join(wt, 'forbidden', 'evil.md'), 'escaped\n');
    git(wt, 'add', 'forbidden/evil.md');
    git(wt, 'commit', '-m', 'hide the escape');

    const audit = await auditWorktree({
      gitExecutable: GIT!, worktreePath: wt,
      allowedPaths: ['apps/dashboard/'], baseCommit: base, runner,
    });
    expect(audit.ok).toBe(true);
    expect(audit.audit).toBeDefined();
    // The union sees BOTH surfaces; the committed escape is a violation.
    expect(audit.audit!.touched.sort()).toEqual([
      'apps/dashboard/ok.md', 'forbidden/evil.md',
    ]);
    expect(audit.audit!.ok).toBe(false);
    expect(audit.audit!.violations).toEqual(['forbidden/evil.md']);

    const rel = await releaseWorktree({
      gitExecutable: GIT!, canonicalRepo: repo, worktreePath: wt, runner,
    });
    expect(rel.ok).toBe(true);
  });

  it('fails closed when the base is unreachable in the worktree', async () => {
    const prov = await provisionWorktree({
      gitExecutable: GIT!, canonicalRepo: repo, worktreesRoot: wtRoot,
      jobId: 'drill-pf1-0002', baseCommit: base, runner,
    });
    expect(prov.ok).toBe(true);
    if (!prov.ok) return;
    const audit = await auditWorktree({
      gitExecutable: GIT!, worktreePath: prov.target.worktreePath,
      allowedPaths: ['apps/dashboard/'],
      baseCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      runner,
    });
    expect(audit.ok).toBe(false);
    expect(audit.reason).toBe('base_unverifiable');
    await releaseWorktree({
      gitExecutable: GIT!, canonicalRepo: repo,
      worktreePath: prov.target.worktreePath, runner,
    });
  });
});
