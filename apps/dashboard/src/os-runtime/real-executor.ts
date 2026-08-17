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
// Provider dispatch (P2/Codex gate): the executor selects the adapter by
// job.assigned_role - runRealClaudeJob for 'claude', runRealCodexJob for
// 'codex'. Each adapter has its OWN owner env gate + executable
// (ORCH_REAL_CLAUDE_ENABLED/ORCH_CLAUDE_EXECUTABLE vs
// ORCH_REAL_CODEX_ENABLED/ORCH_CODEX_EXECUTABLE); with the codex gate absent,
// a codex job's probe returns 'unavailable' and it declines to simulation -
// exactly the prior behavior. Any other role has no real adapter and declines.

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
import { runRealCodexJob } from '../lib/ai-os/real-codex-adapter';
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
  // Structured decline observability (Stage 11R-02): every silent
  // null-return (decline -> simulation fallback) reports a static reason
  // code through this sink. Reason codes only - never env values, paths
  // from config, tokens, or process output.
  log?: (fields: Record<string, unknown>) => void;
  // Test seams; production callers omit them.
  gitRunner?: ProvisionRunner;
  claudeRunner?: Parameters<typeof runRealClaudeJob>[0]['runner'];
  codexRunner?: Parameters<typeof runRealCodexJob>[0]['runner'];
  fileExists?: (p: string) => boolean;
  realpath?: (p: string) => string;
}

// Evidence ref for a declined-real / audit outcome so the decision trail is
// visible on the job row even when we fall back or fail.
function auditRef(jobId: string, runId: string, note: string): string {
  return `real-audit:job:${jobId}:run:${runId}:${note}`;
}

// Durable provider attribution (T-mode review F6, 2026-08-17): evidence_refs
// and the result log line carried no provider identity, so a two-provider
// goal could not prove WHICH adapter executed WHICH job from the run-scoped
// record alone (goal_jobs.assigned_role is mutable outside the run). One
// additional ref per real result closes it without touching the pinned
// real:*/real-audit:* shapes.
function providerRef(jobId: string, runId: string, role: string): string {
  return `real-provider:job:${jobId}:run:${runId}:role:${role}`;
}

