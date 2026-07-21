import { describe, expect, it } from 'vitest';
import type { AuditSink } from '../src/lib/audit';
import {
  RUNTIME_TABLES,
  listJobs,
  type QueryResult,
  type RuntimeClient,
} from '../src/lib/ai-os/store';
import { processChatGptIntake } from '../src/app/api/os/chatgpt/route';
import {
  cancelJob,
  enqueueStagingJob,
  requestControl,
  type CancelJobInput,
  type ControlPlaneDeps,
  type EnqueueInput,
} from '../src/lib/ai-os/controlplane';
import { runStagingWorkerCycle, buildHermesObserveBatch } from '../src/lib/ai-os/staging-sim';
import {
  runHermesObserveOnce,
  runWorkerCycleSimulation,
  type ObserveCandidate,
} from '../src/lib/ai-os/orchestrator';
import { hermesObserveLoop } from '../src/lib/ai-os/hermes-service';
import {
  envelopeFromPacketAndJob,
  validateJobEnvelope,
  REQUIRED_PROHIBITED_OPERATIONS,
  type EnvelopeExtras,
  type JobEnvelope,
} from '../src/lib/ai-os/envelope';
import { worktreePreparePlan } from '../src/lib/ai-os/worktree';
import { selectCandidateJobs, stagingEnvelope } from '../src/lib/ai-os/candidates';
import type { CommandPacket } from '../src/lib/ai-os/commands';
import type { Job } from '../src/lib/ai-os/queue';
import type { AgentRecord } from '../src/lib/ai-os/types';
import type { SystemControls } from '../src/lib/ai-os/controls';

// Preston AI OS - Phase 5J synthetic end-to-end drill (documentation-only).
//
// This file walks ONE synthetic, documentation-only job through the entire
// local authenticated staging harness as a single coherent scenario: ChatGPT
// intake -> replay dedup -> queue-only enqueue -> queue visibility -> Hermes
// observe (routing recommendation only) -> bounded no-execution staging
// simulation -> the multi-agent job envelope -> the worktree-prepare plan ->
// owner halt/kill/cancel controls -> the approval boundary.
//
// Deliberately UNLIKE the per-module unit tests (controlplane.test.ts,
// staging-sim.test.ts, etc.), which use a scripted per-call result queue: this
// file needs the SAME state to persist and evolve across ten ordered steps,
// so the fake RuntimeClient here is a small real in-memory table store
// (insert/select/eq/order/limit/update with unique-constraint emulation)
// rather than a queue of canned responses. It is still the same fail-closed
// adapter surface every other ai-os test exercises - no network, no real DB,
// no child processes, one fixed clock.
//
// The `it()` blocks below are ORDER-DEPENDENT BY DESIGN: they share module
// scoped state (packetId, the job row, the envelope) because this is one
// drill, not ten independent units. Vitest runs `it()` blocks within a
// `describe()` in declaration order, so this is safe.

const NOW = '2026-07-21T12:00:00.000Z';
const OWNER = 'info@preston.nyc';
const OWNER_ENV = { OWNER_EMAIL_ALLOWLIST: OWNER };
const CHATGPT_ENV = { CHATGPT_OWNER_IDENTITY: OWNER };

const CORRELATION_ID = 'drill5j-e2e-001';
const IDEMPOTENCY_KEY = 'drill5j-e2e-idem-001';
const JOB_IDEMPOTENCY_KEY = 'drill5j-e2e-job-idem-001';
const APPROVAL_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const JOB_ID = '55555555-6666-4777-8888-999999999999';

// Human-legible drill worktree/job slug (Phase 5J worktree naming) -
// DELIBERATELY a different identifier from JOB_ID (the os_jobs UUID). The
// envelope's job_id field is always the real job row's id (see
// envelopeFromPacketAndJob); the worktree slug is a separate, caller-chosen
// name for the isolated filesystem worktree, exactly as worktree.ts's own
// tests (worktree-prep.test.ts) already model with jobId '5j-orchestration'.
const DRILL_JOB_SLUG = '5j-doc-drill-001';
const DRILL_WORKTREE_PATH = '/srv/worktrees/wt-5j-doc-drill-001';
const DRILL_BASE_COMMIT = 'f4fd2bce30ea3c6f4ce02b5a791ee5b4568d1201';

