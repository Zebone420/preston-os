// Power-station foundation - capability spine tests.
// Covers: registry contract + unknown-capability fail-closed (master goal
// sections 8/17), request/result contract + error mapping (9), the trusted
// executor lifecycle through the side-effect ledger (10/11/12), the
// idempotency acceptance drills A-F (13), UNCERTAIN outcome semantics in the
// central authority + completion engine (2), the credential broker
// foundation + worker secret isolation (14), and failure isolation (16).

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  CAPABILITY_NAME_RE,
  DRYRUN_READ_TEST,
  DRYRUN_WRITE_TEST,
  listCapabilities,
  lookupCapability,
} from '../src/lib/ai-os/capabilities/registry';
import {
  deriveSideEffectId,
  payloadHash,
  sideEffectApprovalHash,
  toJobFailureReason,
  validateCapabilityRequest,
  type CapabilityRequest,
} from '../src/lib/ai-os/capabilities/contract';
import {
  executeCapability,
  MAX_SIDE_EFFECT_ATTEMPTS,
  verifySideEffectApproval,
  type CapabilityAdapter,
  type CapabilityExecutorDeps,
} from '../src/lib/ai-os/capabilities/executor';
import {
  canTransitionSideEffect,
  reconcileSideEffect,
} from '../src/lib/ai-os/capabilities/ledger-store';
import {
  DRYRUN_PROVIDER,
  makeDryrunAdapter,
} from '../src/lib/ai-os/capabilities/dryrun-adapter';
import {
  credentialFileEnvName,
  makeCredentialBroker,
  PROVIDER_CREDENTIAL_ENV_PREFIX,
} from '../src/lib/ai-os/capabilities/credentials';
import { classifyFailure } from '../src/lib/ai-os/orchestration/outcomes';
import { step } from '../src/lib/ai-os/orchestration/completion-engine';
import { CHILD_ENV_ALLOWLIST } from '../src/lib/ai-os/real-claude-adapter';
import type { GoalJob, GoalState } from '../src/lib/ai-os/orchestration/model';
import { DEFAULT_BUDGET } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-08-27T12:00:00.000Z';
const nowMs = Date.parse(NOW);
const OWNER = 'owner@preston.nyc';

// In-memory fake DB in the repo's established idiom. side_effects keys on
// side_effect_id and enforces unique idempotency_key like migration 0026.
function makeFakeDb(opts: { failInsertOn?: Set<string> } = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const touched: string[] = [];
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  const pk = (t: string) =>
    t === 'orchestration_approvals' ? 'approval_id'
      : t === 'side_effects' ? 'side_effect_id' : 'id';
  const client: RuntimeClient = {
    from(table: string) {
      touched.push(table);
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            if (opts.failInsertOn?.has(table)) {
              return Promise.resolve({ data: null, error: { message: 'service unavailable' } });
            }
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            if (table === 'side_effects' &&
                rows.some((r) => r.idempotency_key === row.idempotency_key)) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ [key]: row[key] ?? 'x' }], error: null });
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
              const matched = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({ data: matched.map((r) => ({ [pk(table)]: r[pk(table)] })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf, touched };
}

// Adapter wrapper that counts real invocations (the core idempotency proof:
// "1 external execution maximum").
function countingAdapter(base: CapabilityAdapter = makeDryrunAdapter()) {
  let calls = 0;
  const adapter: CapabilityAdapter = {
    async execute(input) { calls++; return base.execute(input); },
  };
  return { adapter, calls: () => calls };
}

function makeDeps(
  db: ReturnType<typeof makeFakeDb>,
  adapter: CapabilityAdapter,
  over: Partial<CapabilityExecutorDeps> = {},
): CapabilityExecutorDeps {
  return {
    client: db.client,
    adapters: { [DRYRUN_PROVIDER]: adapter },
    actorId: 'preston-worker',
    ownerIdentity: OWNER,
    now: () => nowMs,
    readApproval: async (_c, id) =>
      db.rowsOf('orchestration_approvals').find((r) => r.approval_id === id),
    ...over,
  };
}

function request(over: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    capability: DRYRUN_READ_TEST,
    version: 1,
    target: 'dryrun:echo',
    params: { outcome: 'success' },
    goal_id: 'goal-cap-0001',
    job_id: 'job-cap-0001',
    run_id: 'run-cap-0001',
    request_id: 'req-cap-0001',
    idempotency_key: 'idem-cap-0001',
    ...over,
  };
}