// Strict real-execution mode (T-mode review F2, 2026-08-17): by default a
// per-job decline (provision failure, adapter refusal) falls back to the
// Phase 7 simulation adapter - correct for staging bring-up, but in a
// posture that INTENDS real execution it silently "sim-completes" work a
// broken provider never did. With this env flag set to 'true' those
// declines FAIL the job honestly instead (executed:false, reason coded).
// capability_downgraded keeps the sim fallback in both modes: an owner
// downgrade is an intentional posture change, not a broken provider.
export const REQUIRE_REAL_ENV = 'ORCH_REQUIRE_REAL_EXECUTION';

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
  const decline = (fields: Record<string, unknown>) =>
    deps.log?.({ event: 'real_executor_decline', ...fields });
  // Real-result observability (11R-06 live gap, 2026-08-10): a real run
  // that FAILED left no log line at all - only declines were logged - so
  // a failed first attempt was invisible and its retry collision was the
  // only symptom. Every real result now emits one bounded line; secrets
  // never enter these fields (evidence refs + reason codes only).
  const logResult = (
    r: RealExecutionResult,
    ids: { job_id: string; goal_id: string; run_id: string } &
      Record<string, unknown>,
  ): RealExecutionResult => {
    deps.log?.({
      event: 'real_executor_result', outcome: r.outcome,
      executed: r.executed, failure_reason: r.failure_reason ?? null,
      evidence_count: r.evidence_refs.length, ...ids,
    });
    return r;
  };
  if (!level0.realExecutionAllowed) {
    decline({ stage: 'compose', reason: 'capability_not_resolved',
      reasons: level0.reasons });
    return null;
  }

  const gitExe = String(deps.env[GIT_EXECUTABLE_ENV] ?? '').trim();
  const canonicalRepo = String(deps.env[CANONICAL_REPO_ENV] ?? '').trim();
  const worktreesRoot = String(deps.env['ORCH_WORKTREES_ROOT'] ?? '').trim();
  const baseCommit = String(deps.env['ORCH_BASE_COMMIT'] ?? '').trim();
  if (!gitExe || !isAbsolute(gitExe)) {
    decline({ stage: 'compose', reason: 'git_executable_invalid' });
    return null;
  }
  if (!canonicalRepo || !isAbsolute(canonicalRepo)) {
    decline({ stage: 'compose', reason: 'canonical_repo_invalid' });
    return null;
  }
  if (!worktreesRoot || !baseCommit) {
    decline({ stage: 'compose', reason: 'worktrees_root_or_base_missing' });
    return null;
  }

  const gitRunner = deps.gitRunner ?? makeGitProcessRunner(deps.env);
  const requireReal =
    String(deps.env[REQUIRE_REAL_ENV] ?? '').trim() === 'true';

  const executor: RealJobExecutor = async (input) => {
    const { job, goal, runId, nowMs, lock } = input;
    const role = job.assigned_role === 'codex' ? 'codex' : 'claude';
    // Strict-mode honest failure for provider-broken declines (F2). The
    // decline log line still fires at the call site; this converts the
    // silent null (sim fallback) into a persisted failed attempt.
    const failReal = (reason: string): RealExecutionResult => logResult({
      outcome: 'failed', executed: false,
      evidence_refs: [
        auditRef(job.id, runId, `real_required:${reason}`),
        providerRef(job.id, runId, role),
      ],
      failure_reason: `real_required:${reason}`,
      summary: 'strict real mode: decline is a failure, not a simulation',
    }, { job_id: job.id, goal_id: job.goal_id, run_id: runId, role });

    // Re-resolve the capability EVERY job (owner may have downgraded).
    const controls = await readSystemControlsChecked(deps.client);
    const level = resolveExecutionLevel({
      env: deps.env,
      controls: controls.controls,
      controlsReadOk: controls.readOk,
    });
    if (!level.realExecutionAllowed) {
      decline({ stage: 'job', reason: 'capability_downgraded',
        reasons: level.reasons, job_id: job.id, goal_id: job.goal_id,
        run_id: runId, role });
      // Intentional in BOTH modes: an owner downgrade means simulation is
      // the ruled posture - not a provider failure (F2 scope note).
      return null;
    }

    // Provision the real isolated worktree for THIS job.
    const prov = await provisionWorktree({
      gitExecutable: gitExe,
      canonicalRepo,
      worktreesRoot,
      jobId: job.id,
      baseCommit,
      runner: gitRunner,
    });
    if (!prov.ok) { // decline -> simulation (or honest failure in strict mode)
      decline({ stage: 'job', reason: prov.reason ?? 'provision_failed',
        detail: prov.detail ?? null, job_id: job.id, goal_id: job.goal_id,
        run_id: runId, role });
      return requireReal ? failReal(prov.reason ?? 'provision_failed') : null;
    }

    try {
      // The approval record travels with the job when it was gated; the
      // adapter re-verifies it authoritatively (defense in depth).
      const approvalRecord = job.approval_id
        ? await readApprovalRecord(deps.client, job.approval_id)
        : undefined;

      // The driver's structural lock ref widens to the adapter's full
      // WorktreeLock shape here; repo is fixed and acquired_at is this
      // run's clock (identity/fence/expiry are what confinement checks).
      const adapterInput = {
        env: deps.env,
        controls,
        goal,
        job,
        approvalRecord,
        runId,
        nowMs,
        lock: {
          ...lock,
          repo: 'preston-os',
          acquired_at: new Date(nowMs).toISOString(),
        },
        worktreePath: prov.target.worktreePath,
        treeDirty: false,
        fileExists: deps.fileExists,
        realpath: deps.realpath,
      };
      // Provider dispatch by assigned_role. Each adapter self-gates on its
      // own env/executable; an unconfigured provider declines to simulation.
      const result = job.assigned_role === 'codex'
        ? await runRealCodexJob({ ...adapterInput, runner: deps.codexRunner })
        : await runRealClaudeJob({ ...adapterInput, runner: deps.claudeRunner });

      if (result.outcome === 'unavailable' || result.outcome === 'blocked') {
        // Adapter refused (posture/contract/confinement). Decline to
        // simulation rather than failing the job - the refusal reasons are
        // preconditions, not work outcomes. In strict real mode the refusal
        // IS the work outcome: fail honestly (F2).
        decline({ stage: 'job', reason: 'adapter_refused',
          outcome: result.outcome, failure_reason: result.failure_reason,
          job_id: job.id, goal_id: job.goal_id, run_id: runId, role });
        return requireReal
          ? failReal(result.failure_reason ?? 'adapter_refused')
          : null;
      }

      // POST-RUN PATH ENFORCEMENT: enumerate every touched path; any edit
      // outside the allowlist fails the job regardless of agent exit code.
      const audit = await auditWorktree({
        gitExecutable: gitExe,
        worktreePath: prov.target.worktreePath,
        allowedPaths: lock.allowed_paths,
        runner: gitRunner,
      });
      // Bounded, already-sanitized child output excerpts travel with the
      // result log line (11R-09 live gap: exit_1 was visible but the
      // child's stderr was not - two blind drill cycles).
      const proc = (result as unknown as {
        process?: {
          stderr_excerpt?: string; stdout_excerpt?: string;
          child_env_keys?: string[]; child_home?: string | null;
        };
      }).process;
      const bound = (s?: string) =>
        s ? s.replace(/\s+/g, ' ').trim().slice(-300) : null;
      const ids = {
        job_id: job.id, goal_id: job.goal_id, run_id: runId, role,
        stderr_excerpt: bound(proc?.stderr_excerpt),
        stdout_excerpt: bound(proc?.stdout_excerpt),
        // Spawn-context fingerprint (11R-14): names + HOME path, no values.
        child_env_keys: proc?.child_env_keys ?? null,
        child_home: proc?.child_home ?? null,
      };
      if (!audit.ok || !audit.audit) {
        return logResult({
          outcome: 'failed', executed: true,
          evidence_refs: [
            ...result.evidence_refs,
            auditRef(job.id, runId, 'status_unreadable'),
            providerRef(job.id, runId, role),
          ],
          failure_reason: 'worktree_audit_unreadable',
          summary: 'real run completed but confinement could not be proven',
        }, ids);
      }
      if (!audit.audit.ok) {
        return logResult({
          outcome: 'failed', executed: true,
          evidence_refs: [
            ...result.evidence_refs,
            auditRef(job.id, runId,
              `path_violation:${audit.audit.violations.length}`),
            providerRef(job.id, runId, role),
          ],
          failure_reason: 'path_violation',
          summary: 'real run touched paths outside the allowlist; ' +
            'edits discarded with the worktree',
        }, ids);
      }

      const summaryNote = audit.audit.dirty
        ? `touched:${audit.audit.touched.length}`
        : 'clean';
      return logResult({
        outcome: result.outcome === 'completed' ? 'completed' : 'failed',
        executed: result.executed,
        evidence_refs: [
          ...result.evidence_refs,
          auditRef(job.id, runId, `paths_ok:${summaryNote}`),
          providerRef(job.id, runId, role),
        ],
        failure_reason: result.failure_reason,
        summary: result.summary,
      }, ids);
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
