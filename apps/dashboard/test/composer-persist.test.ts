import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TTL_MS,
  confirmComposedRequest,
  deterministicUuid,
  payloadDigest,
} from '../src/lib/ai-os/orchestration/composer-persist';
import { composeRequest } from '../src/lib/ai-os/orchestration/composer';
import { makeComposerFakeDb } from './composer-fake-db';

// Composer PERSISTENCE tests: the owner-confirmation boundary. Idempotent
// (derived ids + the atomic RPC's id/correlation check), payload-bound
// (same key + different payload rejected), rollback-safe (RPC atomicity for
// the graph; compensating cancellation for post-graph approval failures).
// Everything persisted is simulation-only staging state; nothing executes.

const OWNER = 'info@preston.nyc';
const NOW = '2026-07-28T15:00:00.000Z';
const KEY = 'cmpreq-00000000-1111-4222-8333-444444444444';

const SAFE_REQUEST =
  'Create a staging-only goal to verify the Phase 7 dashboard status page. ' +
  'Create tasks to inspect the staging status data, generate a ' +
  'simulation-only readiness summary, and attach internal evidence.';

const GATED_REQUEST =
  'Create a staging-only goal to prepare a schema note. ' +
  'Create tasks to draft a schema migration plan for owner review, ' +
  'and summarize the plan in a local report.';

function hashOf(request: string): string {
  const r = composeRequest(request);
  if (!r.ok) throw new Error('compose failed: ' + r.errors.join(','));
  return r.proposal_hash;
}

function confirmInput(request: string, over: Partial<{
  requestKey: string; presentedHash: string; now: string; ownerEmail: string;
}> = {}) {
  return {
    ownerEmail: over.ownerEmail ?? OWNER,
    rawRequest: request,
    requestKey: over.requestKey ?? KEY,
    presentedHash: over.presentedHash ?? hashOf(request),
    now: over.now ?? NOW,
  };
}

describe('composer persistence - identifiers', () => {
  it('derives stable uuid-shaped ids from a seed', () => {
    const a = deterministicUuid('seed-1');
    const b = deterministicUuid('seed-1');
    const c = deterministicUuid('seed-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('payload digest binds semantic content', () => {
    const a = composeRequest(SAFE_REQUEST);
    const b = composeRequest(GATED_REQUEST);
    if (!a.ok || !b.ok) throw new Error('compose failed');
    expect(payloadDigest(a.goals)).toMatch(/^[0-9a-f]{12}$/);
    expect(payloadDigest(a.goals)).not.toBe(payloadDigest(b.goals));
  });
});

describe('composer persistence - creation', () => {
  it('creates exactly one goal graph with jobs, edges, and no approvals for all-GREEN', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client, confirmInput(SAFE_REQUEST));
    if (!out.ok) throw new Error('confirm failed: ' + out.errors.join(','));
    expect(out.replayed).toBe(false);
    expect(out.created).toHaveLength(1);
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    expect(db.rowsOf('goal_jobs')).toHaveLength(3);
    expect(db.rowsOf('orchestration_approvals')).toHaveLength(0);
    const g = db.rowsOf('master_goals')[0];
    expect(g.simulation_only).toBe(true);
    expect(g.environment).toBe('staging');
    expect(g.status).toBe('decomposed');
    // owner identity binding
    expect(g.requested_by).toBe(OWNER);
    for (const j of db.rowsOf('goal_jobs')) expect(j.executed).toBe(false);
  });

  it('creates and LINKS pending approvals for gated jobs', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client, confirmInput(GATED_REQUEST));
    if (!out.ok) throw new Error('confirm failed: ' + out.errors.join(','));
    const approvals = db.rowsOf('orchestration_approvals');
    expect(approvals).toHaveLength(1);
    const a = approvals[0];
    expect(a.status).toBe('pending'); // born pending; only the owner decides
    expect(a.owner_identity).toBe(OWNER);
    expect(a.environment).toBe('staging');
    expect(String(a.expires_at)).toBe(
      new Date(Date.parse(NOW) + APPROVAL_TTL_MS).toISOString());
    const gated = db.rowsOf('goal_jobs').find((j) => j.requires_approval === true)!;
    expect(gated.kind).toBe('migration');
    expect(gated.approval_id).toBe(a.approval_id); // linked
    expect(a.job_id).toBe(gated.id); // scope-bound
    expect(out.ok && out.created[0].approval_ids).toHaveLength(1);
  });

  it('binds created records to the proposal (deterministic ids from the request key)', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client, confirmInput(SAFE_REQUEST));
    if (!out.ok) throw new Error('confirm failed');
    expect(out.created[0].goal_id).toBe(deterministicUuid(`${KEY}:g1`));
    expect(out.created[0].job_ids.map((j) => j.job_id)).toEqual(
      ['t1', 't2', 't3'].map((t) => deterministicUuid(`${KEY}:g1:${t}`)));
    const r = composeRequest(SAFE_REQUEST);
    if (!r.ok) throw new Error('compose failed');
    expect(out.created[0].correlation_id).toBe(
      `cmp-${KEY.slice(0, 24)}-g1-${payloadDigest(r.goals)}`);
  });
});

