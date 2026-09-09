import { describe, expect, it } from 'vitest';

import {
  evaluateMergeReadiness, type LiveGithubMergeState,
} from '../src/lib/ai-os/architect/merge-readiness';
import type { ArchitectProposal } from '../src/lib/ai-os/architect/proposal';

const HEAD = '2'.repeat(40);
const BASE = '1'.repeat(40);

function proposal(): ArchitectProposal {
  return {
    request: {
      repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
      objective: 'Safe exact change', correlation_id: 'corr-architect-0009',
      requested_by: 'owner-0001', source_goal_job_id: 'job-architect-0009',
      environment: 'staging',
    },
    change: {
      repo: 'Zebone420/preston-os', base_branch: 'feature/hermes-native',
      head_branch: 'architect/corr-architect-0009', base_sha: BASE,
      head_sha: HEAD, diff_hash: '3'.repeat(64),
    },
    actor: { requested_by: 'owner-0001', proposer: 'architect-0001',
      approver: 'owner-0001', executor: 'claude',
      correlation_id: 'corr-architect-0009', run_id: 'run-0009' },
    evidence_refs: [], risk_class: 'RED', policy_decision: null,
    status: 'prepared',
    pr: { pr_url: 'https://github.test/pull/99', pr_number: 99 },
  };
}

function live(): LiveGithubMergeState {
  return {
    approving_reviews: 1, base_tip_sha: BASE,
    branch_protection: { enforced: true, required_approving_reviews: 1,
      required_checks: ['tests', 'typecheck'] },
    checks: [{ name: 'tests', conclusion: 'success' },
      { name: 'typecheck', conclusion: 'success' }],
    head_sha: HEAD, mergeable: true, pr_number: 99,
    pr_url: 'https://github.test/pull/99', state: 'open',
  };
}

describe('AG-9 merge-readiness advice', () => {
  it('reports ready only when every recorded and live fact agrees', () => {
    const one = evaluateMergeReadiness(proposal(), live());
    const two = evaluateMergeReadiness(proposal(), live());
    expect(one).toEqual(two);
    expect(one.ready).toBe(true);
    expect(one.disagreements).toEqual([]);
    expect(one.evidence_ref).toMatch(new RegExp(`^merge_readiness:${HEAD}:[0-9a-f]{64}$`));
  });

  it('makes every disagreement independently not ready', () => {
    const cases: Array<[string, (p: ArchitectProposal, state: LiveGithubMergeState) => void]> = [
      ['recorded_pr_missing', (p) => { delete p.pr; }],
      ['pr_number_mismatch', (_p, s) => { s.pr_number = 100; }],
      ['pr_url_mismatch', (_p, s) => { s.pr_url = 'https://github.test/pull/100'; }],
      ['pr_not_open', (_p, s) => { s.state = 'closed'; }],
      ['head_sha_mismatch', (_p, s) => { s.head_sha = '8'.repeat(40); }],
      ['base_sha_moved', (_p, s) => { s.base_tip_sha = '9'.repeat(40); }],
      ['pr_not_mergeable', (_p, s) => { s.mergeable = false; }],
      ['mergeability_unknown', (_p, s) => { s.mergeable = null; }],
      ['required_check_missing:tests', (_p, s) => { s.checks.shift(); }],
      ['required_check_not_successful:tests', (_p, s) => {
        s.checks[0].conclusion = 'failure';
      }],
      ['required_approving_reviews_missing', (_p, s) => { s.approving_reviews = 0; }],
    ];
    for (const [expected, mutate] of cases) {
      const p = proposal();
      const state = live();
      mutate(p, state);
      const verdict = evaluateMergeReadiness(p, state);
      expect(verdict.ready, expected).toBe(false);
      expect(verdict.disagreements, expected).toContain(expected);
    }
  });

  it('fails closed on missing or malformed live GitHub facts', () => {
    for (const raw of [null, {}, { ...live(), checks: 'success' },
      { ...live(), branch_protection: null },
      { ...live(), approving_reviews: -1 }]) {
      expect(evaluateMergeReadiness(proposal(), raw)).toMatchObject({
        ready: false, disagreements: ['live_github_state_invalid'],
      });
    }
  });

  it('does not require reviews when branch protection requires zero', () => {
    const state = live();
    state.branch_protection.required_approving_reviews = 0;
    state.approving_reviews = 0;
    expect(evaluateMergeReadiness(proposal(), state).ready).toBe(true);
  });
});
