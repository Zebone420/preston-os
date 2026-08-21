import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  normalizeRequestId,
  prestonDecideApproval,
  prestonGetEvidence,
  prestonGetGoal,
  prestonListApprovals,
  prestonStatus,
  prestonSubmitGoal,
  projectApproval,
  projectJob,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import { evaluateConsent, safeConsentNext } from '../src/lib/preston-control/consent';
import { protectedResourceMetadata } from '../src/lib/preston-control/metadata';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';

// Preston Control tools run against the shared composer fake DB (the same
// emulation the composer/lifecycle suites use), plus a small
// decide_orchestration_approval emulation that mirrors the 0021 RPC's
// refusal tags. Pins: idempotency, gating, owner-only decision, secret
// exclusion, bounded projections.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-20T12:00:00.000Z';
const LATER = '2026-08-21T13:00:00.000Z'; // past the 24h approval TTL

// Secret-SHAPED fixtures are assembled at runtime so the repo's own secret
// scanner (which rightly flags `<name>=<long value>` literals) stays clean.
const FAKE_VALUE = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ0123'].join('');
const planted = (name: string) => `${name}=${FAKE_VALUE}`;

const HARMLESS_REQUEST =
  'Create a staging-only goal to verify the Phase 7 dashboard status page. ' +
  'Create tasks to inspect the staging status data, generate a ' +
  'simulation-only readiness summary, and attach internal evidence. ' +
  'Do not deploy, send messages, access production, change credentials, ' +
  'perform financial actions, or make external writes.';

const GATED_REQUEST =
  'Create a staging-only goal to prepare the Phase 7 schema evidence. ' +
  'Create tasks to draft a schema migration plan for owner review, ' +
  'and summarize the plan in a local report.';

interface DecideOpts { isOwner: boolean; nowIso: () => string }

// Wrap the composer fake with an emulation of decide_orchestration_approval.
function makeDb(opts: DecideOpts = { isOwner: true, nowIso: () => NOW }) {
  const db = makeComposerFakeDb();
  const base = db.client;
  const decideCalls: Record<string, unknown>[] = [];
  const client: ComposerClient = {
    from: base.from.bind(base),
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== 'decide_orchestration_approval') return base.rpc(fn, args);
      decideCalls.push(args);
      if (!opts.isOwner) return Promise.resolve({ data: null, error: { message: 'owner_required' } });
      const outcome = String(args.p_outcome);
      if (!['approved', 'rejected', 'more_info'].includes(outcome)) return Promise.resolve({ data: null, error: { message: 'outcome_invalid' } });
      if (!args.p_nonce) return Promise.resolve({ data: null, error: { message: 'nonce_required' } });
      const row = db.rowsOf('orchestration_approvals').find((r) => r.approval_id === args.p_approval_id);
      if (!row) return Promise.resolve({ data: null, error: { message: 'approval_not_found' } });
      if (row.nonce) return Promise.resolve({ data: null, error: { message: 'already_decided' } });
      if (row.status !== 'pending') return Promise.resolve({ data: null, error: { message: 'not_pending' } });
      if (Date.parse(String(row.expires_at)) <= Date.parse(opts.nowIso())) {
        return Promise.resolve({ data: null, error: { message: 'expired' } });
      }
      row.status = outcome; row.nonce = args.p_nonce; row.decided_at = opts.nowIso();
      db.rowsOf('audit_log').push({ action: 'orchestration_approval_decision', approval_id: row.approval_id, outcome });
      return Promise.resolve({ data: [row], error: null });
    },
  };
  return { client, rowsOf: db.rowsOf, decideCalls };
}

function ctxFor(client: ComposerClient, now = NOW): ToolContext {
  return { client, ownerEmail: OWNER, now };
}

describe('preston_status', () => {
  it('returns a bounded, structured snapshot on an empty control plane', async () => {
    const db = makeDb();
    const s = await prestonStatus(ctxFor(db.client));
    expect(s.posture).toBe('operating');
    expect(s.controls.readable).toBe(true);
    expect(s.controls.execution_enabled).toBe(false);
    expect(s.summary.total_goals).toBe(0);
    expect(s.recent_goals).toEqual([]);
    expect(s.pending_approvals).toEqual([]);
    expect(Array.isArray(s.needs_attention)).toBe(true);
  });

  it('reports halted + attention when owner_stop is set', async () => {
    const fake = makeComposerFakeDb({ controls: {
      id: 'global', execution_enabled: false, owner_stop: true, paused: false,
      hermes_mode: 'observe_only', remote_runner_enabled: false,
    } });
    const s = await prestonStatus(ctxFor(fake.client));
    expect(s.posture).toBe('halted');
    expect(s.needs_attention.join(' ')).toContain('owner_stop');
  });
});

