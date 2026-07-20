import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import {
  mapJobRow,
  selectCandidateJobs,
  simulationEligible,
  stagingEnvelope,
} from '../src/lib/ai-os/candidates';
import { validateEnvelope } from '../src/lib/ai-os/runner';
import { resolveResume } from '../src/lib/ai-os/checkpoint';
import type { AgentRecord } from '../src/lib/ai-os/types';
import type { Job } from '../src/lib/ai-os/queue';

const NOW = '2026-07-20T12:00:00.000Z';
const LATER = '2026-07-20T13:00:00.000Z';

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'queued', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: LATER, lease_owner: null, lease_token: null,
    lease_expires_at: null, attempts: 0, max_attempts: 3, timeout_ms: 60000,
    retry_backoff_ms: 1000, idempotency_key: 'i1', correlation_id: 'corr-1',
    checkpoint_ref: null, result_ref: null, error_class: null, execution_enabled: false,
    cancel_requested: false, created_at: NOW, updated_at: NOW, ...over,
  };
}

const agent: AgentRecord = {
  id: 'preston-worker', display_name: 'W', provider: 'anthropic', model: 'dispatcher',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'owner',
};

const stopped: SystemControls = { ...DEFAULT_CONTROLS }; // execution disabled, nothing running

describe('mapJobRow - fail-closed row mapping', () => {
  it('maps a complete row', () => {
    const j = mapJobRow(row());
    expect(j).not.toBeNull();
    expect(j!.status).toBe('queued');
    expect(j!.execution_enabled).toBe(false);
  });
  it('rejects rows with missing/mistyped/unknown fields (never guesses)', () => {
    expect(mapJobRow(row({ id: null }))).toBeNull();
    expect(mapJobRow(row({ status: 'exploited' }))).toBeNull();
    expect(mapJobRow(row({ risk_class: 'PURPLE' }))).toBeNull();
    expect(mapJobRow(row({ attempts: 'three' }))).toBeNull();
    expect(mapJobRow(row({ correlation_id: '' }))).toBeNull();
    expect(mapJobRow(row({ expires_at: 'not-a-date' }))).toBeNull();
  });
  it('never invents execution permission from a mistyped flag', () => {
    expect(mapJobRow(row({ execution_enabled: 'true' }))!.execution_enabled).toBe(false);
  });
});

describe('simulationEligible - execution gate removed, everything else kept', () => {
  const job = mapJobRow(row({ status: 'leased', lease_owner: 'preston-worker', lease_token: 't' }))!;
  const base = { agent, job, controls: stopped, requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW };

  it('is eligible with execution disabled (that IS the staging posture)', () => {
    expect(stopped.execution_enabled).toBe(false);
    expect(simulationEligible(base).ok).toBe(true);
  });
  it('still blocks owner_stop, pause, cancel, missing approval, RED/BLACK', () => {
    expect(simulationEligible({ ...base, controls: { ...stopped, owner_stop: true } }).ok).toBe(false);
    expect(simulationEligible({ ...base, controls: { ...stopped, paused: true } }).ok).toBe(false);
    expect(simulationEligible({ ...base, job: { ...job, cancel_requested: true } }).ok).toBe(false);
    expect(simulationEligible({ ...base, job: { ...job, approval_id: null } }).ok).toBe(false);
    expect(simulationEligible({ ...base, job: { ...job, risk_class: 'RED' } }).ok).toBe(false);
  });
  it('still requires capability/connector match and a live agent', () => {
    expect(simulationEligible({ ...base, requiredCapabilities: ['deploy'] }).ok).toBe(false);
    expect(simulationEligible({ ...base, requiredConnectors: ['gmail'] }).ok).toBe(false);
    const staleAgent = { ...agent, last_seen: '2026-07-19T00:00:00.000Z' };
    expect(simulationEligible({ ...base, agent: staleAgent }).ok).toBe(false);
  });
});