// Documentation-only requested_action, deliberately worded so:
//  - classifyRisk (commands.ts) lands GREEN via the 'read' keyword and hits
//    none of the RED/BLACK markers (no send/email/deploy/production/prod/
//    delete/payment/charge/transfer/migrate, no rm -rf/drop table/etc).
//  - classifyTask (hermes.ts) lands 'documentation' via the literal word
//    "documentation" (checked before the 'code' keyword bucket).
//  - mentionsProduction (controlplane.ts) never fires: no "prod"/"production"
//    token anywhere in the action/target/scope fields.
const REQUESTED_ACTION =
  'Read and update documentation describing the verified Remote-Live staging '
  + 'architecture (documentation-only change; no execution, no code paths modified).';

function chatGptBody() {
  return {
    owner_identity: OWNER,
    correlation_id: CORRELATION_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    command: {
      requested_action: REQUESTED_ACTION,
      target_project: 'preston-os',
      target_repository: 'preston-os',
      requested_scope: 'docs/remote-live-staging-architecture.md',
      expected_outcome:
        'Documentation updated to describe the verified Remote-Live staging '
        + 'architecture; no runtime behavior changed.',
    },
  };
}

// --- a small real in-memory table store (not a scripted queue) -------------
//
// Models the subset of Postgres/Supabase semantics every ai-os adapter in
// store.ts relies on: insert() with a unique-constraint-shaped rejection,
// select().eq()/.order()/.limit(), and update().eq()/.lte()/.gt().select()
// as a real conditional (CAS-shaped) mutation. State genuinely persists
// across calls, which is the point: this is one long-running drill, not one
// call per test.

type Row = Record<string, unknown>;

interface Call {
  op: 'insert' | 'update' | 'select';
  table: string;
  row?: Record<string, unknown>;
}

// Extra columns (beyond `id`, which is always treated as a primary key when
// present) that must be unique per table - mirrors the real DB unique
// constraints the adapters in store.ts depend on for idempotent replay.
const UNIQUE_COLUMNS: Record<string, string[]> = {
  [RUNTIME_TABLES.commandPackets]: ['idempotency_key'],
  [RUNTIME_TABLES.jobs]: ['idempotency_key'],
  [RUNTIME_TABLES.leases]: ['job_id'],
};

type Filter = { col: string; op: 'eq' | 'lte' | 'gt'; val: unknown };

