import type { RiskClass } from './types';

// Preston AI OS - job queue lifecycle (Phase 3 runtime). PURE state machine.
// Deterministic transitions with a fail-closed graph. execution_enabled
// defaults false; a job can never enter 'running' without approval + a lease +
// execution enabled + no cancellation/stop. No live polling here.

export type JobStatus =
  | 'proposed'
  | 'validated'
  | 'awaiting_approval'
  | 'approved'
  | 'queued'
  | 'leased'
  | 'running'
  | 'checkpointed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'dead_lettered';

export interface Job {
  id: string;
  command_id: string;
  approval_id: string | null;
  status: JobStatus;
  risk_class: RiskClass;
  priority: number; // higher runs first
  not_before: string; // ISO
  expires_at: string; // ISO
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number;
  max_attempts: number;
  timeout_ms: number;
  retry_backoff_ms: number;
  idempotency_key: string;
  correlation_id: string;
  checkpoint_ref: string | null;
  result_ref: string | null;
  error_class: string | null;
  execution_enabled: boolean; // default false
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
}

// Legal transition graph. Terminal states have no outgoing edges.
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  proposed: ['validated', 'expired', 'cancelled'],
  validated: ['awaiting_approval', 'expired', 'cancelled'],
  awaiting_approval: ['approved', 'cancelled', 'expired'],
  approved: ['queued', 'cancelled', 'expired'],
  queued: ['leased', 'cancelled', 'expired'],
  leased: ['running', 'queued', 'cancelled', 'expired', 'dead_lettered'],
  running: ['checkpointed', 'completed', 'failed', 'cancelled'],
  checkpointed: ['running', 'completed', 'failed', 'cancelled'],
  failed: ['queued', 'dead_lettered'], // retry -> requeue, else dead-letter
  completed: [],
  cancelled: [],
  expired: [],
  dead_lettered: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface TransitionContext {
  now: string;
  executionEnabled: boolean; // global runtime gate
}

export interface TransitionResult {
  ok: boolean;
  job: Job;
  reason?: string;
}

// Apply a transition with fail-closed guards. Cancellation and global-stop
// override toward 'cancelled'. Entry to 'running' requires approval + lease +
// execution enabled (global and per-job) and no cancel.
export function transition(
  job: Job,
  to: JobStatus,
  ctx: TransitionContext,
): TransitionResult {
  if (!canTransition(job.status, to)) {
    return { ok: false, job, reason: `illegal ${job.status} -> ${to}` };
  }
  if (to === 'running') {
    if (job.cancel_requested) return { ok: false, job, reason: 'cancellation requested' };
    if (!job.approval_id) return { ok: false, job, reason: 'not approved' };
    if (!job.lease_owner || !job.lease_token) return { ok: false, job, reason: 'no active lease' };
    if (job.risk_class === 'RED' || job.risk_class === 'BLACK') {
      return { ok: false, job, reason: `risk ${job.risk_class} never runs` };
    }
    if (!(ctx.executionEnabled && job.execution_enabled)) {
      return { ok: false, job, reason: 'execution disabled (fail-closed)' };
    }
  }
  return { ok: true, job: { ...job, status: to, updated_at: ctx.now } };
}

export function isExpired(job: Job, now: string): boolean {
  return Date.parse(job.expires_at) <= Date.parse(now);
}

export function isReady(job: Job, now: string): boolean {
  return Date.parse(job.not_before) <= Date.parse(now) && !isExpired(job, now);
}

// After a failure: retry (requeue) while attempts remain, else dead-letter.
export function shouldDeadLetter(job: Job): boolean {
  return job.attempts >= job.max_attempts;
}
