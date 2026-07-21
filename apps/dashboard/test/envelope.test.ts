import { describe, expect, it } from 'vitest';
import {
  ALLOWED_OPERATIONS,
  REQUIRED_PROHIBITED_OPERATIONS,
  envelopeFromPacketAndJob,
  validateJobEnvelope,
  type JobEnvelope,
} from '../src/lib/ai-os/envelope';
import type { CommandPacket } from '../src/lib/ai-os/commands';
import type { Job } from '../src/lib/ai-os/queue';

const NOW = '2026-07-21T12:00:00.000Z';
const HEX40 = 'a'.repeat(40);

// A minimal, fully-valid staging docs-only envelope. Individual tests mutate
// a shallow copy of this to exercise exactly one fail-closed rejection.
function validEnvelope(): Record<string, unknown> {
  return {
    correlation_id: 'corr-1',
    command_packet_id: 'cmd-1',
    job_id: 'job-1',
    environment: 'staging',
    requested_by: 'owner',
    source: 'claude',
    title: 'Docs-only staging job',
    objective: 'Update a doc in staging',
    scope: 'docs/example.md',
    constraints: ['no execution'],
    risk_class: 'GREEN',
    allowed_operations: ['read_repo', 'edit_docs'],
    prohibited_operations: [...REQUIRED_PROHIBITED_OPERATIONS],
    base_branch: 'master',
    base_commit: HEX40,
    worktree_path: '/srv/worktrees/wt-5j-orchestration',
    assigned_implementer: 'claude',
    assigned_reviewer: 'codex',
    required_tests: ['vitest run'],
    required_evidence: ['test output'],
    checkpoint_state: 'not_started',
    approval_state: 'pending_owner',
    execution: false,
    push: false,
    deploy: false,
    created_at: NOW,
    updated_at: NOW,
    audit_refs: [],
  };
}

describe('validateJobEnvelope - happy path', () => {
  it('accepts a valid staging docs-only envelope', () => {
    const result = validateJobEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.environment).toBe('staging');
      expect(result.envelope.execution).toBe(false);
      expect(result.envelope.push).toBe(false);
      expect(result.envelope.deploy).toBe(false);
    }
  });

  it('accepts every declared allowed_operation on its own', () => {
    for (const op of ALLOWED_OPERATIONS) {
      const result = validateJobEnvelope({ ...validEnvelope(), allowed_operations: [op] });
      expect(result.ok).toBe(true);
    }
  });
});

describe('validateJobEnvelope - fail-closed rejections', () => {
  it('rejects a missing required field', () => {
    const bad = validEnvelope();
    delete (bad as Record<string, unknown>).title;
    const result = validateJobEnvelope(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('title'))).toBe(true);
  });

  it('rejects environment !== staging', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), environment: 'production' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('staging'))).toBe(true);
  });

  it('rejects execution === true', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), execution: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('execution'))).toBe(true);
  });

  it('rejects push === true', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), push: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('push'))).toBe(true);
  });

  it('rejects deploy === true', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), deploy: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('deploy'))).toBe(true);
  });

  it('rejects assigned_implementer === assigned_reviewer', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      assigned_implementer: 'claude',
      assigned_reviewer: 'claude',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('assigned_reviewer'))).toBe(true);
    }
  });

  it('rejects RED risk_class', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), risk_class: 'RED' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('risk_class'))).toBe(true);
  });

  it('rejects BLACK risk_class', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), risk_class: 'BLACK' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('risk_class'))).toBe(true);
  });

  it('rejects a worktree_path with traversal', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      worktree_path: '/srv/worktrees/../etc/passwd',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('worktree_path'))).toBe(true);
  });

  it('rejects a worktree_path outside /srv/worktrees', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), worktree_path: '/srv/preston-os' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('worktree_path'))).toBe(true);
  });

  it('rejects a base_branch with traversal', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), base_branch: '../evil' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('base_branch'))).toBe(true);
  });

  it('rejects a base_branch that looks like a CLI flag', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), base_branch: '-x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('base_branch'))).toBe(true);
  });

  it('rejects a worktree_path with a leading-dot segment', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      worktree_path: '/srv/worktrees/.hidden',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('worktree_path'))).toBe(true);
  });

  it('rejects a non-hex base_commit', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), base_commit: 'not-a-sha' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('base_commit'))).toBe(true);
  });

  it('rejects a short base_commit', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), base_commit: 'abc123' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('base_commit'))).toBe(true);
  });

  it('rejects an unknown allowed_operation', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      allowed_operations: ['read_repo', 'delete_everything'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('unknown allowed_operation'))).toBe(true);
    }
  });

  it('rejects an allowed_operation with shell metacharacters', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      allowed_operations: ['read_repo; rm -rf /'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('shell metacharacters'))).toBe(true);
    }
  });

  it('rejects a secret-shaped string anywhere in the envelope', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      objective: 'rotate the api_key before merging',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('secret'))).toBe(true);
  });

  it('rejects prohibited_operations missing the required baseline', () => {
    const result = validateJobEnvelope({
      ...validEnvelope(),
      prohibited_operations: ['push', 'deploy'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('missing required baseline entry'))).toBe(true);
    }
  });

  it('rejects an unknown extra top-level key', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), shell_command: 'rm -rf /' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('unknown field'))).toBe(true);
    }
  });

  it('rejects a non-object input', () => {
    const result = validateJobEnvelope('not an object');
    expect(result.ok).toBe(false);
  });

  it('rejects assigned_implementer !== claude', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), assigned_implementer: 'codex' });
    expect(result.ok).toBe(false);
  });

  it('rejects assigned_reviewer !== codex', () => {
    const result = validateJobEnvelope({ ...validEnvelope(), assigned_reviewer: 'claude' });
    expect(result.ok).toBe(false);
  });
});

