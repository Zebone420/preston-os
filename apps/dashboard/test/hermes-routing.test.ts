import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../src/lib/ai-os/types';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import type { EligibilityInput } from '../src/lib/ai-os/leases';
import type { Job } from '../src/lib/ai-os/queue';
import { normalizeCommand } from '../src/lib/ai-os/commands';
import {
  classifyTask,
  decide,
  type HermesInput,
  type TaskTextHints,
} from '../src/lib/ai-os/hermes';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import { hermesObserveLoop } from '../src/lib/ai-os/hermes-service';
import {
  runHermesObserveOnce,
  type ObserveCandidate,
} from '../src/lib/ai-os/orchestrator';

// Preston AI OS - Hermes routing recommendation tests (Phase 5J). These prove
// the routing feature is purely advisory: it never changes what decide()
// returns, it never causes Hermes to lease/execute/mutate a job, and it is
// only ever recorded alongside an 'observe' decision as reason strings.

const NOW = '2026-07-21T12:00:00.000Z';

const agent: AgentRecord = {
  id: 'preston-hermes', display_name: 'Hermes', provider: 'anthropic', model: 'm',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: 'info@preston.nyc',
};

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1', command_id: 'c1', approval_id: 'a1', status: 'queued', risk_class: 'GREEN',
    priority: 0, not_before: NOW, expires_at: '2026-07-21T13:00:00.000Z',
    lease_owner: null, lease_token: null, lease_expires_at: null,
    attempts: 0, max_attempts: 3, timeout_ms: 60000, retry_backoff_ms: 1000,
    idempotency_key: 'i1', correlation_id: 'corr-1', checkpoint_ref: null, result_ref: null,
    error_class: null, execution_enabled: true, cancel_requested: false,
    created_at: NOW, updated_at: NOW, ...over,
  };
}

// Fully eligible for dispatch: approved GREEN job, execution enabled both
// globally and on the job, agent fresh with the required capability/connector,
// a correlation id present - i.e. every eligibleWorker() gate passes.
const liveControls: SystemControls = { ...DEFAULT_CONTROLS, execution_enabled: true, hermes_mode: 'dispatch_eligible' };
function eligibleInput(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    agent, job: job(), controls: liveControls,
    requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW, ...over,
  };
}

const validCommand = normalizeCommand({
  id: 'c1', actor: 'owner', source: 'dashboard', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os',
  correlation_id: 'corr-1', idempotency_key: 'i1', now: NOW,
});

function hermesInput(mode: SystemControls['hermes_mode'], over: Partial<HermesInput> = {}): HermesInput {
  return {
    controls: { ...liveControls, hermes_mode: mode },
    command: validCommand,
    eligibility: eligibleInput(),
    now: NOW,
    ...over,
  };
}

// --- (a)/(e): observe_only never yields dispatch/propose, ever -------------

describe('observe_only is an absolute ceiling', () => {
  it('a fully-eligible job dispatches under dispatch_eligible mode (sanity: the fixture really is eligible)', () => {
    const r = decide(hermesInput('dispatch_eligible'));
    expect(r.decision).toBe('dispatch');
  });

  it('the SAME fully-eligible job only ever observes under observe_only (never dispatch/propose)', () => {
    const r = decide(hermesInput('observe_only'));
    expect(r.decision).toBe('observe');
    expect(r.decision).not.toBe('dispatch');
    expect(r.decision).not.toBe('propose');
  });

  it('observe_only observes regardless of eligibility flags - even a maximally INeligible job', () => {
    const ineligible = hermesInput('observe_only', {
      command: null,
      eligibility: eligibleInput({
        job: job({ approval_id: null, risk_class: 'RED', execution_enabled: false, correlation_id: '', cancel_requested: true }),
        controls: { ...liveControls, hermes_mode: 'observe_only', execution_enabled: false, owner_stop: true },
        requiredCapabilities: ['nonexistent-capability'],
        requiredConnectors: ['nonexistent-connector'],
      }),
    });
    const r = decide(ineligible);
    expect(r.decision).toBe('observe');
  });

  it('never yields dispatch or propose under observe_only across a matrix of eligibility permutations', () => {
    const flagSets: Partial<Job>[] = [
      {},
      { approval_id: null },
      { risk_class: 'RED' },
      { risk_class: 'BLACK' },
      { execution_enabled: false },
      { cancel_requested: true },
      { correlation_id: '' },
    ];
    for (const flags of flagSets) {
      const r = decide(hermesInput('observe_only', { eligibility: eligibleInput({ job: job(flags) }) }));
      expect(r.decision).toBe('observe');
    }
  });
});

