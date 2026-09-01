import { describe, expect, it } from 'vitest';
import type {
  PrestonGoalResult,
  PrestonStatusResult,
} from '../src/lib/hermes/adapter';
import {
  aggregateJobRows,
  isArtifactRef,
  metricFromState,
  toGoalCard,
  toHeader,
  toMetrics,
} from '../src/lib/hermes/view-models';

// Hermes Supervisor Dashboard v0 - view-model normalization. The core
// contract: authoritative IDs/states pass through unchanged, and a metric
// whose underlying read failed renders as 'UNKNOWN' - NEVER an invented
// zero (an unreadable bucket must not look like a healthy empty one).

function statusFixture(
  over: Partial<PrestonStatusResult> = {},
): PrestonStatusResult {
  return {
    generated_at: '2026-08-31T12:00:00.000Z',
    environment: 'staging',
    posture: 'operating',
    controls: {
      readable: true,
      execution_enabled: false,
      remote_runner_enabled: false,
      owner_stop: false,
      paused: false,
      hermes_mode: 'observe_only',
      updated_at: '2026-08-31T11:00:00.000Z',
    },
    hermes: {
      state: 'empty',
      hermes_mode: null,
      observed_bucket: null,
      reasons: [],
      snapshot_counts: {
        as_of_bucket: null,
        open_approvals: null,
        failed_jobs: null,
        dead_lettered_jobs: null,
      },
      snapshot_note: 'n',
    },
    summary: {
      total_goals: 3,
      running_goals: 1,
      blocked_goals: 1,
      open_approvals: 2,
      failed_jobs: 1,
      dead_lettered_jobs: 2,
    },
    recent_goals: [],
    pending_approvals: [],
    failures: [],
    dead_letters: [],
    read_states: {
      goals: 'ok',
      approvals: 'ok',
      jobs: 'ok',
      failures: 'ok',
      dead_letters: 'ok',
    },
    needs_attention: ['2 approval(s) waiting for the owner'],
    ...over,
  } as PrestonStatusResult;
}

describe('metricFromState', () => {
  it('trusts ok and empty; everything else is UNKNOWN', () => {
    expect(metricFromState('ok', 5)).toBe(5);
    expect(metricFromState('empty', 0)).toBe(0);
    expect(metricFromState('error', 0)).toBe('UNKNOWN');
    expect(metricFromState('migration_absent', 0)).toBe('UNKNOWN');
    expect(metricFromState('weird', 9)).toBe('UNKNOWN');
  });
});

describe('toMetrics', () => {
  it('passes live counts through when every bucket read cleanly', () => {
    const m = toMetrics(statusFixture());
    expect(m).toEqual({
      total_goals: 3,
      running_goals: 1,
      blocked_goals: 1,
      pending_approvals: 2,
      failed_jobs: 1,
      dead_lettered_jobs: 2,
    });
  });

  it('an errored approvals read yields UNKNOWN, not the summary zero', () => {
    const s = statusFixture();
    s.read_states.approvals = 'error';
    s.summary.open_approvals = 0; // what the platform reports on error
    const m = toMetrics(s);
    expect(m.pending_approvals).toBe('UNKNOWN');
    expect(m.total_goals).toBe(3); // other buckets unaffected
  });

  it('an errored jobs sweep marks BOTH failure metrics UNKNOWN', () => {
    const s = statusFixture();
    s.read_states.jobs = 'error';
    const m = toMetrics(s);
    expect(m.failed_jobs).toBe('UNKNOWN');
    expect(m.dead_lettered_jobs).toBe('UNKNOWN');
  });

  it('migration_absent goals bucket yields UNKNOWN goal metrics', () => {
    const s = statusFixture();
    s.read_states.goals = 'migration_absent';
    const m = toMetrics(s);
    expect(m.total_goals).toBe('UNKNOWN');
    expect(m.running_goals).toBe('UNKNOWN');
    expect(m.blocked_goals).toBe('UNKNOWN');
  });
});

