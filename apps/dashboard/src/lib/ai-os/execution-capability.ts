// Preston AI OS - Phase 8 execution capability levels. PURE, FAIL-CLOSED.
//
// Phase 7 shipped two booleans (execution_enabled, remote_runner_enabled)
// and a single behavior: everything simulates. Remote Operations V1 needs a
// THIRD state - real but bounded code work - without ever making "real
// external writes" reachable. This module is the single authority that maps
// (owner DB controls + host env) onto one of three ordered levels:
//
//   SIMULATION             - adapters simulate; executed is always false.
//   BOUNDED_CODE_EXECUTION - a real agent CLI may run INSIDE an isolated
//                            worktree on allowlisted paths, producing local
//                            commits/test runs only. No deploy, no push, no
//                            external/business write, no production.
//   EXTERNAL_WRITE         - reserved. NEVER returned by this module in V1;
//                            requesting it yields SIMULATION plus the
//                            refusal reason 'external_write_not_activatable'.
//
// Design rules:
//  1. Fail closed. Unreadable controls, missing env, a non-staging runtime,
//     owner_stop, or pause all resolve to SIMULATION.
//  2. The DB row stays authoritative for the kill switch: owner_stop=true
//     downgrades to SIMULATION regardless of env, so the proven Phase 7
//     kill switch keeps working unchanged against real execution.
//  3. Env can only ever LOWER or ENABLE up to the DB posture - never widen
//     past it. Both must agree to leave SIMULATION.
//  4. Reasons are static codes; env VALUES are never echoed.

import type { SystemControls } from './controls';

export const EXECUTION_LEVELS = ['SIMULATION', 'BOUNDED_CODE_EXECUTION',
  'EXTERNAL_WRITE'] as const;
export type ExecutionLevel = (typeof EXECUTION_LEVELS)[number];

// Host env name declaring the CEILING the owner installed on this host.
export const EXECUTION_LEVEL_ENV = 'ORCH_EXECUTION_LEVEL';

// Accepted env spellings (exact, lowercase) -> level. Anything else, including
// an absent value, is SIMULATION. 'external_write' is deliberately ACCEPTED as
// input so the refusal is explicit and testable rather than a silent typo.
const ENV_LEVELS: Readonly<Record<string, ExecutionLevel>> = Object.freeze({
  simulation: 'SIMULATION',
  bounded_code_execution: 'BOUNDED_CODE_EXECUTION',
  external_write: 'EXTERNAL_WRITE',
});

export interface CapabilityInput {
  env: Record<string, string | undefined>;
  controls: SystemControls;
  controlsReadOk: boolean;
}

export interface CapabilityResult {
  level: ExecutionLevel;
  // Every reason the level is not BOUNDED_CODE_EXECUTION (empty when it is).
  reasons: string[];
  // Convenience: real bounded execution is permitted right now.
  realExecutionAllowed: boolean;
}

// Resolve the effective execution level. Never throws.
export function resolveExecutionLevel(i: CapabilityInput): CapabilityResult {
  const reasons: string[] = [];
  const requested = ENV_LEVELS[String(i.env[EXECUTION_LEVEL_ENV] ?? '')
    .trim().toLowerCase()] ?? 'SIMULATION';

  // V1 hard stop: external writes are not activatable by configuration.
  // This is a code-level ceiling, not a flag - lifting it is a separate
  // owner-gated phase with its own review.
  if (requested === 'EXTERNAL_WRITE') {
    reasons.push('external_write_not_activatable');
  }
  if (requested === 'SIMULATION') reasons.push('level_env_not_set');

  // Staging-only, always (mirrors the runtime staging gate + db-health).
  if (i.env['SUPABASE_RUNTIME_ENV'] !== 'staging') {
    reasons.push('runtime_env_not_staging');
  }
  // Emergency flag must be an EXPLICIT opt-out, matching the real adapter.
  if (i.env['DISABLE_REMOTE_RUNNER'] !== 'false') {
    reasons.push('emergency_block_active');
  }
  // Owner DB posture (authoritative kill switch).
  if (!i.controlsReadOk) reasons.push('controls_unreadable');
  else {
    if (i.controls.owner_stop) reasons.push('owner_stop');
    if (i.controls.paused) reasons.push('paused');
    if (!i.controls.execution_enabled) reasons.push('execution_disabled');
    if (!i.controls.remote_runner_enabled) reasons.push('remote_runner_disabled');
  }

  const allowed = reasons.length === 0 && requested === 'BOUNDED_CODE_EXECUTION';
  return {
    level: allowed ? 'BOUNDED_CODE_EXECUTION' : 'SIMULATION',
    reasons,
    realExecutionAllowed: allowed,
  };
}

// Is a level at least as capable as another? (ordered comparison helper)
export function levelAtLeast(a: ExecutionLevel, b: ExecutionLevel): boolean {
  return EXECUTION_LEVELS.indexOf(a) >= EXECUTION_LEVELS.indexOf(b);
}
