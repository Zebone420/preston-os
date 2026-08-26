import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  prestonGetJob,
  readJobResultReports,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';

// Bridge B1: first-class per-job read. Pins: projection allowlist, run
// liveness, linked-approval restatement, per-attempt result reports (B2
// events), and fail-closed handling of invalid/absent ids.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-26T12:00:00.000Z';
const GOAL_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

const FAKE_VALUE = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ0123'].join('');
const planted = (name: string) => `${name}=${FAKE_VALUE}`;

function ctxFor(client: ComposerClient, now = NOW): ToolContext {
  return { client, ownerEmail: OWNER, now };
}

function seedJob(db: ReturnType<typeof makeComposerFakeDb>, extra: Record<string, unknown> = {}) {
  db.rowsOf('master_goals').push({
    id: GOAL_ID, title: 'g', objective: 'o', source: 'dashboard',
    requested_by: OWNER, status: 'running', environment: 'staging',
    correlation_id: 'cmp-b1-job', simulation_only: true, iteration: 1,
    created_at: NOW, updated_at: NOW,
  });
  db.rowsOf('goal_jobs').push({
    id: JOB_ID, goal_id: GOAL_ID, kind: 'documentation', title: 'write summary',
    objective: 'summarize the drill', status: 'completed', risk_class: 'GREEN',
    assigned_role: 'claude', attempts: 1, requires_approval: false,
    approval_id: null, evidence_refs: ['real:goal:x:job:y:run:z:attempt:1:completed:executed:true'],
    failure_reason: null, run_id: null, run_lease_expires_at: null,
    created_at: NOW, updated_at: NOW, ...extra,
  });
}

function seedResultEvent(db: ReturnType<typeof makeComposerFakeDb>, attempt: number, payload: Record<string, unknown> = {}) {
  db.rowsOf('os_events').push({
    id: `ev-result-${JOB_ID}-${attempt}`,
    type: 'JobResultRecorded', actor: 'claude',
    correlation_id: `result:job:${JOB_ID}`,
    payload: {
      goal_id: GOAL_ID, job_id: JOB_ID, run_id: `${JOB_ID}:r${attempt}`,
      attempt, outcome: 'completed', executed: true, mode: 'real',
      provider_role: 'claude', summary: 'REAL level-1 documentation run completed (exit 0, bounded)',
      failure_reason: null,
      result_excerpt: 'Wrote the summary of the staging drill into docs.',
      files_changed: ['docs/summary.md'], evidence_refs: [],
      ...payload,
    },
    created_at: NOW,
  });
}

describe('preston_get_job', () => {
  it('rejects invalid ids and reports absent jobs distinctly', async () => {
    const db = makeComposerFakeDb();
    expect(await prestonGetJob(ctxFor(db.client), 'nope')).toEqual({ found: false, error: 'job_id_invalid' });
    expect(await prestonGetJob(ctxFor(db.client), JOB_ID)).toEqual({ found: false, error: 'not_found' });
  });

  it('returns the projected job with run liveness and result reports', async () => {
    const db = makeComposerFakeDb();
    seedJob(db);
    seedResultEvent(db, 1);
    const r = await prestonGetJob(ctxFor(db.client), JOB_ID);
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.job.job_id).toBe(JOB_ID);
    expect(r.job.goal_id).toBe(GOAL_ID);
    expect(r.job.status).toBe('completed');
    expect(r.run.active).toBe(false);
    expect(r.approval).toBeNull();
    expect(r.result_reports_read_ok).toBe(true);
    expect(r.result_reports).toHaveLength(1);
    expect(r.result_reports[0].outcome).toBe('completed');
    expect(r.result_reports[0].executed).toBe(true);
    expect(r.result_reports[0].result_excerpt).toContain('staging drill');
    expect(r.result_reports[0].files_changed).toEqual(['docs/summary.md']);
    // Projection discipline: no raw row spread, no run_id leak on the job.
    expect(Object.keys(r.job)).not.toContain('run_id');
  });

  it('reports an in-flight run as active while the lease is live', async () => {
    const db = makeComposerFakeDb();
    seedJob(db, {
      status: 'in_progress', run_id: `${JOB_ID}:r2`,
      run_lease_expires_at: '2026-08-26T12:09:00.000Z',
    });
    const r = await prestonGetJob(ctxFor(db.client), JOB_ID);
    if (!r.found) throw new Error('expected found');
    expect(r.run.active).toBe(true);
    expect(r.run.lease_expires_at).toBe('2026-08-26T12:09:00.000Z');
    // Expired lease -> not active (recovery pending, not progress).
    const r2 = await prestonGetJob(ctxFor(db.client, '2026-08-26T12:30:00.000Z'), JOB_ID);
    if (!r2.found) throw new Error('expected found');
    expect(r2.run.active).toBe(false);
  });

  it('restates the linked approval through the same projection discipline', async () => {
    const db = makeComposerFakeDb();
    seedJob(db, { requires_approval: true, status: 'awaiting_approval', approval_id: 'apr-b1-restate-000001' });
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-b1-restate-000001', goal_id: GOAL_ID, job_id: JOB_ID,
      action: 'execute_goal_job', affected_resource: `goal_job:${JOB_ID}`,
      reason: 'gated', risk_class: 'RED', environment: 'staging',
      expected_effect: 'run the job', rollback_plan: 'none', status: 'pending',
      nonce: 'should-never-surface', action_hash: 'hash', owner_identity: OWNER,
      created_at: NOW, expires_at: '2026-08-27T12:00:00.000Z', decided_at: null,
    });
    const r = await prestonGetJob(ctxFor(db.client), JOB_ID);
    if (!r.found) throw new Error('expected found');
    expect(r.approval?.approval_id).toBe('apr-b1-restate-000001');
    expect(r.approval && 'nonce' in r.approval).toBe(false);
    expect(r.approval && 'action_hash' in r.approval).toBe(false);
  });

  it('orders multi-attempt result reports by attempt and screens secret-shaped text', async () => {
    const db = makeComposerFakeDb();
    seedJob(db, { attempts: 2 });
    seedResultEvent(db, 2, { outcome: 'completed' });
    seedResultEvent(db, 1, {
      outcome: 'failed', executed: false, failure_reason: 'exit_1',
      result_excerpt: planted(['api', 'key'].join('_')),
    });
    const r = await readJobResultReports(ctxFor(db.client), JOB_ID);
    expect(r.read_ok).toBe(true);
    expect(r.reports.map((x) => x.attempt)).toEqual([1, 2]);
    expect(r.reports[0].failure_reason).toBe('exit_1');
    // A secret-shaped stored value is redacted on the way OUT, defense in
    // depth behind the runtime-side sanitizer.
    expect(r.reports[0].result_excerpt).toBe('[redacted]');
    expect(r.reports[1].outcome).toBe('completed');
  });

  it('absence of result events is a normal empty state, not an error', async () => {
    const db = makeComposerFakeDb();
    seedJob(db);
    const r = await prestonGetJob(ctxFor(db.client), JOB_ID);
    if (!r.found) throw new Error('expected found');
    expect(r.result_reports_read_ok).toBe(true);
    expect(r.result_reports).toEqual([]);
  });
});
