import { describe, expect, it } from 'vitest';
import { diffHash, type GithubChangeEnvelope }
  from '../src/lib/ai-os/architect/change-binding';
import {
  proposalTransition,
  type ArchitectProposal,
  type ProposalStatus,
} from '../src/lib/ai-os/architect/proposal';
import { evaluatePolicy } from '../src/lib/ai-os/orchestration/policy';

const CHANGE: GithubChangeEnvelope = {
  repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
  head_branch: 'architect/corr-architect-0006',
  base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), diff_hash: diffHash('patch'),
};

function proposal(status: ProposalStatus = 'proposed'): ArchitectProposal {
  return {
    request: {
      repo: CHANGE.repo, base_branch: CHANGE.base_branch, objective: 'safe change',
      correlation_id: 'corr-architect-0006', requested_by: 'owner-0001',
      source_goal_job_id: 'job-architect-0006', environment: 'staging',
    },
    change: CHANGE,
    actor: { requested_by: 'owner-0001', proposer: 'architect-0001', approver: null,
      executor: 'claude', correlation_id: 'corr-architect-0006', run_id: null },
    evidence_refs: ['intake:head:' + CHANGE.head_sha], risk_class: 'GREEN',
    policy_decision: null, status,
  };
}

const pushPolicy = evaluatePolicy({
  action: 'push exact pinned change and open pull request',
  agent: 'claude', environment: 'staging',
});

describe('AG-6 proposal lifecycle', () => {
  it('runs the complete policy/approval/fresh-prepare path', () => {
    const evaluated = proposalTransition(proposal(), {
      type: 'evaluate', policy: pushPolicy, evidence_ref: 'policy:head:' + CHANGE.head_sha,
    });
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(evaluated.proposal.status).toBe('evaluated');
    const awaiting = proposalTransition(evaluated.proposal, {
      type: 'request_approval', evidence_ref: 'approval-request:' + CHANGE.head_sha,
    });
    expect(awaiting.ok).toBe(true);
    if (!awaiting.ok) return;
    const approved = proposalTransition(awaiting.proposal, {
      type: 'approve', approver: 'owner-0001', evidence_ref: 'approval:' + CHANGE.head_sha,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const prepared = proposalTransition(approved.proposal, {
      type: 'prepare', current_base_sha: CHANGE.base_sha,
      current_diff_hash: CHANGE.diff_hash, evidence_ref: 'prepared:' + CHANGE.head_sha,
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.proposal.status).toBe('prepared');
      expect(prepared.proposal.actor.approver).toBe('owner-0001');
      expect(prepared.proposal.evidence_refs.at(-1)).toContain('prepared');
    }
  });

  it('forces sha/diff drift from every status to stale', () => {
    const statuses: ProposalStatus[] = [
      'proposed', 'evaluated', 'awaiting_approval', 'approved', 'prepared',
      'stale', 'rejected', 'withdrawn',
    ];
    for (const status of statuses) {
      for (const type of ['sha_moved', 'diff_changed'] as const) {
        const result = proposalTransition(proposal(status), {
          type, evidence_ref: `${type}:head:${CHANGE.head_sha}`,
        });
        expect(result.ok, `${status}:${type}`).toBe(true);
        if (result.ok) expect(result.proposal.status).toBe('stale');
      }
    }
  });

  it('refuses preparation if current base or diff has moved', () => {
    const approved = proposal('approved');
    for (const current of [
      { base: '9'.repeat(40), diff: CHANGE.diff_hash },
      { base: CHANGE.base_sha, diff: '9'.repeat(64) },
    ]) {
      expect(proposalTransition(approved, {
        type: 'prepare', current_base_sha: current.base, current_diff_hash: current.diff,
        evidence_ref: 'prepare-refusal:' + CHANGE.head_sha,
      })).toEqual({ ok: false, reason: 'proposal_stale' });
    }
  });

  it('requires a real approval-requiring policy before awaiting approval', () => {
    const noPolicy = proposal('evaluated');
    expect(proposalTransition(noPolicy, {
      type: 'request_approval', evidence_ref: 'approval-request:' + CHANGE.head_sha,
    })).toEqual({ ok: false, reason: 'approval_policy_missing' });
  });

  it('refuses self approval and missing transition evidence', () => {
    const awaiting = proposal('awaiting_approval');
    expect(proposalTransition(awaiting, {
      type: 'approve', approver: 'architect-0001', evidence_ref: 'self',
    })).toEqual({ ok: false, reason: 'attribution_invalid' });
    expect(proposalTransition(proposal(), {
      type: 'evaluate', policy: pushPolicy, evidence_ref: '',
    })).toEqual({ ok: false, reason: 'evidence_ref_required' });
  });

  it('rejects every event outside the explicit allow-table', () => {
    const cases = [
      [proposal('proposed'), { type: 'approve', approver: 'owner-0001', evidence_ref: 'e' }],
      [proposal('evaluated'), { type: 'prepare', current_base_sha: CHANGE.base_sha,
        current_diff_hash: CHANGE.diff_hash, evidence_ref: 'e' }],
      [proposal('prepared'), { type: 'withdraw', evidence_ref: 'e' }],
      [proposal('rejected'), { type: 'evaluate', policy: pushPolicy, evidence_ref: 'e' }],
    ] as const;
    for (const [p, event] of cases) {
      expect(proposalTransition(p, event)).toEqual({ ok: false, reason: 'invalid_transition' });
    }
  });
});
