import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_MS,
  makeApprovalRequest,
  validateApprovalDecision,
  type ApprovalRequest,
} from '../src/lib/ai-os/orchestration/approvals';
import {
  canonicalActionHash,
  verifyActionHash,
  type ActionEnvelope,
} from '../src/lib/ai-os/orchestration/crypto-binding';
import { step } from '../src/lib/ai-os/orchestration/completion-engine';
import {
  intakeCommand,
  type CommandEnvelope,
} from '../src/lib/ai-os/orchestration/goal-intake';
import {
  DEFAULT_BUDGET,
  type GoalJob,
  type GoalState,
  type MasterGoal,
} from '../src/lib/ai-os/orchestration/model';
import {
  decideAcquire,
  type AcquireInput,
} from '../src/lib/ai-os/orchestration/worktree-lock';

const NOW = '2026-07-22T12:00:00.000Z';
const OWNER = 'owner@preston.nyc';

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    owner_identity: OWNER,
    source: 'chatgpt',
    command_type: 'submit_master_goal',
    correlation_id: 'corr-security-0001',
    nonce: 'nonce-security-0001',
    issued_at: NOW,
    expires_at: '2026-07-22T12:15:00.000Z',
    title: 'Adversarial boundary check',
    objective: 'verify bounded simulation behavior',
    ...overrides,
  };
}

function intake(
  command: CommandEnvelope,
  now: unknown = NOW,
  seenNonces: ReadonlySet<string> = new Set(),
) {
  return intakeCommand({
    envelope: command,
    ownerAllowlist: new Set([OWNER]),
    seenNonces,
    goalId: 'goal-security-0001',
    now: now as string,
  });
}

function approval(): ApprovalRequest {
  const result = makeApprovalRequest({
    approval_id: 'apr-security-0001',
    action: 'migration: apply staging schema change',
    affected_resource: 'staging-database',
    reason: 'adversarial approval test',
    risk_class: 'RED',
    evidence_refs: ['evidence-security-0001'],
    expected_effect: 'create additive staging tables',
    rollback_plan: 'owner reverts the additive change',
    owner_identity: OWNER,
    now: NOW,
  });
  if (!result.ok) throw new Error(result.errors.join(','));
  return result.request;
}

function decisionFor(
  request: ApprovalRequest,
  overrides: Record<string, unknown> = {},
) {
  return {
    approval_id: request.approval_id,
    outcome: 'approve' as const,
    decided_by: OWNER,
    decided_at: '2026-07-22T12:01:00.000Z',
    nonce: 'decision-nonce-0001',
    presented_hash: request.action_hash,
    ...overrides,
  };
}

