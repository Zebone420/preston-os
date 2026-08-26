import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  evaluateCancelConfirmation,
  prestonCancelGoal,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';

// Bridge B3: owner-confirmed goal cancellation. Mirrors the G8 approval
// handshake test discipline: every refusal path leaves ZERO state changed;
// the confirmed path is CAS-legal, idempotent on replay, audited, and honest
// about what it cannot interrupt.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-26T12:00:00.000Z';
const GOAL_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_GOAL = '66666666-6666-4666-8666-666666666666';

function ctxFor(client: ComposerClient, now = NOW): ToolContext {
  return { client, ownerEmail: OWNER, now };
}

function seed(db: ReturnType<typeof makeComposerFakeDb>, goalStatus: string, jobStatuses: string[], goalId = GOAL_ID) {
  db.rowsOf('master_goals').push({
    id: goalId, title: 'cancel me', objective: 'o', source: 'dashboard',
    requested_by: OWNER, status: goalStatus, environment: 'staging',
    correlation_id: `cmp-b3-${goalId.slice(0, 8)}`, simulation_only: true,
    iteration: 1, created_at: NOW, updated_at: NOW,
  });
  jobStatuses.forEach((status, i) => {
    db.rowsOf('goal_jobs').push({
      id: `77777777-7777-4777-8777-77777777777${i}`, goal_id: goalId,
      kind: 'documentation', title: `j${i}`, objective: 'o', status,
      risk_class: 'GREEN', assigned_role: 'claude', attempts: 0,
      requires_approval: status === 'awaiting_approval', approval_id: null,
      evidence_refs: [], failure_reason: null,
      run_id: status === 'in_progress' ? `run-${i}` : null,
      run_lease_expires_at: status === 'in_progress' ? '2026-08-26T12:09:00.000Z' : null,
      created_at: NOW, updated_at: NOW,
    });
  });
}

const PHRASE = `Cancel goal ${GOAL_ID}`;

describe('evaluateCancelConfirmation', () => {
  it('accepts only the exact-id phrase (goal word optional, punctuation tolerated)', () => {
    expect(evaluateCancelConfirmation(PHRASE, GOAL_ID).ok).toBe(true);
    expect(evaluateCancelConfirmation(`cancel ${GOAL_ID}.`, GOAL_ID).ok).toBe(true);
    expect(evaluateCancelConfirmation(`CANCEL GOAL ${GOAL_ID.toUpperCase()}!`, GOAL_ID).ok).toBe(true);
  });

  it('refuses vague, empty, chattered, and wrong-id phrases', () => {
    expect(evaluateCancelConfirmation('Cancel that', GOAL_ID)).toMatchObject({ ok: false, error: 'cancel_confirmation_required' });
    expect(evaluateCancelConfirmation('', GOAL_ID)).toMatchObject({ ok: false, error: 'cancel_confirmation_required' });
    expect(evaluateCancelConfirmation(`please ${PHRASE}`, GOAL_ID)).toMatchObject({ ok: false, error: 'cancel_confirmation_required' });
    expect(evaluateCancelConfirmation(`Cancel goal ${OTHER_GOAL}`, GOAL_ID)).toMatchObject({ ok: false, error: 'cancel_confirmation_id_mismatch' });
  });
});

