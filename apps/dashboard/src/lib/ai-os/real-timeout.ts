// Preston AI OS - owner-configurable REAL worker timeout (owner-approved
// work unit, 2026-08-28). PURE, no I/O. Shared by BOTH real adapters
// (Claude + Codex run the same execution policy) and by the durable driver
// (the run lease is DERIVED from the same value so a configured timeout can
// never outlive the lease protecting the run).
//
// Units: MILLISECONDS, named in the env var itself (ORCH_REAL_TIMEOUT_MS).
//
// Fail-closed contract:
//   - env absent/blank            -> REAL_TIMEOUT_DEFAULT_MS (prior default)
//   - malformed / non-integer /
//     negative / zero / NaN       -> REAL_TIMEOUT_DEFAULT_MS
//   - below REAL_TIMEOUT_MIN_MS   -> REAL_TIMEOUT_DEFAULT_MS (a sub-minute
//     "timeout" is a misconfiguration that would fail every legitimate run)
//   - above REAL_TIMEOUT_ABS_MAX_MS -> clamped to REAL_TIMEOUT_ABS_MAX_MS
//     (the COMPILED ceiling: no environment value can create an unbounded
//     or multi-hour child process)
//
// Lease coupling: resolveRunLeaseMs = resolved timeout + RUN_LEASE_MARGIN_MS.
// The margin covers the non-child phases of a run (worktree provisioning,
// post-run git audit, artifact persistence, result CAS), so lease recovery
// can never requeue a job underneath a legitimately running worker - for
// EVERY configuration including the default. (Pre-change hazard: the lease
// and the child timeout were both exactly 10 minutes - zero margin.)

export const REAL_TIMEOUT_ENV = 'ORCH_REAL_TIMEOUT_MS';

export const REAL_TIMEOUT_DEFAULT_MS = 10 * 60 * 1000; // 10 min (unchanged)
export const REAL_TIMEOUT_MIN_MS = 60 * 1000; // 1 min
export const REAL_TIMEOUT_ABS_MAX_MS = 60 * 60 * 1000; // 60 min, compiled
export const RUN_LEASE_MARGIN_MS = 5 * 60 * 1000; // provision+audit+persist

// Strict integer-string form only: anything else fails closed to default.
const INT_RE = /^\d{1,12}$/;

export function resolveRealTimeoutMs(
  env: Record<string, string | undefined>,
): number {
  const raw = String(env?.[REAL_TIMEOUT_ENV] ?? '').trim();
  if (!raw) return REAL_TIMEOUT_DEFAULT_MS;
  if (!INT_RE.test(raw)) return REAL_TIMEOUT_DEFAULT_MS;
  const v = Number(raw);
  if (!Number.isSafeInteger(v) || v < REAL_TIMEOUT_MIN_MS) {
    return REAL_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(v, REAL_TIMEOUT_ABS_MAX_MS);
}

// The run lease MUST outlive the configured child timeout by the margin.
export function resolveRunLeaseMs(
  env: Record<string, string | undefined>,
): number {
  return resolveRealTimeoutMs(env) + RUN_LEASE_MARGIN_MS;
}