describe('composer persistence - idempotency', () => {
  it('duplicate confirmation replays without duplicating the graph', async () => {
    const db = makeComposerFakeDb();
    const first = await confirmComposedRequest(db.client, confirmInput(GATED_REQUEST));
    const second = await confirmComposedRequest(db.client, confirmInput(GATED_REQUEST));
    if (!first.ok || !second.ok) throw new Error('confirm failed');
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    expect(db.rowsOf('goal_jobs')).toHaveLength(2);
    expect(db.rowsOf('orchestration_approvals')).toHaveLength(1);
    // the replay returns the SAME ids
    expect(second.created[0].goal_id).toBe(first.created[0].goal_id);
  });

  it('same key + different payload is rejected, nothing new persisted', async () => {
    const db = makeComposerFakeDb();
    const first = await confirmComposedRequest(db.client, confirmInput(SAFE_REQUEST));
    expect(first.ok).toBe(true);
    const out = await confirmComposedRequest(db.client, confirmInput(GATED_REQUEST));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors).toContain('idempotency_key_payload_mismatch');
    expect(db.rowsOf('master_goals')).toHaveLength(1); // still only the first
  });

  it('a tampered/stale presented hash is rejected before any write', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client,
      confirmInput(SAFE_REQUEST, { presentedHash: 'deadbeef' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors).toContain('proposal_hash_mismatch');
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });

  it('an invalid request key is rejected before any write', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client,
      confirmInput(SAFE_REQUEST, { requestKey: 'no' }));
    expect(out.ok).toBe(false);
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });

  it('a request that fails interpretation cannot be confirmed', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client, confirmInput(
      'Create a goal to x. Create tasks to deploy to production.',
      { presentedHash: '00000000' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0]).toBe('compose_failed');
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });
});

describe('composer persistence - rollback / no partial graph', () => {
  it('an RPC failure persists nothing (atomic graph)', async () => {
    const db = makeComposerFakeDb({ failRpc: () => 'insert failed: disk full' });
    const out = await confirmComposedRequest(db.client, confirmInput(SAFE_REQUEST));
    expect(out.ok).toBe(false);
    expect(db.rowsOf('master_goals')).toHaveLength(0);
    expect(db.rowsOf('goal_jobs')).toHaveLength(0);
    expect(db.rowsOf('job_dependencies')).toHaveLength(0);
  });

  it('a migration-absent error surfaces cleanly with nothing persisted', async () => {
    const db = makeComposerFakeDb({
      failRpc: () => 'relation "master_goals" does not exist',
    });
    const out = await confirmComposedRequest(db.client, confirmInput(SAFE_REQUEST));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.some((e) => /does not exist/.test(e))).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });

  it('approval-creation failure triggers compensating cancellation (no active partial graph)', async () => {
    const db = makeComposerFakeDb({
      failInsert: (table) =>
        table === 'orchestration_approvals' ? 'insert failed: injected' : null,
    });
    const out = await confirmComposedRequest(db.client, confirmInput(GATED_REQUEST));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0]).toMatch(/^approval_create_failed:/);
    // rows exist (audit trail) but the graph is terminally INERT:
    expect(db.rowsOf('master_goals')[0].status).toBe('cancelled');
    for (const j of db.rowsOf('goal_jobs')) {
      expect(['cancelled']).toContain(j.status);
    }
    expect(out.compensated.length).toBeGreaterThan(0);
  });

  it('owner identity and proposal binding are preserved on the approval row', async () => {
    const db = makeComposerFakeDb();
    const out = await confirmComposedRequest(db.client, confirmInput(GATED_REQUEST));
    if (!out.ok) throw new Error('confirm failed');
    const a = db.rowsOf('orchestration_approvals')[0];
    const gated = db.rowsOf('goal_jobs').find((j) => j.requires_approval === true)!;
    expect(a.goal_id).toBe(out.created[0].goal_id);
    expect(a.job_id).toBe(gated.id);
    expect(String(a.action)).toContain('migration');
    expect(String(a.action_hash)).toMatch(/^[0-9a-f]{64}$/); // canonical sha-256
  });
});