describe('preston_submit_goal', () => {
  it('rejects empty, oversize, and secret-bearing requests without touching the DB', async () => {
    const db = makeDb();
    expect((await prestonSubmitGoal(ctxFor(db.client), { request: '   ' })).status).toBe('rejected');
    expect((await prestonSubmitGoal(ctxFor(db.client), { request: 'x'.repeat(5000) })).status).toBe('rejected');
    const leak = await prestonSubmitGoal(ctxFor(db.client), { request: HARMLESS_REQUEST, context: planted(['api','key'].join('_')) });
    expect(leak.status).toBe('rejected');
    expect(leak.errors).toContain('secret_in_request');
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });

  it('accepts a harmless mission through the owner composer and is idempotent on request_id', async () => {
    const db = makeDb();
    const first = await prestonSubmitGoal(ctxFor(db.client), { request: HARMLESS_REQUEST, request_id: 'pc-test-harmless-1' });
    expect(first.status).toBe('accepted');
    expect(first.request_id).toBe('pc-test-harmless-1');
    expect(first.goals.length).toBeGreaterThan(0);
    expect(first.approvals_required).toBe(0);
    const goals = db.rowsOf('master_goals');
    expect(goals).toHaveLength(first.goals.length);
    expect(goals[0].requested_by).toBe(OWNER);
    expect(goals[0].simulation_only).toBe(true);

    const again = await prestonSubmitGoal(ctxFor(db.client), { request: HARMLESS_REQUEST, request_id: 'pc-test-harmless-1' });
    expect(again.status).toBe('duplicate');
    expect(again.goals.map((g) => g.goal_id)).toEqual(first.goals.map((g) => g.goal_id));
    expect(db.rowsOf('master_goals')).toHaveLength(goals.length);
  });

  it('same request_id with a different payload is refused (idempotency_conflict), never silently reused', async () => {
    const db = makeDb();
    await prestonSubmitGoal(ctxFor(db.client), { request: HARMLESS_REQUEST, request_id: 'pc-test-conflict-1' });
    const r = await prestonSubmitGoal(ctxFor(db.client), { request: GATED_REQUEST, request_id: 'pc-test-conflict-1' });
    expect(r.status).toBe('rejected');
    expect((r.errors ?? []).join(',')).toMatch(/idempotency_(conflict|key_payload_mismatch)/);
  });

  it('a gated mission parks behind a pending owner approval that list_approvals surfaces', async () => {
    const db = makeDb();
    const r = await prestonSubmitGoal(ctxFor(db.client), { request: GATED_REQUEST, request_id: 'pc-test-gated-1' });
    expect(r.status).toBe('accepted');
    expect(r.approvals_required).toBeGreaterThan(0);
    const gatedJobs = db.rowsOf('goal_jobs').filter((j) => j.requires_approval === true);
    expect(gatedJobs.length).toBeGreaterThan(0);
    // Gated jobs carry approval_id links; the RUNTIME parks/clears them -
    // nothing in this adapter changes a job row.
    for (const j of gatedJobs) expect(j.approval_id).toBeTruthy();

    const list = await prestonListApprovals(ctxFor(db.client));
    expect(list.read_ok).toBe(true);
    expect(list.approvals.length).toBe(r.approvals_required);
    const a = list.approvals[0];
    expect(a.status).toBe('pending');
    expect(a.decision_open).toBe(true);
    // Never the one-time credential or the hash binding.
    expect(a).not.toHaveProperty('nonce');
    expect(a).not.toHaveProperty('action_hash');
    expect(a).not.toHaveProperty('owner_identity');
  });

  it('normalizeRequestId keeps valid ids and mints otherwise', () => {
    expect(normalizeRequestId('pc-abc-12345')).toBe('pc-abc-12345');
    expect(normalizeRequestId('bad id!')).toMatch(/^pc-[0-9a-f-]{36}$/);
    expect(normalizeRequestId(undefined)).toMatch(/^pc-/);
  });
});