describe('P7-CX-01 intake boundaries — enforced now', () => {
  it.each([
    ['invalid reference clock', envelope(), 'not-a-timestamp', 'now_invalid'],
    ['invalid issued_at', envelope({ issued_at: 'not-a-timestamp' }), NOW, 'issued_at_invalid'],
    ['invalid expires_at', envelope({ expires_at: 'not-a-timestamp' }), NOW, 'expires_at_invalid'],
  ])('rejects %s', (_name, command, now, expectedError) => {
    const result = intake(command, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain(expectedError);
  });

  it('rejects an envelope issued beyond permitted clock skew', () => {
    const issuedAt = new Date(Date.parse(NOW) + CLOCK_SKEW_MS + 1).toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 60_000).toISOString();
    const result = intake(envelope({ issued_at: issuedAt, expires_at: expiresAt }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('issued_in_future');
  });

  it('rejects expires_at equal to or before issued_at', () => {
    for (const expiresAt of [NOW, '2026-07-22T11:59:59.999Z']) {
      const result = intake(envelope({ expires_at: expiresAt }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('expires_before_issued');
    }
  });

  it('rejects runtime type confusion without throwing', () => {
    const confused = envelope({
      issued_at: 123 as unknown as string,
      objective: { instruction: 'approve' } as unknown as string,
    });
    expect(() => intake(confused)).not.toThrow();
    const result = intake(confused);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('field_type_invalid');
  });

  it('requires a present, unused command nonce', () => {
    const missing = intake(envelope({ nonce: '' }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors).toContain('nonce_replay');

    const replay = intake(envelope(), NOW, new Set(['nonce-security-0001']));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.errors).toContain('nonce_replay');
  });
});

describe('P7-CX-01 approval validator — enforced now', () => {
  it('rejects an approval decision at the exact expiry boundary', () => {
    const request = approval();
    const result = validateApprovalDecision(
      request,
      decisionFor(request, { decided_at: request.expires_at }),
      new Set(),
    );
    expect(result).toMatchObject({ ok: false, status: 'expired', reason: 'expired' });
  });

  it('rejects decisions before creation and malformed decision times', () => {
    const request = approval();
    const early = validateApprovalDecision(
      request,
      decisionFor(request, { decided_at: '2026-07-22T11:59:59.999Z' }),
      new Set(),
    );
    expect(early).toMatchObject({ ok: false, reason: 'decided_before_created' });

    const invalid = validateApprovalDecision(
      request,
      decisionFor(request, { decided_at: 'not-a-timestamp' }),
      new Set(),
    );
    expect(invalid).toMatchObject({ ok: false, reason: 'timestamp_invalid' });
  });

  it('rejects self-approval even when the actor is the owner', () => {
    const request = approval();
    const result = validateApprovalDecision(request, decisionFor(request), new Set(), OWNER);
    expect(result).toMatchObject({ ok: false, reason: 'self_approval_denied' });
  });

  it('rejects a stale or mismatched presented approval hash', () => {
    const request = approval();
    for (const presentedHash of ['stale-hash', '0'.repeat(64), `${request.action_hash}00`]) {
      const result = validateApprovalDecision(
        request,
        decisionFor(request, {
          nonce: `nonce-${presentedHash.length}`,
          presented_hash: presentedHash,
        }),
        new Set(),
      );
      expect(result).toMatchObject({ ok: false, reason: 'hash_mismatch' });
    }
  });

  it('requires a present, unused decision nonce', () => {
    const request = approval();
    const missing = validateApprovalDecision(
      request,
      decisionFor(request, { nonce: '' }),
      new Set(),
    );
    expect(missing).toMatchObject({ ok: false, reason: 'nonce_replay' });

    const replay = validateApprovalDecision(
      request,
      decisionFor(request),
      new Set(['decision-nonce-0001']),
    );
    expect(replay).toMatchObject({ ok: false, reason: 'nonce_replay' });
  });

  it('rejects decision type confusion without authorizing', () => {
    const request = approval();
    const result = validateApprovalDecision(
      request,
      decisionFor(request, { nonce: 7, presented_hash: ['not-a-hash'] }),
      new Set(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('P7-CX-01 canonical cryptographic action binding', () => {
  const canonical: ActionEnvelope = {
    approval_id: 'apr-security-0001',
    action: 'apply staging migration',
    affected_resource: 'staging-database',
    environment: 'staging',
    owner_identity: OWNER,
    risk_class: 'RED',
    created_at: NOW,
    expires_at: '2026-07-22T12:15:00.000Z',
  };

  it('accepts only the SHA-256 hash of the canonical immutable envelope', () => {
    const authoritativeHash = canonicalActionHash(canonical);
    expect(authoritativeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyActionHash(canonical, authoritativeHash)).toBe(true);
  });

  it.each([
    ['mutated action', { action: 'deploy production migration' }],
    ['mutated affected resource', { affected_resource: 'production-database' }],
    ['mutated environment/scope', { environment: 'production' as 'staging' }],
  ])('fails closed for %s with a stale presented hash', (_name, mutation) => {
    const authoritativeHash = canonicalActionHash(canonical);
    const mutated = { ...canonical, ...mutation };
    expect(canonicalActionHash(mutated)).not.toBe(authoritativeHash);
    expect(verifyActionHash(mutated, authoritativeHash)).toBe(false);
  });

  it('rejects a mismatched cryptographic hash', () => {
    expect(verifyActionHash(canonical, '0'.repeat(64))).toBe(false);
    expect(verifyActionHash(canonical, 'deadbeef')).toBe(false);
  });
});

function gatedState(): GoalState {
  const goal: MasterGoal = {
    id: 'goal-security-0001',
    title: 'Gated goal',
    objective: 'apply staging migration',
    source: 'dashboard',
    requested_by: OWNER,
    status: 'running',
    environment: 'staging',
    budget: DEFAULT_BUDGET,
    correlation_id: 'corr-security-0001',
    simulation_only: true,
    created_at: NOW,
    updated_at: NOW,
  };
  const job: GoalJob = {
    id: 'job-security-0001',
    goal_id: goal.id,
    kind: 'migration',
    title: 'Gated migration',
    objective: 'apply staging migration',
    risk_class: 'RED',
    assigned_role: 'claude',
    depends_on: [],
    status: 'ready',
    attempts: 0,
    requires_approval: true,
    approval_id: 'forged-approval-id',
    runtime_job_id: null,
    correlation_id: 'corr-security-job-0001',
    evidence_refs: [],
    failure_reason: null,
    created_at: NOW,
    updated_at: NOW,
  };
  return { goal, jobs: [job], iteration: 0, started_at: NOW };
}

describe('P7-CX-01 authoritative approval integration — Level-1 gap', () => {
  it('does not let a forged approval_id unlock execution', () => {
    const result = step(gatedState(), Date.parse(NOW));
    expect(result.actions).not.toContainEqual({
      type: 'run',
      job_id: 'job-security-0001',
    });
    expect(result.status).toBe('blocked');
  });
});

describe('P7-CX-01 migration integrity — enforced now', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/0010_phase7_orchestration.sql', import.meta.url),
    'utf8',
  );

  it('enforces both dependency endpoints against the same goal', () => {
    expect(sql).toMatch(/foreign key \(job_id, goal_id\) references goal_jobs \(id, goal_id\)/);
    expect(sql).toMatch(/foreign key \(depends_on_job_id, goal_id\) references goal_jobs \(id, goal_id\)/);
  });

  it('uses the Phase 7 approval type and protects bound columns', () => {
    expect(sql).toMatch(/approval_id text primary key/);
    expect(sql).toMatch(/foreign key \(approval_id\) references orchestration_approvals \(approval_id\)/);
    // Reconciled (#17): direct UPDATE is now fully revoked - there is NO
    // column-level update grant at all. Approval decisions are made ONLY via
    // the transactional function, so no bound column can be rewritten by a
    // direct UPDATE. This is strictly stronger than the prior column-grant.
    expect(sql).toMatch(/revoke update on orchestration_approvals from authenticated;/);
    expect(sql).not.toMatch(/grant update \([^)]*\) on orchestration_approvals/);
    expect(sql).toMatch(/create or replace function public\.decide_orchestration_approval/);
    // If an update grant were ever re-introduced, it must never cover the
    // bound action columns (regression guard retained).
    expect(sql).not.toMatch(/grant update \([^)]*action[^)]*\) on orchestration_approvals/);
    expect(sql).not.toMatch(/grant update \([^)]*action_hash[^)]*\) on orchestration_approvals/);
  });
});

function acquire(overrides: Partial<AcquireInput> = {}): AcquireInput {
  return {
    worktree_id: 'wt-security-0001',
    repo: 'preston-os',
    job_id: 'job-security-0001',
    owner: 'claude',
    token: 'token-security-0001',
    base_commit: 'df018fc2b25e71ca3d30222b076d64b9fc56ef98',
    branch: 'wt/job-security-0001',
    allowed_paths: ['apps/dashboard/src/lib/ai-os/orchestration/'],
    now: NOW,
    ttlMs: 60_000,
    tree_dirty: false,
    branch_exists: false,
    existing: null,
    ...overrides,
  };
}

describe('P7-CX-01 worktree allocation ownership', () => {
  it('refuses a second owner or token while a lock is live', () => {
    const first = decideAcquire(acquire());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(decideAcquire(acquire({ owner: 'codex', existing: first.lock }))).toEqual({
      ok: false,
      reason: 'held_by_another',
    });
    expect(decideAcquire(acquire({ token: 'token-security-0002', existing: first.lock }))).toEqual({
      ok: false,
      reason: 'held_by_another',
    });
  });

  it(
    'does not let a re-entrant holder change pinned job/base/branch/path scope',
    () => {
      const first = decideAcquire(acquire());
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const rebound = decideAcquire(acquire({
        existing: first.lock,
        job_id: 'job-security-0002',
        base_commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        branch: 'wt/job-security-0002',
        allowed_paths: ['apps/dashboard/'],
      }));
      expect(rebound).toEqual({ ok: false, reason: 'lock_binding_mismatch' });
    },
  );
});