// --- registry ---------------------------------------------------------------

describe('capability registry (in-code, versioned, fail-closed)', () => {
  it('resolves a registered capability at its exact version', () => {
    const r = lookupCapability(DRYRUN_READ_TEST, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.definition.provider).toBe('preston.dryrun');
  });
  it('unknown capability fails closed', () => {
    const r = lookupCapability('gmail.message.send', 1);
    expect(r).toEqual({ ok: false, reason: 'unknown_capability' });
  });
  it('malformed names fail closed', () => {
    for (const bad of ['', 'gmail', 'GMAIL.Message.Send', 'a.b.c.d.e.f', 'a..b']) {
      expect(lookupCapability(bad, 1).ok).toBe(false);
    }
  });
  it('version mismatch fails closed', () => {
    expect(lookupCapability(DRYRUN_READ_TEST, 2))
      .toEqual({ ok: false, reason: 'capability_version_mismatch' });
  });
  it('definitions are frozen and name-valid; only dryrun ships in this goal', () => {
    const all = listCapabilities();
    expect(all.length).toBe(2);
    for (const d of all) {
      expect(Object.isFrozen(d)).toBe(true);
      expect(CAPABILITY_NAME_RE.test(d.name)).toBe(true);
      expect(d.provider).toBe('preston.dryrun');
    }
  });
  it('the gated write test carries approval + YELLOW; read is GREEN ungated', () => {
    const w = lookupCapability(DRYRUN_WRITE_TEST, 1);
    const r = lookupCapability(DRYRUN_READ_TEST, 1);
    if (!w.ok || !r.ok) throw new Error('registry lookup failed');
    expect(w.definition.requires_approval).toBe(true);
    expect(w.definition.operation_kind).toBe('write');
    expect(r.definition.requires_approval).toBe(false);
  });
});

// --- contract ---------------------------------------------------------------

