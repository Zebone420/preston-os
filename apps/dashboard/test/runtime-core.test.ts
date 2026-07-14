import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import {
  DEFAULT_CONTROLS,
  isHalted,
  runtimeActive,
  type SystemControls,
} from '../src/lib/ai-os/controls';
import {
  InMemoryEventStore,
  consume,
  hasSecretPayload,
  makeEnvelope,
  validateEnvelope,
} from '../src/lib/ai-os/transport';
import {
  classifyRisk,
  isDuplicate,
  isExpired as cmdExpired,
  normalizeCommand,
  validateCommand,
} from '../src/lib/ai-os/commands';
import {
  canTransition,
  shouldDeadLetter,
  transition,
  type Job,
} from '../src/lib/ai-os/queue';
import {
  canLease,
  eligibleWorker,
  isLeaseExpired,
  lease,
  renew,
  type LeaseState,
} from '../src/lib/ai-os/leases';

const NOW = '2026-07-14T12:00:00.000Z';

describe('controls - fail-closed defaults', () => {
  it('default controls are fully stopped / non-executing', () => {
    expect(runtimeActive(DEFAULT_CONTROLS)).toBe(false);
    expect(isHalted(DEFAULT_CONTROLS)).toBe(true);
    expect(DEFAULT_CONTROLS.hermes_mode).toBe('disabled');
  });
  it('runtimeActive requires execution enabled and not stopped/paused', () => {
    const live: SystemControls = {
      ...DEFAULT_CONTROLS,
      execution_enabled: true,
    };
    expect(runtimeActive(live)).toBe(true);
    expect(runtimeActive({ ...live, owner_stop: true })).toBe(false);
    expect(runtimeActive({ ...live, paused: true })).toBe(false);
  });
});

describe('event transport', () => {
  it('rejects secret-shaped payloads and redacts on make', () => {
    expect(hasSecretPayload({ ok: 1, client_secret: 'x' })).toBe(true);
    const e = makeEnvelope({
      id: 'e1', type: 'TaskCreated', actor: 'claude-code', source: 'claude',
      correlation_id: 'c1', idempotency_key: 'k1', now: NOW,
      payload: { note: 'hi', api_key: 'leak' },
    });
    expect((e.payload as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect(validateEnvelope(e).ok).toBe(true);
  });

  it('appends idempotently and reads after a cursor', async () => {
    const store = new InMemoryEventStore();
    const mk = (id: string, key: string) =>
      makeEnvelope({ id, type: 'TaskCreated', actor: 'a', source: 's', correlation_id: 'c', idempotency_key: key, now: NOW });
    expect((await store.append(mk('e1', 'k1'))).stored).toBe(true);
    expect((await store.append(mk('e2', 'k1'))).stored).toBe(false); // dupe key
    expect((await store.append(mk('e3', 'k2'))).stored).toBe(true);
    const after = await store.read('e1');
    expect(after.map((e) => e.id)).toEqual(['e3']);
  });

  it('consume is replay-safe (skips processed idempotency keys)', async () => {
    const store = new InMemoryEventStore();
    for (const [id, key] of [['e1', 'k1'], ['e2', 'k2']] as const) {
      await store.append(makeEnvelope({ id, type: 'TaskCreated', actor: 'a', source: 's', correlation_id: 'c', idempotency_key: key, now: NOW }));
    }
    const seen = new Set<string>();
    const got: string[] = [];
    const r1 = await consume(store, null, seen, (e) => got.push(e.id));
    expect(got).toEqual(['e1', 'e2']);
    // Re-consume from the start: nothing re-processed.
    const r2 = await consume(store, null, seen, (e) => got.push(e.id));
    expect(r2.processed).toEqual([]);
    expect(r1.cursor).toBe('e2');
  });
});

describe('command intake - default deny + classification', () => {
  it('classifies risk defensively', () => {
    expect(classifyRisk('read project status')).toBe('GREEN');
    expect(classifyRisk('send an email to client')).toBe('RED');
    // Input assembled from fragments so the test file holds no literal
    // destructive command; the runtime value is still the real string.
    expect(classifyRisk('r' + 'm -rf /tmp')).toBe('BLACK');
    expect(classifyRisk('refactor the module')).toBe('YELLOW'); // unknown => YELLOW
  });

  it('normalizes to a proposed, non-eligible packet', () => {
    const p = normalizeCommand({
      id: 'c1', actor: 'owner', source: 'telegram',
      requested_action: 'deploy staging', target_project: 'preston-os',
      target_repository: 'preston-os', correlation_id: 'corr', idempotency_key: 'idem', now: NOW,
    });
    expect(p.execution_eligible).toBe(false);
    expect(p.status).toBe('proposed');
    expect(p.action_class).toBe('RED'); // 'deploy' => RED
    expect(p.approval_required).toBe(true);
  });

  it('validation rejects eligible-at-intake and secret payloads', () => {
    const base = normalizeCommand({
      id: 'c1', actor: 'owner', source: 'chatgpt', requested_action: 'list agents',
      target_project: 'p', target_repository: 'r', correlation_id: 'c', idempotency_key: 'i', now: NOW,
    });
    expect(validateCommand(base).ok).toBe(true);
    expect(validateCommand({ ...base, execution_eligible: true }).ok).toBe(false);
    expect(
      validateCommand({ ...base, requested_action: 'use api_key sk-secret' }).ok,
    ).toBe(false);
  });

  it('expiration and dedup work', () => {
    const p = normalizeCommand({
      id: 'c1', actor: 'o', source: 'owner_cli', requested_action: 'status',
      target_project: 'p', target_repository: 'r', correlation_id: 'c', idempotency_key: 'i', now: NOW, ttlMs: 1000,
    });
    expect(cmdExpired(p, '2026-07-14T12:00:02.000Z')).toBe(true);
    expect(isDuplicate(new Set(['i']), p)).toBe(true);
  });
});

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1', command_id: 'c1', approval_id: null, status: 'proposed', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: '2026-07-14T13:00:00.000Z',
    lease_owner: null, lease_token: null, lease_expires_at: null,
    attempts: 0, max_attempts: 3, timeout_ms: 60000, retry_backoff_ms: 1000,
    idempotency_key: 'i', correlation_id: 'corr', checkpoint_ref: null, result_ref: null,
    error_class: null, execution_enabled: false, cancel_requested: false,
    created_at: NOW, updated_at: NOW, ...over,
  };
}