describe('preston_cancel_goal', () => {
  it('missing confirmation -> NO cancellation, restatement + required phrase returned', async () => {
    const db = makeComposerFakeDb();
    seed(db, 'running', ['pending', 'in_progress']);
    const r = await prestonCancelGoal(ctxFor(db.client), { goal_id: GOAL_ID });
    expect(r.ok).toBe(false);
    if (r.ok || !('required_confirmation' in r)) throw new Error('expected refusal shape');
    expect(r.error).toBe('cancel_confirmation_required');
    expect(r.decision_made).toBe(false);
    expect(r.required_confirmation).toBe(PHRASE);
    expect(r.restatement?.goal_id).toBe(GOAL_ID);
    expect(db.rowsOf('master_goals')[0].status).toBe('running');
    expect(db.rowsOf('goal_jobs').every((j) => j.status !== 'cancelled')).toBe(true);
    expect(db.rowsOf('os_events')).toHaveLength(0);
  });

  it('wrong-id confirmation -> NO cancellation', async () => {
    const db = makeComposerFakeDb();
    seed(db, 'running', ['pending']);
    const r = await prestonCancelGoal(ctxFor(db.client), {
      goal_id: GOAL_ID, owner_confirmation: `Cancel goal ${OTHER_GOAL}`,
    });
    expect(r.ok).toBe(false);
    if (r.ok || !('error' in r)) throw new Error('expected refusal');
    expect(r.error).toBe('cancel_confirmation_id_mismatch');
    expect(db.rowsOf('master_goals')[0].status).toBe('running');
  });

  it('valid confirmation cancels the goal and every non-terminal job, audited, without touching other goals', async () => {
    const db = makeComposerFakeDb();
    seed(db, 'running', ['pending', 'ready', 'in_progress', 'awaiting_approval', 'failed', 'completed', 'dead_lettered']);
    seed(db, 'running', ['pending'], OTHER_GOAL);
    const r = await prestonCancelGoal(ctxFor(db.client), {
      goal_id: GOAL_ID, owner_confirmation: PHRASE, reason: 'drill cleanup',
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !('status' in r)) throw new Error('expected success shape');
    expect(r.status).toBe('cancelled');
    expect(r.decision_made).toBe(true);
    expect(r.jobs_cancelled).toBe(5);
    expect(r.jobs_already_terminal).toBe(2);
    expect(r.audit_recorded).toBe(true);
    const mine = db.rowsOf('goal_jobs').filter((j) => j.goal_id === GOAL_ID);
    expect(mine.filter((j) => j.status === 'cancelled')).toHaveLength(5);
    expect(mine.filter((j) => j.status === 'completed')).toHaveLength(1);
    expect(mine.filter((j) => j.status === 'dead_lettered')).toHaveLength(1);
    // In-flight run's lease cleared so nothing looks live.
    expect(mine.every((j) => j.run_id === null || j.status === 'completed' || j.status === 'dead_lettered')).toBe(true);
    // Unrelated goal untouched.
    const other = db.rowsOf('master_goals').find((g) => g.id === OTHER_GOAL);
    expect(other?.status).toBe('running');
    // Audit event recorded with counts.
    const ev = db.rowsOf('os_events').find((e) => e.id === `ev-cancel-${GOAL_ID}`);
    expect(ev?.type).toBe('GoalCancelRequested');
    expect((ev?.payload as Record<string, unknown>).jobs_cancelled).toBe(5);
    expect((ev?.payload as Record<string, unknown>).goal_status_before).toBe('running');
  });

  it('replaying the same cancellation is an idempotent no-op', async () => {
    const db = makeComposerFakeDb();
    seed(db, 'decomposed', ['pending']);
    const first = await prestonCancelGoal(ctxFor(db.client), { goal_id: GOAL_ID, owner_confirmation: PHRASE });
    expect(first.ok).toBe(true);
    const again = await prestonCancelGoal(ctxFor(db.client), { goal_id: GOAL_ID, owner_confirmation: PHRASE });
    expect(again.ok).toBe(true);
    if (!again.ok || !('status' in again)) throw new Error('expected shape');
    expect(again.status).toBe('already_cancelled');
    expect(again.decision_made).toBe(false);
    // No duplicate audit rows, no extra transitions.
    expect(db.rowsOf('os_events').filter((e) => String(e.id).startsWith('ev-cancel-'))).toHaveLength(1);
  });

  it('terminal goals are refused honestly (completed / failed / dead_lettered)', async () => {
    for (const status of ['completed', 'failed', 'dead_lettered']) {
      const db = makeComposerFakeDb();
      seed(db, status, ['completed']);
      const r = await prestonCancelGoal(ctxFor(db.client), { goal_id: GOAL_ID, owner_confirmation: PHRASE });
      expect(r.ok).toBe(false);
      if (r.ok || !('error' in r)) throw new Error('expected refusal');
      expect(r.error).toBe('goal_terminal');
      expect(db.rowsOf('master_goals')[0].status).toBe(status);
    }
  });

  it('invalid ids, unknown goals, and secret-bearing reasons are refused before any write', async () => {
    const db = makeComposerFakeDb();
    expect((await prestonCancelGoal(ctxFor(db.client), { goal_id: 'nope' })).ok).toBe(false);
    expect((await prestonCancelGoal(ctxFor(db.client), { goal_id: GOAL_ID })).ok).toBe(false);
    seed(db, 'running', ['pending']);
    const secretish = ['api_key', 'ABCDEFGHIJKLMNOP'].join('=');
    const r = await prestonCancelGoal(ctxFor(db.client), {
      goal_id: GOAL_ID, owner_confirmation: PHRASE, reason: secretish,
    });
    expect(r.ok).toBe(false);
    if (r.ok || !('error' in r)) throw new Error('expected refusal');
    expect(r.error).toBe('secret_in_reason');
    expect(db.rowsOf('master_goals')[0].status).toBe('running');
  });
});