function makeMemoryDb(): { client: RuntimeClient; store: Record<string, Row[]>; calls: Call[] } {
  const store: Record<string, Row[]> = {};
  const calls: Call[] = [];

  function table(name: string): Row[] {
    return (store[name] ??= []);
  }

  function isDuplicate(name: string, row: Row): boolean {
    const rows = table(name);
    const extra = UNIQUE_COLUMNS[name] ?? [];
    return rows.some((r) => {
      if (row['id'] !== undefined && r['id'] === row['id']) return true;
      return extra.length > 0 && extra.every((c) => r[c] !== undefined && r[c] === row[c]);
    });
  }

  function rowMatches(row: Row, filters: Filter[]): boolean {
    return filters.every((f) => {
      const rv = row[f.col];
      if (f.op === 'eq') return String(rv) === String(f.val);
      if (rv === null || rv === undefined) return false;
      // All timestamps in this drill share one fixed ISO 8601 format, so a
      // plain string compare is chronologically correct (same idiom the real
      // Postgres adapters rely on via lte/gt on ISO columns).
      return f.op === 'lte' ? String(rv) <= String(f.val) : String(rv) > String(f.val);
    });
  }

  const client: RuntimeClient = {
    from(name: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ op: 'insert', table: name, row });
          return {
            select: async (): Promise<QueryResult> => {
              if (isDuplicate(name, row)) {
                return {
                  data: null,
                  error: { message: `duplicate key value violates unique constraint "${name}_uq"` },
                };
              }
              const stored: Row = { ...row };
              table(name).push(stored);
              return { data: [{ ...stored }], error: null };
            },
          };
        },
        select() {
          calls.push({ op: 'select', table: name });
          const filters: Filter[] = [];
          type SelectNode = {
            eq: (c: string, v: unknown) => SelectNode;
            order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<QueryResult> };
            limit: (n: number) => Promise<QueryResult>;
          };
          const node: SelectNode = {
            eq(c, v) {
              filters.push({ col: c, op: 'eq', val: v });
              return node;
            },
            order(c, o) {
              return {
                limit: async (n: number) => {
                  const rows = table(name).filter((r) => rowMatches(r, filters));
                  const sorted = rows.slice().sort((a, b) => {
                    const av = a[c];
                    const bv = b[c];
                    const cmp = typeof av === 'number' && typeof bv === 'number'
                      ? av - bv
                      : String(av ?? '').localeCompare(String(bv ?? ''));
                    return o.ascending ? cmp : -cmp;
                  });
                  return { data: sorted.slice(0, Math.max(0, n)).map((r) => ({ ...r })), error: null };
                },
              };
            },
            limit: async (n: number) => {
              const rows = table(name).filter((r) => rowMatches(r, filters));
              return { data: rows.slice(0, Math.max(0, n)).map((r) => ({ ...r })), error: null };
            },
          };
          return node;
        },
        update(patch: Record<string, unknown>) {
          calls.push({ op: 'update', table: name, row: patch });
          const filters: Filter[] = [];
          type UpdateNode = {
            eq: (c: string, v: unknown) => UpdateNode;
            lte: (c: string, v: unknown) => UpdateNode;
            gt: (c: string, v: unknown) => UpdateNode;
            select: () => Promise<QueryResult>;
          };
          const node: UpdateNode = {
            eq(c, v) {
              filters.push({ col: c, op: 'eq', val: v });
              return node;
            },
            lte(c, v) {
              filters.push({ col: c, op: 'lte', val: v });
              return node;
            },
            gt(c, v) {
              filters.push({ col: c, op: 'gt', val: v });
              return node;
            },
            select: async () => {
              const matched = table(name).filter((r) => rowMatches(r, filters));
              matched.forEach((r) => Object.assign(r, patch));
              return { data: matched.map((r) => ({ ...r })), error: null };
            },
          };
          return node;
        },
      };
    },
  };
  return { client, store, calls };
}

const { client, store, calls } = makeMemoryDb();

// Audit sink: writes onto the SAME shared store/calls so "an audit event was
// written" is provable from persisted state, not just a mock invocation.
const audit: AuditSink = {
  from(name: string) {
    return {
      insert(row: Record<string, unknown>) {
        calls.push({ op: 'insert', table: name, row });
        (store[name] ??= []).push({ ...row });
        return Promise.resolve({ error: null });
      },
    };
  },
};

function controlsRow(over: Record<string, unknown> = {}): Row {
  return {
    id: 'global', execution_enabled: true, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW, ...over,
  };
}

// Seed an ACTIVE (not halted) control plane so ChatGPT intake, enqueue, and
// the staging cycle all proceed - this is the drill's starting posture.
store[RUNTIME_TABLES.controls] = [controlsRow()];

const agent: AgentRecord = {
  id: 'preston-worker', display_name: 'Preston Worker', provider: 'anthropic', model: 'dispatcher',
  capabilities: ['code'], allowed_connectors: ['github'], status: 'idle',
  current_task_id: null, last_seen: NOW, version: '1', owner: OWNER,
};

let packetId = '';
let hermesBatch: ObserveCandidate[] = [];
let drillEnvelope: JobEnvelope;