describe('job queue lifecycle', () => {
  const ctx = { now: NOW, executionEnabled: true };
  it('enforces the legal transition graph', () => {
    expect(canTransition('proposed', 'validated')).toBe(true);
    expect(canTransition('proposed', 'running')).toBe(false);
    expect(transition(job({ status: 'proposed' }), 'running', ctx).ok).toBe(false);
  });
  it('blocks running without approval + lease + execution enabled', () => {
    const leased = job({ status: 'leased', lease_owner: 'w', lease_token: 't' });
    expect(transition(leased, 'running', ctx).reason).toContain('not approved');
    const approved = job({ status: 'leased', approval_id: 'a', lease_owner: 'w', lease_token: 't' });
    expect(transition(approved, 'running', ctx).reason).toContain('execution disabled');
    const ready = job({ status: 'leased', approval_id: 'a', lease_owner: 'w', lease_token: 't', execution_enabled: true });
    expect(transition(ready, 'running', ctx).ok).toBe(true);
  });
  it('never runs RED/BLACK', () => {
    const red = job({ status: 'leased', approval_id: 'a', lease_owner: 'w', lease_token: 't', execution_enabled: true, risk_class: 'RED' });
    expect(transition(red, 'running', ctx).ok).toBe(false);
  });
  it('dead-letters once attempts are exhausted', () => {
    expect(shouldDeadLetter(job({ attempts: 3, max_attempts: 3 }))).toBe(true);
    expect(shouldDeadLetter(job({ attempts: 1, max_attempts: 3 }))).toBe(false);
  });
});

describe('worker leasing + recovery', () => {
  const live: LeaseState = { owner: 'claude-worker', token: 't1', acquired_at: NOW, expires_at: '2026-07-14T12:05:00.000Z' };
  it('acquires when free, refuses when held by another', () => {
    expect(lease(null, { owner: 'w', token: 't', ttlMs: 60000, now: NOW })?.owner).toBe('w');
    expect(canLease(live, 'other', 'tX', NOW)).toBe(false);
  });
  it('recovers a stale lease', () => {
    const later = '2026-07-14T12:10:00.000Z';
    expect(isLeaseExpired(live, later)).toBe(true);
    expect(canLease(live, 'other', 'tX', later)).toBe(true);
  });
  it('renews only for the current owner+token before expiry', () => {
    expect(renew(live, 'claude-worker', 't1', 60000, NOW)?.expires_at).toBe('2026-07-14T12:01:00.000Z');
    expect(renew(live, 'other', 't1', 60000, NOW)).toBeNull();
    expect(renew(live, 'claude-worker', 't1', 60000, '2026-07-14T12:10:00.000Z')).toBeNull(); // expired
  });
  it('rejects non-positive ttl (no permanent lease)', () => {
    expect(lease(null, { owner: 'w', token: 't', ttlMs: 0, now: NOW })).toBeNull();
  });
});

const agent: AgentRecord = {
  id: 'claude-worker', display_name: 'Claude Worker', provider: 'anthropic', model: 'm',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'info@preston.nyc',
};
const liveControls: SystemControls = { ...DEFAULT_CONTROLS, execution_enabled: true };

describe('worker eligibility - fail closed', () => {
  const readyJob = job({ approval_id: 'a', execution_enabled: true, risk_class: 'GREEN' });
  it('eligible when everything lines up', () => {
    const e = eligibleWorker({ agent, job: readyJob, controls: liveControls, requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW });
    expect(e.ok).toBe(true);
  });
  it('refuses on halt, missing approval, RED risk, stale agent, missing capability/connector', () => {
    expect(eligibleWorker({ agent, job: readyJob, controls: DEFAULT_CONTROLS, requiredCapabilities: [], requiredConnectors: [], now: NOW }).ok).toBe(false); // halted
    expect(eligibleWorker({ agent, job: job({ execution_enabled: true }), controls: liveControls, requiredCapabilities: [], requiredConnectors: [], now: NOW }).reasons.join(' ')).toContain('not approved');
    expect(eligibleWorker({ agent, job: job({ approval_id: 'a', execution_enabled: true, risk_class: 'RED' }), controls: liveControls, requiredCapabilities: [], requiredConnectors: [], now: NOW }).ok).toBe(false);
    expect(eligibleWorker({ agent, job: readyJob, controls: liveControls, requiredCapabilities: [], requiredConnectors: [], now: '2026-07-14T12:10:00.000Z' }).reasons.join(' ')).toContain('stale');
    expect(eligibleWorker({ agent, job: readyJob, controls: liveControls, requiredCapabilities: ['python'], requiredConnectors: [], now: NOW }).reasons.join(' ')).toContain('capability');
    expect(eligibleWorker({ agent, job: readyJob, controls: liveControls, requiredCapabilities: [], requiredConnectors: ['slack'], now: NOW }).reasons.join(' ')).toContain('connector');
  });
});
