import { describe, expect, it, vi } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';

// ===========================================================================
// COMPOSER LIFECYCLE (integration): one natural-language owner request flows
// through the REAL internal boundaries end to end, against the fake in-memory
// store: compose action -> proposal (nothing persisted) -> owner confirmation
// -> durable goal/jobs/deps/approvals -> owner approval decision -> durable
// driver (simulation adapters) -> evidence refs -> read-model summary.
// The owner decision uses the app-side decideApproval CAS; on the migrated
// staging DB the ONLY decision path is the owner-run RPC
// decide_orchestration_approval (UPDATE is revoked) - this test proves the
// LOGIC, the staging drill proves the database enforcement.
// ===========================================================================

const resolveOwnerMock = vi.fn();

vi.mock('@/lib/ai-os/owner-context', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/ai-os/owner-context')>();
  return { ...real, resolveOwner: () => resolveOwnerMock() };
});

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  composeProposalAction,
  confirmProposalAction,
} from '../src/app/os/composer/actions';
import { INITIAL_COMPOSER_STATE } from '../src/app/os/composer/state';
import { decideApproval } from '../src/lib/ai-os/orchestration/store';
import { driveGoal } from '../src/lib/ai-os/orchestration/driver';
import { loadOrchestrationReadModel } from '../src/lib/ai-os/orchestration/read-model';

const OWNER = 'info@preston.nyc';
const NOW = '2026-07-28T15:00:00.000Z';

// The Phase F lifecycle request: harmless, dashboard-only, staging-only.
const LIFECYCLE_REQUEST =
  'Create a staging-only goal to verify the Phase 7 dashboard status page. ' +
  'Create tasks to inspect the staging status data, generate a ' +
  'simulation-only readiness summary, and attach internal evidence. ' +
  'Do not deploy, send messages, access production, change credentials, ' +
  'perform financial actions, or make external writes.';

// Gated variant: adds a migration-kind task so the approval boundary and the
// owner decision are exercised inside ONE goal lifecycle.
const GATED_REQUEST =
  'Create a staging-only goal to prepare the Phase 7 schema evidence. ' +
  'Create tasks to draft a schema migration plan for owner review, ' +
  'and summarize the plan in a local report.';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function lockCtx() {
  return {
    base_commit: 'abc1234',
    allowed_paths: ['apps/dashboard/src/'],
    token: (j: string) => `tok-${j}`,
  };
}

function dependsFrom(db: ReturnType<typeof makeComposerFakeDb>) {
  return (jobId: string) =>
    db.rowsOf('job_dependencies')
      .filter((r) => String(r.job_id) === jobId)
      .map((r) => String(r.depends_on_job_id));
}

describe('composer lifecycle - all-GREEN goal completes in simulation', () => {
  it('request -> proposal -> confirm -> drive -> evidence -> read model', async () => {
    const db = makeComposerFakeDb();
    resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client: db.client, audit: {} });

    // (1/2) natural-language request -> interpretation -> structured proposal
    const p = await composeProposalAction(INITIAL_COMPOSER_STATE,
      fd({ request: LIFECYCLE_REQUEST }));
    expect(p.step).toBe('proposal');
    if (!p.proposal) throw new Error('no proposal');
    expect(p.proposal.goals[0].tasks).toHaveLength(3);
    // (5) durable records do NOT exist before confirmation
    expect(db.rowsOf('master_goals')).toHaveLength(0);

    // (6/7) owner confirmation -> exactly one goal graph
    const done = await confirmProposalAction(INITIAL_COMPOSER_STATE, fd({
      raw_request: p.raw_request,
      request_key: p.request_key,
      proposal_hash: p.proposal.proposal_hash,
    }));
    expect(done.step).toBe('created');
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    expect(db.rowsOf('goal_jobs')).toHaveLength(3);
    const goalId = done.created[0].goal_id;

    // duplicate confirmation does not duplicate the graph
    const again = await confirmProposalAction(INITIAL_COMPOSER_STATE, fd({
      raw_request: p.raw_request,
      request_key: p.request_key,
      proposal_hash: p.proposal.proposal_hash,
    }));
    expect(again.replayed).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(1);

    // (10) simulated orchestration drives the goal to completion
    let t = Date.parse(NOW);
    const res = await driveGoal(db.client, goalId, () => (t += 1000), 200,
      dependsFrom(db), lockCtx());
    expect(res.reason).toBe('completed');

    // (11) evidence captured on every job, bound to the run
    for (const j of db.rowsOf('goal_jobs')) {
      expect(j.status).toBe('completed');
      expect((j.evidence_refs as string[]).length).toBeGreaterThan(0);
    }
    expect(db.rowsOf('master_goals')[0].status).toBe('completed');

    // (12) the dashboard read model shows the final lifecycle state
    const rm = await loadOrchestrationReadModel(db.client, 20);
    expect(rm.applied).toBe(true);
    expect(rm.summary.total_goals).toBe(1);
    expect(rm.summary.open_approvals).toBe(0);
    expect(rm.summary.failed_jobs).toBe(0);
    expect(String(rm.goals.rows[0].status)).toBe('completed');

    // (13-16) no prohibited side effect; safety posture unchanged
    const controls = db.rowsOf('system_controls')[0];
    expect(controls.execution_enabled).toBe(false);
    expect(controls.remote_runner_enabled).toBe(false);
    expect(controls.hermes_mode).toBe('observe_only');
    for (const j of db.rowsOf('goal_jobs')) expect(j.executed).toBe(false);
    expect(db.rowsOf('master_goals')[0].simulation_only).toBe(true);
  });
});