describe('toHeader', () => {
  it('carries posture, flags, hermes_mode and needs_attention verbatim', () => {
    const h = toHeader(statusFixture());
    expect(h.environment).toBe('staging');
    expect(h.posture).toBe('operating');
    expect(h.execution_enabled).toBe(false);
    expect(h.remote_runner_enabled).toBe(false);
    expect(h.owner_stop).toBe(false);
    expect(h.paused).toBe(false);
    expect(h.hermes_mode).toBe('observe_only');
    expect(h.needs_attention).toEqual([
      '2 approval(s) waiting for the owner',
    ]);
  });
});

type FoundGoal = Extract<PrestonGoalResult, { found: true }>;

function goalFixture(over: Partial<FoundGoal> = {}): FoundGoal {
  return {
    found: true,
    goal: {
      goal_id: 'g-1',
      title: 'T',
      objective: 'O',
      status: 'running',
      source: 'owner',
      requested_by: 'info@preston.nyc',
      environment: 'staging',
      correlation_id: 'c-1',
      simulation_only: true,
      iteration: 0,
      created_at: '2026-08-30T10:00:00.000Z',
      updated_at: '2026-08-31T10:00:00.000Z',
    },
    jobs: [
      {
        job_id: 'j-1',
        goal_id: 'g-1',
        kind: 'code',
        title: 'job one',
        objective: 'o',
        status: 'completed',
        risk_class: 'GREEN',
        assigned_role: 'claude',
        attempts: 1,
        requires_approval: false,
        approval_id: null,
        failure_reason: null,
        evidence_refs: ['art-' + 'a'.repeat(32)],
        created_at: '2026-08-30T10:00:00.000Z',
        updated_at: '2026-08-31T09:00:00.000Z',
      },
      {
        job_id: 'j-2',
        goal_id: 'g-1',
        kind: 'test',
        title: 'job two',
        objective: 'o',
        status: 'in_progress',
        risk_class: 'GREEN',
        assigned_role: 'codex',
        attempts: 2,
        requires_approval: false,
        approval_id: null,
        failure_reason: null,
        evidence_refs: [],
        created_at: '2026-08-30T10:00:00.000Z',
        updated_at: '2026-08-31T11:00:00.000Z',
      },
    ],
    jobs_read_ok: true,
    job_status_counts: { completed: 1, in_progress: 1 },
    pending_approvals: [],
    evidence_refs: [{ job_id: 'j-1', ref: 'art-' + 'a'.repeat(32) }],
    parent_goal_id: null,
    child_goal_ids: [],
    ...over,
  } as FoundGoal;
}

describe('toGoalCard', () => {
  it('sums job counts and counts evidence availability factually', () => {
    const card = toGoalCard(goalFixture());
    expect(card.goal_id).toBe('g-1');
    expect(card.status).toBe('running');
    expect(card.job_total).toBe(2);
    expect(card.pending_approvals).toBe(0);
    expect(card.evidence_refs).toBe(1);
  });

  it('a failed jobs read yields UNKNOWN job total, never zero', () => {
    const card = toGoalCard(
      goalFixture({ jobs_read_ok: false, job_status_counts: {} }),
    );
    expect(card.jobs_read_ok).toBe(false);
    expect(card.job_total).toBe('UNKNOWN');
  });
});

describe('aggregateJobRows', () => {
  it('flattens found goals newest-first, skipping unreadable ones', () => {
    const notFound = {
      found: false,
      error: 'read_failed',
    } as PrestonGoalResult;
    const rows = aggregateJobRows([goalFixture(), notFound]);
    expect(rows.map((r) => r.job_id)).toEqual(['j-2', 'j-1']);
    expect(rows[0].assigned_role).toBe('codex');
    expect(rows[1].evidence_refs).toBe(1);
  });

  it('caps the aggregate', () => {
    const rows = aggregateJobRows([goalFixture()], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].job_id).toBe('j-2');
  });
});

describe('isArtifactRef', () => {
  it('accepts only art-<32 hex> ids', () => {
    expect(isArtifactRef('art-' + 'a'.repeat(32))).toBe(true);
    expect(isArtifactRef('art-' + 'a'.repeat(31))).toBe(false);
    expect(isArtifactRef('note:done')).toBe(false);
    expect(isArtifactRef(42)).toBe(false);
    expect(isArtifactRef(null)).toBe(false);
  });
});