// --- call-recording fake client ---------------------------------------------

interface Call {
  op: 'insert' | 'update' | 'select';
  table: string;
  row?: Record<string, unknown>;
}

function recordingClient(
  controlsRow: Record<string, unknown> | null,
  writeResult: QueryResult = { data: [{ id: 'x' }], error: null },
): { client: RuntimeClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ op: 'insert', table, row });
          return { select: async () => writeResult };
        },
        update(row: Record<string, unknown>) {
          calls.push({ op: 'update', table, row });
          type Node = {
            select: () => Promise<QueryResult>;
            eq: () => Node;
            lte: () => Node;
            gt: () => Node;
          };
          const node: Node = { select: async () => writeResult, eq: () => node, lte: () => node, gt: () => node };
          return node;
        },
        select() {
          calls.push({ op: 'select', table });
          const limit = async () => ({ data: controlsRow ? [controlsRow] : [], error: null });
          type Node = {
            limit: (n: number) => Promise<QueryResult>;
            eq: (c: string, v: string) => Node;
            order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<QueryResult> };
          };
          const node: Node = { limit, eq: () => node, order: () => ({ limit }) };
          return node;
        },
      };
    },
  };
  return { client, calls };
}

// --- (b): recommendation reasons are recorded on the decision row ----------

describe('routing recommendation is recorded on the orchestration_decisions row', () => {
  it('appends route: reason strings only for the observe decision', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'observe_only' });
    const candidate: ObserveCandidate = { id: 'j1', input: hermesInput('observe_only') };
    const res = await runHermesObserveOnce(client, [candidate], NOW);

    expect(res.observations[0].decision).toBe('observe');
    expect(res.observations[0].reasons).toEqual(
      expect.arrayContaining([
        'route:implementer=claude',
        'route:reviewer=codex',
        'route:task_kind=unknown',
        'route:mode=recommendation_only',
      ]),
    );

    const written = calls.find((c) => c.op === 'insert' && c.table === 'orchestration_decisions');
    expect(written).toBeDefined();
    const reasons = written?.row?.['reasons'] as string[];
    expect(reasons).toEqual(
      expect.arrayContaining([
        'route:implementer=claude',
        'route:reviewer=codex',
        'route:mode=recommendation_only',
      ]),
    );
    expect(written?.row?.['decision']).toBe('observe');
  });

  it('classifies the task_kind from the command packet into the recorded reasons', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'observe_only' });
    const packet: TaskTextHints = {
      requested_action: 'Write unit tests for the checkpoint resume logic',
      requested_scope: null,
      expected_outcome: null,
    };
    const candidate: ObserveCandidate = { id: 'j1', input: hermesInput('observe_only'), packet };
    await runHermesObserveOnce(client, [candidate], NOW);
    const written = calls.find((c) => c.op === 'insert' && c.table === 'orchestration_decisions');
    expect(written?.row?.['reasons']).toEqual(
      expect.arrayContaining(['route:task_kind=test']),
    );
  });

  it('does NOT append route: reasons when the decision is not observe (e.g. noop while paused)', async () => {
    const { client } = recordingClient({ ...liveControls, hermes_mode: 'paused' });
    const candidate: ObserveCandidate = { id: 'j1', input: hermesInput('paused') };
    const res = await runHermesObserveOnce(client, [candidate], NOW);
    expect(res.observations[0].decision).toBe('noop');
    expect(res.observations[0].reasons.some((r) => r.startsWith('route:'))).toBe(false);
  });
});

// --- (c): the Hermes observe path never touches lease/complete/requeue -----

describe('Hermes observe path calls only insertOrchestrationDecision + event append', () => {
  it('never calls an update() adapter, and only inserts into orchestration_decisions / os_events', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'observe_only' });
    const candidates: ObserveCandidate[] = [
      { id: 'j1', input: hermesInput('observe_only') },
      { id: 'j2', input: hermesInput('observe_only', { eligibility: eligibleInput({ job: job({ id: 'j2', idempotency_key: 'i2' }) }) }) },
    ];
    await runHermesObserveOnce(client, candidates, NOW);

    // No lease acquisition/release, no job CAS, no staging-job insert, no
    // completion/requeue - all of those are update() or insert-into-other-
    // tables calls. The observe path must be strictly read-controls +
    // insert-decision + insert-event.
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
    const insertTables = new Set(calls.filter((c) => c.op === 'insert').map((c) => c.table));
    expect(insertTables).toEqual(new Set(['orchestration_decisions', 'os_events']));
    expect(calls.some((c) => c.table === 'worker_leases')).toBe(false);
    expect(calls.some((c) => c.table === 'job_attempts')).toBe(false);
    expect(calls.some((c) => c.table === 'job_checkpoints')).toBe(false);
    expect(calls.some((c) => c.table === 'os_jobs' && c.op !== 'select')).toBe(false);
  });
});

