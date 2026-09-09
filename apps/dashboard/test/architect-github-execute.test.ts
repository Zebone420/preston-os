import { describe, expect, it, vi } from 'vitest';

import {
  executeGithubProposal,
  makeGithubApprovalRequest,
  type GithubExecutionIo,
  type GithubPrRecord,
} from '../src/lib/ai-os/architect/github-execute';
import { githubChangeDigest, type GithubChangeEnvelope }
  from '../src/lib/ai-os/architect/change-binding';
import {
  EVIDENCE_REQUIREMENTS, formatEvidenceRef,
} from '../src/lib/ai-os/architect/evidence';
import { buildPrPayload } from '../src/lib/ai-os/architect/pr-provenance';
import type { ArchitectProposal } from '../src/lib/ai-os/architect/proposal';
import type {
  ApprovalDecisionInput, ApprovalRequest,
} from '../src/lib/ai-os/orchestration/approvals';
import { evaluatePolicy } from '../src/lib/ai-os/orchestration/policy';

const CHANGE: GithubChangeEnvelope = {
  repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
  head_branch: 'architect/corr-architect-0008',
  base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), diff_hash: '3'.repeat(64),
};
const POLICY = evaluatePolicy({
  action: 'push exact pinned change and open pull request',
  agent: 'claude', environment: 'staging',
});

function evidence(head = CHANGE.head_sha): string[] {
  return EVIDENCE_REQUIREMENTS[POLICY.risk_class].map((kind) =>
    formatEvidenceRef({ kind, head_sha: head, locator: `artifact/${kind}.json` }));
}

function proposal(overrides: Partial<ArchitectProposal> = {}): ArchitectProposal {
  return {
    request: {
      repo: CHANGE.repo, base_branch: CHANGE.base_branch, objective: 'Safe exact change',
      correlation_id: 'corr-architect-0008', requested_by: 'owner-0001',
      source_goal_job_id: 'job-architect-0008', environment: 'staging',
    },
    change: { ...CHANGE },
    actor: {
      requested_by: 'owner-0001', proposer: 'architect-0001', approver: 'owner-0001',
      executor: 'claude', correlation_id: 'corr-architect-0008', run_id: 'run-0008',
    },
    evidence_refs: evidence(), risk_class: POLICY.risk_class,
    policy_decision: POLICY, status: 'approved', ...overrides,
  };
}

function approval(p = proposal()): {
  request: ApprovalRequest; decision: ApprovalDecisionInput;
} {
  const digest = githubChangeDigest(p.change);
  const built = makeGithubApprovalRequest(p, {
    approval_id: 'approval-0008', reason: 'owner reviewed exact digest',
    expected_effect: 'open one pull request', rollback_plan: 'close pull request',
    now: '2026-09-09T12:00:00.000Z',
  });
  if (!built.ok) throw new Error(built.errors.join(','));
  return {
    request: built.request,
    decision: {
      approval_id: 'approval-0008', outcome: 'approve', decided_by: 'owner-0001',
      decided_at: '2026-09-09T12:01:00.000Z', nonce: 'nonce-0008',
      presented_hash: digest,
    },
  };
}

function harness(existing: GithubPrRecord | null = null) {
  const io: GithubExecutionIo = {
    readCurrentState: vi.fn().mockResolvedValue({
      base_sha: CHANGE.base_sha, diff_hash: CHANGE.diff_hash,
    }),
    findExistingPr: vi.fn().mockResolvedValue(existing),
    pushExact: vi.fn().mockResolvedValue(undefined),
    openPr: vi.fn().mockResolvedValue({
      created_at: '2026-09-09T12:02:00.000Z', head_sha: CHANGE.head_sha,
      pr_number: 81, pr_url: 'https://github.test/pull/81',
    }),
  };
  const cache = new Map<string, GithubPrRecord>();
  return { io, cache };
}

const ENABLED = {
  ARCHITECT_GITHUB_EXECUTE_ENABLED: 'true',
  ARCHITECT_GITHUB_TOKEN: 'not-configured-test-placeholder',
  ARCHITECT_REPO_ALLOWLIST: CHANGE.repo,
};

