import { describe, expect, it } from 'vitest';
import type { AuditSink } from '../src/lib/audit';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  cancelJob,
  enqueueStagingJob,
  readStatus,
  requestControl,
  submitCommandProposal,
  type CancelJobInput,
  type ControlPlaneDeps,
  type EnqueueInput,
  type SubmitInput,
} from '../src/lib/ai-os/controlplane';

const NOW = '2026-07-14T12:00:00.000Z';
const OWNER_ENV = { OWNER_EMAIL_ALLOWLIST: 'info@preston.nyc' };

interface AuditCall {
  action: string;
  action_class?: string;
}

function deps(writeResult: QueryResult, controlsRow?: Record<string, unknown>, packetRow?: Record<string, unknown>): {
  deps: ControlPlaneDeps;
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  audits: AuditCall[];
} {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const audits: AuditCall[] = [];
  const client: RuntimeClient = {
    from(table: string) {
      // Table-aware reads: the command-packet lookup returns packetRow; every
      // other eq/limit read returns the controls row.
      const readRows = async () => ({
        data: table === 'runtime_command_packets'
          ? (packetRow ? [packetRow] : [])
          : (controlsRow ? [controlsRow] : []),
        error: null,
      });
      return {
        insert(row: Record<string, unknown>) {
          if (table !== 'audit_log') inserts.push(row);
          return { select: async () => writeResult };
        },
        select() {
          type EqNode = { limit: typeof readRows; eq: () => EqNode; order: () => { limit: typeof readRows } };
          const eqNode: EqNode = { limit: readRows, eq: () => eqNode, order: () => ({ limit: readRows }) };
          return {
            eq: () => eqNode,
            order: () => ({ limit: async () => writeResult }),
            limit: readRows,
          };
        },
        update(row: Record<string, unknown>) {
          if (table !== 'audit_log') updates.push(row);
          type Node = { select: () => Promise<QueryResult>; eq: () => Node; lte: () => Node; gt: () => Node };
          const node: Node = { select: async () => writeResult, eq: () => node, lte: () => node, gt: () => node };
          return node;
        },
      };
    },
  };
  // Audit sink captures the row's action.
  const audit: AuditSink = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          audits.push({ action: String(row['action']), action_class: String(row['action_class']) });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { deps: { client, audit, env: OWNER_ENV, now: NOW }, inserts, updates, audits };
}

const baseInput = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  ownerEmail: 'info@preston.nyc', source: 'chatgpt', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os', correlation_id: 'corr',
  idempotency_key: 'idem-1', commandId: 'cmd-1', ...over,
});