describe('preston_decide_approval', () => {
  async function gated(db = makeDb()) {
    const r = await prestonSubmitGoal(ctxFor(db.client), { request: GATED_REQUEST, request_id: 'pc-test-decide-1' });
    const approvalId = r.goals.flatMap((g) => g.approval_ids)[0];
    expect(approvalId).toBeTruthy();
    return { db, approvalId };
  }

  it('invalid input is refused before the RPC', async () => {
    const { db, approvalId } = await gated();
    const bad = await prestonDecideApproval(ctxFor(db.client), { approval_id: 'x', outcome: 'approved' });
    expect(bad).toMatchObject({ ok: false, error: 'invalid_input' });
    const badOutcome = await prestonDecideApproval(ctxFor(db.client), { approval_id: approvalId, outcome: 'maybe' as 'approved' });
    expect(badOutcome).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(db.decideCalls).toHaveLength(0);
  });

  it('owner approval goes through decide_orchestration_approval exactly once with a fresh pc- nonce and one audit row', async () => {
    const { db, approvalId } = await gated();
    const r = await prestonDecideApproval(ctxFor(db.client), { approval_id: approvalId, outcome: 'approved' });
    expect(r.ok).toBe(true);
    expect(db.decideCalls).toHaveLength(1);
    expect(String(db.decideCalls[0].p_nonce)).toMatch(/^pc-/);
    const row = db.rowsOf('orchestration_approvals').find((a) => a.approval_id === approvalId)!;
    expect(row.status).toBe('approved');
    expect(db.rowsOf('audit_log').filter((a) => a.approval_id === approvalId)).toHaveLength(1);
    // No direct table bypass: the gated job is untouched until the runtime clears the gate.
    const job = db.rowsOf('goal_jobs').find((j) => j.id === row.job_id)!;
    expect(job.requires_approval).toBe(true);
    expect(job.status).not.toBe('ready');
  });

  it('already-decided, invalid id, and expired approvals are refused with the RPC tag', async () => {
    const { db, approvalId } = await gated();
    await prestonDecideApproval(ctxFor(db.client), { approval_id: approvalId, outcome: 'rejected' });
    expect(await prestonDecideApproval(ctxFor(db.client), { approval_id: approvalId, outcome: 'approved' }))
      .toMatchObject({ ok: false, error: 'already_decided' });
    expect(await prestonDecideApproval(ctxFor(db.client), { approval_id: 'apr-does-not-exist', outcome: 'approved' }))
      .toMatchObject({ ok: false, error: 'approval_not_found' });

    const late = makeDb({ isOwner: true, nowIso: () => LATER });
    const g2 = await gated(late);
    expect(await prestonDecideApproval(ctxFor(g2.db.client, LATER), { approval_id: g2.approvalId, outcome: 'approved' }))
      .toMatchObject({ ok: false, error: 'expired' });
  });

  it('non-owner / runtime identity -> owner_required from the DB (no local override exists)', async () => {
    const rt = makeDb({ isOwner: false, nowIso: () => NOW });
    const { approvalId } = await gated(rt);
    const r = await prestonDecideApproval(ctxFor(rt.client), { approval_id: approvalId, outcome: 'approved' });
    expect(r).toMatchObject({ ok: false, error: 'owner_required' });
    const row = rt.rowsOf('orchestration_approvals').find((a) => a.approval_id === approvalId)!;
    expect(row.status).toBe('pending');
  });

  it('a secret in the reason is refused before the RPC', async () => {
    const { db, approvalId } = await gated();
    const r = await prestonDecideApproval(ctxFor(db.client), { approval_id: approvalId, outcome: 'approved', reason: planted('password') });
    expect(r).toMatchObject({ ok: false, error: 'secret_in_reason' });
    expect(db.decideCalls).toHaveLength(0);
  });
});

