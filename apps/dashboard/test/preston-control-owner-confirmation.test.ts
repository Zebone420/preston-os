import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  evaluateOwnerConfirmation,
  prestonDecideApproval,
  prestonSubmitGoal,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import type { ComposerClient } from '@/lib/ai-os/orchestration/composer-persist';

// G8 owner-boundary regression suite.
//
// Observed defect (native ChatGPT app, staging): with exactly one
// decision-open approval, the owner said only "Approve that." and the
// conversational layer resolved the pronoun to the approval id and decided it.
// The invariant enforced here, AT THE SHARED TOOL BOUNDARY in front of
// decide_orchestration_approval (both MCP and GPT REST route through it):
//
//   The authoritative decision RPC is unreachable unless the call carries an
//   owner confirmation phrase that NAMES the exact approval id with a verb
//   matching the requested outcome. Ambiguous references can never satisfy
//   this because the id itself must appear in the phrase. Without it the
//   server restates the approval (exact id + action text) and makes NO
//   decision.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-20T12:00:00.000Z';
const LATER = '2026-08-21T13:00:00.000Z'; // past the 24h approval TTL

const GATED_REQUEST =
  'Create a staging-only goal to prepare the Phase 7 schema evidence. ' +
  'Create tasks to draft a schema migration plan for owner review, ' +
  'and summarize the plan in a local report.';

const HARMLESS_REQUEST =
  'Create a staging-only goal to verify the Phase 7 dashboard status page. ' +
  'Create tasks to inspect the staging status data, generate a ' +
  'simulation-only readiness summary, and attach internal evidence. ' +
  'Do not deploy, send messages, access production, change credentials, ' +
  'perform financial actions, or make external writes.';

interface DecideOpts { isOwner: boolean; nowIso: () => string }

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
      const row = db.rowsOf('orchestration_approvals').find((r) => r.approval_id === args.p_approval_id);
      if (!row) return Promise.resolve({ data: null, error: { message: 'approval_not_found' } });
      if (row.nonce) return Promise.resolve({ data: null, error: { message: 'already_decided' } });
      if (row.status !== 'pending') return Promise.resolve({ data: null, error: { message: 'not_pending' } });
      if (Date.parse(String(row.expires_at)) <= Date.parse(opts.nowIso())) {
        return Promise.resolve({ data: null, error: { message: 'expired' } });
      }
      row.status = String(args.p_outcome); row.nonce = args.p_nonce; row.decided_at = opts.nowIso();
      db.rowsOf('audit_log').push({ action: 'orchestration_approval_decision', approval_id: row.approval_id, outcome: args.p_outcome });
      return Promise.resolve({ data: [row], error: null });
    },
  };
  return { client, rowsOf: db.rowsOf, decideCalls };
}

function ctxFor(client: ComposerClient, now = NOW): ToolContext {
  return { client, ownerEmail: OWNER, now };
}

type Db = ReturnType<typeof makeDb>;

async function gated(db: Db, requestId: string) {
  const r = await prestonSubmitGoal(ctxFor(db.client), { request: GATED_REQUEST, request_id: requestId });
  expect(r.status).toBe('accepted');
  const approvalId = r.goals.flatMap((g) => g.approval_ids)[0];
  expect(approvalId).toBeTruthy();
  return approvalId;
}

function approvalRow(db: Db, id: string) {
  return db.rowsOf('orchestration_approvals').find((r) => r.approval_id === id)!;
}

function gatedJobRow(db: Db, id: string) {
  const a = approvalRow(db, id);
  return db.rowsOf('goal_jobs').find((j) => j.id === a.job_id)!;
}

