import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import type { EligibilityInput } from '../src/lib/ai-os/leases';
import type { Job } from '../src/lib/ai-os/queue';
import type { ExecutionEnvelope } from '../src/lib/ai-os/runner';
import type { Checkpoint } from '../src/lib/ai-os/checkpoint';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import type { WorkerOnceInput } from '../src/lib/ai-os/worker-service';
import { EXIT, jsonLogger, parseArgs, runDispatcher } from '../src/os-runtime/dispatcher';

const NOW = '2026-07-14T12:00:00.000Z';
const RUNTIME_ENV = { SUPABASE_URL: 'https://x', SUPABASE_RUNTIME_KEY: 'k', SUPABASE_RUNTIME_TOKEN: 't', SUPABASE_RUNTIME_ENV: 'staging' };

function fakeClient(controlsRow: Record<string, unknown> | null, write: QueryResult = { data: [{ id: 'x' }], error: null }): RuntimeClient {
  const w = async () => write;
  const readControls = async () => ({ data: controlsRow ? [controlsRow] : [], error: null });
  return {
    from() {
      return {
        insert() { return { select: w }; },
        select() { return { eq() { return { limit: readControls }; }, order() { return { limit: w }; }, limit: readControls }; },
        update() { return { eq: () => ({ select: w, eq: () => ({ select: w }) }) }; },
      };
    },
  };
}

function noop(): void {}

