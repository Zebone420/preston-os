// Preston AI OS - Phase 8 worktree provisioner. FAIL-CLOSED.
//
// Real bounded execution needs a real isolated git worktree on the host.
// scripts/worktree_prepare.sh does this for an OWNER at a terminal; this
// module does the same three operations from the runtime, under a FIXED
// argv contract:
//
//   git -C <canonical> worktree add <root>/wt-<job> -b job/<job> <base>
//   git -C <worktree>  status --porcelain
//   git -C <canonical> worktree remove --force <root>/wt-<job>
//
// Nothing else is reachable. The argv arrays are BUILT here from validated
// components - never assembled from job text - and executed with shell:false
// by the caller-supplied runner. There is no 'push', 'remote', 'fetch',
// 'commit', 'config', or 'checkout' builder in this file, so no network or
// history-rewriting git operation can be issued through it.
//
// The provisioner also performs the POST-RUN PATH ENFORCEMENT that makes the
// path allowlist real rather than advisory: after an agent has run inside
// the worktree, `git status --porcelain` enumerates every path it touched,
// and any path outside the allowlist is a violation that fails the job.
// This is the enforcement point, because the spawned agent CLI is itself a
// general tool - cwd and a scrubbed environment confine it, but only this
// after-the-fact check can PROVE it stayed inside its lane.

import { isAbsolute } from 'node:path';

export const GIT_EXECUTABLE_BASENAMES: ReadonlySet<string> =
  Object.freeze(new Set(['git', 'git.exe']));

// Same shapes the worktree lock and the real adapter already enforce.
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE_COMMIT_RE = /^[0-9a-f]{7,40}$/i;

export interface ProvisionSpec {
  executable: string; // absolute path to git
  args: string[];
  cwd?: string;
  timeout_ms: number;
}

export interface ProvisionOutcome {
  status: 'ok' | 'error' | 'timeout' | 'spawn_error';
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

export type ProvisionRunner = (s: ProvisionSpec) => Promise<ProvisionOutcome>;

export const PROVISION_TIMEOUT_MS = 120_000;

export interface WorktreeTarget {
  jobId: string;
  worktreePath: string;
  branch: string;
}

export type PlanResult =
  | { ok: true; target: WorktreeTarget }
  | { ok: false; reason: string };

// Compute the confined worktree location for a job. Pure + validating.
export function planWorktree(
  jobId: string, worktreesRoot: string,
): PlanResult {
  if (!JOB_ID_RE.test(jobId)) return { ok: false, reason: 'job_id_invalid' };
  if (!worktreesRoot || !isAbsolute(worktreesRoot) ||
      worktreesRoot.includes('..')) {
    return { ok: false, reason: 'worktrees_root_invalid' };
  }
  const root = worktreesRoot.replace(/[/\\]+$/, '');
  return {
    ok: true,
    target: {
      jobId,
      worktreePath: `${root}/wt-${jobId}`,
      branch: `job/${jobId}`,
    },
  };
}

// --- fixed argv builders ---------------------------------------------------

export function buildWorktreeAddArgs(
  canonicalRepo: string, target: WorktreeTarget, baseCommit: string,
): string[] {
  return ['-C', canonicalRepo, 'worktree', 'add', target.worktreePath,
    '-b', target.branch, baseCommit];
}

export function buildStatusArgs(worktreePath: string): string[] {
  return ['-C', worktreePath, 'status', '--porcelain'];
}

export function buildWorktreeRemoveArgs(
  canonicalRepo: string, worktreePath: string,
): string[] {
  return ['-C', canonicalRepo, 'worktree', 'remove', '--force', worktreePath];
}

// --- porcelain parsing + path enforcement ---------------------------------

// Parse `git status --porcelain` into the set of touched paths. Handles
// renames ("R  old -> new" yields BOTH sides: a rename out of an allowed
// path into a forbidden one - or vice versa - is still a touch of both).
export function parsePorcelainPaths(stdout: string): string[] {
  const out: string[] = [];
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim().length === 0) continue;
    // Porcelain v1: XY<space>path  (X,Y are status codes, possibly spaces)
    const body = line.length > 3 ? line.slice(3) : line.trim();
    const unquote = (s: string) => {
      const t = s.trim();
      return t.startsWith('"') && t.endsWith('"') && t.length > 1
        ? t.slice(1, -1) : t;
    };
    const arrow = body.indexOf(' -> ');
    if (arrow >= 0) {
      out.push(unquote(body.slice(0, arrow)));
      out.push(unquote(body.slice(arrow + 4)));
    } else {
      out.push(unquote(body));
    }
  }
  return out.filter((p) => p.length > 0);
}

// Is a repo-relative path inside the allowlist? Allowlist entries are
// repo-relative prefixes (e.g. "apps/dashboard/"). An entry without a
// trailing slash matches that exact path or that path as a directory
// prefix - never a sibling with a shared name prefix.
export function pathAllowed(p: string, allowedPaths: string[]): boolean {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm.length === 0) return false;
  if (norm.includes('..')) return false; // never allow traversal
  if (norm.startsWith('/')) return false; // never allow absolute
  return allowedPaths.some((raw) => {
    const a = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (a.length === 0) return false;
    if (a.endsWith('/')) return norm.startsWith(a);
    return norm === a || norm.startsWith(a + '/');
  });
}