describe('AG-8 governed GitHub execution', () => {
  it('builds the only exact-digest approval path through existing primitives', () => {
    const p = proposal();
    const built = approval(p);
    expect(built.request.action_hash).toBe(githubChangeDigest(p.change));
    expect(built.request.owner_identity).toBe(p.actor.approver);
    expect(built.request.environment).toBe('staging');
    const withoutApprover = proposal({ actor: { ...p.actor, approver: null } });
    expect(makeGithubApprovalRequest(withoutApprover, {
      approval_id: 'approval-0008', reason: 'x', expected_effect: 'x',
      rollback_plan: 'x', now: '2026-09-09T12:00:00.000Z',
    })).toEqual({ ok: false, errors: ['architect_approver_required'] });
  });

  it('builds deterministic provenance with exact refs and evidence', () => {
    const p = proposal();
    const one = buildPrPayload(p);
    const two = buildPrPayload({ ...p, evidence_refs: [...p.evidence_refs].reverse() });
    expect(one).toEqual(two);
    expect(one).toMatchObject({
      base: CHANGE.base_branch, head: CHANGE.head_branch, title: 'Safe exact change',
    });
    for (const exact of [CHANGE.base_sha, CHANGE.head_sha, CHANGE.diff_hash]) {
      expect(one.body).toContain(exact);
    }
  });

  it('is disabled by default and missing-token fail-closed before I/O', async () => {
    for (const env of [{}, {
      ARCHITECT_GITHUB_EXECUTE_ENABLED: 'true',
      ARCHITECT_REPO_ALLOWLIST: CHANGE.repo,
    }]) {
      const h = harness();
      const a = approval();
      const result = await executeGithubProposal({
        proposal: proposal(), approval_request: a.request, approval_decision: a.decision,
      }, { ...h, env });
      expect(result).toEqual({ executed: false,
        reason: env.ARCHITECT_GITHUB_EXECUTE_ENABLED ? 'github_token_missing' : 'execution_disabled' });
      expect(h.io.readCurrentState).not.toHaveBeenCalled();
      expect(h.io.pushExact).not.toHaveBeenCalled();
    }
  });

  it('rechecks every gate and performs one exact push/open through injected I/O', async () => {
    const h = harness();
    const p = proposal();
    const a = approval(p);
    const result = await executeGithubProposal({
      proposal: p, approval_request: a.request, approval_decision: a.decision,
    }, { ...h, env: ENABLED });
    expect(result, JSON.stringify(result)).toMatchObject({ executed: true, idempotent: false,
      reused_existing_pr: false, pr: { head_sha: CHANGE.head_sha, pr_number: 81 } });
    expect(h.io.readCurrentState).toHaveBeenCalledOnce();
    expect(h.io.pushExact).toHaveBeenCalledWith(CHANGE);
    expect(h.io.openPr).toHaveBeenCalledOnce();
  });

  it('is idempotent by approval plus digest and rechecks current state on replay', async () => {
    const h = harness();
    const p = proposal();
    const a = approval(p);
    const input = { proposal: p, approval_request: a.request, approval_decision: a.decision };
    expect((await executeGithubProposal(input, { ...h, env: ENABLED })).executed).toBe(true);
    const replay = await executeGithubProposal(input, { ...h, env: ENABLED });
    expect(replay).toMatchObject({ executed: true, idempotent: true });
    expect(h.io.readCurrentState).toHaveBeenCalledTimes(2);
    expect(h.io.pushExact).toHaveBeenCalledOnce();
    expect(h.io.openPr).toHaveBeenCalledOnce();
  });

  it('returns an existing exact-head PR without push or duplicate open', async () => {
    const existing = { created_at: '2026-09-09T12:02:00.000Z',
      head_sha: CHANGE.head_sha, pr_number: 44,
      pr_url: 'https://github.test/pull/44' };
    const h = harness(existing);
    const p = proposal();
    const a = approval(p);
    const result = await executeGithubProposal({
      proposal: p, approval_request: a.request, approval_decision: a.decision,
    }, { ...h, env: ENABLED });
    expect(result).toMatchObject({ executed: true, idempotent: true,
      reused_existing_pr: true, pr: existing });
    expect(h.io.pushExact).not.toHaveBeenCalled();
    expect(h.io.openPr).not.toHaveBeenCalled();
  });

  it('refuses moved base and changed diff before any push', async () => {
    for (const current of [
      { base_sha: '9'.repeat(40), diff_hash: CHANGE.diff_hash },
      { base_sha: CHANGE.base_sha, diff_hash: '9'.repeat(64) },
    ]) {
      const h = harness();
      vi.mocked(h.io.readCurrentState).mockResolvedValue(current);
      const p = proposal();
      const a = approval(p);
      const result = await executeGithubProposal({
        proposal: p, approval_request: a.request, approval_decision: a.decision,
      }, { ...h, env: ENABLED });
      expect(result).toMatchObject({ executed: false });
      expect(h.io.pushExact).not.toHaveBeenCalled();
    }
  });

  it('rejects a changed head under the old approval/cache binding', async () => {
    const h = harness();
    const original = proposal();
    const a = approval(original);
    expect((await executeGithubProposal({
      proposal: original, approval_request: a.request, approval_decision: a.decision,
    }, { ...h, env: ENABLED })).executed).toBe(true);
    const changed = proposal({ change: { ...CHANGE, head_sha: '8'.repeat(40) },
      evidence_refs: evidence('8'.repeat(40)) });
    const denied = await executeGithubProposal({
      proposal: changed, approval_request: a.request, approval_decision: a.decision,
    }, { ...h, env: ENABLED });
    expect(denied).toEqual({ executed: false, reason: 'approval_request_hash_mismatch' });
    expect(h.io.pushExact).toHaveBeenCalledOnce();
  });

  it('rejects static authorization/evidence/approval failures before I/O', async () => {
    const cases: Array<[string, ArchitectProposal, (a: ReturnType<typeof approval>) => void]> = [
      ['proposal', proposal({ status: 'awaiting_approval' }), () => undefined],
      ['evidence', proposal({ evidence_refs: [] }), () => undefined],
      ['owner', proposal(), (a) => { a.decision.decided_by = 'other-owner'; }],
      ['expiry', proposal(), (a) => { a.decision.decided_at = a.request.expires_at; }],
      ['hash', proposal(), (a) => { a.decision.presented_hash = '0'.repeat(64); }],
      ['outcome', proposal(), (a) => { a.decision.outcome = 'reject'; }],
      ['self-approval', proposal({ actor: { ...proposal().actor,
        proposer: 'owner-0001' } }), () => undefined],
      ['protected-head', proposal({ change: { ...CHANGE, head_branch: 'master' } }),
        () => undefined],
    ];
    for (const [label, p, mutate] of cases) {
      const h = harness();
      const a = approval(p);
      mutate(a);
      const result = await executeGithubProposal({
        proposal: p, approval_request: a.request, approval_decision: a.decision,
      }, { ...h, env: ENABLED });
      expect(result.executed, label).toBe(false);
      expect(h.io.readCurrentState, label).not.toHaveBeenCalled();
      expect(h.io.pushExact, label).not.toHaveBeenCalled();
    }
  });

  it('surfaces external failures as typed refusals without false success', async () => {
    for (const [method, reason] of [
      ['readCurrentState', 'github_state_unavailable'],
      ['findExistingPr', 'github_pr_lookup_failed'],
      ['pushExact', 'github_push_failed'],
      ['openPr', 'github_pr_open_failed_after_push'],
    ] as const) {
      const h = harness();
      vi.mocked(h.io[method]).mockRejectedValue(new Error('injected failure'));
      const p = proposal();
      const a = approval(p);
      expect(await executeGithubProposal({
        proposal: p, approval_request: a.request, approval_decision: a.decision,
      }, { ...h, env: ENABLED })).toEqual({ executed: false, reason });
    }
  });
});
