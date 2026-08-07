// Preston AI OS - Phase 8 real-execution composer. FAIL-CLOSED.
//
// Builds the RealJobExecutor the dispatcher injects into the durable driver
// when - and only when - the capability gate resolves BOUNDED_CODE_EXECUTION.
// This file lives in os-runtime (NOT orchestration/, which is structurally
// pinned spawn-free); it composes:
//
//   1. resolveExecutionLevel  - env + owner DB posture, fail-closed.
//   2. provisionWorktree      - real isolated git worktree for the job.
//   3. runRealClaudeJob       - the G-D3 fail-closed agent CLI adapter.
//   4. auditWorktree          - post-run path-allowlist ENFORCEMENT.
//   5. releaseWorktree        - cleanup on every path.
//
// The executor returns null (decline -> driver falls back to simulation)
// whenever any precondition is not met, so a partially-configured host can
// never half-execute. A real run that ESCAPES its path allowlist is marked
// FAILED with reason path_violation even if the agent exited 0 - the audit
// is the enforcement, not a report. The worktree is removed on every path;
// on a path violation the removal also discards the offending edits
// (git worktree remove --force), so nothing outside policy survives.
//
// Codex note: this composer is Claude-only in V1 (ORCH_CLAUDE_EXECUTABLE).
// The adapter's job contract already refuses non-claude assigned roles, so
// codex-assigned jobs decline to simulation until a codex executable gate
// is separately owner-activated.

import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { RuntimeClient } from '../lib/ai-os/store';
import { readSystemControlsChecked } from '../lib/ai-os/store';
import {
  resolveExecutionLevel,
} from '../lib/ai-os/execution-capability';
import {
  auditWorktree,
  provisionWorktree,
  releaseWorktree,
  type ProvisionOutcome,
  type ProvisionRunner,
  type ProvisionSpec,
} from '../lib/ai-os/worktree-provision';
import {
  runRealClaudeJob,
  sanitizeChildEnv,
} from '../lib/ai-os/real-claude-adapter';
import type {
  RealExecutionResult,
  RealJobExecutor,
} from '../lib/ai-os/orchestration/driver';
import { readApprovalRecord } from '../lib/ai-os/orchestration/store';

export const GIT_EXECUTABLE_ENV = 'ORCH_GIT_EXECUTABLE';
export const CANONICAL_REPO_ENV = 'ORCH_CANONICAL_REPO';

// Minimal bounded process runner for the git provisioning commands.
// argv-only, shell:false, scrubbed env, hard timeout, output caps.
export function makeGitProcessRunner(
  env: Record<string, string | undefined>,
): ProvisionRunner {
  return (spec: ProvisionSpec) => new Promise<ProvisionOutcome>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        shell: false,
        env: sanitizeChildEnv(env) as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ status: 'spawn_error', exit_code: null, stdout: '', stderr: '' });
      return;
    }
    let out = '';
    let err = '';
    let done = false;
    const finish = (o: ProvisionOutcome) => {
      if (!done) { done = true; resolve(o); }
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ status: 'timeout', exit_code: null, stdout: out, stderr: err });
    }, spec.timeout_ms);
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length < 1_000_000) out += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (err.length < 1_000_000) err += d.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish({ status: 'spawn_error', exit_code: null, stdout: out, stderr: err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({
        status: 'ok', exit_code: code, stdout: out, stderr: err,
      });
    });
  });
}

export interface RealExecutorDeps {
  client: RuntimeClient;
  env: Record<string, string | undefined>;
  // Test seams; production callers omit them.
  gitRunner?: ProvisionRunner;
  claudeRunner?: Parameters<typeof runRealClaudeJob>[0]['runner'];
  fileExists?: (p: string) => boolean;
  realpath?: (p: string) => string;
}

// Evidence ref for a declined-real / audit outcome so the decision trail is
// visible on the job row even when we fall back or fail.
function auditRef(jobId: string, runId: string, note: string): string {
  return `real-audit:job:${jobId}:run:${runId}:${note}`;
}

