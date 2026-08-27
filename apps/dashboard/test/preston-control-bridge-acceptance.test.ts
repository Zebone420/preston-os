import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import { driveGoal } from '../src/lib/ai-os/orchestration/driver';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { TOOL_NAMES } from '../src/lib/preston-control/server';
import { buildOpenApiDocument } from '../src/lib/preston-control/openapi';
import {
  prestonCancelGoal,
  prestonFollowUpGoal,
  prestonGetGoal,
  prestonGetJob,
  prestonSubmitGoal,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';

// Bridge completeness acceptance (B5 pre-staging, unit level): the full owner
// loop over the SHARED service layer - submit -> runtime drive (simulation)
// -> per-job read with readable result -> follow-up -> owner-confirmed
// cancel - plus transport-parity pins (MCP catalogue vs OpenAPI document).
// The staging drill (G1-G12) re-proves this on the live staging deployment.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-26T12:00:00.000Z';

const SINGLE_TASK_REQUEST =
  'Create a staging-only goal to verify the bridge acceptance path. ' +
  'Create one task to attach internal evidence of the acceptance run.';

function ctxFor(client: ComposerClient, now = NOW): ToolContext {
  return { client, ownerEmail: OWNER, now };
}

const lockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/src/'],
  token: (jobId: string) => `tok-${jobId}`,
};

describe('bridge acceptance - full owner loop over the shared layer', () => {
  it('submit -> drive -> readable result -> follow-up -> cancel', async () => {
    const db = makeComposerFakeDb();
    const ctx = ctxFor(db.client);

    // 1. Delegate (ChatGPT surface).
    const submitted = await prestonSubmitGoal(ctx, {
      request: SINGLE_TASK_REQUEST, request_id: 'pc-acc-loop-000001',
    });
    expect(submitted.status).toBe('accepted');
    if (submitted.status !== 'accepted') return;
    const goalId = submitted.goals[0].goal_id;
    const jobId = submitted.goals[0].jobs[0].job_id;

    // 2. Runtime drives it (simulation adapter; same driver the host runs).
    // Clock anchored to the fake DB's pinned goal created_at so the engine's
    // wall deadline (measured from creation) is not already exceeded.
    let t = Date.parse('2026-07-28T15:00:05.000Z');
    const driven = await driveGoal(
      db.client as unknown as RuntimeClient, goalId, () => (t += 1000), 100,
      () => [], lockCtx,
    );
    expect(driven.reason).toBe('completed');

    // 3. Owner reads what happened - job-level, with a readable result.
    const job = await prestonGetJob(ctx, jobId);
    if (!job.found) throw new Error('job not found');
    expect(job.job.status).toBe('completed');
    expect(job.result_reports).toHaveLength(1);
    expect(job.result_reports[0].outcome).toBe('completed');
    expect(job.result_reports[0].mode).toBe('simulation');
    expect(job.result_reports[0].summary.length).toBeGreaterThan(0);

    // 4. Follow-up on the completed goal -> fresh linked goal.
    const followUp = await prestonFollowUpGoal(ctx, {
      parent_goal_id: goalId,
      instruction: 'Create one task to attach internal evidence of the follow-up run.',
      request_id: 'pc-acc-loop-000002',
    });
    expect(followUp.status).toBe('accepted');
    if (followUp.status !== 'accepted') return;
    const childId = followUp.goals[0].goal_id;
    expect(childId).not.toBe(goalId);
    const child = await prestonGetGoal(ctx, childId);
    if (!child.found) throw new Error('child not found');
    expect(child.parent_goal_id).toBe(goalId);

    // 5. Owner-confirmed cancel of the continuation.
    const cancelled = await prestonCancelGoal(ctx, {
      goal_id: childId, owner_confirmation: `Cancel goal ${childId}`,
    });
    expect(cancelled.ok).toBe(true);
    // 6. The original goal is untouched by the cancel.
    const parentAfter = await prestonGetGoal(ctx, goalId);
    if (!parentAfter.found) throw new Error('parent not found');
    expect(parentAfter.goal.status).toBe('completed');
  });
});

describe('bridge acceptance - transport parity (G12)', () => {
  const doc = buildOpenApiDocument('https://example.test');
  const ops = Object.values(doc.paths as Record<string, Record<string, {
    operationId: string; description: string; 'x-openai-isConsequential': boolean;
  }>>).flatMap((p) => Object.values(p));

  it('every MCP tool has exactly one GPT Actions operation (same count, no drift)', () => {
    expect(TOOL_NAMES).toHaveLength(10);
    expect(ops).toHaveLength(10);
    const expectPairs: Array<[string, string]> = [
      ['preston_status', 'getPrestonStatus'],
      ['preston_submit_goal', 'submitPrestonGoal'],
      ['preston_follow_up_goal', 'followUpPrestonGoal'],
      ['preston_get_goal', 'getPrestonGoal'],
      ['preston_get_job', 'getPrestonJob'],
      ['preston_list_approvals', 'listPrestonApprovals'],
      ['preston_decide_approval', 'decidePrestonApproval'],
      ['preston_cancel_goal', 'cancelPrestonGoal'],
      ['preston_get_evidence', 'getPrestonEvidence'],
      // Power-station artifact readback (read-only, non-consequential).
      ['preston_get_artifact', 'getPrestonArtifact'],
    ];
    const opIds = new Set(ops.map((o) => o.operationId));
    for (const [tool, op] of expectPairs) {
      expect(TOOL_NAMES).toContain(tool);
      expect(opIds.has(op), `missing operation ${op}`).toBe(true);
    }
  });

  it('every operation description fits the GPT Actions 300-char import limit', () => {
    for (const o of ops) {
      expect(o.description.length, `${o.operationId} description too long`).toBeLessThanOrEqual(300);
    }
  });

  it('exactly the owner-decision writes are consequential', () => {
    const consequential = ops.filter((o) => o['x-openai-isConsequential']).map((o) => o.operationId).sort();
    expect(consequential).toEqual(['cancelPrestonGoal', 'decidePrestonApproval']);
  });
});
