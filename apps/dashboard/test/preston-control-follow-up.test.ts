import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  prestonFollowUpGoal,
  prestonGetGoal,
  prestonSubmitGoal,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';

// Bridge B4: continuation = a FRESH goal linked to the parent via an
// append-only GoalLinked os_events row. Pins: parent must exist, nothing is
// inherited (classification + gates + idempotency behave exactly like a new
// goal), linkage is durable + replay-convergent, the parent goal row is
// never mutated.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-26T12:00:00.000Z';
const ABSENT_PARENT = '99999999-9999-4999-8999-999999999999';

const HARMLESS_REQUEST =
  'Create a staging-only goal to verify the Phase 7 dashboard status page. ' +
  'Create tasks to inspect the staging status data and attach internal evidence.';

const FOLLOW_UP_INSTRUCTION =
  'Create one task to document the verification outcome in an internal note.';

const GATED_INSTRUCTION =
  'Create one task to draft a schema migration plan for owner review.';

function ctxFor(client: ComposerClient, now = NOW): ToolContext {
  return { client, ownerEmail: OWNER, now };
}

async function seedParent(db: ReturnType<typeof makeComposerFakeDb>) {
  const r = await prestonSubmitGoal(ctxFor(db.client), {
    request: HARMLESS_REQUEST, request_id: 'pc-b4-parent-000001',
  });
  if (r.status !== 'accepted') throw new Error('parent seed failed');
  return r.goals[0].goal_id;
}

