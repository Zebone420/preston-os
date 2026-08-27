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
//   UNCERTAIN   - an EXTERNAL side effect whose outcome is unknown (e.g. the
//                 provider call timed out after possibly succeeding). NEVER
//                 blind-retried: a retry could duplicate a real-world action.
//                 The job parks terminally; the side-effect LEDGER row keeps
//                 the reconciliation state, and only reconciliation (with
//                 provider evidence) settles it. (Power-station master goal
//                 sections 2/9/12.)
//   OWNER_GATED - valid work parked on an owner approval decision
//   CANCELLED   - owner-cancelled work
//
// Fail-open-to-RETRYABLE for unrecognized reasons: an unknown failure shape
// must degrade to the pre-existing bounded-retry behavior (never to an
// over-eager dead-letter), and the retry budget still caps the loop. The
// UNCERTAIN class is reachable ONLY through its explicit reason prefixes -
// an unknown shape can never accidentally park as uncertain.

export type OutcomeClass =
  | 'SUCCESS'
  | 'RETRYABLE'
  | 'TERMINAL'
  | 'UNCERTAIN'
  | 'OWNER_GATED'
  | 'CANCELLED';

export interface FailureClassification {
  outcome_class: 'RETRYABLE' | 'TERMINAL' | 'UNCERTAIN';
  // Static reason code for evidence/logs; never free text from the failure.
  reason: string;
}

// Failure-reason prefixes that mean "an external side effect may or may not
// have happened". Set by the capability executor (capabilities/executor.ts)
// when a provider call times out or dies mid-flight after the ledger row
// entered EXECUTING. Both forms classify UNCERTAIN.
const UNCERTAIN_PREFIXES = ['side_effect_uncertain', 'uncertain_outcome'];

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

  // Uncertain external outcomes park terminally and are settled ONLY by
  // ledger reconciliation - a blind retry could duplicate a real-world
  // side effect. Checked first: uncertainty outranks every other class.
  for (const p of UNCERTAIN_PREFIXES) {
    if (r.startsWith(p)) {
      return { outcome_class: 'UNCERTAIN', reason: `uncertain:${r}` };
    }
  }

  if (r.startsWith('real_required:')) {
    return classifyRealRequired(r.slice('real_required:'.length));
  }
  if (TERMINAL_BARE.has(r) || r.startsWith('unsupported_kind')) {
    return { outcome_class: 'TERMINAL', reason: `terminal:${r}` };
  }
  // Bare terminal reasons may carry a static sub-reason suffix (e.g. the
  // capability executor's prohibited_action:unknown_capability). The colon
  // form classifies identically to the bare form.
  for (const p of TERMINAL_BARE) {
    if (r.startsWith(p + ':')) {
      return { outcome_class: 'TERMINAL', reason: `terminal:${r}` };
    }
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