// --- (d): disabled/stopped/paused record nothing ----------------------------

describe('disabled/stopped/paused modes record nothing', () => {
  it('disabled: runHermesObserveOnce skips entirely', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'disabled' });
    const res = await runHermesObserveOnce(client, [{ id: 'j1', input: hermesInput('disabled') }], NOW);
    expect(res.skipped).toBe(true);
    expect(res.recorded).toBe(0);
    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });

  it('stopped: runHermesObserveOnce skips entirely', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'stopped' });
    const res = await runHermesObserveOnce(client, [{ id: 'j1', input: hermesInput('stopped') }], NOW);
    expect(res.skipped).toBe(true);
    expect(res.recorded).toBe(0);
    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });

  it('hermes_mode=paused: the bounded loop halts BEFORE recording anything', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'paused' });
    const batch = [{ id: 'j1', input: hermesInput('paused') }];
    const r = await hermesObserveLoop(client, [batch], 5, NOW);
    expect(r.stoppedReason).toBe('halted');
    expect(r.totalRecorded).toBe(0);
    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });

  it('owner_stop / soft pause: the bounded loop also halts before recording', async () => {
    const { client, calls } = recordingClient({ ...liveControls, hermes_mode: 'observe_only', paused: true });
    const batch = [{ id: 'j1', input: hermesInput('observe_only') }];
    const r = await hermesObserveLoop(client, [batch], 5, NOW);
    expect(r.stoppedReason).toBe('halted');
    expect(r.totalRecorded).toBe(0);
    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });
});

// --- (f): classifyTask determinism ------------------------------------------

describe('classifyTask - pure, deterministic, bounded keyword classification', () => {
  it('a docs-only objective classifies as documentation', () => {
    const packet: TaskTextHints = {
      requested_action: 'Update the README documentation',
      requested_scope: 'docs/',
      expected_outcome: 'changelog entry added',
    };
    const cls = classifyTask(job(), packet);
    expect(cls.task_kind).toBe('documentation');
  });

  it('code keywords classify as code', () => {
    const packet: TaskTextHints = {
      requested_action: 'Implement a fix for the login bug in the API endpoint',
      requested_scope: null,
      expected_outcome: null,
    };
    const cls = classifyTask(job(), packet);
    expect(cls.task_kind).toBe('code');
  });

  it('migration keywords classify as migration', () => {
    const packet: TaskTextHints = {
      requested_action: 'Write a schema migration to alter table os_jobs',
      requested_scope: null,
      expected_outcome: null,
    };
    expect(classifyTask(job(), packet).task_kind).toBe('migration');
  });

  it('test keywords classify as test', () => {
    const packet: TaskTextHints = {
      requested_action: 'Add vitest coverage for the checkpoint resume path',
      requested_scope: null,
      expected_outcome: null,
    };
    expect(classifyTask(job(), packet).task_kind).toBe('test');
  });

  it('falls back to unknown with no packet and no descriptive job text', () => {
    expect(classifyTask(job(), null).task_kind).toBe('unknown');
    expect(classifyTask(job(), undefined).task_kind).toBe('unknown');
  });

  it('is error-tolerant: a null/undefined job never throws', () => {
    expect(() => classifyTask(null, null)).not.toThrow();
    expect(() => classifyTask(undefined, undefined)).not.toThrow();
    expect(classifyTask(null, null).task_kind).toBe('unknown');
  });

  it('reviewer is always codex and always differs from implementer, across every task_kind', () => {
    const cases: (TaskTextHints | null)[] = [
      null,
      { requested_action: 'update docs' },
      { requested_action: 'implement a feature' },
      { requested_action: 'db migration' },
      { requested_action: 'write tests' },
    ];
    for (const packet of cases) {
      const cls = classifyTask(job(), packet);
      expect(cls.implementer).toBe('claude');
      expect(cls.reviewer).toBe('codex');
      expect(cls.reviewer).not.toBe(cls.implementer);
    }
  });

  it('is deterministic: identical inputs always classify identically', () => {
    const packet: TaskTextHints = { requested_action: 'Implement the new dashboard component', requested_scope: null, expected_outcome: null };
    const first = classifyTask(job(), packet);
    const second = classifyTask(job(), packet);
    expect(first).toEqual(second);
  });
});