describe('evaluateOwnerConfirmation (pure invariant)', () => {
  const ID = 'apr-41eadf71b90b7a8622be3318';

  it('every ambiguous / pronoun / context reference is refused', () => {
    for (const vague of [
      undefined, '', '   ',
      'Approve that.', 'Reject that.', 'Approve it.', 'Go ahead.', 'Do it.',
      'Approve the pending one.', 'yes', 'Yes, approve.', 'approve', 'approve the approval',
      'approve the one you showed me', 'confirm', 'please approve that one',
    ]) {
      const r = evaluateOwnerConfirmation(vague, ID, 'approved');
      expect(r.ok, JSON.stringify(vague)).toBe(false);
    }
  });

  it('accepts only an explicit phrase naming the exact id with a matching verb', () => {
    expect(evaluateOwnerConfirmation(`Approve ${ID}`, ID, 'approved').ok).toBe(true);
    expect(evaluateOwnerConfirmation(`approved ${ID}.`, ID, 'approved').ok).toBe(true);
    expect(evaluateOwnerConfirmation(`Reject approval ${ID}!`, ID, 'rejected').ok).toBe(true);
    expect(evaluateOwnerConfirmation(`  approve   ${ID.toUpperCase()}  `, ID, 'approved').ok).toBe(true);
  });

  it('a different id or a conflicting verb is refused with a distinct tag', () => {
    expect(evaluateOwnerConfirmation('Approve apr-other-id-123456', ID, 'approved'))
      .toMatchObject({ ok: false, error: 'owner_confirmation_id_mismatch' });
    expect(evaluateOwnerConfirmation(`Reject ${ID}`, ID, 'approved'))
      .toMatchObject({ ok: false, error: 'owner_confirmation_outcome_mismatch' });
    expect(evaluateOwnerConfirmation(`Approve ${ID}`, ID, 'rejected'))
      .toMatchObject({ ok: false, error: 'owner_confirmation_outcome_mismatch' });
  });

  it('a phrase with surrounding chatter does not slip through', () => {
    expect(evaluateOwnerConfirmation(`I guess you should approve ${ID} maybe`, ID, 'approved').ok).toBe(false);
    expect(evaluateOwnerConfirmation(`approve ${ID} and everything else`, ID, 'approved').ok).toBe(false);
  });
});