describe('preston_get_goal / preston_get_evidence', () => {
  it('reads one goal with jobs and evidence, rejects malformed ids, reports not_found', async () => {
    const db = makeDb();
    const r = await prestonSubmitGoal(ctxFor(db.client), { request: HARMLESS_REQUEST, request_id: 'pc-test-read-1' });
    const goalId = r.goals[0].goal_id;
    // Plant an evidence ref and a secret-looking failure reason to prove screening.
    const job = db.rowsOf('goal_jobs').find((j) => j.goal_id === goalId)!;
    job.evidence_refs = ['evidence://staging/run-1', planted(['auth','token'].join('_'))];
    job.failure_reason = planted('secret');

    const g = await prestonGetGoal(ctxFor(db.client), goalId);
    expect(g.found).toBe(true);
    if (g.found) {
      expect(g.goal.goal_id).toBe(goalId);
      expect(g.jobs.length).toBeGreaterThan(0);
      const text = JSON.stringify(g);
      expect(text).not.toContain(FAKE_VALUE);
      expect(text).toContain('[redacted]');
      expect(g.evidence_refs.some((e) => e.ref === 'evidence://staging/run-1')).toBe(true);
    }
    expect(await prestonGetGoal(ctxFor(db.client), 'not-a-uuid')).toMatchObject({ found: false, error: 'goal_id_invalid' });
    expect(await prestonGetGoal(ctxFor(db.client), '00000000-0000-4000-8000-000000000000')).toMatchObject({ found: false, error: 'not_found' });

    const ev = await prestonGetEvidence(ctxFor(db.client), { goal_id: goalId });
    expect(ev.ok).toBe(true);
    expect(JSON.stringify(ev)).not.toContain(FAKE_VALUE);
    const one = await prestonGetEvidence(ctxFor(db.client), { job_id: String(job.id) });
    expect(one.ok).toBe(true);
    expect(one.items).toHaveLength(1);
    expect(await prestonGetEvidence(ctxFor(db.client), {})).toMatchObject({ ok: false, error: 'goal_id_or_job_id_required' });
  });

  it('projections are explicit allowlists (no row spread)', () => {
    const job = projectJob({ id: 'j', goal_id: 'g', run_id: 'lease-secret', extra: 'x', status: 'ready' });
    expect(job).not.toHaveProperty('run_id');
    expect(job).not.toHaveProperty('extra');
    const a = projectApproval({ approval_id: 'a', nonce: 'n', action_hash: 'h', status: 'pending', expires_at: LATER }, Date.parse(NOW));
    expect(a).not.toHaveProperty('nonce');
    expect(a.decision_open).toBe(true);
  });
});

describe('consent gate + metadata', () => {
  const CLIENT_ID = '11111111-2222-4333-8444-555555555555';
  const env = { PRESTON_CONTROL_OAUTH_CLIENT_ID: CLIENT_ID, OWNER_EMAIL_ALLOWLIST: OWNER, NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' };
  const details = {
    authorization_id: 'auth_abcdef123456',
    client: { id: CLIENT_ID, name: 'ChatGPT' },
    scope: 'email',
    user: { id: 'u', email: OWNER },
  };

  it('approves only the registered client, allowlisted scopes, and the signed-in owner', () => {
    expect(evaluateConsent(details, OWNER, env)).toEqual({ ok: true, scopes: ['email'] });
    expect(evaluateConsent({ ...details, client: { id: 'other', name: 'x' } }, OWNER, env)).toMatchObject({ ok: false, reason: 'client_not_allowed' });
    expect(evaluateConsent({ ...details, scope: 'email admin' }, OWNER, env)).toMatchObject({ ok: false, reason: 'scope_not_allowed' });
    expect(evaluateConsent(details, 'guest@example.com', { ...env })).toMatchObject({ ok: false, reason: 'user_not_owner' });
    expect(evaluateConsent({ ...details, user: { id: 'v', email: 'someone@else.com' } }, OWNER, env)).toMatchObject({ ok: false, reason: 'user_mismatch' });
    expect(evaluateConsent({ ...details, authorization_id: 'a b' }, OWNER, env)).toMatchObject({ ok: false, reason: 'authorization_id_invalid' });
    expect(evaluateConsent(details, OWNER, { ...env, PRESTON_CONTROL_OAUTH_CLIENT_ID: '' })).toMatchObject({ ok: false, reason: 'unconfigured' });
  });

  it('safeConsentNext admits only the same-origin consent path', () => {
    expect(safeConsentNext('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc');
    expect(safeConsentNext('/')).toBeNull();
    expect(safeConsentNext('//evil.example/oauth/consent?x')).toBeNull();
    expect(safeConsentNext('https://evil.example/oauth/consent?x')).toBeNull();
    expect(safeConsentNext('/oauth/consent?a=\r\nSet-Cookie:x')).toBeNull();
  });

  it('protected resource metadata points at the Supabase auth issuer and /mcp', () => {
    const req = new Request('https://preston-os-prod.vercel.app/.well-known/oauth-protected-resource/mcp');
    const m = protectedResourceMetadata(req, env)!;
    expect(m.resource).toBe('https://preston-os-prod.vercel.app/mcp');
    expect(m.authorization_servers).toEqual(['https://proj.supabase.co/auth/v1']);
    expect(protectedResourceMetadata(req, { ...env, PRESTON_CONTROL_PUBLIC_ORIGIN: 'https://control.preston.nyc/' })!.resource)
      .toBe('https://control.preston.nyc/mcp');
    expect(protectedResourceMetadata(req, { ...env, NEXT_PUBLIC_SUPABASE_URL: '' })).toBeNull();
  });
});
