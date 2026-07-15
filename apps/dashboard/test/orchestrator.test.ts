import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import type { EligibilityInput } from '../src/lib/ai-os/leases';
import type { Job } from '../src/lib/ai-os/queue';
import type { ExecutionEnvelope } from '../src/lib/ai-os/runner';
import { normalizeCommand } from '../src/lib/ai-os/commands';
import type { HermesInput } from '../src/lib/ai-os/hermes';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  runHermesObserveOnce,
  runWorkerCycleSimulation,
} from '../src/lib/ai-os/orchestrator';

const NOW = '2026-07-14T12:00:00.000Z';

function client(controlsRow: Record<string, unknown> | null, writeResult: QueryResult): RuntimeClient {
  const thenable = async () => writeResult;
  return {
    from() {
      return {
        insert() {
          return { select: thenable };
        },
        select() {
          return {
            eq() {
              return { limit: async () => ({ data: controlsRow ? [controlsRow] : [], error: null }) };
            },
            order() {
              return { limit: thenable };
            },
            limit: async () => ({ data: controlsRow ? [controlsRow] : [], error: null }),
          };
        },
        update() {
          return { eq: () => ({ select: thenable, eq: () => ({ select: thenable }) }) };
        },
      };
    },
  };
}

const agent: AgentRecord = {
  id: 'claude-worker', display_name: 'CW', provider: 'anthropic', model: 'm',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'info@preston.nyc',
};
function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'leased', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: '2026-07-14T13:00:00.000Z',
    lease_owner: 'claude-worker', lease_token: 't', lease_expires_at: '2026-07-14T12:05:00.000Z',
    attempts: 0, max_attempts: 3, timeout_ms: 60000, retry_backoff_ms: 1000,
    idempotency_key: 'i', correlation_id: 'corr', checkpoint_ref: null, result_ref: null,
    error_class: null, execution_enabled: true, cancel_requested: false, created_at: NOW, updated_at: NOW, ...over,
  };
}
const liveControls: SystemControls = { ...DEFAULT_CONTROLS, execution_enabled: true };
function elig(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return { agent, job: job(), controls: liveControls, requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW, ...over };
}
const envelope: ExecutionEnvelope = {
  runner_id: 'r1', repo_root: '/srv/preston-os', executable: 'git', args: ['status'],
  cwd: '/srv/preston-os', timeout_ms: 60000, allow_network: false, correlation_id: 'c1',
};

describe('worker cycle simulation - never executes', () => {
  it('simulates a fully-eligible GREEN job without executing', () => {
    const r = runWorkerCycleSimulation({ eligibility: elig(), envelope, now: NOW });
    expect(r.executed).toBe(false);
    expect(r.eligible).toBe(true);
    expect(r.envelopeValid).toBe(true);
    expect(r.checkpointStatus).toBe('simulated_ok');
    // runner disabled by default => a real run is NOT permitted even so.
    expect(r.runPermitted).toBe(false);
  });
  it('blocks (still no execution) when the agent is stale', () => {
    const r = runWorkerCycleSimulation({ eligibility: elig({ now: '2026-07-14T13:30:00.000Z' }), envelope, now: NOW });
    expect(r.executed).toBe(false);
    expect(r.eligible).toBe(false);
    expect(r.checkpointStatus).toBe('blocked');
  });
  it('flags an invalid envelope and never executes', () => {
    const r = runWorkerCycleSimulation({ eligibility: elig(), envelope: { ...envelope, executable: 'bash' }, now: NOW });
    expect(r.executed).toBe(false);
    expect(r.envelopeValid).toBe(false);
  });
});

const cmd = normalizeCommand({
  id: 'c1', actor: 'owner', source: 'dashboard', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os', correlation_id: 'corr', idempotency_key: 'i', now: NOW,
});
function hermesInput(): HermesInput {
  return { controls: { ...liveControls, hermes_mode: 'observe_only' }, command: cmd, eligibility: elig(), now: NOW };
}

describe('Hermes observe-once - records, never acts', () => {
  it('skips entirely when Hermes is disabled (records nothing)', async () => {
    const c = client({ hermes_mode: 'disabled' }, { data: [{ id: 'x' }], error: null });
    const r = await runHermesObserveOnce(c, [{ id: 'j1', input: hermesInput() }], NOW);
    expect(r.skipped).toBe(true);
    expect(r.recorded).toBe(0);
  });
  it('observes and records a decision when in observe_only', async () => {
    const c = client({ hermes_mode: 'observe_only' }, { data: [{ id: 'od-j1' }], error: null });
    const r = await runHermesObserveOnce(c, [{ id: 'j1', input: hermesInput() }], NOW);
    expect(r.skipped).toBe(false);
    expect(r.observations[0].decision).toBe('observe'); // observe_only mode
    expect(r.recorded).toBe(1);
  });
});
