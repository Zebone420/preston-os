import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  validateWorktreePath,
  validateBaseRef,
  worktreePreparePlan,
  workerPushAllowed,
  WORKTREES_ROOT,
} from '../src/lib/ai-os/worktree';

// Repo root: apps/dashboard/test -> ../../.. -> repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const VALID_COMMIT = 'a'.repeat(40);

describe('validateWorktreePath', () => {
  it('accepts a well-formed job worktree path', () => {
    expect(validateWorktreePath('/srv/worktrees/wt-5j-orchestration')).toEqual({ ok: true });
  });

  it('accepts a short single-char job dir name', () => {
    expect(validateWorktreePath('/srv/worktrees/a')).toEqual({ ok: true });
  });

  it('rejects traversal segments', () => {
    expect(validateWorktreePath('/srv/worktrees/../etc').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/wt-1/../../etc').ok).toBe(false);
  });

  it('rejects paths outside /srv/worktrees/', () => {
    expect(validateWorktreePath('/srv/preston-os').ok).toBe(false);
    expect(validateWorktreePath('/etc/passwd').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees-evil/wt-1').ok).toBe(false);
  });

  it('rejects bad characters in the job directory name', () => {
    expect(validateWorktreePath('/srv/worktrees/wt 1').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/wt;rm').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/wt$(id)').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/.hidden').ok).toBe(false);
  });

  it('rejects names longer than 64 characters', () => {
    expect(validateWorktreePath('/srv/worktrees/' + 'a'.repeat(65)).ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/' + 'a'.repeat(64)).ok).toBe(true);
  });

  it('rejects backslashes', () => {
    expect(validateWorktreePath('/srv/worktrees\\wt-1').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/wt-1\\..\\etc').ok).toBe(false);
  });

  it('rejects a null byte', () => {
    expect(validateWorktreePath('/srv/worktrees/wt-1\0/etc').ok).toBe(false);
  });

  it('rejects empty string, non-absolute paths, and a trailing slash', () => {
    expect(validateWorktreePath('').ok).toBe(false);
    expect(validateWorktreePath('srv/worktrees/wt-1').ok).toBe(false);
    expect(validateWorktreePath('/srv/worktrees/wt-1/').ok).toBe(false);
  });

  it('rejects a doubled slash (symlink-suggestive)', () => {
    expect(validateWorktreePath('/srv/worktrees//wt-1').ok).toBe(false);
    expect(validateWorktreePath('/srv//worktrees/wt-1').ok).toBe(false);
  });

  it('rejects multi-segment paths under the root', () => {
    expect(validateWorktreePath('/srv/worktrees/wt-1/sub').ok).toBe(false);
  });

  it('exposes the canonical worktrees root used by the planner', () => {
    expect(WORKTREES_ROOT).toBe('/srv/worktrees/');
  });
});

describe('validateBaseRef', () => {
  it('accepts a normal branch and a 40-hex commit', () => {
    expect(validateBaseRef('master', VALID_COMMIT)).toEqual({ ok: true });
    expect(validateBaseRef('job/5j-orchestration', VALID_COMMIT)).toEqual({ ok: true });
    expect(validateBaseRef('release-1.2.3', VALID_COMMIT)).toEqual({ ok: true });
  });

  it('rejects a branch with a traversal segment', () => {
    expect(validateBaseRef('feature/../etc', VALID_COMMIT).ok).toBe(false);
  });

  it('rejects a branch starting with a dash (option-injection shape)', () => {
    expect(validateBaseRef('--upload-pack=x', VALID_COMMIT).ok).toBe(false);
  });

  it('rejects a branch with whitespace or shell metacharacters', () => {
    expect(validateBaseRef('main; rm ' + '-rf /', VALID_COMMIT).ok).toBe(false);
    expect(validateBaseRef('main branch', VALID_COMMIT).ok).toBe(false);
  });

  it('rejects an empty branch', () => {
    expect(validateBaseRef('', VALID_COMMIT).ok).toBe(false);
  });

  it('rejects commits that are not exactly 40 lowercase-hex characters', () => {
    expect(validateBaseRef('master', 'deadbeef').ok).toBe(false);
    expect(validateBaseRef('master', 'A'.repeat(40)).ok).toBe(false);
    expect(validateBaseRef('master', 'g'.repeat(40)).ok).toBe(false);
    expect(validateBaseRef('master', 'a'.repeat(39)).ok).toBe(false);
    expect(validateBaseRef('master', 'a'.repeat(41)).ok).toBe(false);
  });
});

describe('worktreePreparePlan - happy path structure', () => {
  const req = {
    jobId: '5j-orchestration',
    baseBranch: 'master',
    baseCommit: VALID_COMMIT,
    implementer: 'claude',
    reviewer: 'codex',
  };

  it('returns an ok plan with the expected path and branch', () => {
    const plan = worktreePreparePlan(req);
    expect(plan.ok).toBe(true);
    expect(plan.worktreePath).toBe('/srv/worktrees/wt-5j-orchestration');
    expect(plan.branch).toBe('job/5j-orchestration');
    expect(plan.steps && plan.steps.length).toBeGreaterThan(0);
  });

  it('every step is a bounded argv array with no shell metacharacters', () => {
    const plan = worktreePreparePlan(req);
    expect(plan.ok).toBe(true);
    // Real shell-injection metacharacters. Braces are excluded: these argv
    // arrays are never passed through a shell (no execve via /bin/sh), and
    // '^{commit}' is valid, safe git revision syntax in argv form.
    const shellMeta = /[;&|`$()<>\\\n]/;
    for (const step of plan.steps!) {
      expect(Array.isArray(step.argv)).toBe(true);
      expect(step.argv.length).toBeGreaterThan(0);
      expect(typeof step.description).toBe('string');
      expect(step.description.length).toBeGreaterThan(0);
      for (const arg of step.argv) {
        expect(typeof arg).toBe('string');
        expect(shellMeta.test(arg)).toBe(false);
      }
    }
  });

  it('includes a git worktree add step targeting the isolated path and new branch', () => {
    const plan = worktreePreparePlan(req);
    const addStep = plan.steps!.find((s) => s.argv.includes('add') && s.argv.includes('worktree'));
    expect(addStep).toBeDefined();
    expect(addStep!.argv).toEqual([
      'git',
      'worktree',
      'add',
      '/srv/worktrees/wt-5j-orchestration',
      '-b',
      'job/5j-orchestration',
      VALID_COMMIT,
    ]);
  });

  it('marks the reviewer as read-only with no separate write worktree', () => {
    const plan = worktreePreparePlan(req);
    const reviewStep = plan.steps!.find((s) => /read-only/i.test(s.description));
    expect(reviewStep).toBeDefined();
    expect(reviewStep!.description).toMatch(/codex/);
  });
});

describe('worktreePreparePlan - refusals', () => {
  it('refuses when implementer === reviewer', () => {
    const plan = worktreePreparePlan({
      jobId: '5j-orchestration',
      baseBranch: 'master',
      baseCommit: VALID_COMMIT,
      implementer: 'claude',
      reviewer: 'claude',
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBeTruthy();
    expect(plan.steps).toBeUndefined();
  });

  it('refuses on an invalid job id', () => {
    const plan = worktreePreparePlan({
      jobId: '../etc',
      baseBranch: 'master',
      baseCommit: VALID_COMMIT,
      implementer: 'claude',
      reviewer: 'codex',
    });
    expect(plan.ok).toBe(false);
  });

  it('refuses on an invalid base branch', () => {
    const plan = worktreePreparePlan({
      jobId: '5j-orchestration',
      baseBranch: '--upload-pack=x',
      baseCommit: VALID_COMMIT,
      implementer: 'claude',
      reviewer: 'codex',
    });
    expect(plan.ok).toBe(false);
  });

  it('refuses on a malformed base commit', () => {
    const plan = worktreePreparePlan({
      jobId: '5j-orchestration',
      baseBranch: 'master',
      baseCommit: 'not-a-sha',
      implementer: 'claude',
      reviewer: 'codex',
    });
    expect(plan.ok).toBe(false);
  });

  it('refuses on empty implementer or reviewer', () => {
    expect(
      worktreePreparePlan({
        jobId: '5j-orchestration',
        baseBranch: 'master',
        baseCommit: VALID_COMMIT,
        implementer: '',
        reviewer: 'codex',
      }).ok,
    ).toBe(false);
    expect(
      worktreePreparePlan({
        jobId: '5j-orchestration',
        baseBranch: 'master',
        baseCommit: VALID_COMMIT,
        implementer: 'claude',
        reviewer: '',
      }).ok,
    ).toBe(false);
  });
});

describe('workerPushAllowed', () => {
  it('is hard-false regardless of any external state', () => {
    expect(workerPushAllowed()).toBe(false);
  });
});

describe('bash scanner scripts - syntax and self-scan', () => {
  it('scripts/worktree_prepare.sh passes bash -n', () => {
    expect(() =>
      execFileSync('bash', ['-n', 'scripts/worktree_prepare.sh'], { cwd: REPO_ROOT }),
    ).not.toThrow();
  });

  it('scripts/secret_scan.sh passes bash -n', () => {
    expect(() =>
      execFileSync('bash', ['-n', 'scripts/secret_scan.sh'], { cwd: REPO_ROOT }),
    ).not.toThrow();
  });

  it('scripts/red_boundary_scan.sh passes bash -n', () => {
    expect(() =>
      execFileSync('bash', ['-n', 'scripts/red_boundary_scan.sh'], { cwd: REPO_ROOT }),
    ).not.toThrow();
  });

  it('secret_scan.sh finds zero findings against the tracked worktree root', () => {
    const out = execFileSync('bash', ['scripts/secret_scan.sh', REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(out).toMatch(/== secret scan: 0 finding\(s\) ==/);
  });

  it('red_boundary_scan.sh finds zero findings against the tracked worktree root', () => {
    const out = execFileSync('bash', ['scripts/red_boundary_scan.sh', REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(out).toMatch(/== RED boundary scan: 0 finding\(s\) ==/);
  });
});
