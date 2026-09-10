import { describe, expect, it } from 'vitest';

import { githubChangeDigest } from '../src/lib/ai-os/architect/change-binding';
import { EVIDENCE_REQUIREMENTS, formatEvidenceRef }
  from '../src/lib/ai-os/architect/evidence';
import { makeGithubApprovalRequest }
  from '../src/lib/ai-os/architect/github-execute';
import type { ArchitectProposal } from '../src/lib/ai-os/architect/proposal';
import { evaluatePolicy } from '../src/lib/ai-os/orchestration/policy';
import {
  createArchitectToolSession,
  prestonDecideArchitectProposal,
  prestonGetArchitectProposal,
  prestonListArchitectProposals,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import {
  DecideArchitectProposalSchema,
  GetArchitectProposalSchema,
  ListArchitectProposalsSchema,
} from '../src/lib/preston-control/schemas';
import { TOOL_NAMES } from '../src/lib/preston-control/server';

// AG-5 preserves Preston Control's exact authenticated owner email.
const OWNER = 'info@preston.nyc';
const NOW = '2026-09-09T12:01:00.000Z';
const POLICY = evaluatePolicy({ action: 'push exact change and open pull request',
  agent: 'claude', environment: 'staging' });

function proposal(): ArchitectProposal {
  const head = '2'.repeat(40);
  return {
    request: {
      repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
      objective: 'Safe exact change', correlation_id: 'corr-architect-0010',
      requested_by: OWNER, source_goal_job_id: 'job-architect-0010',
      environment: 'staging',
    },
    change: {
      repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
      head_branch: 'architect/corr-architect-0010', base_sha: '1'.repeat(40),
      head_sha: head, diff_hash: '3'.repeat(64),
    },
    actor: { requested_by: OWNER, proposer: 'architect-0010', approver: OWNER,
      executor: 'claude', correlation_id: 'corr-architect-0010', run_id: 'run-0010' },
    evidence_refs: EVIDENCE_REQUIREMENTS[POLICY.risk_class].map((kind) =>
      formatEvidenceRef({ kind, head_sha: head, locator: `artifact/${kind}` })),
    risk_class: POLICY.risk_class, policy_decision: POLICY,
    status: 'awaiting_approval',
  };
}

function setup(ownerEmail = OWNER) {
  const p = proposal();
  const approval = makeGithubApprovalRequest(p, {
    approval_id: 'approval-architect-0010', reason: 'exact change reviewed',
    expected_effect: 'record approval', rollback_plan: 'reject proposal',
    now: '2026-09-09T12:00:00.000Z',
  });
  if (!approval.ok) throw new Error(approval.errors.join(','));
  const architectSession = createArchitectToolSession({
    proposals: [p], approvals: [{ proposal_id: p.request.correlation_id,
      request: approval.request }],
  });
  const ctx = { client: {} as ToolContext['client'], ownerEmail, now: NOW,
    architectSession, architectRepoAllowlist: p.change.repo };
  return { p, approval: approval.request, ctx };
}

describe('AG-10 Preston Control handoff', () => {
  it('registers the three tools with strict bounded schemas', () => {
    expect(TOOL_NAMES).toEqual(expect.arrayContaining([
      'list_architect_proposals', 'get_architect_proposal',
      'decide_architect_proposal',
    ]));
    expect(ListArchitectProposalsSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(GetArchitectProposalSchema.safeParse({ proposal_id: 'short' }).success).toBe(false);
    expect(DecideArchitectProposalSchema.safeParse({
      proposal_id: 'corr-architect-0010', approval_id: 'approval-architect-0010',
      outcome: 'approved', presented_hash: '3'.repeat(64),
      owner_confirmation: 'Approve approval-architect-0010', extra: true,
    }).success).toBe(false);
  });

  it('lists and gets a bounded, exact-digest session proposal', async () => {
    const { p, ctx } = setup();
    const list = await prestonListArchitectProposals(ctx, { limit: 1 });
    expect(list).toMatchObject({ ok: true, proposals: [{
      proposal_id: p.request.correlation_id,
      approval_digest: githubChangeDigest(p.change), status: 'awaiting_approval',
    }] });
    const detail = await prestonGetArchitectProposal(ctx, {
      proposal_id: p.request.correlation_id,
    });
    expect(detail).toMatchObject({ ok: true, proposal: {
      head_sha: p.change.head_sha, diff_hash: p.change.diff_hash,
      evidence_bindings: expect.any(Array),
    } });
    expect(JSON.stringify(detail)).not.toContain('artifact/');
  });

  it('records an approved owner decision through approvals.ts without GitHub I/O', async () => {
    const { p, approval, ctx } = setup();
    const result = await prestonDecideArchitectProposal(ctx, {
      proposal_id: p.request.correlation_id, approval_id: approval.approval_id,
      outcome: 'approved', presented_hash: approval.action_hash,
      owner_confirmation: `Approve ${approval.approval_id}`,
    });
    expect(result).toMatchObject({ ok: true, status: 'approved',
      decided_by: OWNER });
    expect((await prestonGetArchitectProposal(ctx, {
      proposal_id: p.request.correlation_id,
    }))).toMatchObject({ ok: true, proposal: { status: 'approved', approver: OWNER } });
    expect(await prestonDecideArchitectProposal(ctx, {
      proposal_id: p.request.correlation_id, approval_id: approval.approval_id,
      outcome: 'approved', presented_hash: approval.action_hash,
      owner_confirmation: `Approve ${approval.approval_id}`,
    })).toMatchObject({ ok: false, error: 'not_pending' });
  });

  it('passes through owner, hash, confirmation, and lifecycle refusals verbatim', async () => {
    const cases = [
      { owner: 'other-owner-0001', hash: null, confirmation: true,
        error: 'actor_not_owner' },
      { owner: OWNER, hash: '0'.repeat(64), confirmation: true,
        error: 'hash_mismatch' },
      { owner: OWNER, hash: null, confirmation: false,
        error: 'owner_confirmation_required' },
    ];
    for (const item of cases) {
      const { p, approval, ctx } = setup(item.owner);
      expect(await prestonDecideArchitectProposal(ctx, {
        proposal_id: p.request.correlation_id, approval_id: approval.approval_id,
        outcome: 'approved', presented_hash: item.hash ?? approval.action_hash,
        owner_confirmation: item.confirmation ? `Approve ${approval.approval_id}` : '',
      })).toMatchObject({ ok: false, error: item.error });
    }
  });

  it('fails closed when session state is absent, missing, or invalid', async () => {
    const bare = { client: {} as ToolContext['client'], ownerEmail: OWNER, now: NOW };
    expect(await prestonListArchitectProposals(bare, {})).toMatchObject({
      ok: false, error: 'architect_session_unavailable',
    });
    const { ctx } = setup();
    expect(await prestonGetArchitectProposal(ctx, {
      proposal_id: 'corr-architect-missing',
    })).toEqual({ ok: false, error: 'architect_proposal_not_found' });
    const broken = proposal();
    broken.change.head_sha = 'invalid';
    ctx.architectSession = createArchitectToolSession({ proposals: [broken], approvals: [] });
    expect(await prestonGetArchitectProposal(ctx, {
      proposal_id: broken.request.correlation_id,
    })).toMatchObject({ ok: false,
      error: expect.stringContaining('architect_change_invalid:head_sha_invalid') });

    const denied = setup();
    denied.ctx.architectRepoAllowlist = 'AnotherOwner/another-repo';
    expect(await prestonGetArchitectProposal(denied.ctx, {
      proposal_id: denied.p.request.correlation_id,
    })).toMatchObject({ ok: false,
      error: 'architect_repo_invalid:repository_not_allowed' });
  });
});