describe('control-plane - submit command proposal', () => {
  it('denies a non-owner', async () => {
    const { deps: d } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput({ ownerEmail: 'attacker@x.com' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('denied');
  });

  it('accepts an owner proposal, writes it, and audits it', async () => {
    const { deps: d, inserts, audits } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('proposed');
    expect(inserts[0].execution_eligible).toBe(false); // default-deny persisted
    expect(audits.some((a) => a.action === 'command_proposed')).toBe(true);
  });

  it('rejects a production target and audits the rejection', async () => {
    const { deps: d, inserts, audits } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput({ target_project: 'preston-production' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('production_rejected');
    expect(inserts.length).toBe(0); // nothing written to the command table
    expect(audits.some((a) => a.action.includes('production_target'))).toBe(true);
  });

  it('rejects a production requested_action even with a benign target', async () => {
    const { deps: d, inserts } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput({ requested_action: 'deploy to production' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('production_rejected');
    expect(inserts.length).toBe(0);
  });
});

const CMD_UUID = '11111111-2222-4333-8444-555555555555';
const APPROVAL_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GREEN_PACKET = {
  id: CMD_UUID, action_class: 'GREEN', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os',
};
const okWrite: QueryResult = { data: [{ id: 'j-1' }], error: null };
const einput = (over: Partial<EnqueueInput> = {}): EnqueueInput => ({
  ownerEmail: 'info@preston.nyc', jobId: 'j-1', command_id: CMD_UUID, approval_id: APPROVAL_UUID,
  correlation_id: 'corr', idempotency_key: 'idem-1', ...over,
});

describe('control-plane - enqueue staging job (queue-only, Phase 5D)', () => {
  it('denies a non-owner (audited) and validates required fields', async () => {
    const { deps: d, audits } = deps(okWrite, undefined, GREEN_PACKET);
    expect((await enqueueStagingJob(d, einput({ ownerEmail: 'attacker@x.com' }))).code).toBe('denied');
    expect(audits.some((a) => a.action === 'job_enqueue_rejected:denied')).toBe(true);
    expect((await enqueueStagingJob(d, einput({ command_id: '' }))).code).toBe('invalid');
    expect((await enqueueStagingJob(d, einput({ approval_id: '' }))).code).toBe('invalid');
    expect((await enqueueStagingJob(d, einput({ idempotency_key: '' }))).code).toBe('invalid');
  });

  it('rejects malformed ids and unbounded priority BEFORE any DB write (clean message, no raw DB error)', async () => {
    const { deps: d, inserts } = deps(okWrite, undefined, GREEN_PACKET);
    expect((await enqueueStagingJob(d, einput({ command_id: 'not-a-uuid' }))).code).toBe('invalid');
    expect((await enqueueStagingJob(d, einput({ approval_id: 'a1' }))).code).toBe('invalid');
    expect((await enqueueStagingJob(d, einput({ priority: 2.5 }))).code).toBe('invalid');
    expect((await enqueueStagingJob(d, einput({ priority: 10_000_000 }))).code).toBe('invalid');
    expect(inserts.length).toBe(0);
  });

  it('refuses an unknown command packet and a non-GREEN one', async () => {
    const { deps: none } = deps(okWrite, undefined, undefined);
    expect((await enqueueStagingJob(none, einput())).code).toBe('unknown_command');
    const { deps: yellow } = deps(okWrite, undefined, { ...GREEN_PACKET, action_class: 'YELLOW' });
    expect((await enqueueStagingJob(yellow, einput())).code).toBe('not_green');
  });

  it('rejects a production-marked packet with a RED audit entry', async () => {
    const { deps: d, inserts, audits } = deps(okWrite, undefined, { ...GREEN_PACKET, target_project: 'preston-production' });
    const r = await enqueueStagingJob(d, einput());
    expect(r.code).toBe('production_rejected');
    expect(inserts.length).toBe(0);
    expect(audits.some((a) => a.action.includes('production_target') && a.action_class === 'RED')).toBe(true);
  });

  it('queues with the forced fail-closed posture and audits it', async () => {
    const { deps: d, inserts, audits } = deps(okWrite, undefined, GREEN_PACKET);
    const r = await enqueueStagingJob(d, einput());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('queued');
    expect(inserts[0]).toMatchObject({
      status: 'queued', execution_enabled: false, cancel_requested: false,
      attempts: 0, risk_class: 'GREEN', approval_id: APPROVAL_UUID,
    });
    expect(audits.some((a) => a.action === 'job_enqueued')).toBe(true);
  });

  it('dedupes a replayed idempotency key: no second job is created', async () => {
    const dupWrite: QueryResult = { data: null, error: { message: 'duplicate key value violates unique constraint' } };
    const { deps: d } = deps(dupWrite, undefined, GREEN_PACKET);
    const r = await enqueueStagingJob(d, einput());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('duplicate');
    expect(r.id).toBeUndefined();
  });
});

describe('control-plane - owner controls', () => {
  it('denies pause/resume/stop for a non-owner', async () => {
    const { deps: d } = deps({ data: [{ id: 'global' }], error: null });
    expect((await requestControl(d, 'attacker@x.com', 'stop')).ok).toBe(false);
  });

  it('applies stop (owner_stop + paused) with an audit entry', async () => {
    const { deps: d, audits } = deps({ data: [{ id: 'global' }], error: null });
    const r = await requestControl(d, 'info@preston.nyc', 'stop');
    expect(r.ok).toBe(true);
    expect(audits.some((a) => a.action === 'control:stop')).toBe(true);
  });

  it('resume clears paused+owner_stop but NEVER touches execution or runner flags', async () => {
    const { deps: d, updates } = deps({ data: [{ id: 'global' }], error: null });
    const r = await requestControl(d, 'info@preston.nyc', 'resume');
    expect(r.ok).toBe(true);
    const patch = updates[0];
    expect(patch['paused']).toBe(false);
    expect(patch['owner_stop']).toBe(false);
    // The "installed/resumed is never live" invariant: resume must not include
    // these keys at all, so it can never re-enable execution.
    expect('execution_enabled' in patch).toBe(false);
    expect('remote_runner_enabled' in patch).toBe(false);
    expect('hermes_mode' in patch).toBe(false);
  });

  it('reports failure when the control update matches no row (unseeded singleton)', async () => {
    const { deps: d, audits } = deps({ data: [], error: null });
    const r = await requestControl(d, 'info@preston.nyc', 'stop');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('write_failed');
    expect(audits.length).toBe(0); // no success audit for a write that changed nothing
  });

  it('readStatus fails closed to fully-stopped when no controls row', async () => {
    const { deps: d } = deps({ data: [], error: null });
    const s = await readStatus(d);
    expect(s.execution_enabled).toBe(false);
    expect(s.hermes_mode).toBe('disabled');
    expect(s.remote_runner_enabled).toBe(false);
  });

  it('denies kill for a non-owner', async () => {
    const { deps: d } = deps({ data: [{ id: 'global' }], error: null });
    expect((await requestControl(d, 'attacker@x.com', 'kill')).ok).toBe(false);
  });

  it('kill sets owner_stop+paused (same hard-halt patch as stop) and audits it RED', async () => {
    const { deps: d, updates, audits } = deps({ data: [{ id: 'global' }], error: null });
    const r = await requestControl(d, 'info@preston.nyc', 'kill');
    expect(r.ok).toBe(true);
    expect(r.code).toBe('kill');
    const patch = updates[0];
    expect(patch['owner_stop']).toBe(true);
    expect(patch['paused']).toBe(true);
    expect(audits.some((a) => a.action === 'control:kill' && a.action_class === 'RED')).toBe(true);
  });

  it('kill NEVER touches execution_enabled/remote_runner_enabled/hermes_mode', async () => {
    const { deps: d, updates } = deps({ data: [{ id: 'global' }], error: null });
    await requestControl(d, 'info@preston.nyc', 'kill');
    const patch = updates[0];
    expect('execution_enabled' in patch).toBe(false);
    expect('remote_runner_enabled' in patch).toBe(false);
    expect('hermes_mode' in patch).toBe(false);
  });
});

// --- cancelJob (Phase 5J owner job-cancel control) --------------------------

const JOB_UUID = '22222222-3333-4444-8555-666666666666';

// Dedicated fake client: cancelJob needs a job-row READ (to detect an already
// cancel_requested job idempotently) followed by a conditional UPDATE (the
// store's per-status CAS loop) - the shared deps() helper above only models
// one shared write outcome per call and isn't eq-value-aware, so this models
// both independently: `jobRow` backs every select, `updateMatches` decides
// whether the store's CAS loop finds a matching row on its update attempts.
function cancelDeps(
  jobRow: Record<string, unknown> | null,
  updateMatches: boolean,
): { deps: ControlPlaneDeps; updates: Record<string, unknown>[]; audits: AuditCall[] } {
  const updates: Record<string, unknown>[] = [];
  const audits: AuditCall[] = [];
  const client: RuntimeClient = {
    from() {
      type SelectNode = { limit: () => Promise<QueryResult>; eq: () => SelectNode; order: () => { limit: () => Promise<QueryResult> } };
      const selectResult = async (): Promise<QueryResult> => ({ data: jobRow ? [jobRow] : [], error: null });
      const selectNode: SelectNode = { limit: selectResult, eq: () => selectNode, order: () => ({ limit: selectResult }) };
      type UpdateNode = { select: () => Promise<QueryResult>; eq: () => UpdateNode; lte: () => UpdateNode; gt: () => UpdateNode };
      return {
        insert() {
          return { select: async (): Promise<QueryResult> => ({ data: null, error: null }) };
        },
        select() {
          return selectNode;
        },
        update(row: Record<string, unknown>) {
          updates.push(row);
          const updateResult = async (): Promise<QueryResult> =>
            updateMatches ? { data: [{ id: String(jobRow?.['id'] ?? JOB_UUID) }], error: null } : { data: [], error: null };
          const node: UpdateNode = { select: updateResult, eq: () => node, lte: () => node, gt: () => node };
          return node;
        },
      };
    },
  };
  const audit: AuditSink = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          audits.push({ action: String(row['action']), action_class: String(row['action_class']) });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { deps: { client, audit, env: OWNER_ENV, now: NOW }, updates, audits };
}

const cinput = (over: Partial<CancelJobInput> = {}): CancelJobInput => ({
  ownerEmail: 'info@preston.nyc', jobId: JOB_UUID, correlation_id: 'corr-cancel-1', ...over,
});

describe('control-plane - cancelJob (Phase 5J)', () => {
  it('rejects a non-owner', async () => {
    const { deps: d, audits } = cancelDeps({ id: JOB_UUID, status: 'queued', cancel_requested: false }, true);
    const r = await cancelJob(d, cinput({ ownerEmail: 'attacker@x.com' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('denied');
    expect(audits.length).toBe(0);
  });

  it('rejects a malformed job_id (not a uuid) before any DB read', async () => {
    const { deps: d } = cancelDeps(null, true);
    const r = await cancelJob(d, cinput({ jobId: 'not-a-uuid' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid');
  });

  it('rejects a malformed correlation_id (bad shape) before any DB read', async () => {
    const { deps: d } = cancelDeps(null, true);
    const r = await cancelJob(d, cinput({ correlation_id: 'short' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid');
  });

  it('fails for an unknown job', async () => {
    const { deps: d } = cancelDeps(null, true);
    const r = await cancelJob(d, cinput());
    expect(r.ok).toBe(false);
    expect(r.code).toBe('unknown_job');
  });

  it('happy path: flags cancel_requested and audits YELLOW', async () => {
    const { deps: d, updates, audits } = cancelDeps({ id: JOB_UUID, status: 'queued', cancel_requested: false }, true);
    const r = await cancelJob(d, cinput());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('cancel_requested');
    expect(updates[0]['cancel_requested']).toBe(true);
    expect(audits.some((a) => a.action === 'job_cancel_requested' && a.action_class === 'YELLOW')).toBe(true);
  });

  it('is idempotent: an already cancel_requested job returns ok/already without a second audit or update', async () => {
    const { deps: d, updates, audits } = cancelDeps({ id: JOB_UUID, status: 'queued', cancel_requested: true }, true);
    const r = await cancelJob(d, cinput());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('already_requested');
    expect(updates.length).toBe(0);
    expect(audits.length).toBe(0);
  });

  it('fails closed when the job is not in a cancellable state', async () => {
    const { deps: d } = cancelDeps({ id: JOB_UUID, status: 'done', cancel_requested: false }, false);
    const r = await cancelJob(d, cinput());
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not_cancellable');
  });
});