// Build the executor, or null when the host does not resolve
// BOUNDED_CODE_EXECUTION at composition time (dispatcher start). The
// per-job path ALSO re-resolves the level so a mid-run owner downgrade
// takes effect on the very next job.
export async function buildRealExecutor(
  deps: RealExecutorDeps,
): Promise<RealJobExecutor | null> {
  const controls0 = await readSystemControlsChecked(deps.client);
  const level0 = resolveExecutionLevel({
    env: deps.env,
    controls: controls0.controls,
    controlsReadOk: controls0.readOk,
  });
  if (!level0.realExecutionAllowed) return null;

  const gitExe = String(deps.env[GIT_EXECUTABLE_ENV] ?? '').trim();
  const canonicalRepo = String(deps.env[CANONICAL_REPO_ENV] ?? '').trim();
  const worktreesRoot = String(deps.env['ORCH_WORKTREES_ROOT'] ?? '').trim();
  const baseCommit = String(deps.env['ORCH_BASE_COMMIT'] ?? '').trim();
  if (!gitExe || !isAbsolute(gitExe)) return null;
  if (!canonicalRepo || !isAbsolute(canonicalRepo)) return null;
  if (!worktreesRoot || !baseCommit) return null;

  const gitRunner = deps.gitRunner ?? makeGitProcessRunner(deps.env);

  const executor: RealJobExecutor = async (input) => {
    const { job, goal, runId, nowMs, lock } = input;

    // Re-resolve the capability EVERY job (owner may have downgraded).
    const controls = await readSystemControlsChecked(deps.client);
    const level = resolveExecutionLevel({
      env: deps.env,
      controls: controls.controls,
      controlsReadOk: controls.readOk,
    });
    if (!level.realExecutionAllowed) return null;

    // Provision the real isolated worktree for THIS job.
    const prov = await provisionWorktree({
      gitExecutable: gitExe,
      canonicalRepo,
      worktreesRoot,
      jobId: job.id,
      baseCommit,
      runner: gitRunner,
    });
    if (!prov.ok) return null; // decline -> simulation (fail-closed fallback)

    try {
      // The approval record travels with the job when it was gated; the
      // adapter re-verifies it authoritatively (defense in depth).
      const approvalRecord = job.approval_id
        ? await readApprovalRecord(deps.client, job.approval_id)
        : undefined;

      const result = await runRealClaudeJob({
        env: deps.env,
        controls,
        goal,
        job,
        approvalRecord,
        runId,
        nowMs,
        // The driver's structural lock ref widens to the adapter's full
        // WorktreeLock shape here; repo is fixed and acquired_at is this
        // run's clock (identity/fence/expiry are what confinement checks).
        lock: {
          ...lock,
          repo: 'preston-os',
          acquired_at: new Date(nowMs).toISOString(),
        },
        worktreePath: prov.target.worktreePath,
        treeDirty: false,
        runner: deps.claudeRunner,
        fileExists: deps.fileExists,
        realpath: deps.realpath,
      });

      if (result.outcome === 'unavailable' || result.outcome === 'blocked') {
        // Adapter refused (posture/contract/confinement). Decline to
        // simulation rather than failing the job - the refusal reasons are
        // preconditions, not work outcomes.
        return null;
      }

      // POST-RUN PATH ENFORCEMENT: enumerate every touched path; any edit
      // outside the allowlist fails the job regardless of agent exit code.
      const audit = await auditWorktree({
        gitExecutable: gitExe,
        worktreePath: prov.target.worktreePath,
        allowedPaths: lock.allowed_paths,
        runner: gitRunner,
      });
      if (!audit.ok || !audit.audit) {
        return {
          outcome: 'failed', executed: true,
          evidence_refs: [
            ...result.evidence_refs,
            auditRef(job.id, runId, 'status_unreadable'),
          ],
          failure_reason: 'worktree_audit_unreadable',
          summary: 'real run completed but confinement could not be proven',
        };
      }
      if (!audit.audit.ok) {
        return {
          outcome: 'failed', executed: true,
          evidence_refs: [
            ...result.evidence_refs,
            auditRef(job.id, runId,
              `path_violation:${audit.audit.violations.length}`),
          ],
          failure_reason: 'path_violation',
          summary: 'real run touched paths outside the allowlist; ' +
            'edits discarded with the worktree',
        };
      }

      const summaryNote = audit.audit.dirty
        ? `touched:${audit.audit.touched.length}`
        : 'clean';
      return {
        outcome: result.outcome === 'completed' ? 'completed' : 'failed',
        executed: result.executed,
        evidence_refs: [
          ...result.evidence_refs,
          auditRef(job.id, runId, `paths_ok:${summaryNote}`),
        ],
        failure_reason: result.failure_reason,
        summary: result.summary,
      };
    } finally {
      // Always remove the worktree: results live in evidence + job rows;
      // on violation this also discards the out-of-policy edits.
      await releaseWorktree({
        gitExecutable: gitExe,
        canonicalRepo,
        worktreePath: prov.target.worktreePath,
        runner: gitRunner,
      });
    }
  };
  return executor;
}

export type { RealExecutionResult };