describe('G8: ambiguous references never reach the decision RPC', () => {
  it('1. one open approval + "Approve that." -> no decision, restatement returned', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case1');
    const r = await prestonDecideApproval(ctxFor(db.client), {
      approval_id: id, outcome: 'approved', owner_confirmation: 'Approve that.',
    });
    expect(r).toMatchObject({ ok: false, decision_made: false, error: 'owner_confirmation_required' });
    if ('restatement' in r) {
      expect(r.restatement).toMatchObject({ approval_id: id, status: 'pending' });
      expect(String((r.restatement as { action: string }).action).length).toBeGreaterThan(0);
      expect(r.required_confirmation).toBe(`Approve ${id}`);
    }
    expect(db.decideCalls).toHaveLength(0);
    expect(approvalRow(db, id).status).toBe('pending');
  });

  it('2. one open approval + "Reject that." -> no decision', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case2');
    const r = await prestonDecideApproval(ctxFor(db.client), {
      approval_id: id, outcome: 'rejected', owner_confirmation: 'Reject that.',
    });
    expect(r).toMatchObject({ ok: false, decision_made: false, error: 'owner_confirmation_required' });
    expect(db.decideCalls).toHaveLength(0);
    expect(approvalRow(db, id).status).toBe('pending');
  });

  it('3. multiple open approvals + ambiguous reference -> no decision on any of them', async () => {
    const db = makeDb();
    const a = await gated(db, 'pc-g8-case3-a');
    const b = await gated(db, 'pc-g8-case3-b');
    expect(a).not.toBe(b);
    for (const vague of ['Approve it.', 'Go ahead.', 'Approve the pending one.', undefined]) {
      const r = await prestonDecideApproval(ctxFor(db.client), {
        approval_id: a, outcome: 'approved', owner_confirmation: vague,
      });
      expect(r).toMatchObject({ ok: false, decision_made: false });
    }
    expect(db.decideCalls).toHaveLength(0);
    expect(approvalRow(db, a).status).toBe('pending');
    expect(approvalRow(db, b).status).toBe('pending');
  });

  it('4. exact approval id but no explicit final owner confirmation -> no decision', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case4');
    const r = await prestonDecideApproval(ctxFor(db.client), { approval_id: id, outcome: 'approved' });
    expect(r).toMatchObject({ ok: false, decision_made: false, error: 'owner_confirmation_required' });
    expect(db.decideCalls).toHaveLength(0);
    expect(approvalRow(db, id).status).toBe('pending');
  });

  it('5. two-phase handshake: restatement first, then exact phrase -> correct approval decision', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case5');
    const phase1 = await prestonDecideApproval(ctxFor(db.client), { approval_id: id, outcome: 'approved' });
    expect(phase1).toMatchObject({ ok: false, decision_made: false, required_confirmation: `Approve ${id}` });
    expect(db.decideCalls).toHaveLength(0);
    const phase2 = await prestonDecideApproval(ctxFor(db.client), {
      approval_id: id, outcome: 'approved', owner_confirmation: `Approve ${id}`,
    });
    expect(phase2).toMatchObject({ ok: true, approval_id: id, outcome: 'approved' });
    expect(db.decideCalls).toHaveLength(1);
    expect(approvalRow(db, id).status).toBe('approved');
    expect(db.rowsOf('audit_log').filter((x) => x.approval_id === id)).toHaveLength(1);
  });

  it('6. exact id + explicit rejection confirmation -> correct rejection decision', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case6');
    const r = await prestonDecideApproval(ctxFor(db.client), {
      approval_id: id, outcome: 'rejected', owner_confirmation: `Reject ${id}`,
    });
    expect(r).toMatchObject({ ok: true, outcome: 'rejected' });
    expect(approvalRow(db, id).status).toBe('rejected');
  });

  it('7. an unrelated approval is never modified (mismatched id refused; sibling untouched by a valid decision)', async () => {
    const db = makeDb();
    const a = await gated(db, 'pc-g8-case7-a');
    const b = await gated(db, 'pc-g8-case7-b');
    // Confirmation names B while the call targets A: refused, nothing decided.
    const cross = await prestonDecideApproval(ctxFor(db.client), {
      approval_id: a, outcome: 'approved', owner_confirmation: `Approve ${b}`,
    });
    expect(cross).toMatchObject({ ok: false, decision_made: false, error: 'owner_confirmation_id_mismatch' });
    expect(db.decideCalls).toHaveLength(0);
    expect(approvalRow(db, a).status).toBe('pending');
    expect(approvalRow(db, b).status).toBe('pending');
    // A valid decision on A leaves B pending.
    await prestonDecideApproval(ctxFor(db.client), {
      approval_id: a, outcome: 'approved', owner_confirmation: `Approve ${a}`,
    });
    expect(approvalRow(db, a).status).toBe('approved');
    expect(approvalRow(db, b).status).toBe('pending');
    expect(db.decideCalls).toHaveLength(1);
  });

  it('8. a rejected gated job stays gated and unexecuted: attempts 0, requires_approval true', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case8');
    const before = gatedJobRow(db, id);
    expect(before.requires_approval).toBe(true);
    await prestonDecideApproval(ctxFor(db.client), {
      approval_id: id, outcome: 'rejected', owner_confirmation: `Reject ${id}`,
    });
    const job = gatedJobRow(db, id);
    expect(Number(job.attempts ?? 0)).toBe(0);
    expect(job.requires_approval).toBe(true);
    expect(job.executed === true).toBe(false);
    expect(['ready', 'in_progress', 'completed']).not.toContain(String(job.status));
  });

  it('9. already-decided and expired approvals still fail closed even with a valid confirmation', async () => {
    const db = makeDb();
    const id = await gated(db, 'pc-g8-case9');
    await prestonDecideApproval(ctxFor(db.client), { approval_id: id, outcome: 'approved', owner_confirmation: `Approve ${id}` });
    expect(await prestonDecideApproval(ctxFor(db.client), { approval_id: id, outcome: 'rejected', owner_confirmation: `Reject ${id}` }))
      .toMatchObject({ ok: false, error: 'already_decided' });
    expect(approvalRow(db, id).status).toBe('approved');

    const late = makeDb({ isOwner: true, nowIso: () => LATER });
    const id2 = await gated(late, 'pc-g8-case9-late');
    expect(await prestonDecideApproval(ctxFor(late.client, LATER), { approval_id: id2, outcome: 'approved', owner_confirmation: `Approve ${id2}` }))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(approvalRow(late, id2).status).toBe('pending');
  });

  it('10. harmless non-gated goal submission is unaffected by the handshake', async () => {
    const db = makeDb();
    const r = await prestonSubmitGoal(ctxFor(db.client), { request: HARMLESS_REQUEST, request_id: 'pc-g8-case10' });
    expect(r.status).toBe('accepted');
    expect(r.approvals_required).toBe(0);
    expect(db.rowsOf('master_goals').length).toBeGreaterThan(0);
    expect(db.decideCalls).toHaveLength(0);
  });
});