export interface PathAudit {
  ok: boolean;
  touched: string[];
  violations: string[];
  dirty: boolean;
}

// Enforce the path allowlist over a porcelain status output.
export function auditTouchedPaths(
  stdout: string, allowedPaths: string[],
): PathAudit {
  const touched = parsePorcelainPaths(stdout);
  // An empty or unusable allowlist permits NOTHING (fail closed).
  const usable = allowedPaths.filter((p) => p && !p.includes('..') &&
    !p.startsWith('/') && !isAbsolute(p));
  const violations = usable.length === 0
    ? [...touched]
    : touched.filter((p) => !pathAllowed(p, usable));
  return {
    ok: violations.length === 0,
    touched,
    violations,
    dirty: touched.length > 0,
  };
}

// --- provisioning operations ----------------------------------------------

export interface ProvisionInput {
  gitExecutable: string;
  canonicalRepo: string;
  worktreesRoot: string;
  jobId: string;
  baseCommit: string;
  runner: ProvisionRunner;
  timeoutMs?: number;
}

export type ProvisionResult =
  | { ok: true; target: WorktreeTarget }
  | { ok: false; reason: string; detail?: string };

function checkGitExecutable(exe: string): string | null {
  if (!exe || !isAbsolute(exe)) return 'git_executable_not_absolute';
  const base = exe.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!GIT_EXECUTABLE_BASENAMES.has(base)) return 'git_executable_not_allowed';
  return null;
}

// Create the isolated worktree for a job. Refuses without spawning when any
// input is malformed.
export async function provisionWorktree(
  i: ProvisionInput,
): Promise<ProvisionResult> {
  const exeErr = checkGitExecutable(i.gitExecutable);
  if (exeErr) return { ok: false, reason: exeErr };
  if (!i.canonicalRepo || !isAbsolute(i.canonicalRepo) ||
      i.canonicalRepo.includes('..')) {
    return { ok: false, reason: 'canonical_repo_invalid' };
  }
  if (!BASE_COMMIT_RE.test(i.baseCommit)) {
    return { ok: false, reason: 'base_commit_invalid' };
  }
  const plan = planWorktree(i.jobId, i.worktreesRoot);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  const res = await i.runner({
    executable: i.gitExecutable,
    args: buildWorktreeAddArgs(i.canonicalRepo, plan.target, i.baseCommit),
    timeout_ms: i.timeoutMs ?? PROVISION_TIMEOUT_MS,
  });
  if (res.status !== 'ok' || res.exit_code !== 0) {
    return {
      ok: false, reason: 'worktree_add_failed',
      detail: `${res.status}:${res.exit_code ?? 'null'}${stderrExcerpt(res.stderr)}`,
    };
  }
  return { ok: true, target: plan.target };
}

// A bounded, whitespace-collapsed tail of git's stderr for decline
// observability. Provisioning commands are local-only fixed argv (no
// network, scrubbed child env), so stderr carries fatal:/error: text and
// paths - never credentials. 11R-05 live finding (2026-08-10): a bare
// "ok:255" detail forced blind diagnosis of a service-only failure; the
// exact git message must travel with the decline.
function stderrExcerpt(stderr: string): string {
  const s = String(stderr ?? '').replace(/\s+/g, ' ').trim();
  return s ? `:${s.slice(-400)}` : '';
}

// Read the worktree's dirty state + enforce the path allowlist.
export async function auditWorktree(
  i: {
    gitExecutable: string; worktreePath: string; allowedPaths: string[];
    runner: ProvisionRunner; timeoutMs?: number;
  },
): Promise<{ ok: boolean; reason?: string; audit?: PathAudit }> {
  const exeErr = checkGitExecutable(i.gitExecutable);
  if (exeErr) return { ok: false, reason: exeErr };
  const res = await i.runner({
    executable: i.gitExecutable,
    args: buildStatusArgs(i.worktreePath),
    timeout_ms: i.timeoutMs ?? PROVISION_TIMEOUT_MS,
  });
  if (res.status !== 'ok' || res.exit_code !== 0) {
    // An unreadable status cannot prove confinement - fail closed.
    return { ok: false, reason: 'status_unreadable' };
  }
  return { ok: true, audit: auditTouchedPaths(res.stdout, i.allowedPaths) };
}

// Remove the worktree. Best-effort by design: the caller has already
// persisted its result, and a leftover directory is inert (the next job
// gets a distinct path, and re-provisioning the same job id refuses
// because `git worktree add` will not overwrite).
export async function releaseWorktree(
  i: {
    gitExecutable: string; canonicalRepo: string; worktreePath: string;
    runner: ProvisionRunner; timeoutMs?: number;
  },
): Promise<{ ok: boolean; reason?: string }> {
  const exeErr = checkGitExecutable(i.gitExecutable);
  if (exeErr) return { ok: false, reason: exeErr };
  const res = await i.runner({
    executable: i.gitExecutable,
    args: buildWorktreeRemoveArgs(i.canonicalRepo, i.worktreePath),
    timeout_ms: i.timeoutMs ?? PROVISION_TIMEOUT_MS,
  });
  return res.status === 'ok' && res.exit_code === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `worktree_remove_failed:${res.status}:${res.exit_code ?? 'null'}${stderrExcerpt(res.stderr)}`,
      };
}
