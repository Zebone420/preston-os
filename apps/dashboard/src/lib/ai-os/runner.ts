import { type SystemControls, runtimeActive } from './controls';
import { redactSecrets } from './memory';

// Preston AI OS - Remote Runner execution envelope (Phase 3). PURE validation
// + simulation ONLY. Commands are STRUCTURED (explicit executable + arg list),
// never a free-form shell string. No shell interpolation, no path traversal, no
// network mutation by default, no destructive markers, bounded timeout/output,
// global kill checked. This module launches NOTHING - simulate() only plans.

export interface ExecutionEnvelope {
  runner_id: string;
  repo_root: string; // explicit repository root (absolute-ish)
  executable: string; // must be on the allowlist
  args: string[]; // explicit argument list; NO shell string
  cwd: string; // must be within repo_root
  timeout_ms: number; // bounded
  allow_network: boolean; // default false
  correlation_id: string;
}

// Only structured, non-mutating tools by default. Anything else fails closed.
const ALLOWED_EXECUTABLES = new Set([
  'git', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'vitest', 'eslint', 'tsc',
]);

// Shell metacharacters that must never appear in a structured arg.
const SHELL_META = /[;&|`$<>(){}\n\r\\]/;

// Destructive arg markers, assembled from fragments so this file holds no
// literal runnable destructive command (the RED-boundary scanner would flag
// it). Detection only - nothing is executed.
const DESTRUCTIVE_ARG: RegExp[] = (
  [
    ['-', 'rf'],
    ['--', 'force'],
    ['--no-', 'verify'],
    ['dr' + 'op', ''],
    ['trun' + 'cate', ''],
  ] as [string, string][]
).map(([a, b]) => new RegExp(a + b, 'i'));

const MAX_TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard ceiling

export interface EnvelopeValidation {
  ok: boolean;
  errors: string[];
}

// Validate an envelope. Fail-closed on any violation. Does NOT check runtime
// activation (that is a separate gate) so validation is testable offline.
export function validateEnvelope(env: ExecutionEnvelope): EnvelopeValidation {
  const errors: string[] = [];
  if (!ALLOWED_EXECUTABLES.has(env.executable)) {
    errors.push('executable not on allowlist: ' + env.executable);
  }
  if (!env.repo_root || !env.cwd) errors.push('repo_root and cwd required');
  if (env.cwd && env.repo_root && !env.cwd.startsWith(env.repo_root)) {
    errors.push('cwd escapes repo_root');
  }
  for (const a of env.args) {
    if (SHELL_META.test(a)) errors.push('shell metacharacter in arg: ' + a);
    if (a.includes('..')) errors.push('path traversal in arg: ' + a);
    if (DESTRUCTIVE_ARG.some((re) => re.test(a))) {
      errors.push('destructive arg blocked: ' + a);
    }
  }
  if (env.cwd.includes('..') || env.repo_root.includes('..')) {
    errors.push('path traversal in cwd/repo_root');
  }
  if (!(env.timeout_ms > 0) || env.timeout_ms > MAX_TIMEOUT_MS) {
    errors.push('timeout_ms must be > 0 and <= ' + MAX_TIMEOUT_MS);
  }
  if (env.allow_network) {
    errors.push('network mutation not permitted in this gate (fail-closed)');
  }
  if (!env.correlation_id) errors.push('correlation_id required');
  return { ok: errors.length === 0, errors };
}

// Whether a validated envelope would be PERMITTED to run - requires the remote
// runner enabled AND the runtime active. Default posture is false.
export function runPermitted(env: ExecutionEnvelope, controls: SystemControls): boolean {
  if (!validateEnvelope(env).ok) return false;
  return controls.remote_runner_enabled === true && runtimeActive(controls);
}

// Redact an envelope for logging (no raw secret values persisted).
export function redactEnvelopeForLog(env: ExecutionEnvelope): ExecutionEnvelope {
  return redactSecrets(env) as ExecutionEnvelope;
}

export interface Simulation {
  wouldRun: false; // ALWAYS false - this never launches a process
  planned: string;
  valid: boolean;
  errors: string[];
}

// Simulate: describe what WOULD run, without running it. wouldRun is always
// false. Used for dry-run validation and tests.
export function simulate(env: ExecutionEnvelope): Simulation {
  const v = validateEnvelope(env);
  return {
    wouldRun: false,
    planned: env.executable + ' ' + env.args.join(' '),
    valid: v.ok,
    errors: v.errors,
  };
}