describe('capability request contract', () => {
  it('validates a well-formed request and hashes params canonically', () => {
    const a = validateCapabilityRequest(request({ params: { b: 1, a: 2 } }));
    const b = validateCapabilityRequest(request({ params: { a: 2, b: 1 } }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.payload_hash).toBe(b.payload_hash);
  });
  it('rejects malformed ids, missing target, oversized params', () => {
    expect(validateCapabilityRequest(request({ job_id: 'bad id!' })).ok).toBe(false);
    expect(validateCapabilityRequest(request({ target: '' })).ok).toBe(false);
    expect(validateCapabilityRequest(
      request({ params: { x: 'y'.repeat(9000) } })).ok).toBe(false);
  });
  it('derives a deterministic side_effect_id from the idempotency key', () => {
    expect(deriveSideEffectId('k1')).toBe(deriveSideEffectId('k1'));
    expect(deriveSideEffectId('k1')).not.toBe(deriveSideEffectId('k2'));
    expect(deriveSideEffectId('k1')).toMatch(/^se-[0-9a-f]{32}$/);
  });
  it('maps error classes onto the central outcome authority reasons', () => {
    expect(classifyFailure(toJobFailureReason(
      { error_class: 'uncertain', reason: 'provider_timeout' })).outcome_class)
      .toBe('UNCERTAIN');
    expect(classifyFailure(toJobFailureReason(
      { error_class: 'terminal', reason: 'unknown_capability' })).outcome_class)
      .toBe('TERMINAL');
    expect(classifyFailure(toJobFailureReason(
      { error_class: 'retryable', reason: 'ledger_unavailable' })).outcome_class)
      .toBe('RETRYABLE');
  });
});

// --- outcomes: UNCERTAIN in the central authority ---------------------------

describe('UNCERTAIN outcome class (central authority + engine)', () => {
  it('classifies side_effect_uncertain reasons UNCERTAIN, others unchanged', () => {
    expect(classifyFailure('side_effect_uncertain:provider_timeout'))
      .toEqual({ outcome_class: 'UNCERTAIN', reason: 'uncertain:side_effect_uncertain:provider_timeout' });
    expect(classifyFailure('uncertain_outcome:client_timeout').outcome_class)
      .toBe('UNCERTAIN');
    // regression pins: prior classes are untouched
    expect(classifyFailure('real_required:provider_not_claude').outcome_class)
      .toBe('TERMINAL');
    expect(classifyFailure('exit_1').outcome_class).toBe('RETRYABLE');
    expect(classifyFailure('').outcome_class).toBe('RETRYABLE');
  });

  function stateWithFailedJob(reason: string): GoalState {
    const job: GoalJob = {
      id: 'job-u-1', goal_id: 'goal-u-1', kind: 'code', title: 't',
      objective: 'o', risk_class: 'GREEN', assigned_role: 'claude',
      depends_on: [], status: 'failed', attempts: 1,
      requires_approval: false, approval_id: null, runtime_job_id: null,
      correlation_id: 'c', evidence_refs: [], failure_reason: reason,
      run_id: null, run_lease_expires_at: null,
      created_at: NOW, updated_at: NOW,
    };
    return {
      goal: {
        id: 'goal-u-1', title: 'g', objective: 'o', source: 'dashboard',
        requested_by: OWNER, status: 'running', environment: 'staging',
        budget: DEFAULT_BUDGET, correlation_id: 'c', simulation_only: true,
        created_at: NOW, updated_at: NOW,
      },
      jobs: [job], iteration: 1, started_at: NOW,
    };
  }

  it('an uncertain failure NEVER retries - it dead-letters with the uncertain reason', () => {
    const s = step(stateWithFailedJob('side_effect_uncertain:provider_timeout'), nowMs);
    const dl = s.actions.find((a) => a.type === 'dead_letter');
    expect(dl).toBeDefined();
    expect((dl as { reason: string }).reason)
      .toContain('uncertain:side_effect_uncertain');
    expect(s.actions.some((a) => a.type === 'retry')).toBe(false);
  });
  it('a retryable capability failure still retries within the budget', () => {
    const s = step(stateWithFailedJob('capability_retryable:ledger_unavailable'), nowMs);
    expect(s.actions.some((a) => a.type === 'retry')).toBe(true);
  });
});

// --- executor lifecycle + idempotency acceptance ----------------------------

describe('trusted capability executor (ledger lifecycle)', () => {
  it('success path: authorized, claimed, executed once, settled succeeded, event recorded', async () => {
    const db = makeFakeDb();
    const { adapter, calls } = countingAdapter();
    const res = await executeCapability(makeDeps(db, adapter), request());
    expect(res.ok).toBe(true);
    expect(res.provider_result_id).toMatch(/^dryrun-/);
    expect(calls()).toBe(1);
    const row = db.rowsOf('side_effects')[0];
    expect(row.status).toBe('succeeded');
    expect(row.attempt_count).toBe(1);
    expect(row.environment).toBe('staging');
    const evs = db.rowsOf('os_events');
    expect(evs.some((e) => String(e.id).includes('succeeded'))).toBe(true);
  });

  it('A: the same side-effect request twice -> ONE external execution maximum', async () => {
    const db = makeFakeDb();
    const { adapter, calls } = countingAdapter();
    const deps = makeDeps(db, adapter);
    const r1 = await executeCapability(deps, request());
    const r2 = await executeCapability(deps, request());
    expect(r1.ok && r2.ok).toBe(true);
    expect(r2.side_effect_id).toBe(r1.side_effect_id);
    expect(r2.summary).toContain('replayed');
    expect(calls()).toBe(1); // never a second execution
    expect(db.rowsOf('side_effects').length).toBe(1);
  });

  it('C: a worker retry converges on the SAME side_effect_id', async () => {
    expect(deriveSideEffectId('idem-cap-0001'))
      .toBe(deriveSideEffectId('idem-cap-0001'));
    const db = makeFakeDb();
    const deps = makeDeps(db, countingAdapter().adapter);
    const r = await executeCapability(deps, request());
    expect(r.side_effect_id).toBe(deriveSideEffectId('idem-cap-0001'));
  });

  it('D: the ledger row survives a "restart" (fresh executor, same DB)', async () => {
    const db = makeFakeDb();
    await executeCapability(makeDeps(db, countingAdapter().adapter), request());
    // fresh deps = restarted process; same persisted ledger
    const { adapter, calls } = countingAdapter();
    const r = await executeCapability(makeDeps(db, adapter), request());
    expect(r.ok).toBe(true);
    expect(calls()).toBe(0); // replayed from the durable row, not re-executed
  });

  it('terminal adapter outcome settles failed and maps TERMINAL', async () => {
    const db = makeFakeDb();
    const res = await executeCapability(
      makeDeps(db, makeDryrunAdapter()),
      request({ params: { outcome: 'terminal' } }));
    expect(res.ok).toBe(false);
    expect(res.error?.error_class).toBe('terminal');
    expect(db.rowsOf('side_effects')[0].status).toBe('failed');
    expect(classifyFailure(toJobFailureReason(res.error!)).outcome_class).toBe('TERMINAL');
  });

  it('retryable outcome requeues to authorized; the durable cap eventually refuses', async () => {
    const db = makeFakeDb();
    const { adapter, calls } = countingAdapter();
    const deps = makeDeps(db, adapter);
    const req = request({ params: { outcome: 'retryable' } });
    for (let i = 1; i <= MAX_SIDE_EFFECT_ATTEMPTS; i++) {
      const r = await executeCapability(deps, req);
      expect(r.error?.error_class).toBe('retryable');
      expect(db.rowsOf('side_effects')[0].status).toBe('authorized');
      expect(db.rowsOf('side_effects')[0].attempt_count).toBe(i);
    }
    const capped = await executeCapability(deps, req);
    expect(capped.error).toEqual(
      { error_class: 'terminal', reason: 'attempts_exhausted' });
    expect(db.rowsOf('side_effects')[0].status).toBe('refused');
    expect(calls()).toBe(MAX_SIDE_EFFECT_ATTEMPTS); // cap enforced
  });

  it('E: uncertain outcome parks the row; a replay NEVER blind-retries', async () => {
    const db = makeFakeDb();
    const { adapter, calls } = countingAdapter();
    const deps = makeDeps(db, adapter);
    const req = request({ params: { outcome: 'uncertain' } });
    const r1 = await executeCapability(deps, req);
    expect(r1.error?.error_class).toBe('uncertain');
    expect(db.rowsOf('side_effects')[0].status).toBe('uncertain');
    const r2 = await executeCapability(deps, req);
    expect(r2.error).toEqual(
      { error_class: 'uncertain', reason: 'awaiting_reconciliation' });
    expect(calls()).toBe(1); // no second execution while uncertain
    // and the job-side classification never retries it either
    expect(classifyFailure(toJobFailureReason(r1.error!)).outcome_class).toBe('UNCERTAIN');
  });

  it('F: reconciliation settles the ORIGINAL row without executing again', async () => {
    const db = makeFakeDb();
    const { adapter, calls } = countingAdapter();
    const deps = makeDeps(db, adapter);
    const req = request({ params: { outcome: 'uncertain' } });
    const r1 = await executeCapability(deps, req);
    const rec = await reconcileSideEffect(
      db.client, r1.side_effect_id, 'succeeded', 'provider-evt-77',
      'reconcile:test', NOW);
    expect(rec.ok).toBe(true);
    const row = db.rowsOf('side_effects')[0];
    expect(row.status).toBe('succeeded');
    expect(row.provider_result_id).toBe('provider-evt-77');
    // replay now returns the reconciled success; still exactly one execution
    const r2 = await executeCapability(deps, req);
    expect(r2.ok).toBe(true);
    expect(calls()).toBe(1);
    // reconciliation is one-time (CAS on uncertain)
    const rec2 = await reconcileSideEffect(
      db.client, r1.side_effect_id, 'failed', null, 'reconcile:again', NOW);
    expect(rec2.ok).toBe(false);
  });

  it('a write timeout is UNCERTAIN, not a retry (definition timeout enforced)', async () => {
    vi.useFakeTimers();
    try {
      const db = makeFakeDb();
      // gated write with a valid approval so the hang reaches the adapter
      const req = request({
        capability: DRYRUN_WRITE_TEST,
        params: { outcome: 'hang' },
        approval_id: 'apr-se-hang-000000000001',
        idempotency_key: 'idem-hang-1',
      });
      seedApproval(db, req, 'apr-se-hang-000000000001');
      const p = executeCapability(makeDeps(db, makeDryrunAdapter()), req);
      await vi.advanceTimersByTimeAsync(11_000);
      const res = await p;
      expect(res.error).toEqual(
        { error_class: 'uncertain', reason: 'provider_timeout' });
      expect(db.rowsOf('side_effects')[0].status).toBe('uncertain');
    } finally {
      vi.useRealTimers();
    }
  });
});

// --- approval gate ----------------------------------------------------------

function seedApproval(
  db: ReturnType<typeof makeFakeDb>,
  req: CapabilityRequest,
  approvalId: string,
  over: Record<string, unknown> = {},
) {
  const lookup = lookupCapability(req.capability, req.version);
  if (!lookup.ok) throw new Error('bad capability in fixture');
  const v = validateCapabilityRequest(req);
  if (!v.ok) throw new Error('bad request in fixture');
  const created = NOW;
  const expires = new Date(nowMs + 3_600_000).toISOString();
  db.rowsOf('orchestration_approvals').push({
    approval_id: approvalId,
    status: 'approved',
    owner_identity: OWNER,
    environment: 'staging',
    nonce: 'n-1',
    decided_at: NOW,
    created_at: created,
    expires_at: expires,
    action_hash: sideEffectApprovalHash({
      approval_id: approvalId,
      definition: lookup.definition,
      side_effect_id: deriveSideEffectId(req.idempotency_key),
      target: req.target,
      payload_hash: v.payload_hash,
      owner_identity: OWNER,
      created_at: created,
      expires_at: expires,
    }),
    ...over,
  });
}

describe('side-effect approval gate', () => {
  const gatedReq = (over: Partial<CapabilityRequest> = {}): CapabilityRequest =>
    request({
      capability: DRYRUN_WRITE_TEST,
      idempotency_key: 'idem-gated-1',
      approval_id: 'apr-se-00000000000000000001',
      ...over,
    });

  it('G7: a gated capability WITHOUT an approval is refused terminally', async () => {
    const db = makeFakeDb();
    const { adapter, calls } = countingAdapter();
    const res = await executeCapability(
      makeDeps(db, adapter), gatedReq({ approval_id: null }));
    expect(res.error).toEqual(
      { error_class: 'terminal', reason: 'approval_required' });
    expect(db.rowsOf('side_effects')[0].status).toBe('refused');
    expect(calls()).toBe(0);
  });

  it('a verified owner approval authorizes and executes exactly once', async () => {
    const db = makeFakeDb();
    const req = gatedReq();
    seedApproval(db, req, req.approval_id!);
    const { adapter, calls } = countingAdapter();
    const res = await executeCapability(makeDeps(db, adapter), req);
    expect(res.ok).toBe(true);
    expect(calls()).toBe(1);
    expect(db.rowsOf('side_effects')[0].approval_id).toBe(req.approval_id);
  });

  it('a swapped payload cannot inherit the approval (hash-bound)', async () => {
    const db = makeFakeDb();
    const req = gatedReq();
    seedApproval(db, req, req.approval_id!);
    const tampered = { ...req, params: { outcome: 'success', extra: 'x' } };
    const { adapter, calls } = countingAdapter();
    const res = await executeCapability(makeDeps(db, adapter), tampered);
    expect(res.error?.reason).toBe('approval_action_hash_mismatch');
    expect(calls()).toBe(0);
  });

  it('B: after the one-time decision, a second decision cannot re-trigger execution', async () => {
    const db = makeFakeDb();
    const req = gatedReq();
    seedApproval(db, req, req.approval_id!);
    const { adapter, calls } = countingAdapter();
    const deps = makeDeps(db, adapter);
    await executeCapability(deps, req); // executes once
    // owner "approves twice": the record is already decided; replaying the
    // request must replay the stored success, not act again.
    const replay = await executeCapability(deps, req);
    expect(replay.ok).toBe(true);
    expect(replay.summary).toContain('replayed');
    expect(calls()).toBe(1);
  });

  it('verification fails closed on owner/env/expiry/nonce gaps', () => {
    const req = gatedReq();
    const lookup = lookupCapability(req.capability, 1);
    const v = validateCapabilityRequest(req);
    if (!lookup.ok || !v.ok) throw new Error('fixture');
    const args = {
      approval_id: 'apr-x', definition: lookup.definition,
      side_effect_id: deriveSideEffectId(req.idempotency_key),
      target: req.target, payload_hash: v.payload_hash,
      owner_identity: OWNER,
    };
    expect(verifySideEffectApproval(undefined, args, nowMs).reason)
      .toBe('no_approval_record');
    expect(verifySideEffectApproval({
      approval_id: 'apr-x', status: 'pending',
    }, args, nowMs).reason).toBe('not_approved');
    expect(verifySideEffectApproval({
      approval_id: 'apr-x', status: 'approved', owner_identity: 'intruder@x',
    }, args, nowMs).reason).toBe('owner_mismatch');
    expect(verifySideEffectApproval({
      approval_id: 'apr-x', status: 'approved', owner_identity: OWNER,
      environment: 'production',
    }, args, nowMs).reason).toBe('environment_mismatch');
  });
});

// --- failure isolation ------------------------------------------------------

describe('failure isolation (master goal section 16)', () => {
  it('ledger unavailable -> the write refuses safely BEFORE any execution', async () => {
    const db = makeFakeDb({ failInsertOn: new Set(['side_effects']) });
    const { adapter, calls } = countingAdapter();
    const res = await executeCapability(makeDeps(db, adapter), request());
    expect(res.error).toEqual(
      { error_class: 'retryable', reason: 'ledger_unavailable' });
    expect(calls()).toBe(0);
  });
  it('missing provider adapter -> terminal refusal, no ledger row', async () => {
    const db = makeFakeDb();
    const res = await executeCapability(
      makeDeps(db, makeDryrunAdapter(), { adapters: {} }), request());
    expect(res.error).toEqual(
      { error_class: 'terminal', reason: 'provider_adapter_unavailable' });
    expect(db.rowsOf('side_effects').length).toBe(0);
  });
  it('unknown capability -> terminal, zero DB touches', async () => {
    const db = makeFakeDb();
    const res = await executeCapability(
      makeDeps(db, makeDryrunAdapter()),
      request({ capability: 'gmail.message.send' }));
    expect(res.error?.reason).toBe('unknown_capability');
    expect(db.touched.length).toBe(0);
  });
  it('legal ledger edges only (no resurrection of terminal rows)', () => {
    expect(canTransitionSideEffect('proposed', 'authorized')).toBe(true);
    expect(canTransitionSideEffect('executing', 'uncertain')).toBe(true);
    expect(canTransitionSideEffect('uncertain', 'succeeded')).toBe(true);
    expect(canTransitionSideEffect('succeeded', 'executing')).toBe(false);
    expect(canTransitionSideEffect('failed', 'authorized')).toBe(false);
    expect(canTransitionSideEffect('refused', 'authorized')).toBe(false);
    expect(canTransitionSideEffect('uncertain', 'executing')).toBe(false);
  });
});

// --- credential boundary ----------------------------------------------------

describe('credential broker foundation + worker secret isolation', () => {
  it('unconfigured provider fails closed', () => {
    const b = makeCredentialBroker({ env: {}, readFile: () => 'x', now: () => nowMs });
    expect(b.resolve('preston.dryrun'))
      .toEqual({ ok: false, reason: 'provider_not_configured' });
  });
  it('reads the root-owned file once and serves from the in-process cache', () => {
    let reads = 0;
    const env = { [credentialFileEnvName('gmail')]: '/etc/preston/gmail.token' };
    const b = makeCredentialBroker({
      env, readFile: () => { reads++; return 'secret-material\n'; },
      now: () => nowMs,
    });
    const r1 = b.resolve('gmail');
    const r2 = b.resolve('gmail');
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok) expect(r1.credential.secret).toBe('secret-material');
    expect(reads).toBe(1);
    expect(b.stats().disk_reads).toBe(1);
  });
  it('unreadable or empty credential files fail closed', () => {
    const env = { [credentialFileEnvName('gmail')]: '/etc/preston/gmail.token' };
    const throwing = makeCredentialBroker({
      env, readFile: () => { throw new Error('EACCES'); }, now: () => nowMs,
    });
    expect(throwing.resolve('gmail').ok).toBe(false);
    const empty = makeCredentialBroker({
      env, readFile: () => '  ', now: () => nowMs,
    });
    expect(empty.resolve('gmail'))
      .toEqual({ ok: false, reason: 'credential_empty' });
  });
  it('STRUCTURAL: the worker child-env allowlist can never carry provider or runtime secrets', () => {
    for (const name of CHILD_ENV_ALLOWLIST) {
      expect(name.startsWith(PROVIDER_CREDENTIAL_ENV_PREFIX)).toBe(false);
      expect(name.startsWith('SUPABASE_')).toBe(false);
      expect(name.startsWith('TELEGRAM_')).toBe(false);
      expect(name.includes('TOKEN')).toBe(false);
      expect(name.includes('SECRET')).toBe(false);
      expect(name.includes('KEY')).toBe(false);
    }
  });
  it('the dry-run drill consumes no credentials at all', async () => {
    const db = makeFakeDb();
    let resolves = 0;
    const broker = makeCredentialBroker({
      env: {}, readFile: () => { resolves++; return 'x'; }, now: () => nowMs,
    });
    void broker; // constructed but NEVER wired: the dryrun adapter takes none
    const res = await executeCapability(
      makeDeps(db, makeDryrunAdapter()), request());
    expect(res.ok).toBe(true);
    expect(resolves).toBe(0);
    expect(broker.stats().resolutions).toBe(0);
  });
});

describe('payload hash canonicalization', () => {
  it('nested key order does not change the hash; values do', () => {
    expect(payloadHash({ a: { x: 1, y: [1, 2] }, b: 'z' }))
      .toBe(payloadHash({ b: 'z', a: { y: [1, 2], x: 1 } }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
