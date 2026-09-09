import { describe, expect, it } from 'vitest';
import {
  buildArchitectAcquireInput,
  evaluateBranchPolicy,
  isBranchAllowed,
  isProtectedBase,
} from '../src/lib/ai-os/architect/branch-policy';
import { decideAcquire } from '../src/lib/ai-os/orchestration/worktree-lock';
import {
  UNIVERSAL_PROHIBITIONS,
  canAgentPerform,
} from '../src/lib/ai-os/orchestration/agent-contracts';
import { evaluatePolicy } from '../src/lib/ai-os/orchestration/policy';
import type { ArchitectRequest } from '../src/lib/ai-os/architect/intake';

const CORR = 'corr-architect-0003';
const HEAD = `architect/${CORR}`;
const request: ArchitectRequest = {
  repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
  objective: 'Implement a bounded change', correlation_id: CORR,
  requested_by: 'owner', source_goal_job_id: 'job-architect-0003',
  environment: 'staging',
};

describe('Architect branch policy', () => {
  it('recognizes protected branches and never accepts them as a head', () => {
    expect(isProtectedBase('master')).toBe(true);
    expect(isProtectedBase('release/2026-09')).toBe(true);
    expect(isProtectedBase('feature/hermes-native')).toBe(false);
    expect(isBranchAllowed('master', CORR)).toBe(false);
    expect(isBranchAllowed('release/2026-09', CORR)).toBe(false);
  });

  it('accepts only the exact architect/<correlation_id> head', () => {
    expect(isBranchAllowed(HEAD, CORR)).toBe(true);
    expect(isBranchAllowed('architect/another-correlation', CORR)).toBe(false);
    expect(isBranchAllowed('feature/architect', CORR)).toBe(false);
  });

  it('fails closed when the base allowlist is absent or does not match', () => {
    for (const allowed of [undefined, [], ['master']]) {
      expect(evaluateBranchPolicy({
        base_branch: request.base_branch, head_branch: HEAD,
        correlation_id: CORR, allowed_base_branches: allowed,
      })).toMatchObject({ allowed: false, reason: 'base_branch_not_allowed' });
    }
  });

  it('reports an allowed protected PR base without treating it as a writable head', () => {
    expect(evaluateBranchPolicy({
      base_branch: 'master', head_branch: HEAD, correlation_id: CORR,
      allowed_base_branches: ['master'],
    })).toEqual({ allowed: true, reason: 'branch_allowed', base_protected: true });
  });

  it('builds the existing wt/<job> AcquireInput and passes its audited validator', () => {
    const built = buildArchitectAcquireInput({
      request, head_branch: HEAD, allowed_base_branches: [request.base_branch],
      worktree_id: 'wt-job-architect-0003', owner: 'claude',
      token: 'token-architect-0003', base_commit: '8041f08425b87743a06e22ac50cea0d6b307b5f9',
      allowed_paths: ['apps/dashboard/src/lib/ai-os/architect'],
      now: '2026-09-08T22:00:00.000Z', tree_dirty: false, branch_exists: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.github_head_branch).toBe(HEAD);
    expect(built.input.branch).toBe('wt/job-architect-0003');
    expect(decideAcquire(built.input).ok).toBe(true);
  });
});

describe('AG-3 shared governance additions', () => {
  it('structurally prohibits force push, protected merge and protection weakening', () => {
    for (const name of [
      'force_push', 'merge_protected_branch', 'weaken_branch_protection',
    ]) {
      expect(UNIVERSAL_PROHIBITIONS).toContain(name);
      expect(canAgentPerform('claude', name as never)).toBe(false);
    }
  });

  it('grants proposal-only GitHub capability to implementers, never ChatGPT', () => {
    expect(canAgentPerform('claude', 'propose_github_change')).toBe(true);
    expect(canAgentPerform('codex', 'propose_github_change')).toBe(true);
    expect(canAgentPerform('chatgpt', 'propose_github_change')).toBe(false);
  });

  it('forces merge/force-push/branch-protection requests through the mobile gate', () => {
    for (const action of [
      'merge the pull request', 'force_push the branch', 'weaken branch_protection',
    ]) {
      expect(evaluatePolicy({ action, agent: 'claude', environment: 'staging' }))
        .toMatchObject({ tier: 'RED', requires_approval: true, mobile_gate: true });
    }
  });
});