describe('dispatcher - runtime packaging entry (pure)', () => {
  it('parseArgs maps subcommands and --max', () => {
    expect(parseArgs(['node', 'bin', 'worker-loop', '--max', '3']).command).toBe('worker-loop');
    expect(parseArgs(['node', 'bin', 'hermes-loop']).maxIterations).toBe(5);
    expect(parseArgs(['node', 'bin']).command).toBe('health');
  });

  it('health returns exit 0 and reports worker+hermes state', async () => {
    const r = await runDispatcher({ command: 'health', client: fakeClient({ hermes_mode: 'disabled' }), env: {}, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.summary.worker).toBeDefined();
  });

  it('working commands fail closed (exit 78) when runtime env is missing', async () => {
    const r = await runDispatcher({ command: 'worker-loop', client: fakeClient(null), env: {}, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.config);
  });

  it('worker-loop with env and no candidates completes (exit 0)', async () => {
    const r = await runDispatcher({ command: 'worker-loop', client: fakeClient({ hermes_mode: 'disabled' }), env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop, workerCandidates: [] });
    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.summary.stoppedReason).toBe('completed');
  });

  it('jsonLogger redacts secret-shaped fields', () => {
    let out = '';
    const log = jsonLogger((s) => { out = s; });
    log({ level: 'info', api_key: 'sk-leak', note: 'ok' });
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('sk-leak');
    expect(out).toContain('ok');
  });

  it('parseArgs recognizes db-health and --diagnostic', () => {
    expect(parseArgs(['n', 'b', 'db-health']).command).toBe('db-health');
    expect(parseArgs(['n', 'b', 'worker-loop', '--diagnostic']).diagnostic).toBe(true);
    expect(parseArgs(['n', 'b', 'health']).diagnostic).toBe(false);
  });

  it('db-health passes on a reachable staging control plane (read-only)', async () => {
    const r = await runDispatcher({ command: 'db-health', client: fakeClient({ hermes_mode: 'disabled' }), env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.summary.ok).toBe(true);
  });

  it('db-health refuses a production SUPABASE_URL', async () => {
    const r = await runDispatcher({ command: 'db-health', client: fakeClient(null), env: { ...RUNTIME_ENV, SUPABASE_URL: 'https://prod.supabase.co' }, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.config);
  });

  it('db-health fails closed when not explicitly marked staging', async () => {
    const noMarker = { SUPABASE_URL: 'https://x', SUPABASE_RUNTIME_KEY: 'k', SUPABASE_RUNTIME_TOKEN: 't' };
    const r = await runDispatcher({ command: 'db-health', client: fakeClient({ hermes_mode: 'disabled' }), env: noMarker, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.config);
  });

  it('db-health fails when the control plane returns zero readable rows (RLS denial)', async () => {
    const r = await runDispatcher({ command: 'db-health', client: fakeClient(null), env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.error); // rows 0 => not healthy
  });

  it('db-health reports error exit when the probe read fails', async () => {
    const err = async () => ({ data: null, error: { message: 'permission denied' } });
    const errClient: RuntimeClient = {
      from() {
        return {
          insert() { return { select: err }; },
          select() { return { eq() { return { limit: err }; }, order() { return { limit: err }; }, limit: err }; },
          update() { return { eq: () => ({ select: err, eq: () => ({ select: err }) }) }; },
        };
      },
    };
    const r = await runDispatcher({ command: 'db-health', client: errClient, env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop });
    expect(r.exitCode).toBe(EXIT.error);
  });
});

// --- owner_stop -> exit 75 (halted), with one real candidate --------------
const agent: AgentRecord = {
  id: 'w', display_name: 'W', provider: 'anthropic', model: 'm', capabilities: ['code'],
  allowed_connectors: ['github'], status: 'idle', current_task_id: null, last_seen: NOW, version: '1', owner: 'info@preston.nyc',
};
function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'leased', risk_class: 'GREEN', priority: 0,
    not_before: NOW, expires_at: '2026-07-14T13:00:00.000Z', lease_owner: 'w', lease_token: 't',
    lease_expires_at: '2026-07-14T12:05:00.000Z', attempts: 0, max_attempts: 3, timeout_ms: 60000,
    retry_backoff_ms: 1000, idempotency_key: 'i', correlation_id: 'corr', checkpoint_ref: null,
    result_ref: null, error_class: null, execution_enabled: true, cancel_requested: false, created_at: NOW, updated_at: NOW, ...over,
  };
}
const controls: SystemControls = { ...DEFAULT_CONTROLS, execution_enabled: true };
const envelope: ExecutionEnvelope = { runner_id: 'r', repo_root: '/srv/preston-os', executable: 'git', args: ['status'], cwd: '/srv/preston-os', timeout_ms: 60000, allow_network: false, correlation_id: 'c1' };
const checkpoint: Checkpoint = {
  project: 'preston-os', phase: 'p', gate: 'g', goal: 'sim', job_id: 'j1', agent_id: 'w', worktree: 'wt', branch: 'master',
  base_commit: 'a', current_commit: 'b', files_changed: [], tests_run: 'n/a', validation: 'n/a', blockers: [], owner_actions: [],
  next_action: 'none', rollback: 'n/a', correlation_id: 'corr', created_at: NOW, status: 'in_progress',
};

describe('dispatcher - owner stop yields halted exit code', () => {
  it('worker-loop returns exit 75 when owner_stop is set', async () => {
    const client = fakeClient({ execution_enabled: true, owner_stop: true, hermes_mode: 'disabled' });
    const candidate: WorkerOnceInput = { client, cycle: { eligibility: { agent, job: job(), controls, requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW } as EligibilityInput, envelope, now: NOW }, jobId: 'j1', agentId: 'w', checkpoint, now: NOW };
    const r = await runDispatcher({ command: 'worker-loop', client, env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop, workerCandidates: [candidate] });
    expect(r.exitCode).toBe(EXIT.halted);
  });

  it('worker-loop with NO candidates still honors owner_stop (shipped-unit kill visibility)', async () => {
    const client = fakeClient({ owner_stop: true, hermes_mode: 'disabled' });
    const r = await runDispatcher({ command: 'worker-loop', client, env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop, workerCandidates: [] });
    expect(r.exitCode).toBe(EXIT.halted);
    expect(r.summary.stoppedReason).toBe('halted');
  });

  it('hermes-loop with NO batches honors pause (75) and reports disabled as a clean no-op (0)', async () => {
    const paused = fakeClient({ hermes_mode: 'observe_only', paused: true });
    const rp = await runDispatcher({ command: 'hermes-loop', client: paused, env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop });
    expect(rp.exitCode).toBe(EXIT.halted);
    const disabled = fakeClient({ hermes_mode: 'disabled' });
    const rd = await runDispatcher({ command: 'hermes-loop', client: disabled, env: RUNTIME_ENV, now: NOW, correlationId: 'c', log: noop });
    expect(rd.exitCode).toBe(EXIT.ok);
    expect(rd.summary.stoppedReason).toBe('disabled');
  });
});
