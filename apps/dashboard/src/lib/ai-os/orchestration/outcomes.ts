// Preston AI OS - central terminal-vs-retryable outcome authority (fast-track
// Phase A1). PURE, deterministic, no I/O. This module is the ONLY place that
// decides whether a failed job attempt is worth retrying: the completion
// engine consults it, and no adapter, driver, or dispatcher layer may
// reimplement the decision. The classification reason is persisted on the
// dead-lettered row (failure_reason) so evidence stays readable.
//
// Classes (per the fast-track master goal):
//   SUCCESS     - completed work
//   RETRYABLE   - transient provider/network/timeout/process faults; a fresh
//                 attempt could genuinely succeed
//   TERMINAL    - contract/policy/impossibility: retrying burns attempts on a
//                 deterministic refusal (the pre-fix live failure mode: a
//                 provider-mismatch job consumed 3 identical attempts before
//                 dead-lettering - prod goal 6b5d32c5, 2026-08-26)
//   OWNER_GATED - valid work parked on an owner approval decision
//   CANCELLED   - owner-cancelled work
//
// Fail-open-to-RETRYABLE for unrecognized reasons: an unknown failure shape
// must degrade to the pre-existing bounded-retry behavior (never to an
// over-eager dead-letter), and the retry budget still caps the loop.

export type OutcomeClass =
  | 'SUCCESS'
  | 'RETRYABLE'
  | 'TERMINAL'
  | 'OWNER_GATED'
  | 'CANCELLED';

export interface FailureClassification {
  outcome_class: 'RETRYABLE' | 'TERMINAL';
  // Static reason code for evidence/logs; never free text from the failure.
  reason: string;
}

// Deterministic refusals of the job CONTRACT itself: provider/role mismatch,
// ineligible kind, risk ceiling, environment/schema pins, missing identity,
// and authoritative-approval refusals surfaced as failures in strict real
// mode. A retry re-runs the exact same checks against the exact same row, so
// it can never succeed without the job itself changing.
const TERMINAL_REAL_REQUIRED = new Set([
  'provider_not_claude',
  'provider_not_codex',
  'kind_not_eligible',
  'risk_exceeds_allowed',
  'environment_not_staging',
  'simulation_pin_unexpected',
  'owner_identity_missing',
  'execution_clock_invalid',
]);

// real_required:<reason> sub-reasons that are transient races or recoverable
// process/provider faults - a fresh attempt gets a fresh lease/worktree.
const RETRYABLE_REAL_REQUIRED_PREFIXES = [
  'job_not_leased', 'lease_not_owned', 'lease_expired', // claim races
  'provision_failed', 'provision_', // worktree provisioning hiccups
  'spawn_failed', 'timeout', 'killed', 'exit_', // process faults
  'output_limit_exceeded',
  'adapter_refused', // composite adapter refusal without a finer reason
  'dirty_tree', 'lock_', 'worktree_', // confinement race/setup faults
];

// Bare failure reasons (non-strict mode / driver-level) that are terminal.
const TERMINAL_BARE = new Set([
  'unsupported_kind',
  'prohibited_action',
  'policy_denied',
  'invalid_contract',
]);

function classifyRealRequired(sub: string): FailureClassification {
  if (TERMINAL_REAL_REQUIRED.has(sub)) {
    return { outcome_class: 'TERMINAL', reason: `terminal:real_required:${sub}` };
  }
  if (sub.startsWith('approval_')) {
    // A strict-mode approval refusal (expired/mismatched record) cannot heal
    // by retrying: the same record re-verifies identically. The job stays an
    // honest terminal failure; a NEW approval requires a new owner decision
    // and (by policy) a fresh goal.
    return { outcome_class: 'TERMINAL', reason: `terminal:real_required:${sub}` };
  }
  for (const p of RETRYABLE_REAL_REQUIRED_PREFIXES) {
    if (sub.startsWith(p)) {
      return { outcome_class: 'RETRYABLE', reason: `retryable:real_required:${sub}` };
    }
  }
  // Unknown strict-mode refusal: degrade to bounded retry (fail-open toward
  // the pre-existing behavior, still capped by max_job_retries).
  return { outcome_class: 'RETRYABLE', reason: `retryable:unrecognized:${sub}` };
}

// The single authority. `failureReason` is the job row's failure_reason from
// the attempt that just failed (may be null/empty for legacy rows).
export function classifyFailure(
  failureReason: string | null | undefined,
): FailureClassification {
  const r = String(failureReason ?? '').trim();
  if (!r) return { outcome_class: 'RETRYABLE', reason: 'retryable:unspecified' };

  if (r.startsWith('real_required:')) {
    return classifyRealRequired(r.slice('real_required:'.length));
  }
  if (TERMINAL_BARE.has(r) || r.startsWith('unsupported_kind')) {
    return { outcome_class: 'TERMINAL', reason: `terminal:${r}` };
  }
  // path_violation: the agent's edits escaped the allowlist and were
  // discarded. Agent behavior varies run to run, so ONE more bounded attempt
  // is permitted (RETRYABLE) - the retry budget still caps it, and the
  // violation evidence stays on the row.
  // Transient process faults (timeout/exit/killed/spawn/truncation) and
  // anything unrecognized: bounded retry.
  return { outcome_class: 'RETRYABLE', reason: `retryable:${r}` };
}

// Kinds the platform can honestly execute or simulate. 'unknown' is not a
// capability - it is the composer's "could not classify" marker - so a job
// carrying it FAILS CLOSED as an immediate honest terminal state instead of
// consuming attempts on deterministic adapter refusals (Phase A2).
export const SUPPORTED_JOB_KINDS: ReadonlySet<string> = Object.freeze(new Set([
  'documentation', 'code', 'test', 'migration', 'audit', 'repair',
  'recommendation',
]));

export function isSupportedKind(kind: string): boolean {
  return SUPPORTED_JOB_KINDS.has(kind);
}