describe('Phase 5J synthetic end-to-end drill: documentation-only job through the staging harness', () => {
  it('drill step 1: ChatGPT intake proposes the documentation-only job (GREEN, approval required, audited)', async () => {
    const auditBefore = store['audit_log']?.length ?? 0;

    const r = await processChatGptIntake(chatGptBody(), CHATGPT_ENV, NOW, { client, audit });

    expect(r.httpStatus).toBe(200);
    expect(r.json['ok']).toBe(true);
    expect(r.json['status']).toBe('proposed');
    expect(r.json['duplicate']).toBe(false);
    packetId = String(r.json['packet_id']);
    expect(packetId).toBeTruthy();

    const stored = store[RUNTIME_TABLES.commandPackets]!.find((row) => row['id'] === packetId);
    expect(stored).toBeDefined();
    expect(stored?.['approval_required']).toBe(true); // forced regardless of classification
    expect(stored?.['execution_eligible']).toBe(false); // default-deny
    expect(stored?.['action_class']).toBe('GREEN'); // classifyRisk('...read...') -> GREEN

    // Audit event written.
    expect(store['audit_log']!.length).toBeGreaterThan(auditBefore);
    const lastAudit = store['audit_log']!.at(-1)!;
    expect(lastAudit['action']).toBe('command_proposed');
    expect(lastAudit['action_class']).toBe('GREEN');
  });

  it('drill step 2: replaying the same idempotency_key reports duplicate:true and writes no second packet row', async () => {
    const before = store[RUNTIME_TABLES.commandPackets]!.length;

    const r = await processChatGptIntake(chatGptBody(), CHATGPT_ENV, NOW, { client, audit });

    expect(r.httpStatus).toBe(200);
    expect(r.json['ok']).toBe(true);
    expect(r.json['status']).toBe('duplicate');
    expect(r.json['duplicate']).toBe(true);
    expect(store[RUNTIME_TABLES.commandPackets]!.length).toBe(before); // no second row
  });

  it('drill step 3: enqueueStagingJob queues one job from the drill packet, execution stays forced off', async () => {
    const deps: ControlPlaneDeps = { client, audit, env: OWNER_ENV, now: NOW };
    const input: EnqueueInput = {
      ownerEmail: OWNER,
      jobId: JOB_ID,
      command_id: packetId,
      approval_id: APPROVAL_UUID,
      correlation_id: CORRELATION_ID,
      idempotency_key: JOB_IDEMPOTENCY_KEY,
    };

    const r = await enqueueStagingJob(deps, input);

    expect(r.ok).toBe(true);
    expect(r.code).toBe('queued');
    const row = store[RUNTIME_TABLES.jobs]!.find((j) => j['id'] === JOB_ID);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      status: 'queued', execution_enabled: false, cancel_requested: false,
      risk_class: 'GREEN', approval_id: APPROVAL_UUID, attempts: 0,
    });
  });

  it('drill step 4: the queued job is visible via the same read path GET /api/os/queue uses (listJobs)', async () => {
    const { rows, error } = await listJobs(client, 20);
    expect(error).toBeUndefined();
    expect(rows.some((r) => r['id'] === JOB_ID)).toBe(true);
  });

  it('drill step 5: Hermes observe (observe_only) records an "observe" decision with the routing recommendation and touches no job/lease table', async () => {
    hermesBatch = await buildHermesObserveBatch(client, agent, 5, NOW);
    expect(hermesBatch.some((c) => c.id === JOB_ID)).toBe(true);

    const before = calls.length;
    const res = await runHermesObserveOnce(client, hermesBatch, NOW);
    const obs = res.observations.find((o) => o.id === JOB_ID);
    expect(obs).toBeDefined();
    expect(obs?.decision).toBe('observe');
    expect(obs?.reasons).toEqual(
      expect.arrayContaining([
        'route:implementer=claude',
        'route:reviewer=codex',
        'route:task_kind=documentation',
        'route:mode=recommendation_only',
      ]),
    );

    const stepCalls = calls.slice(before);
    // No lease/update/insert on job tables by Hermes: only reads controls,
    // then inserts a decision row + an event row.
    const jobTables = new Set<string>([
      RUNTIME_TABLES.jobs, RUNTIME_TABLES.leases, RUNTIME_TABLES.attempts, RUNTIME_TABLES.checkpoints,
    ]);
    expect(stepCalls.some((c) => jobTables.has(c.table))).toBe(false);
    expect(stepCalls.some((c) => c.op === 'update')).toBe(false);
    const insertTables = new Set(stepCalls.filter((c) => c.op === 'insert').map((c) => c.table));
    expect(insertTables).toEqual(new Set([RUNTIME_TABLES.orchestration, RUNTIME_TABLES.events]));

    expect(store[RUNTIME_TABLES.orchestration]!.some((d) => d['job_id'] === JOB_ID && d['decision'] === 'observe')).toBe(true);
    expect(store[RUNTIME_TABLES.events]!.some((e) => e['type'] === 'HermesObserved')).toBe(true);
  });

  it('drill step 6: the bounded staging cycle simulates the job end-to-end (queued -> leased -> checkpointed) with no execution', async () => {
    const before = calls.length;

    const r = await runStagingWorkerCycle(client, {
      agent, maxJobs: 5, leaseTtlMs: 120_000, now: NOW, tokenFactory: () => 'tok-drill-1',
    });

    expect(r.halted).toBe(false);
    const ev = r.evidence.find((e) => e.jobId === JOB_ID);
    expect(ev).toBeDefined();
    expect(ev?.outcome).toBe('simulated');
    expect(ev?.attemptWritten).toBe(true);
    expect(ev?.checkpointWritten).toBe(true);
    expect(ev?.completed).toBe(true);
    // JobEvidence never carries an `executed` field at all - the staging
    // simulation path structurally cannot report a job as executed.
    for (const e of r.evidence) expect('executed' in e).toBe(false);

    const stepCalls = calls.slice(before);
    const jobUpdates = stepCalls.filter((c) => c.op === 'update' && c.table === RUNTIME_TABLES.jobs);
    expect(jobUpdates.some((c) => c.row?.['status'] === 'leased')).toBe(true); // queued -> leased
    expect(jobUpdates.at(-1)?.row).toMatchObject({ status: 'checkpointed', attempts: 1 }); // -> checkpointed

    const row = store[RUNTIME_TABLES.jobs]!.find((j) => j['id'] === JOB_ID);
    expect(row?.['status']).toBe('checkpointed');
    expect(row?.['attempts']).toBe(1);
    expect(store[RUNTIME_TABLES.attempts]!.some((a) => a['job_id'] === JOB_ID)).toBe(true);
    expect(store[RUNTIME_TABLES.checkpoints]!.some((c) => c['job_id'] === JOB_ID)).toBe(true);

    // Supporting assertion at the orchestrator layer: the underlying
    // simulation result the worker wraps is ALWAYS executed:false too, not
    // merely absent from the evidence summary.
    const leasedSnapshot: Job = {
      ...(store[RUNTIME_TABLES.jobs]!.find((j) => j['id'] === JOB_ID) as unknown as Job),
      status: 'leased', lease_owner: agent.id, lease_token: 'tok-check',
      lease_expires_at: new Date(Date.parse(NOW) + 120_000).toISOString(),
    };
    const controls = controlsRow() as unknown as SystemControls;
    const sim = runWorkerCycleSimulation({
      eligibility: {
        agent, job: leasedSnapshot, controls,
        requiredCapabilities: ['code'], requiredConnectors: ['github'], now: NOW,
      },
      envelope: stagingEnvelope(leasedSnapshot),
      now: NOW,
      mode: 'simulation',
    });
    expect(sim.executed).toBe(false);
  });

  it('drill step 7: the JobEnvelope validates for the drill job, and every listed mutation is rejected', () => {
    const storedPacketRow = store[RUNTIME_TABLES.commandPackets]!.find((r) => r['id'] === packetId)!;
    const packetForEnvelope: CommandPacket = {
      id: String(storedPacketRow['id']),
      actor: String(storedPacketRow['actor']),
      source: storedPacketRow['source'] as CommandPacket['source'],
      requested_action: String(storedPacketRow['requested_action']),
      action_class: storedPacketRow['action_class'] as CommandPacket['action_class'],
      target_project: String(storedPacketRow['target_project']),
      target_repository: String(storedPacketRow['target_repository']),
      requested_scope: String(storedPacketRow['requested_scope'] ?? ''),
      expected_outcome: String(storedPacketRow['expected_outcome'] ?? ''),
      constraints: (storedPacketRow['constraints'] as string[]) ?? [],
      approval_required: Boolean(storedPacketRow['approval_required']),
      execution_eligible: false,
      correlation_id: String(storedPacketRow['correlation_id']),
      idempotency_key: String(storedPacketRow['idempotency_key']),
      created_at: NOW,
      expires_at: String(storedPacketRow['expires_at']),
      status: storedPacketRow['status'] as CommandPacket['status'],
      audit_ref: (storedPacketRow['audit_ref'] as string | null) ?? null,
    };
    const jobRow = store[RUNTIME_TABLES.jobs]!.find((j) => j['id'] === JOB_ID) as unknown as Job;

    const extras: EnvelopeExtras = {
      environment: 'staging',
      title: 'Document verified Remote-Live staging architecture',
      objective:
        'Produce accurate, verified documentation of the Remote-Live staging '
        + 'architecture with no runtime or execution changes.',
      scope: 'docs/ only; no source, config, or infrastructure changes',
      allowed_operations: ['read_repo', 'edit_docs', 'run_tests', 'secret_scan', 'boundary_scan'],
      prohibited_operations: [...REQUIRED_PROHIBITED_OPERATIONS],
      base_branch: 'master',
      base_commit: DRILL_BASE_COMMIT,
      worktree_path: DRILL_WORKTREE_PATH,
      assigned_implementer: 'claude',
      assigned_reviewer: 'codex',
      required_tests: ['docs-lint'],
      required_evidence: ['job_checkpoints', 'job_attempts', 'orchestration_decisions'],
      checkpoint_state: 'queued_for_worktree_preparation',
      approval_state: 'pending_owner',
      created_at: NOW,
      updated_at: NOW,
      audit_refs: [],
    };

    const result = envelopeFromPacketAndJob(packetForEnvelope, jobRow, extras);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected the drill envelope to validate: ' + result.errors.join(', '));
    drillEnvelope = result.envelope;

    expect(drillEnvelope.environment).toBe('staging');
    expect(drillEnvelope.execution).toBe(false);
    expect(drillEnvelope.push).toBe(false);
    expect(drillEnvelope.deploy).toBe(false);
    expect(drillEnvelope.risk_class).toBe('GREEN');
    expect(drillEnvelope.approval_state).toBe('pending_owner');
    expect(drillEnvelope.assigned_implementer).toBe('claude');
    expect(drillEnvelope.assigned_reviewer).toBe('codex');
    expect(drillEnvelope.worktree_path).toBe(DRILL_WORKTREE_PATH);

    // Mutations that MUST fail.
    expect(validateJobEnvelope({ ...drillEnvelope, environment: 'production' }).ok).toBe(false);
    expect(validateJobEnvelope({ ...drillEnvelope, push: true }).ok).toBe(false);
    expect(validateJobEnvelope({ ...drillEnvelope, assigned_reviewer: 'claude' }).ok).toBe(false);
    expect(validateJobEnvelope({ ...drillEnvelope, worktree_path: '/srv/worktrees/../etc' }).ok).toBe(false);
  });

  it('drill step 8: worktreePreparePlan produces an argv-only plan matching the envelope worktree path, with a read-only reviewer marker', () => {
    const plan = worktreePreparePlan({
      jobId: DRILL_JOB_SLUG,
      baseBranch: 'master',
      baseCommit: DRILL_BASE_COMMIT,
      implementer: 'claude',
      reviewer: 'codex',
    });

    expect(plan.ok).toBe(true);
    expect(plan.worktreePath).toBe(DRILL_WORKTREE_PATH); // matches the envelope's worktree_path (step 7)
    expect(plan.steps && plan.steps.length).toBeGreaterThan(0);

    const shellMeta = /[;&|`$()<>\\\n]/;
    for (const step of plan.steps!) {
      expect(Array.isArray(step.argv)).toBe(true);
      expect(step.argv.length).toBeGreaterThan(0);
      for (const arg of step.argv) expect(shellMeta.test(arg)).toBe(false);
    }
    const reviewStep = plan.steps!.find((s) => /read-only/i.test(s.description));
    expect(reviewStep).toBeDefined();
    expect(reviewStep!.description).toMatch(/codex/);
  });

  describe('drill step 9: owner halt / kill / cancel are honored', () => {
    it('drill step 9a: owner_stop halts the staging worker cycle before any lease is attempted', async () => {
      store[RUNTIME_TABLES.controls] = [controlsRow({ owner_stop: true })];
      const before = calls.length;

      const r = await runStagingWorkerCycle(client, { agent, maxJobs: 5, leaseTtlMs: 120_000, now: NOW });

      expect(r.halted).toBe(true);
      expect(r.evidence).toHaveLength(0);
      const stepCalls = calls.slice(before);
      expect(stepCalls.some((c) => c.table === RUNTIME_TABLES.leases)).toBe(false);
      expect(stepCalls.some((c) => c.op === 'update' && c.table === RUNTIME_TABLES.jobs)).toBe(false);
    });

    it('drill step 9b: owner_stop halts the Hermes observe loop before it records anything', async () => {
      const before = calls.length;

      const r = await hermesObserveLoop(client, [hermesBatch], 5, NOW);

      expect(r.stoppedReason).toBe('halted');
      expect(r.totalRecorded).toBe(0);
      const stepCalls = calls.slice(before);
      expect(stepCalls.every((c) => c.op === 'select')).toBe(true); // reads controls only
    });

    it('drill step 9c: the owner kill action sets owner_stop+paused and is audited', async () => {
      const deps: ControlPlaneDeps = { client, audit, env: OWNER_ENV, now: NOW };
      const auditBefore = store['audit_log']?.length ?? 0;

      const r = await requestControl(deps, OWNER, 'kill');

      expect(r.ok).toBe(true);
      expect(r.code).toBe('kill');
      const row = store[RUNTIME_TABLES.controls]!.find((c) => c['id'] === 'global')!;
      expect(row['owner_stop']).toBe(true);
      expect(row['paused']).toBe(true);
      expect(store['audit_log']!.length).toBeGreaterThan(auditBefore);
      expect(store['audit_log']!.at(-1)).toMatchObject({ action: 'control:kill', action_class: 'RED' });
    });

    it('drill step 9d: cancelJob sets cancel_requested on the drill job (owner-gated)', async () => {
      const deps: ControlPlaneDeps = { client, audit, env: OWNER_ENV, now: NOW };
      const input: CancelJobInput = {
        ownerEmail: OWNER, jobId: JOB_ID, correlation_id: CORRELATION_ID,
        reason: 'drill owner-halt verification',
      };

      const r = await cancelJob(deps, input);

      expect(r.ok).toBe(true);
      expect(r.code).toBe('cancel_requested');
      const row = store[RUNTIME_TABLES.jobs]!.find((j) => j['id'] === JOB_ID)!;
      expect(row['cancel_requested']).toBe(true);
    });

    it('drill step 9e: a cancel_requested job is never selected as a worker candidate', () => {
      const cancelledRow: Row = {
        id: 'synthetic-cancelled-drill-job', command_id: 'c1', approval_id: APPROVAL_UUID,
        status: 'queued', risk_class: 'GREEN', priority: 0, not_before: NOW,
        expires_at: '2026-07-21T13:00:00.000Z', attempts: 0, max_attempts: 3,
        idempotency_key: 'synthetic-cancelled-1', correlation_id: 'corr-synthetic',
        cancel_requested: true,
      };
      const liveControls: SystemControls = controlsRow({ owner_stop: false, paused: false }) as unknown as SystemControls;

      const sel = selectCandidateJobs([cancelledRow], { now: NOW, limit: 5, controls: liveControls });

      expect(sel.selected).toHaveLength(0);
      expect(
        sel.rejected.some((r) => r.id === 'synthetic-cancelled-drill-job' && r.reason.includes('cancellation requested')),
      ).toBe(true);
    });
  });

  it('drill step 10: the approval boundary holds - the envelope stays pending_owner through the entire drill', () => {
    expect(drillEnvelope.approval_state).toBe('pending_owner');
    // No step above ever had a code path capable of setting owner_approved:
    // approval_state only ever becomes 'owner_approved' when a caller
    // explicitly supplies that literal via EnvelopeExtras.approval_state (see
    // envelope.ts) - nothing in ChatGPT intake, enqueue, Hermes observe, the
    // staging cycle, or the owner controls exercised above ever constructs or
    // mutates a JobEnvelope. Re-validating the SAME object confirms it is
    // still exactly the pending, owner-gated envelope produced in step 7.
    const revalidated = validateJobEnvelope(drillEnvelope);
    expect(revalidated.ok).toBe(true);
    expect(revalidated.ok && revalidated.envelope.approval_state).toBe('pending_owner');
    expect(revalidated.ok && revalidated.envelope).toEqual(drillEnvelope);
  });
});
