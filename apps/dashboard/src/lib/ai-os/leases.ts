import type { AgentRecord } from './types';
import { effectiveStatus } from './registry';
import type { Job } from './queue';
import { type SystemControls, isHalted } from './controls';

// Preston AI OS - worker leasing + recovery + eligibility (Phase 3 runtime).
// PURE + deterministic. One active worker per job via a lease token; leases
// always expire; stale leases are safely recoverable; renewal is owner+token
// bound. Worker eligibility is fail-closed: incomplete metadata => not
// eligible. The DB compare-and-set is the real mutual exclusion; this computes
// the decision so it is testable without a database.

export interface LeaseState {
  owner: string; // worker/agent id
  token: string;
  acquired_at: string;
  expires_at: string;
}

export function isLeaseExpired(lease: LeaseState | null, now: string): boolean {
  return !lease || Date.parse(lease.expires_at) <= Date.parse(now);
}

// A job may be leased when it has no live lease, or the caller already holds it
// (same owner + token). Expired leases are recoverable by anyone.
export function canLease(
  current: LeaseState | null,
  owner: string,
  token: string,
  now: string,
): boolean {
  if (isLeaseExpired(current, now)) return true;
  return current!.owner === owner && current!.token === token;
}

export interface LeaseRequest {
  owner: string;
  token: string;
  ttlMs: number;
  now: string;
}

export function lease(
  current: LeaseState | null,
  req: LeaseRequest,
): LeaseState | null {
  if (req.ttlMs <= 0) return null; // no permanent leases
  if (!canLease(current, req.owner, req.token, req.now)) return null;
  return {
    owner: req.owner,
    token: req.token,
    acquired_at: req.now,
    expires_at: new Date(Date.parse(req.now) + req.ttlMs).toISOString(),
  };
}

// Renewal is only for the current, not-yet-expired owner+token.
export function renew(
  current: LeaseState | null,
  owner: string,
  token: string,
  ttlMs: number,
  now: string,
): LeaseState | null {
  if (isLeaseExpired(current, now)) return null; // expired => must re-acquire
  if (current!.owner !== owner || current!.token !== token) return null;
  if (ttlMs <= 0) return null;
  return { ...current!, expires_at: new Date(Date.parse(now) + ttlMs).toISOString() };
}

export function capabilityMatch(agent: AgentRecord, required: string[]): boolean {
  return required.every((c) => agent.capabilities.includes(c));
}

export function connectorMatch(agent: AgentRecord, required: string[]): boolean {
  return required.every((c) => agent.allowed_connectors.includes(c));
}

export interface EligibilityInput {
  agent: AgentRecord;
  job: Job;
  controls: SystemControls;
  requiredCapabilities: string[];
  requiredConnectors: string[];
  now: string;
  staleMs?: number;
}

export interface Eligibility {
  ok: boolean;
  reasons: string[]; // why NOT eligible (empty when ok)
}

// Fail-closed worker eligibility. Every reason is additive; empty => eligible.
export function eligibleWorker(input: EligibilityInput): Eligibility {
  const reasons: string[] = [];
  const { agent, job, controls, now } = input;

  if (isHalted(controls)) reasons.push('runtime halted (owner_stop or execution disabled)');
  if (controls.paused) reasons.push('runtime paused');
  if (job.cancel_requested) reasons.push('job cancellation requested');
  if (!job.approval_id) reasons.push('job not approved');
  if (job.risk_class === 'RED' || job.risk_class === 'BLACK') {
    reasons.push(`risk ${job.risk_class} never dispatched`);
  }
  if (!(controls.execution_enabled && job.execution_enabled)) {
    reasons.push('execution disabled (fail-closed)');
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
