import type { AgentRecord } from './types';
import type { SystemControls } from './controls';
import { capabilityMatch, connectorMatch, type Eligibility, type EligibilityInput } from './leases';
import { effectiveStatus } from './registry';
import { isReady, type Job, type JobStatus } from './queue';

// Preston AI OS - database-sourced worker candidates (Phase 5A). PURE.
// Maps untrusted os_jobs rows fail-closed, evaluates SIMULATION eligibility
// (execution eligibility minus the execution-enabled gate - nothing executes,
// so that gate is meaningless here and would block all staging evidence), and
// selects a bounded, deterministically-ordered candidate batch. Selection has
// NO side effect: no lease, no write, no execution.

const JOB_STATUSES: ReadonlySet<string> = new Set<JobStatus>([
  'proposed', 'validated', 'awaiting_approval', 'approved', 'queued', 'leased',
  'running', 'checkpointed', 'completed', 'failed', 'cancelled', 'expired',
  'dead_lettered',
]);

const RISK_CLASSES = new Set(['GREEN', 'YELLOW', 'RED', 'BLACK']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Fail-closed row mapper: any missing/mistyped required field rejects the row
// (returns null) rather than guessing. Optional lease fields may be null.
export function mapJobRow(row: Record<string, unknown>): Job | null {
  const id = str(row['id']);
  const status = str(row['status']);
  const risk = str(row['risk_class']);
  const notBefore = str(row['not_before']);
  const expiresAt = str(row['expires_at']);
  const idem = str(row['idempotency_key']);
  const corr = str(row['correlation_id']);
  const attempts = num(row['attempts']);
  const maxAttempts = num(row['max_attempts']);
  const priority = num(row['priority']);
  if (!id || !status || !risk || !notBefore || !expiresAt || !idem || !corr) return null;
  if (attempts === null || maxAttempts === null || priority === null) return null;
  if (!JOB_STATUSES.has(status) || !RISK_CLASSES.has(risk)) return null;
  if (Number.isNaN(Date.parse(notBefore)) || Number.isNaN(Date.parse(expiresAt))) return null;
  return {
    id,
    command_id: str(row['command_id']) ?? '',
    approval_id: str(row['approval_id']),
    status: status as JobStatus,
    risk_class: risk as Job['risk_class'],
    priority,
    not_before: notBefore,
    expires_at: expiresAt,
    lease_owner: str(row['lease_owner']),
    lease_token: str(row['lease_token']),
    lease_expires_at: str(row['lease_expires_at']),
    attempts,
    max_attempts: maxAttempts,
    timeout_ms: num(row['timeout_ms']) ?? 60000,
    retry_backoff_ms: num(row['retry_backoff_ms']) ?? 1000,
    idempotency_key: idem,
    correlation_id: corr,
    checkpoint_ref: str(row['checkpoint_ref']),
    result_ref: str(row['result_ref']),
    error_class: str(row['error_class']),
    execution_enabled: row['execution_enabled'] === true,
    cancel_requested: row['cancel_requested'] === true,
    created_at: str(row['created_at']) ?? '',
    updated_at: str(row['updated_at']) ?? '',
  };
}

// SIMULATION eligibility. Identical to leases.eligibleWorker EXCEPT it does
// not require execution_enabled (documented stance: simulation is safe while
// execution is disabled - that IS the staging drill). Every other gate stays:
// a job that could never legally execute must not produce simulation evidence
// pretending it could.
export function simulationEligible(input: EligibilityInput): Eligibility {
  const reasons: string[] = [];
  const { agent, job, controls, now } = input;

  if (controls.owner_stop) reasons.push('owner stop engaged');
  if (controls.paused) reasons.push('runtime paused');
  if (job.cancel_requested) reasons.push('job cancellation requested');
  if (!job.approval_id) reasons.push('job not approved');
  if (job.risk_class === 'RED' || job.risk_class === 'BLACK') {
    reasons.push(`risk ${job.risk_class} never dispatched`);
  }
  if (effectiveStatus(agent, now, input.staleMs) === 'offline') {
    reasons.push('agent stale/offline');
  }
  if (!capabilityMatch(agent, input.requiredCapabilities)) {
    reasons.push('missing required capability');
  }
  if (!connectorMatch(agent, input.requiredConnectors)) {
    reasons.push('missing required connector permission');
  }
  if (!job.correlation_id) reasons.push('missing correlation id');

  return { ok: reasons.length === 0, reasons };
}

export interface CandidateSelection {
  selected: Job[];
  rejected: { id: string | null; reason: string }[];
}

export interface SelectOptions {
  now: string;
  limit: number; // hard batch bound; <=0 selects nothing
  controls: SystemControls;
}

// Bounded, deterministic, side-effect-free selection over raw DB rows.
// Only 'queued', ready, GREEN/YELLOW, approved, non-cancelled jobs survive.
// Order: priority DESC, then created_at ASC, then id ASC (total order).
export function selectCandidateJobs(
  rows: Record<string, unknown>[],
  opts: SelectOptions,
): CandidateSelection {
  const rejected: CandidateSelection['rejected'] = [];
  const ok: Job[] = [];

  if (opts.controls.owner_stop || opts.controls.paused) {
    return { selected: [], rejected: [{ id: null, reason: 'runtime halted/paused' }] };
  }

  for (const row of rows) {
    const job = mapJobRow(row);
    if (!job) {
      rejected.push({ id: str(row['id']), reason: 'malformed row (fail-closed)' });
      continue;
    }
    if (job.status !== 'queued') {
      rejected.push({ id: job.id, reason: 'status not queued: ' + job.status });
      continue;
    }
    if (job.cancel_requested) {
      rejected.push({ id: job.id, reason: 'cancellation requested' });
      continue;
    }
    if (job.risk_class === 'RED' || job.risk_class === 'BLACK') {
      rejected.push({ id: job.id, reason: 'risk ' + job.risk_class + ' never dispatched' });
      continue;
    }
    if (!job.approval_id) {
      rejected.push({ id: job.id, reason: 'not approved' });
      continue;
    }
    if (!isReady(job, opts.now)) {
      rejected.push({ id: job.id, reason: 'not ready (not_before/expired)' });
      continue;
    }
    if (job.attempts >= job.max_attempts) {
      rejected.push({ id: job.id, reason: 'attempts exhausted' });
      continue;
    }
    ok.push(job);
  }

  ok.sort((a, b) =>
    b.priority - a.priority
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id));

  const limit = Math.max(0, Math.floor(opts.limit));
  for (const dropped of ok.slice(limit)) {
    rejected.push({ id: dropped.id, reason: 'over batch limit' });
  }
  return { selected: ok.slice(0, limit), rejected };
}

// Standard staging simulation envelope + checkpoint builders (synthetic, no
// business data). Kept here so the dispatcher and tests share one definition.
export function stagingEnvelope(job: Job) {
  return {
    runner_id: 'staging-sim',
    repo_root: '/srv/preston-os',
    executable: 'git' as const,
    args: ['status'],
    cwd: '/srv/preston-os',
    timeout_ms: Math.min(job.timeout_ms, 60000),
    allow_network: false,
    correlation_id: job.correlation_id,
  };
}

export function stagingCheckpoint(job: Job, agent: AgentRecord, now: string) {
  return {
    project: 'preston-os',
    phase: 'Phase 5',
    gate: 'staging-sim',
    goal: 'bounded staging simulation (no execution)',
    job_id: job.id,
    agent_id: agent.id,
    worktree: 'none',
    branch: 'master',
    base_commit: 'staging',
    current_commit: 'staging',
    files_changed: [],
    tests_run: 'n/a (simulation)',
    validation: 'simulated only; executed=false',
    blockers: [],
    owner_actions: [],
    next_action: 'none (bounded simulation complete)',
    rollback: 'none required (no mutation)',
    correlation_id: job.correlation_id,
    created_at: now,
    status: 'in_progress' as const,
  };
}
