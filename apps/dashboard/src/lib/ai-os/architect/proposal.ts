// Architect Gate AG-6: pure architecture/change proposal lifecycle.

import type { RiskClass } from '../types';
import type { PolicyDecision } from '../orchestration/policy';
import { requireAttribution, type ActorAttribution } from './actor';
import type { GithubChangeEnvelope } from './change-binding';
import { isStale } from './change-binding';
import type { ArchitectRequest } from './intake';

export type ProposalStatus =
  | 'proposed'
  | 'evaluated'
  | 'awaiting_approval'
  | 'approved'
  | 'prepared'
  | 'stale'
  | 'rejected'
  | 'withdrawn';

export interface ArchitectProposal {
  request: ArchitectRequest;
  change: GithubChangeEnvelope;
  actor: ActorAttribution;
  evidence_refs: string[];
  risk_class: RiskClass;
  policy_decision: PolicyDecision | null;
  status: ProposalStatus;
  pr?: { pr_url: string; pr_number: number };
}

export type ProposalEvent =
  | { type: 'evaluate'; policy: PolicyDecision; evidence_ref: string }
  | { type: 'request_approval'; evidence_ref: string }
  | { type: 'approve'; approver: string; evidence_ref: string }
  | { type: 'prepare'; current_base_sha: string; current_diff_hash: string;
      evidence_ref: string }
  | { type: 'reject'; evidence_ref: string }
  | { type: 'withdraw'; evidence_ref: string }
  | { type: 'expire'; evidence_ref: string }
  | { type: 'sha_moved'; evidence_ref: string }
  | { type: 'diff_changed'; evidence_ref: string };

export type ProposalTransitionResult =
  | { ok: true; proposal: ArchitectProposal }
  | { ok: false; reason:
      | 'invalid_transition' | 'evidence_ref_required'
      | 'approval_policy_missing' | 'attribution_invalid'
      | 'proposal_stale' };

const ALLOWED: Readonly<Record<ProposalStatus, readonly ProposalEvent['type'][]>> = {
  proposed: ['evaluate', 'reject', 'withdraw'],
  evaluated: ['request_approval', 'reject', 'withdraw'],
  awaiting_approval: ['approve', 'reject', 'withdraw', 'expire'],
  approved: ['prepare', 'reject', 'withdraw', 'expire'],
  prepared: [], stale: [], rejected: [], withdrawn: [],
};

function append(
  proposal: ArchitectProposal,
  status: ProposalStatus,
  evidenceRef: string,
  patch: Partial<ArchitectProposal> = {},
): ProposalTransitionResult {
  return { ok: true, proposal: {
    ...proposal, ...patch, status,
    evidence_refs: [...proposal.evidence_refs, evidenceRef],
  } };
}

export function proposalTransition(
  current: ArchitectProposal,
  event: ProposalEvent,
): ProposalTransitionResult {
  if (typeof event.evidence_ref !== 'string' || !event.evidence_ref.trim()) {
    return { ok: false, reason: 'evidence_ref_required' };
  }
  // SHA/diff drift invalidates every lifecycle state, including one that was
  // already approved or prepared. Nothing silently retains authorization.
  if (event.type === 'sha_moved' || event.type === 'diff_changed') {
    return append(current, 'stale', event.evidence_ref);
  }
  if (!ALLOWED[current.status].includes(event.type)) {
    return { ok: false, reason: 'invalid_transition' };
  }
  switch (event.type) {
    case 'evaluate':
      return append(current, 'evaluated', event.evidence_ref, {
        risk_class: event.policy.risk_class,
        policy_decision: { ...event.policy,
          evidence_required: [...event.policy.evidence_required] },
      });
    case 'request_approval':
      if (current.policy_decision?.requires_approval !== true) {
        return { ok: false, reason: 'approval_policy_missing' };
      }
      return append(current, 'awaiting_approval', event.evidence_ref);
    case 'approve': {
      const actor = { ...current.actor, approver: event.approver };
      if (!requireAttribution(actor).ok) {
        return { ok: false, reason: 'attribution_invalid' };
      }
      return append(current, 'approved', event.evidence_ref, { actor });
    }
    case 'prepare': {
      const stale = isStale(
        current.change, event.current_base_sha, event.current_diff_hash,
      );
      if (stale.stale) return { ok: false, reason: 'proposal_stale' };
      return append(current, 'prepared', event.evidence_ref);
    }
    case 'expire':
      return append(current, 'stale', event.evidence_ref);
    case 'reject':
      return append(current, 'rejected', event.evidence_ref);
    case 'withdraw':
      return append(current, 'withdrawn', event.evidence_ref);
    default:
      return { ok: false, reason: 'invalid_transition' };
  }
}
