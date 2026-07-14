import { describe, expect, it } from 'vitest';
import {
  PIPELINE_STAGES,
  type AgentRecord,
  type ExecutionRecord,
  type LockRecord,
} from '../src/lib/ai-os/types';
import { advance, isTerminalStage, stageIndex } from '../src/lib/ai-os/pipeline';
import { acquire, canAcquire, canRelease, isExpired } from '../src/lib/ai-os/locks';
import { redactSecrets, validateMemoryEntry } from '../src/lib/ai-os/memory';
import { effectiveStatus, withHeartbeat } from '../src/lib/ai-os/registry';
import { makeEvent } from '../src/lib/ai-os/events';

const NOW = '2026-07-14T12:00:00.000Z';

function execRec(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'ex1',
    packet_id: 'pkt1',
    stage: 'requested',
    state: 'pending',
    risk_class: 'GREEN',
    approved: false,
    execution_enabled: false,
    worker_lease: null,
    correlation_id: 'corr1',
    updated_at: NOW,
    ...over,
  };
}

describe('execution pipeline - fail-closed advance', () => {
  it('advances through the early stages without approval', () => {
    const r = advance(execRec({ stage: 'requested' }), { now: NOW, executionEnabled: false });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('validation');
  });

  it('blocks crossing into execution_intent without approval', () => {
    const r = advance(execRec({ stage: 'approval_decision', approved: false }), {
      now: NOW,
      executionEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not approved');
  });

  it('allows approval_decision -> execution_intent when approved', () => {
    const r = advance(execRec({ stage: 'approval_decision', approved: true }), {
      now: NOW,
      executionEnabled: true,
    });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('execution_intent');
  });

  it('never lets RED/BLACK reach execution_attempt', () => {
    for (const risk of ['RED', 'BLACK'] as const) {
      const r = advance(
        execRec({
          stage: 'worker_lease',
          approved: true,
          risk_class: risk,
          execution_enabled: true,
          worker_lease: 'lease-1',
        }),
        { now: NOW, executionEnabled: true },
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('never executes');
    }
  });

  it('blocks execution_attempt when execution is globally disabled', () => {
    const r = advance(
      execRec({
        stage: 'worker_lease',
        approved: true,
        risk_class: 'GREEN',
        execution_enabled: true,
        worker_lease: 'lease-1',
      }),
      { now: NOW, executionEnabled: false },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('execution disabled');
  });

  it('blocks execution_attempt without a worker lease', () => {
    const r = advance(
      execRec({
        stage: 'worker_lease',
        approved: true,
        risk_class: 'GREEN',
        execution_enabled: true,
        worker_lease: null,
      }),
      { now: NOW, executionEnabled: true },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no worker lease');
  });

  it('permits a fully-gated GREEN execution_attempt', () => {
    const r = advance(
      execRec({
        stage: 'worker_lease',
        approved: true,
        risk_class: 'GREEN',
        execution_enabled: true,
        worker_lease: 'lease-1',
      }),
      { now: NOW, executionEnabled: true },
    );
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('execution_attempt');
  });

  it('does not advance past the terminal audit stage', () => {
    const r = advance(execRec({ stage: 'audit', approved: true }), {
      now: NOW,
      executionEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('terminal');
  });

  it('exposes a strictly ordered, unique stage list', () => {
    expect(new Set(PIPELINE_STAGES).size).toBe(PIPELINE_STAGES.length);
    expect(stageIndex('requested')).toBe(0);
    expect(isTerminalStage('audit')).toBe(true);
  });
});

describe('distributed locks', () => {
  const live: LockRecord = {
    id: 'task:t1',
    scope: 'task',
    resource: 't1',
    owner: 'claude-code',
    acquired_at: NOW,
    expires_at: '2026-07-14T12:05:00.000Z',
  };

  it('acquires a free lock and sets expiry from ttl', () => {
    const l = acquire(null, { scope: 'task', resource: 't1', owner: 'chatgpt', ttlMs: 60_000 }, NOW);
    expect(l?.owner).toBe('chatgpt');
    expect(l?.expires_at).toBe('2026-07-14T12:01:00.000Z');
  });

  it('refuses a live lock held by another owner', () => {
    expect(canAcquire(live, 'chatgpt', NOW)).toBe(false);
    expect(acquire(live, { scope: 'task', resource: 't1', owner: 'chatgpt', ttlMs: 60_000 }, NOW)).toBeNull();
  });

  it('is re-entrant for the same owner', () => {
    expect(canAcquire(live, 'claude-code', NOW)).toBe(true);
  });

  it('recovers a stale (expired) lock for a new owner', () => {
    const later = '2026-07-14T12:10:00.000Z';
    expect(isExpired(live, later)).toBe(true);
    expect(canAcquire(live, 'chatgpt', later)).toBe(true);
  });

  it('rejects non-positive ttl (no permanent locks)', () => {
    expect(acquire(null, { scope: 'task', resource: 't1', owner: 'x', ttlMs: 0 }, NOW)).toBeNull();
  });

  it('only the owner may release', () => {
    expect(canRelease(live, 'claude-code')).toBe(true);
    expect(canRelease(live, 'chatgpt')).toBe(false);
    expect(canRelease(null, 'claude-code')).toBe(false);
  });
});

describe('shared memory validation + redaction', () => {
  it('accepts a complete provenance entry', () => {
    const r = validateMemoryEntry({
      memory_type: 'decision',
      key: 'chose-durable-oauth',
      actor: 'claude-code',
      source: 'session',
      version: 1,
      correlation_id: 'c1',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects missing provenance fields', () => {
    const r = validateMemoryEntry({ memory_type: 'decision', key: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('actor required');
    expect(r.errors).toContain('correlation_id required');
  });

  it('rejects a secret-shaped key', () => {
    const r = validateMemoryEntry({
      memory_type: 'connector',
      key: 'google_refresh_token',
      actor: 'a',
      source: 's',
      version: 1,
      correlation_id: 'c',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('secret-shaped');
  });

  it('redacts secret-shaped fields recursively', () => {
    const out = redactSecrets({
      note: 'ok',
      client_secret: 'shhh',
      nested: { api_key: 'k', label: 'fine' },
      list: [{ password: 'p' }],
    }) as Record<string, unknown>;
    expect(out.note).toBe('ok');
    expect(out.client_secret).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).label).toBe('fine');
    expect(((out.list as Record<string, unknown>[])[0]).password).toBe('[REDACTED]');
  });
});

describe('agent registry liveness', () => {
  const agent: AgentRecord = {
    id: 'claude-code',
    display_name: 'Claude Code',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    capabilities: ['code', 'review'],
    allowed_connectors: ['github'],
    status: 'working',
    current_task_id: 't1',
    last_seen: NOW,
    version: '1.0.0',
    owner: 'info@preston.nyc',
  };

  it('treats a fresh heartbeat as its recorded status', () => {
    expect(effectiveStatus(agent, '2026-07-14T12:01:00.000Z')).toBe('working');
  });

  it('treats a stale agent as offline regardless of recorded status', () => {
    expect(effectiveStatus(agent, '2026-07-14T12:10:00.000Z')).toBe('offline');
  });

  it('treats a never-seen agent as offline', () => {
    expect(effectiveStatus({ ...agent, last_seen: null }, NOW)).toBe('offline');
  });

  it('withHeartbeat stamps last_seen and collapses invalid status to error', () => {
    const h = withHeartbeat(agent, NOW, 'invalid' as never);
    expect(h.last_seen).toBe(NOW);
    expect(h.status).toBe('error');
  });
});

describe('event factory', () => {
  it('builds a typed event with defaults', () => {
    const e = makeEvent({
      id: 'e1',
      type: 'ApprovalGranted',
      actor: 'owner',
      correlation_id: 'c1',
      now: NOW,
    });
    expect(e.type).toBe('ApprovalGranted');
    expect(e.payload).toEqual({});
    expect(e.created_at).toBe(NOW);
  });
});