describe('composer lifecycle - gated goal blocks, owner decides, completes', () => {
  it('approval is created pending, blocks the driver, and unlocks only after decision', async () => {
    const db = makeComposerFakeDb();
    resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client: db.client, audit: {} });

    const p = await composeProposalAction(INITIAL_COMPOSER_STATE,
      fd({ request: GATED_REQUEST }));
    if (!p.proposal) throw new Error('no proposal');
    // (4) policy classification: the migration task is flagged for approval
    const gatedTask = p.proposal.goals[0].tasks.find((t) => t.kind === 'migration')!;
    expect(gatedTask.requires_approval).toBe(true);
    expect(p.proposal.approvals_required).toBe(1);

    const done = await confirmProposalAction(INITIAL_COMPOSER_STATE, fd({
      raw_request: p.raw_request,
      request_key: p.request_key,
      proposal_hash: p.proposal.proposal_hash,
    }));
    expect(done.step).toBe('created');
    const goalId = done.created[0].goal_id;

    // (8) the approval exists, PENDING, owner- and job-bound
    const approvals = db.rowsOf('orchestration_approvals');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].status).toBe('pending');
    const approvalId = String(approvals[0].approval_id);

    // the driver parks the gated job; the GREEN job completes
    let t = Date.parse(NOW);
    const parked = await driveGoal(db.client, goalId, () => (t += 1000), 200,
      dependsFrom(db), lockCtx());
    expect(parked.reason).toBe('awaiting_owner_approval');
    const gated = db.rowsOf('goal_jobs').find((j) => j.requires_approval === true)!;
    expect(gated.status).toBe('awaiting_approval');

    // an undecided approval NEVER unlocks - drive again, still parked
    const still = await driveGoal(db.client, goalId, () => (t += 1000), 200,
      dependsFrom(db), lockCtx());
    expect(still.reason).toBe('awaiting_owner_approval');

    // (9) the owner decision (app-side CAS; the staging path is the 0010 RPC)
    const decided = await decideApproval(db.client, approvalId, 'approved',
      `nonce-${approvalId}`, new Date(t).toISOString());
    expect(decided.ok).toBe(true);
    // a second decision is refused (one-time)
    const replayed = await decideApproval(db.client, approvalId, 'approved',
      `nonce2-${approvalId}`, new Date(t).toISOString());
    expect(replayed.ok).toBe(false);

    // (10/11) the driver verifies the canonical hash and completes the goal
    const res = await driveGoal(db.client, goalId, () => (t += 1000), 200,
      dependsFrom(db), lockCtx());
    expect(res.reason).toBe('completed');
    expect(db.rowsOf('master_goals')[0].status).toBe('completed');
    const gatedAfter = db.rowsOf('goal_jobs').find((j) => j.id === gated.id)!;
    expect(gatedAfter.status).toBe('completed');
    expect(gatedAfter.requires_approval).toBe(false);
    expect((gatedAfter.evidence_refs as string[]).length).toBeGreaterThan(0);

    // (12) read model shows the completed lifecycle, no open approvals
    const rm = await loadOrchestrationReadModel(db.client, 20);
    expect(rm.summary.open_approvals).toBe(0);
    expect(String(rm.goals.rows[0].status)).toBe('completed');

    // (13-16) safety posture unchanged; nothing executed for real
    const controls = db.rowsOf('system_controls')[0];
    expect(controls.execution_enabled).toBe(false);
    expect(controls.remote_runner_enabled).toBe(false);
    expect(controls.hermes_mode).toBe('observe_only');
    for (const j of db.rowsOf('goal_jobs')) expect(j.executed).toBe(false);
  });
});
