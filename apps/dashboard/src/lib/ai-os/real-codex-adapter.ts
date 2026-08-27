// Preston AI OS - Codex production execution adapter. FAIL-CLOSED.
//
// The Codex sibling of real-claude-adapter.ts. Same seven-control gate, same
// bounded invocation discipline. It REUSES the provider-agnostic machinery
// from the (proven, unmodified) Claude adapter - process runner, worktree
// confinement, prompt boundary, outcome mapping, evidence refs, child-env
// allowlist - and re-implements ONLY the three things that differ per
// provider:
//
//   1. the owner env gate + executable env var (ORCH_REAL_CODEX_ENABLED /
//      ORCH_CODEX_EXECUTABLE) and a FIXED basename allowlist {codex,codex.exe};
//   2. the provider pin (job.assigned_role must be 'codex', not 'claude');
//   3. the fixed argv contract for the Codex CLI (buildCodexArgs).
//
// It is wired into the executor's role dispatch but stays INERT until the
// owner activates the Codex gate on the prod host: ORCH_REAL_CODEX_ENABLED is
// absent, so the probe returns 'unavailable' and a codex-assigned job declines
// to simulation - exactly today's behavior. Enabling it never widens Claude's
// authority: the two adapters share no gate, no executable, no env var.
//
// Every invariant the Claude adapter enforces holds here identically:
// shell:false argv-only spawn, secret-free child env, bounded output, hard
// timeout with process-TREE kill, worktree confinement (realpath escape,
// base-commit, fence, path-allowlist subset), authoritative approval binding,
// and the 0010 executed/simulation pins (never written here).

import { existsSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import type { SystemControls } from './controls';
import {
  deploymentEnvironment, strictRuntimeEnvironment,
} from './runtime-environment';
import type { GoalJob } from './orchestration/model';
import type { WorktreeLock } from './orchestration/worktree-lock';
import {
  canonicalActionHash,
  jobApprovalEnvelope,
} from './orchestration/crypto-binding';
import { verifyAuthoritativeApproval } from './orchestration/store';
import {
  buildLevel1Prompt,
  checkWorktreeConfinement,
  clampTimeoutMs,
  extractResultParts,
  makeNodeProcessRunner,
  mapProcessOutcome,
  realEvidenceRef,
  sanitizeProcessText,
  REAL_CLAUDE_MAX_OUTPUT_BYTES,
  type ProcessOutcome,
  type ProcessRunner,
  type ProcessSpec,
  type RealClaudeConfig,
  type RealOutcome,
  type RealProcessEvidence,
} from './real-claude-adapter';
import { routeModel } from './orchestration/routing';
import type { StructuredResult } from './structured-result';

// --- constants (fixed contracts; changing any is an owner-gated change) ----

export const REAL_CODEX_GATE_ENV = 'ORCH_REAL_CODEX_ENABLED';
export const REAL_CODEX_EXECUTABLE_ENV = 'ORCH_CODEX_EXECUTABLE';
export const REAL_CODEX_WORKTREES_ROOT_ENV = 'ORCH_WORKTREES_ROOT';

// FIXED executable allowlist by basename. Only the Codex CLI binary; no
// shells, no git, no package managers - so no push, deploy, or arbitrary
// command is reachable through this adapter. .cmd/.bat shims are EXCLUDED
// (Node refuses to spawn them without a shell, which this adapter never uses).
export const REAL_CODEX_EXECUTABLE_BASENAMES: ReadonlySet<string> =
  Object.freeze(new Set(['codex', 'codex.exe']));

// Level-1 kinds this adapter may run (same ceiling as the Claude adapter;
// migration/repair/unknown excluded at Level 1 by design). Declared
// independently so a change to one provider never silently changes the other.
export const REAL_CODEX_ELIGIBLE_KINDS: ReadonlySet<string> =
  Object.freeze(new Set(['documentation', 'code', 'test', 'audit',
    'recommendation']));

// Risk ceiling mirrors the codex agent contract (max_risk YELLOW).
const ALLOWED_RISK = new Set(['GREEN', 'YELLOW']);

const BASE_COMMIT_RE = /^[0-9a-f]{7,40}$/i;

function parseAllowedPaths(raw: string | undefined): string[] | null {
  const paths = String(raw ?? '')
    .split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (paths.length === 0) return null;
  const unsafe = paths.some(
    (p) => p.includes('..') || p.startsWith('/') || isAbsolute(p),
  );
  return unsafe ? null : paths;
}

// --- capability probe: NO process, NO auth, NO network --------------------

export interface RealCodexProbeInput {
  env: Record<string, string | undefined>;
  controls: SystemControls;
  controlsReadOk: boolean;
  fileExists?: (p: string) => boolean;
}

export interface RealCodexProbeResult {
  capability: 'real' | 'unavailable';
  reasons: string[]; // static reason codes only; never env values
  config: RealClaudeConfig | null;
}

export function probeRealCodexCapability(
  input: RealCodexProbeInput,
): RealCodexProbeResult {
  const { env, controls, controlsReadOk } = input;
  const fileExists = input.fileExists ?? existsSync;
  const reasons: string[] = [];

  if (env[REAL_CODEX_GATE_ENV] !== 'true') reasons.push('gate_disabled');
  if (env['DISABLE_REMOTE_RUNNER'] !== 'false') {
    reasons.push('emergency_block_active');
  }
  if (strictRuntimeEnvironment(env) === null) {
    reasons.push('runtime_env_not_allowed');
  }

  const baseCommit = String(env['ORCH_BASE_COMMIT'] ?? '').trim();
  if (!BASE_COMMIT_RE.test(baseCommit)) reasons.push('base_commit_invalid');

  const allowedPaths = parseAllowedPaths(env['ORCH_ALLOWED_PATHS']);
  if (!allowedPaths) reasons.push('allowed_paths_invalid');

  const worktreesRoot =
    String(env[REAL_CODEX_WORKTREES_ROOT_ENV] ?? '').trim();
  if (!worktreesRoot || !isAbsolute(worktreesRoot) ||
      worktreesRoot.includes('..')) {
    reasons.push('worktrees_root_invalid');
  }

  const exe = String(env[REAL_CODEX_EXECUTABLE_ENV] ?? '').trim();
  if (!exe) {
    reasons.push('executable_not_configured');
  } else {
    if (!isAbsolute(exe)) reasons.push('executable_not_absolute');
    if (exe.includes('..')) reasons.push('executable_traversal');
    if (!REAL_CODEX_EXECUTABLE_BASENAMES.has(basename(exe).toLowerCase())) {
      reasons.push('executable_not_allowlisted');
    }
    if (reasons.length === 0 && !fileExists(exe)) {
      reasons.push('executable_missing');
    }
  }

  if (!controlsReadOk) {
    reasons.push('controls_unreadable');
  } else {
    if (controls.owner_stop) reasons.push('owner_stop');
    if (controls.paused) reasons.push('paused');
    if (controls.execution_enabled !== true) reasons.push('execution_disabled');
    if (controls.remote_runner_enabled !== true) {
      reasons.push('remote_runner_disabled');
    }
  }

  if (reasons.length > 0) {
    return { capability: 'unavailable', reasons, config: null };
  }
  return {
    capability: 'real',
    reasons: [],
    config: {
      executable: exe,
      baseCommit,
      allowedPaths: allowedPaths as string[],
      worktreesRoot,
    },
  };
}

// --- job contract ---------------------------------------------------------

export interface RealCodexJobContractInput {
  job: GoalJob;
  ownerIdentity: string;
  goalEnvironment: string;
  goalSimulationOnly: boolean;
  approvalRecord?: Record<string, unknown>;
  runId: string;
  nowMs: number;
}

export type ContractCheck = { ok: true } | { ok: false; reason: string };

export function checkRealCodexJobContract(
  i: RealCodexJobContractInput,
): ContractCheck {
  const { job } = i;
  if (!Number.isFinite(i.nowMs)) {
    return { ok: false, reason: 'execution_clock_invalid' };
  }
  if (!i.ownerIdentity?.trim()) {
    return { ok: false, reason: 'owner_identity_missing' };
  }
  if (i.goalEnvironment !== deploymentEnvironment()) {
    return { ok: false, reason: 'environment_mismatch' };
  }
  if (i.goalSimulationOnly !== true) {
    return { ok: false, reason: 'simulation_pin_unexpected' };
  }
  // Provider pin: this adapter runs ONLY codex-assigned jobs. A claude (or
  // any other) job is refused here, exactly as the Claude adapter refuses
  // codex. The two never cross.
  if (job.assigned_role !== 'codex') {
    return { ok: false, reason: 'provider_not_codex' };
  }
  if (!REAL_CODEX_ELIGIBLE_KINDS.has(job.kind)) {
    return { ok: false, reason: 'kind_not_eligible' };
  }
  if (!ALLOWED_RISK.has(job.risk_class)) {
    return { ok: false, reason: 'risk_exceeds_allowed' };
  }
  if (job.status !== 'in_progress') {
    return { ok: false, reason: 'job_not_leased' };
  }
  if (!i.runId?.trim() || job.run_id !== i.runId) {
    return { ok: false, reason: 'lease_not_owned' };
  }
  const leaseMs = Date.parse(job.run_lease_expires_at ?? '');
  if (!Number.isFinite(leaseMs) || leaseMs <= i.nowMs) {
    return { ok: false, reason: 'lease_expired' };
  }
  if (job.requires_approval) {
    if (!job.approval_id) return { ok: false, reason: 'approval_missing' };
    const record = i.approvalRecord;
    const expectedHash = record
      ? canonicalActionHash(jobApprovalEnvelope({
          approval_id: job.approval_id,
          job_kind: job.kind,
          job_id: job.id,
          job_objective: job.objective,
          job_title: job.title,
          risk_class: job.risk_class,
          assigned_role: job.assigned_role ?? '',
          owner_identity: i.ownerIdentity,
          created_at: String(record.created_at ?? ''),
          expires_at: String(record.expires_at ?? ''),
        }))
      : '';
    const check = verifyAuthoritativeApproval(record, job, {
      owner_identity: i.ownerIdentity,
      action_hash: expectedHash,
    }, i.nowMs);
    if (!check.ok) return { ok: false, reason: 'approval_' + check.reason };
  }
  return { ok: true };
}

// --- fixed argv contract for the Codex CLI --------------------------------

// The Codex CLI non-interactive subcommand. The prompt is ONE argv element
// and always begins with the fixed PRESTON header (buildLevel1Prompt), so
// task text can neither add arguments nor be parsed as a flag. `exec` is the
// non-interactive form; `--json` emits structured events. If the installed
// Codex CLI's contract differs, this constant is the single reviewable point
// changed at the owner activation gate.
export function buildCodexArgs(prompt: string, model?: string | null): string[] {
  // Optional routing-table model (Phase E): flags stay BEFORE the prompt so
  // the prompt remains the final positional element; the model value passed
  // here has already been shape-validated by the routing table.
  return model
    ? ['exec', '--json', '--model', model, prompt]
    : ['exec', '--json', prompt];
}

// --- result -----------------------------------------------------------------

export interface RealCodexAdapterResult {
  job_id: string;
  role: 'codex';
  mode: 'real';
  outcome: RealOutcome;
  executed: boolean;
  simulated: false;
  run_id: string;
  evidence_refs: string[];
  process: RealProcessEvidence | null;
  summary: string;
  failure_reason: string | null;
  // Bridge B2: readable result text (sanitized + bounded); see the claude
  // adapter's extractResultText. Codex `exec --json` emits event lines, so
  // this is usually the raw sanitized tail rather than a parsed field.
  result_excerpt: string | null;
  // Fast-track Phase B/E parity with the claude adapter result.
  structured: StructuredResult | null;
  structured_error: string | null;
  provider_model: string | null;
  routing_reason: string | null;
}

function processEvidence(o: ProcessOutcome): RealProcessEvidence {
  return {
    exit_code: o.exit_code,
    timed_out: o.timed_out,
    truncated: o.truncated,
    duration_ms: o.duration_ms,
    stdout_bytes: Buffer.byteLength(o.stdout, 'utf8'),
    stderr_bytes: Buffer.byteLength(o.stderr, 'utf8'),
    stdout_excerpt: sanitizeProcessText(o.stdout),
    stderr_excerpt: sanitizeProcessText(o.stderr),
    child_env_keys: o.child_env_keys,
    child_home: o.child_home,
  };
}

// --- adapter entry point ----------------------------------------------------

export interface RealCodexJobInput {
  env: Record<string, string | undefined>;
  controls: { controls: SystemControls; readOk: boolean };
  goal: {
    requested_by: string;
    environment: string;
    simulation_only: boolean;
  };
  job: GoalJob;
  approvalRecord?: Record<string, unknown>;
  runId: string;
  nowMs: number;
  lock: WorktreeLock;
  worktreePath: string;
  treeDirty: boolean;
  runner?: ProcessRunner;
  fileExists?: (p: string) => boolean;
  realpath?: (p: string) => string;
  timeoutMs?: number;
}

function refuse(
  i: RealCodexJobInput, outcome: RealOutcome, reason: string,
): RealCodexAdapterResult {
  return {
    job_id: i.job.id, role: 'codex', mode: 'real', outcome,
    executed: false, simulated: false, run_id: i.runId,
    evidence_refs: [realEvidenceRef(i.job, i.runId, outcome, false)],
    process: null,
    summary: `real codex adapter refused: ${reason}`,
    failure_reason: reason,
    result_excerpt: null,
    structured: null,
    structured_error: null,
    provider_model: null,
    routing_reason: null,
  };
}

// Run ONE bounded Level-1 codex job through the real Codex CLI. Every control
// must pass or the function refuses WITHOUT spawning anything.
export async function runRealCodexJob(
  i: RealCodexJobInput,
): Promise<RealCodexAdapterResult> {
  const probe = probeRealCodexCapability({
    env: i.env,
    controls: i.controls.controls,
    controlsReadOk: i.controls.readOk,
    fileExists: i.fileExists,
  });
  if (probe.capability !== 'real' || !probe.config) {
    return refuse(i, 'unavailable', 'probe:' + probe.reasons.join(','));
  }
  const contract = checkRealCodexJobContract({
    job: i.job,
    ownerIdentity: i.goal.requested_by,
    goalEnvironment: i.goal.environment,
    goalSimulationOnly: i.goal.simulation_only,
    approvalRecord: i.approvalRecord,
    runId: i.runId,
    nowMs: i.nowMs,
  });
  if (!contract.ok) return refuse(i, 'blocked', contract.reason);
  const confined = checkWorktreeConfinement({
    lock: i.lock, job: i.job, config: probe.config,
    worktreePath: i.worktreePath, treeDirty: i.treeDirty,
    nowMs: i.nowMs, realpath: i.realpath,
  });
  if (!confined.ok) return refuse(i, 'blocked', confined.reason);
  const routed = routeModel(i.job.kind, i.env);
  const prompt = buildLevel1Prompt({ job: i.job, config: probe.config });
  const spec: ProcessSpec = {
    executable: probe.config.executable,
    args: buildCodexArgs(prompt, routed.model),
    cwd: confined.cwd,
    timeout_ms: clampTimeoutMs(i.timeoutMs),
    max_output_bytes: REAL_CLAUDE_MAX_OUTPUT_BYTES,
  };
  const runner = i.runner ?? makeNodeProcessRunner(i.env);
  const o = await runner(spec);
  const mapped = mapProcessOutcome(o);
  const parts = extractResultParts(o.stdout);
  return {
    job_id: i.job.id, role: 'codex', mode: 'real', outcome: mapped.outcome,
    executed: mapped.executed, simulated: false, run_id: i.runId,
    evidence_refs: [
      realEvidenceRef(i.job, i.runId, mapped.outcome, mapped.executed),
    ],
    process: processEvidence(o),
    summary: mapped.executed
      ? `REAL level-1 ${i.job.kind} codex run completed (exit 0, bounded)`
      : `REAL level-1 ${i.job.kind} codex run did not complete: ` +
        (mapped.failure_reason ?? 'unknown'),
    failure_reason: mapped.failure_reason,
    result_excerpt: parts.excerpt,
    structured: parts.structured,
    structured_error: parts.structured_error,
    provider_model: routed.model,
    routing_reason: routed.reason,
  };
}