describe('selectCandidateJobs - bounded, deterministic, side-effect free', () => {
  const opts = { now: NOW, limit: 10, controls: stopped };

  it('selects only ready queued GREEN/YELLOW approved jobs', () => {
    const sel = selectCandidateJobs(
      [
        row(),
        row({ id: 'j2', idempotency_key: 'i2', status: 'leased' }),
        row({ id: 'j3', idempotency_key: 'i3', status: 'completed' }),
        row({ id: 'j4', idempotency_key: 'i4', risk_class: 'RED' }),
        row({ id: 'j5', idempotency_key: 'i5', approval_id: null }),
        row({ id: 'j6', idempotency_key: 'i6', cancel_requested: true }),
        row({ id: 'j7', idempotency_key: 'i7', expires_at: '2026-07-20T11:00:00.000Z' }),
        row({ id: 'j8', idempotency_key: 'i8', not_before: LATER }),
        row({ id: 'j9', idempotency_key: 'i9', attempts: 3 }),
        { id: 'j10', garbage: true },
      ],
      opts,
    );
    expect(sel.selected.map((j) => j.id)).toEqual(['j1']);
    expect(sel.rejected.length).toBe(9);
  });

  it('orders priority DESC then created_at ASC then id ASC, and bounds the batch', () => {
    const sel = selectCandidateJobs(
      [
        row({ id: 'a', idempotency_key: 'ia', priority: 1 }),
        row({ id: 'c', idempotency_key: 'ic', priority: 5 }),
        row({ id: 'b', idempotency_key: 'ib', priority: 5 }),
      ],
      { ...opts, limit: 2 },
    );
    expect(sel.selected.map((j) => j.id)).toEqual(['b', 'c']);
    expect(sel.rejected).toContainEqual({ id: 'a', reason: 'over batch limit' });
  });

  it('selects nothing when halted/paused and with a non-positive limit', () => {
    expect(selectCandidateJobs([row()], { ...opts, controls: { ...stopped, owner_stop: true } }).selected).toEqual([]);
    expect(selectCandidateJobs([row()], { ...opts, controls: { ...stopped, paused: true } }).selected).toEqual([]);
    expect(selectCandidateJobs([row()], { ...opts, limit: 0 }).selected).toEqual([]);
  });
});

describe('stagingEnvelope - always a valid, non-network, bounded envelope', () => {
  it('passes runner validation and caps the timeout', () => {
    const j: Job = mapJobRow(row({ timeout_ms: 900000 }))!;
    const env = stagingEnvelope(j);
    expect(validateEnvelope(env).ok).toBe(true);
    expect(env.timeout_ms).toBe(60000);
    expect(env.allow_network).toBe(false);
  });
});

describe('resolveResume - crash-recovery decisions fail closed', () => {
  const job = { id: 'j1', correlation_id: 'corr-1' };
  const cp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    job_id: 'j1', correlation_id: 'corr-1', status: 'in_progress', ...over,
  });

  it('no checkpoint -> fresh attempt', () => {
    expect(resolveResume(null, job).action).toBe('fresh');
  });
  it('matching complete checkpoint -> idempotent skip (never rerun)', () => {
    expect(resolveResume(cp({ status: 'complete' }), job).action).toBe('skip_completed');
  });
  it('non-terminal checkpoint -> fresh bounded attempt', () => {
    expect(resolveResume(cp({ status: 'blocked' }), job).action).toBe('fresh');
    expect(resolveResume(cp({ status: 'failed' }), job).action).toBe('fresh');
  });
  it('corrupt/foreign/stale checkpoints -> reject (fail closed, touch nothing)', () => {
    expect(resolveResume(cp({ status: 'garbage' }), job).action).toBe('reject');
    expect(resolveResume(cp({ status: null }), job).action).toBe('reject');
    expect(resolveResume(cp({ job_id: 'other-job' }), job).action).toBe('reject');
    expect(resolveResume(cp({ correlation_id: 'stale-corr' }), job).action).toBe('reject');
    expect(resolveResume({}, job).action).toBe('reject');
  });
});
