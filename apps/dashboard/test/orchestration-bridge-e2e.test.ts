import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { intakeCommand, type CommandEnvelope } from '../src/lib/ai-os/orchestration/goal-intake';
import {
  insertGoalJob,
  insertJobApproval,
  insertMasterGoal,
  transitionGoal,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { driveGoal, driverStep, loadGoalState } from '../src/lib/ai-os/orchestration/driver';
import { loadBridgeReadiness, loadOrchestrationReadModel } from '../src/lib/ai-os/orchestration/read-model';

// ===========================================================================
// BRIDGE END-TO-END (item 14): one traceable owner command flows through the
// whole SIMULATION-ONLY control plane, exercised against a FAKE in-memory store
// (not a real database). It proves the store/driver/engine LOGIC and CAS
// semantics of each stage. It does NOT prove real database durability, RLS/
// CHECK/FK/grant enforcement, transactional RPC locking, database wall-clock
// expiry, real notification delivery, or laptop-closed remote operation - those
// require the owner to apply migration 0010 to staging and run the host/phone
// drill. Each `expect` is annotated with the gate point whose LOGIC it proves.
// ===========================================================================

const OWNER = 'owner@preston.nyc';
const NOW = '2026-07-22T12:00:00.000Z';
const ms = (iso: string) => Date.parse(iso);

function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? {
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row[key] ?? 'x', approval_id: row.approval_id }], error: null });
          } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() {
              const m = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of m) Object.assign(r, patch);
              return Promise.resolve({ data: m.map((r) => ({ id: r[pk(table)], approval_id: r.approval_id })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

function submitEnvelope(over: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    owner_identity: OWNER, source: 'telegram', command_type: 'submit_master_goal',
    correlation_id: 'corr-00000001', nonce: 'cmd-nonce-1', issued_at: NOW,
    expires_at: '2026-07-22T12:10:00.000Z', title: 'ship helper',
    objective: 'add a helper and a migration', ...over,
  };
}

// The owner's approval decision, applied the way decide_orchestration_approval
// (the one-time, row-locked, pending-only RPC) would - the app never mutates an
// approval row directly (migration 0010 revokes UPDATE). In staging this is the
// owner-run RPC; here we apply its effect to the fake row.
function ownerDecides(db: ReturnType<typeof makeFakeDb>, approvalId: string, at: string) {
  const row = db.rowsOf('orchestration_approvals').find((r) => r.approval_id === approvalId)!;
  Object.assign(row, { status: 'approved', decided_at: at, nonce: `decide-${approvalId}` });
}

describe('BRIDGE end-to-end (simulation control-plane trace)', () => {
  it('flows intake -> goal -> decompose -> approval -> claim -> result, under controls', async () => {
    const db = makeFakeDb();

    // (1) AUTHENTICATED INTAKE: only the allowlisted owner, fresh nonce, valid window.
    const intake = intakeCommand({
      envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]),
      seenNonces: new Set(), goalId: 'goal-00000001', now: NOW,
    });
    expect(intake.ok && intake.kind === 'goal').toBe(true); // (1) authenticated intake
    // a non-owner or replayed nonce is refused (fail-closed intake)
    expect(intakeCommand({ envelope: submitEnvelope({ owner_identity: 'intruder@x' }), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'g', now: NOW }).ok).toBe(false);
    expect(intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(['cmd-nonce-1']), goalId: 'g', now: NOW }).ok).toBe(false);
    if (!(intake.ok && intake.kind === 'goal')) throw new Error('intake');

    // (2) PERSISTENCE API + (3) IDEMPOTENT master-goal creation (fake-store CAS;
    // real durability + the unique constraint are proven on the migrated DB).
    expect((await insertMasterGoal(db.client, intake.goal)).ok).toBe(true); // (2) persistence API
    const dup = await insertMasterGoal(db.client, intake.goal);
    expect(dup.duplicate).toBe(true); // (3) idempotent: the same command does not duplicate the goal
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    expect(db.rowsOf('master_goals')[0].simulation_only).toBe(true);
    expect(db.rowsOf('master_goals')[0].environment).toBe('staging'); // (17) no production/real write

    // (4) VALID DECOMPOSITION: a GREEN code job + a RED migration job (gated), dep-ordered.
    // Job B's objective NAMES a gated action ("migrate"/"deploy") so the policy
    // classifier marks it RED + requires_approval (the objective drives gating,
    // not a spec field).
    const specs: TaskSpec[] = [
      { local_id: 'a', kind: 'code', title: 'impl helper', objective: 'add helper', depends_on_local: [] },
      { local_id: 'b', kind: 'migration', title: 'apply 0011', objective: 'migrate the database and deploy', depends_on_local: ['a'] },
    ];
    const d = decomposeGoal(intake.goal, specs, (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);
    await transitionGoal(db.client, 'goal-00000001', 'proposed', 'decomposed', NOW);
    expect(db.rowsOf('goal_jobs')).toHaveLength(2); // (4) durable jobs
    const jobB = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!;
    expect(jobB.requires_approval).toBe(true); // (5) the RED job is gated
    expect(jobB.executed).toBe(false);

    const depends = (id: string) => (id === 'job-0000-b' ? ['job-0000-a'] : []);
    const lockCtx = { base_commit: 'abc1234', allowed_paths: ['apps/dashboard/src/'], token: (j: string) => `tok-${j}` };

    // (9/10) drive: the GREEN job A is CLAIMED (run_id lease) and completes; the
    // gated job B BLOCKS at awaiting_approval (never self-approved).
    let t = ms(NOW);
    const parked = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 200, depends, lockCtx);
    expect(parked.reason).toBe('awaiting_owner_approval'); // (5) approval blocks execution
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.status).toBe('completed'); // (9) bounded claim ran A
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.status).toBe('awaiting_approval');
    expect(db.rowsOf('goal_jobs').every((j) => j.executed === false)).toBe(true); // (17) executed stays false

    // (6) Simulated effect of a SUCCESSFUL owner-only RPC decision for job B (the
    // real owner-only/pending-only/one-time/RLS/locking semantics are enforced by
    // decide_orchestration_approval on the migrated DB, not here). The approval
    // hash is DERIVED internally from the authoritative job (7 - action binding).
    const approvalId = 'apr-00000011';
    db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.approval_id = approvalId;
    const created = await insertJobApproval(db.client, {
      approval_id: approvalId, goal_id: 'goal-00000001',
      // the approval binds the job's ACTUAL action fields (what will execute)
      job: { id: 'job-0000-b', kind: 'migration', objective: 'migrate the database and deploy', title: 'apply 0011', risk_class: 'RED', assigned_role: 'claude' },
      owner_identity: OWNER, created_at: NOW, expires_at: '2026-07-22T13:00:00.000Z',
    });
    expect(created.ok).toBe(true); // (7) creation derives the canonical hash internally
    expect(db.rowsOf('orchestration_approvals')[0].status).toBe('pending'); // born pending (INSERT policy)

    // (8) EXECUTION-TIME EXPIRY: before the owner decides, an expired-by-now clock
    // would refuse; here the owner decides in time.
    ownerDecides(db, approvalId, NOW); // (6) simulated successful owner RPC decision

    // resume: the driver VERIFIES the canonical hash + execution-time expiry,
    // clears the gate atomically, CLAIMS job B, and completes it.
    const done = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 200, depends, lockCtx);
    expect(done.reason).toBe('completed'); // (11) durable result returned
    const finalB = db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!;
    expect(finalB.status).toBe('completed'); // (7/8) verified hash + non-expired => cleared + ran
    expect(finalB.requires_approval).toBe(false); // (6) clearance persisted
    expect(finalB.assigned_role).toBe('claude'); // (10) controlled agent assignment
    // (11) durable evidence returned, bound to the run that produced it
    expect(Array.isArray(finalB.evidence_refs)).toBe(true);
    expect((finalB.evidence_refs as string[]).some((r) => r.includes(':run:job-0000-b:') && r.endsWith(':completed'))).toBe(true);
    expect(db.rowsOf('master_goals')[0].status).toBe('completed');
    expect(db.rowsOf('goal_jobs').every((j) => j.executed === false)).toBe(true); // (17) still no real write
  });

  it('a wrong-hash approval never clears the gate (7 negative)', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, { ...(intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW }) as { goal: import('../src/lib/ai-os/orchestration/model').MasterGoal }).goal });
    db.rowsOf('goal_jobs').push({
      id: 'job-0000-b', goal_id: 'goal-00000001', kind: 'migration', title: 'apply 0011',
      objective: 'apply migration', risk_class: 'RED', assigned_role: 'claude',
      status: 'awaiting_approval', attempts: 0, requires_approval: true, approval_id: 'apr-x',
      runtime_job_id: null, correlation_id: 'corr-00000001', evidence_refs: [], failure_reason: null,
      created_at: NOW, updated_at: NOW,
    });
    // an approval whose action_hash does NOT bind this action (forged/mismatched)
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-x', goal_id: 'goal-00000001', job_id: 'job-0000-b', status: 'approved',
      owner_identity: OWNER, action_hash: 'not-the-canonical-hash', environment: 'staging',
      nonce: 'n', decided_at: NOW, created_at: NOW, expires_at: '2026-07-22T13:00:00.000Z',
    });
    const lockCtx = { base_commit: 'abc1234', allowed_paths: ['apps/dashboard/src/'], token: (j: string) => `tok-${j}` };
    await driverStep(db.client, 'goal-00000001', ms('2026-07-22T12:05:00.000Z'), () => [], lockCtx);
    // gate never clears - a forged/mismatched approval cannot authorize execution
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.status).toBe('awaiting_approval');
  });

  it('a correctly-hashed but EXPIRED approval never clears the gate (8 negative)', async () => {
    const db = makeFakeDb();
    const intake = intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
    if (!(intake.ok && intake.kind === 'goal')) throw new Error('intake');
    await insertMasterGoal(db.client, intake.goal);
    db.rowsOf('goal_jobs').push({
      id: 'job-0000-b', goal_id: 'goal-00000001', kind: 'migration', title: 'apply 0011',
      objective: 'migrate the database and deploy', risk_class: 'RED', assigned_role: 'claude',
      status: 'awaiting_approval', attempts: 0, requires_approval: true, approval_id: 'apr-exp',
      runtime_job_id: null, correlation_id: 'corr-00000001', evidence_refs: [], failure_reason: null,
      created_at: NOW, updated_at: NOW,
    });
    // correct internally-derived hash, validly decided, but expires at 12:30
    const created = await insertJobApproval(db.client, {
      approval_id: 'apr-exp', goal_id: 'goal-00000001',
      job: { id: 'job-0000-b', kind: 'migration', objective: 'migrate the database and deploy', title: 'apply 0011', risk_class: 'RED', assigned_role: 'claude' },
      owner_identity: OWNER, created_at: NOW, expires_at: '2026-07-22T12:30:00.000Z',
    });
    expect(created.ok).toBe(true);
    ownerDecides(db, 'apr-exp', NOW);
    const lockCtx = { base_commit: 'abc1234', allowed_paths: ['apps/dashboard/src/'], token: (j: string) => `tok-${j}` };
    // execute AFTER expiry (12:45): the hash is right, but the approval expired
    // by the execution clock -> gate must NOT clear.
    await driverStep(db.client, 'goal-00000001', ms('2026-07-22T12:45:00.000Z'), () => [], lockCtx);
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.status).toBe('awaiting_approval');
    expect(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-b')!.requires_approval).toBe(true);
  });

  it('parks a gated job even when an approval_id is pre-linked (liveness)', async () => {
    const db = makeFakeDb();
    const intake = intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
    if (!(intake.ok && intake.kind === 'goal')) throw new Error('intake');
    await insertMasterGoal(db.client, intake.goal);
    const specs: TaskSpec[] = [{ local_id: 'b', kind: 'migration', title: 'apply', objective: 'migrate the database', depends_on_local: [] }];
    const dd = decomposeGoal(intake.goal, specs, (l) => `job-0000-${l}`, NOW);
    if (!dd.ok) throw new Error('d');
    // pre-link an approval_id BEFORE the job ever parks (the state Codex flagged)
    const jb = { ...dd.jobs[0], approval_id: 'apr-pre' };
    await insertGoalJob(db.client, jb);
    await transitionGoal(db.client, 'goal-00000001', 'proposed', 'decomposed', NOW);
    let t = ms(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 50, () => [], { base_commit: 'abc1234', allowed_paths: ['apps/dashboard/src/'], token: (j: string) => `tok-${j}` });
    // it parks (does not spin), because the engine emits request_approval regardless of approval_id
    expect(r.reason).toBe('awaiting_owner_approval');
    expect(db.rowsOf('goal_jobs')[0].status).toBe('awaiting_approval');
  });

  it('intake rejects an expired / reversed-window envelope (1 negative)', () => {
    const base = { ownerAllowlist: new Set([OWNER]), seenNonces: new Set<string>(), goalId: 'g', now: '2026-07-22T12:20:00.000Z' };
    // envelope expired before now
    expect(intakeCommand({ ...base, envelope: submitEnvelope() }).ok).toBe(false); // expires 12:10 < now 12:20
    // reversed window (expires before issued)
    expect(intakeCommand({ ...base, now: NOW, envelope: submitEnvelope({ issued_at: '2026-07-22T12:10:00.000Z', expires_at: '2026-07-22T12:05:00.000Z' }) }).ok).toBe(false);
  });

  it('pause / owner_stop halt the runtime fail-closed (13/14)', async () => {
    for (const control of [{ paused: true }, { owner_stop: true }]) {
      const db = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW, ...control });
      const intake = intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
      if (!(intake.ok && intake.kind === 'goal')) throw new Error('intake');
      await insertMasterGoal(db.client, intake.goal);
      const specs: TaskSpec[] = [{ local_id: 'a', kind: 'code', title: 't', objective: 'o', depends_on_local: [] }];
      const dd = decomposeGoal(intake.goal, specs, (l) => `job-0000-${l}`, NOW);
      if (!dd.ok) throw new Error('d');
      await insertGoalJob(db.client, dd.jobs[0]);
      const before = JSON.stringify(db.rowsOf('goal_jobs'));
      const r = await driverStep(db.client, 'goal-00000001', ms(NOW), () => []);
      expect(r.halted).toBe(true); // (13/14) pause + owner_stop/global_kill halt
      expect(JSON.stringify(db.rowsOf('goal_jobs'))).toBe(before); // nothing advanced
    }
  });

  it('reports bridge readiness/health for remote inspection (item 13)', async () => {
    // simulation-safe posture + migration applied (goal present) => ready
    const db = makeFakeDb();
    await insertMasterGoal(db.client, (intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW }) as { goal: import('../src/lib/ai-os/orchestration/model').MasterGoal }).goal);
    const ready = await loadBridgeReadiness(db.client);
    expect(ready.status).toBe('simulation_ready');
    expect(ready.simulation_safe).toBe(true);
    expect(ready.execution_enabled).toBe(false);
    expect(ready.remote_runner_enabled).toBe(false);
    expect(ready.hermes_mode).toBe('observe_only');

    // owner_stop => halted
    const stopped = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: true, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW });
    expect((await loadBridgeReadiness(stopped.client)).status).toBe('halted');

    // an unsafe control posture is flagged (never silently "ready")
    const unsafe = makeFakeDb({ id: 'global', execution_enabled: true, owner_stop: false, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW });
    expect((await loadBridgeReadiness(unsafe.client)).status).toBe('unsafe_controls');
    expect((await loadBridgeReadiness(unsafe.client)).simulation_safe).toBe(false);

    // paused => halted
    const paused = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: false, paused: true, hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW });
    expect((await loadBridgeReadiness(paused.client)).status).toBe('halted');
    // remote_runner enabled => unsafe
    const rr = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: true, updated_at: NOW });
    expect((await loadBridgeReadiness(rr.client)).simulation_safe).toBe(false);
    expect((await loadBridgeReadiness(rr.client)).status).toBe('unsafe_controls');
    // Hermes not observe_only => unsafe
    const hermes = makeFakeDb({ id: 'global', execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'active', remote_runner_enabled: false, updated_at: NOW });
    expect((await loadBridgeReadiness(hermes.client)).status).toBe('unsafe_controls');

    // unreadable controls fail closed (cannot verify safety)
    const noControls = makeFakeDb();
    noControls.rowsOf('system_controls').length = 0;
    expect((await loadBridgeReadiness(noControls.client)).status).toBe('controls_unreadable');

    // a generic read error on the orchestration read model fails closed - it
    // must NEVER be reported as simulation_ready (error must not become 0/ok).
    const errClient: RuntimeClient = {
      from(table: string) {
        return {
          insert() { return { select() { return Promise.resolve({ data: [{ id: 'x' }], error: null }); } }; },
          select() {
            const chain = () => ({
              eq() { return chain(); },
              order() { return { limit() { return Promise.resolve({ data: null, error: table === 'system_controls' ? null : { message: 'permission denied' } }); } }; },
              limit() { return Promise.resolve({ data: table === 'system_controls' ? [{ id: 'global', execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false }] : null, error: table === 'system_controls' ? null : { message: 'permission denied' } }); },
            });
            return chain();
          },
          update() { const chain = () => ({ eq() { return chain(); }, lte() { return chain(); }, gt() { return chain(); }, select() { return Promise.resolve({ data: [], error: null }); } }); return chain(); },
        };
      },
    };
    const errReady = await loadBridgeReadiness(errClient);
    expect(errReady.status).toBe('read_model_unreadable');
    expect(errReady.read_model_readable).toBe(false);

    // MIXED result: one goal's jobs read succeeds, another fails. The partial
    // failure must NOT be masked as healthy (it would undercount failures).
    const controlsRow = [{ id: 'global', execution_enabled: false, owner_stop: false, paused: false, hermes_mode: 'observe_only', remote_runner_enabled: false }];
    const mixedClient: RuntimeClient = {
      from(table: string) {
        return {
          insert() { return { select() { return Promise.resolve({ data: [{ id: 'x' }], error: null }); } }; },
          select() {
            let goalId = '';
            const chain = () => ({
              eq(_c: string, v: string) { goalId = v; return chain(); },
              order() { return { limit() { return resolve(); } }; },
              limit() { return resolve(); },
            });
            const resolve = () => {
              if (table === 'system_controls') return Promise.resolve({ data: controlsRow, error: null });
              if (table === 'master_goals') return Promise.resolve({ data: [{ id: 'goal-1', status: 'running' }, { id: 'goal-2', status: 'running' }], error: null });
              if (table === 'orchestration_approvals') return Promise.resolve({ data: [], error: null });
              if (table === 'goal_jobs') {
                return goalId === 'goal-2'
                  ? Promise.resolve({ data: null, error: { message: 'permission denied' } }) // one goal's jobs unreadable
                  : Promise.resolve({ data: [{ id: 'j1', goal_id: 'goal-1', status: 'completed' }], error: null });
              }
              return Promise.resolve({ data: [], error: null });
            };
            return chain();
          },
          update() { const chain = () => ({ eq() { return chain(); }, lte() { return chain(); }, gt() { return chain(); }, select() { return Promise.resolve({ data: [], error: null }); } }); return chain(); },
        };
      },
    };
    const mixed = await loadBridgeReadiness(mixedClient);
    expect(mixed.status).toBe('read_model_unreadable'); // partial failure is NOT masked
    expect(mixed.read_model_readable).toBe(false);
    // decisive: the read model itself marks the jobs bucket 'error' on ANY
    // per-goal failure (even though goal-1's rows loaded and are retained).
    const rm = await loadOrchestrationReadModel(mixedClient);
    expect(rm.jobs.state).toBe('error');
    expect(rm.jobs.rows.length).toBeGreaterThan(0); // partial rows retained for display
  });

  it('evidence accumulates across attempts (does not replace prior refs) (#15)', async () => {
    const db = makeFakeDb();
    const intake = intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
    if (!(intake.ok && intake.kind === 'goal')) throw new Error('intake');
    await insertMasterGoal(db.client, intake.goal);
    // a ready code job that already carries evidence from a PRIOR attempt
    db.rowsOf('goal_jobs').push({
      id: 'job-0000-a', goal_id: 'goal-00000001', kind: 'code', title: 'impl', objective: 'add helper',
      risk_class: 'GREEN', assigned_role: 'claude', status: 'ready', attempts: 1, requires_approval: false,
      approval_id: null, runtime_job_id: null, correlation_id: 'corr-00000001',
      evidence_refs: ['sim:prior-attempt-evidence'], failure_reason: null, created_at: NOW, updated_at: NOW,
    });
    const lockCtx = { base_commit: 'abc1234', allowed_paths: ['apps/dashboard/src/'], token: (j: string) => `tok-${j}` };
    await driverStep(db.client, 'goal-00000001', ms(NOW) + 1000, () => [], lockCtx);
    const refs = db.rowsOf('goal_jobs')[0].evidence_refs as string[];
    expect(refs).toContain('sim:prior-attempt-evidence'); // prior evidence preserved
    expect(refs.some((r) => r.includes(':run:job-0000-a:') && r.endsWith(':completed'))).toBe(true); // new ref appended
    expect(refs.length).toBe(2);
  });

  it('a fresh driver resumes from persisted store state (reload/resume) (15)', async () => {
    const db = makeFakeDb();
    const intake = intakeCommand({ envelope: submitEnvelope(), ownerAllowlist: new Set([OWNER]), seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
    if (!(intake.ok && intake.kind === 'goal')) throw new Error('intake');
    await insertMasterGoal(db.client, intake.goal);
    const specs: TaskSpec[] = [
      { local_id: 'a', kind: 'code', title: 'a', objective: 'x', depends_on_local: [] },
      { local_id: 'b', kind: 'test', title: 'b', objective: 'y', depends_on_local: ['a'] },
    ];
    const dd = decomposeGoal(intake.goal, specs, (l) => `job-0000-${l}`, NOW);
    if (!dd.ok) throw new Error('d');
    for (const j of dd.jobs) await insertGoalJob(db.client, j);
    await transitionGoal(db.client, 'goal-00000001', 'proposed', 'decomposed', NOW);
    const depends = (id: string) => (id === 'job-0000-b' ? ['job-0000-a'] : []);
    const lockCtx = { base_commit: 'abc1234', allowed_paths: ['apps/dashboard/src/'], token: (j: string) => `tok-${j}` };
    let t = ms(NOW);
    // one step advances A, then the "process dies"; a FRESH driver reads the DB.
    await driverStep(db.client, 'goal-00000001', (t += 1000), depends, lockCtx);
    const mid = await loadGoalState(db.client, 'goal-00000001', depends);
    expect(mid!.jobs.find((j) => j.id === 'job-0000-a')!.status).toBe('completed');
    const resumed = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 200, depends, lockCtx);
    expect(resumed.reason).toBe('completed'); // (15) restart-safe resume
    expect(Number(db.rowsOf('goal_jobs').find((j) => j.id === 'job-0000-a')!.attempts)).toBe(1); // A not re-run
  });
});