describe('envelopeFromPacketAndJob', () => {
  const packet: CommandPacket = {
    id: 'cmd-1',
    actor: 'owner',
    source: 'claude',
    requested_action: 'update docs',
    action_class: 'GREEN',
    target_project: 'preston-os',
    target_repository: 'preston-os',
    requested_scope: 'docs/example.md',
    expected_outcome: 'doc updated',
    constraints: ['no execution'],
    approval_required: true,
    execution_eligible: false,
    correlation_id: 'corr-1',
    idempotency_key: 'idem-1',
    created_at: NOW,
    expires_at: '2026-07-21T13:00:00.000Z',
    status: 'proposed',
    audit_ref: null,
  };

  const job: Job = {
    id: 'job-1',
    command_id: 'cmd-1',
    approval_id: null,
    status: 'proposed',
    risk_class: 'GREEN',
    priority: 0,
    not_before: NOW,
    expires_at: '2026-07-21T13:00:00.000Z',
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    attempts: 0,
    max_attempts: 3,
    timeout_ms: 60000,
    retry_backoff_ms: 1000,
    idempotency_key: 'idem-1',
    correlation_id: 'corr-1',
    checkpoint_ref: null,
    result_ref: null,
    error_class: null,
    execution_enabled: false,
    cancel_requested: false,
    created_at: NOW,
    updated_at: NOW,
  };

  const extras = {
    environment: 'staging' as const,
    title: 'Docs-only staging job',
    objective: 'Update a doc in staging',
    scope: 'docs/example.md',
    allowed_operations: ['read_repo', 'edit_docs'],
    prohibited_operations: [...REQUIRED_PROHIBITED_OPERATIONS],
    base_branch: 'master',
    base_commit: HEX40,
    worktree_path: '/srv/worktrees/wt-5j-orchestration',
    assigned_implementer: 'claude',
    assigned_reviewer: 'codex',
    required_tests: ['vitest run'],
    required_evidence: ['test output'],
    checkpoint_state: 'not_started',
    approval_state: 'pending_owner' as const,
    created_at: NOW,
    updated_at: NOW,
    audit_refs: [],
  };

  it('builds a valid envelope from a packet + job + extras', () => {
    const result = envelopeFromPacketAndJob(packet, job, extras);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const envelope: JobEnvelope = result.envelope;
      expect(envelope.correlation_id).toBe('corr-1');
      expect(envelope.command_packet_id).toBe('cmd-1');
      expect(envelope.job_id).toBe('job-1');
      expect(envelope.source).toBe('claude');
      expect(envelope.requested_by).toBe('owner');
    }
  });

  it('passes through validation failures (e.g. RED job risk_class)', () => {
    const redJob: Job = { ...job, risk_class: 'RED' };
    const result = envelopeFromPacketAndJob(packet, redJob, extras);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('risk_class'))).toBe(true);
  });

  it('passes through validation failures (e.g. bad worktree_path from extras)', () => {
    const result = envelopeFromPacketAndJob(packet, job, {
      ...extras,
      worktree_path: '/etc/passwd',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('worktree_path'))).toBe(true);
  });
});