describe('preston_follow_up_goal', () => {
  it('rejects an invalid or absent parent without persisting anything', async () => {
    const db = makeComposerFakeDb();
    const bad = await prestonFollowUpGoal(ctxFor(db.client), {
      parent_goal_id: 'nope', instruction: FOLLOW_UP_INSTRUCTION,
    });
    expect(bad.status).toBe('rejected');
    expect(bad.errors).toContain('parent_goal_id_invalid');
    const absent = await prestonFollowUpGoal(ctxFor(db.client), {
      parent_goal_id: ABSENT_PARENT, instruction: FOLLOW_UP_INSTRUCTION,
    });
    expect(absent.status).toBe('rejected');
    expect(absent.errors).toContain('parent_not_found');
    expect(db.rowsOf('master_goals')).toHaveLength(0);
    expect(db.rowsOf('os_events')).toHaveLength(0);
  });

  it('creates a FRESH linked goal; parent row untouched; linkage readable from both sides', async () => {
    const db = makeComposerFakeDb();
    const parentId = await seedParent(db);
    const parentRowBefore = JSON.stringify(db.rowsOf('master_goals').find((g) => g.id === parentId));

    const r = await prestonFollowUpGoal(ctxFor(db.client), {
      parent_goal_id: parentId, instruction: FOLLOW_UP_INSTRUCTION,
      request_id: 'pc-b4-child-000001',
    });
    expect(r.status).toBe('accepted');
    if (r.status !== 'accepted') return;
    expect(r.parent_goal_id).toBe(parentId);
    expect(r.parent_status).toBeDefined();
    expect(r.links_recorded).toBe(r.goals.length);
    const childId = r.goals[0].goal_id;
    expect(childId).not.toBe(parentId);

    // Parent goal row byte-identical (no mutation, no appended jobs).
    expect(JSON.stringify(db.rowsOf('master_goals').find((g) => g.id === parentId))).toBe(parentRowBefore);

    // Link event durable + well-formed.
    const link = db.rowsOf('os_events').find((e) => e.id === `ev-goal-link-${childId}`);
    expect(link?.type).toBe('GoalLinked');
    expect(link?.correlation_id).toBe(`link:parent:${parentId}`);
    expect((link?.payload as Record<string, unknown>).parent_goal_id).toBe(parentId);

    // Both directions visible through the read model.
    const child = await prestonGetGoal(ctxFor(db.client), childId);
    if (!child.found) throw new Error('child not found');
    expect(child.parent_goal_id).toBe(parentId);
    const parent = await prestonGetGoal(ctxFor(db.client), parentId);
    if (!parent.found) throw new Error('parent not found');
    expect(parent.child_goal_ids).toContain(childId);
    expect(parent.parent_goal_id).toBeNull();
  });

  it('a gated instruction stays gated - approval gates are never inherited away', async () => {
    const db = makeComposerFakeDb();
    const parentId = await seedParent(db);
    const r = await prestonFollowUpGoal(ctxFor(db.client), {
      parent_goal_id: parentId, instruction: GATED_INSTRUCTION,
      request_id: 'pc-b4-gated-000001',
    });
    expect(r.status).toBe('accepted');
    if (r.status !== 'accepted') return;
    expect(r.approvals_required).toBeGreaterThan(0);
    const childId = r.goals[0].goal_id;
    const gated = db.rowsOf('goal_jobs').filter((j) => j.goal_id === childId && j.requires_approval === true);
    expect(gated.length).toBeGreaterThan(0);
    expect(db.rowsOf('orchestration_approvals').some((a) => a.goal_id === childId)).toBe(true);
  });

  it('replays idempotently: same request_id -> duplicate, same child ids, one link row', async () => {
    const db = makeComposerFakeDb();
    const parentId = await seedParent(db);
    const input = {
      parent_goal_id: parentId, instruction: FOLLOW_UP_INSTRUCTION,
      request_id: 'pc-b4-replay-000001',
    };
    const first = await prestonFollowUpGoal(ctxFor(db.client), input);
    const again = await prestonFollowUpGoal(ctxFor(db.client), input);
    expect(first.status).toBe('accepted');
    expect(again.status).toBe('duplicate');
    if (first.status !== 'accepted' || again.status !== 'duplicate') return;
    expect(again.goals.map((g) => g.goal_id)).toEqual(first.goals.map((g) => g.goal_id));
    const links = db.rowsOf('os_events').filter((e) => String(e.id).startsWith('ev-goal-link-'));
    expect(links).toHaveLength(first.goals.length);
    expect(again.links_recorded).toBe(again.goals.length); // duplicate insert converged
  });

  it('continuation from a completed parent is allowed and reports the parent status', async () => {
    const db = makeComposerFakeDb();
    const parentId = await seedParent(db);
    const parentRow = db.rowsOf('master_goals').find((g) => g.id === parentId)!;
    parentRow.status = 'completed';
    for (const j of db.rowsOf('goal_jobs').filter((x) => x.goal_id === parentId)) j.status = 'completed';
    const r = await prestonFollowUpGoal(ctxFor(db.client), {
      parent_goal_id: parentId, instruction: FOLLOW_UP_INSTRUCTION,
      request_id: 'pc-b4-done-000001',
    });
    expect(r.status).toBe('accepted');
    if (r.status !== 'accepted') return;
    expect(r.parent_status).toBe('completed');
    // The parent stays terminal - continuation never reopens it.
    expect(db.rowsOf('master_goals').find((g) => g.id === parentId)?.status).toBe('completed');
  });

  it('rejected instructions reject exactly like a new goal (secret screen, composer guards)', async () => {
    const db = makeComposerFakeDb();
    const parentId = await seedParent(db);
    const goalsBefore = db.rowsOf('master_goals').length;
    const secretish = ['api_key', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01'].join('=');
    const r = await prestonFollowUpGoal(ctxFor(db.client), {
      parent_goal_id: parentId, instruction: FOLLOW_UP_INSTRUCTION, context: secretish,
    });
    expect(r.status).toBe('rejected');
    expect(db.rowsOf('master_goals')).toHaveLength(goalsBefore);
    expect(db.rowsOf('os_events').filter((e) => String(e.id).startsWith('ev-goal-link-'))).toHaveLength(0);
  });
});
