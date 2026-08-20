// Regression: post-approval resume must not be dead-lettered by owner
// decision latency (live staging drill finding, 2026-08-07, goal cef03ae2).
//
// Observed on the deployed host: a gated migration job's approval was decided
// ~hours after goal creation; the next orchestrator tick authoritatively
// verified the approval and cleared the gate to 'ready', but the completion
// engine's wall deadline (budget.max_wall_ms, measured from goal CREATION)
// fired BEFORE scheduling - the ready job was never selected (attempts stayed
// 0), the goal dead-lettered, and driveGoal re-stepped the terminal verdict to
// its cycle bound (cycles:11, iteration 11, one reserved iteration per cycle).
//
// Fixes pinned here:
//  1. The wall deadline measures from the LATEST authoritatively verified
//     approval decision bound to the goal's jobs (durable decided_at anchor),
//     so owner latency never consumes the active-driving budget.
//  2. driveGoal exits on the engine's terminal verdict (done) - a genuine
//     deadline dead-letters in ONE cycle, with ONE reserved iteration.
//  3. Approval semantics unchanged: an unverifiable record (wrong hash)
//     neither unlocks NOR anchors - the creation-time deadline stays in force.

import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { driveGoal } from '../src/lib/ai-os/orchestration/driver';
import {
  insertJobApproval,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';
import { clearGateRpc } from './_clear-gate-rpc';

const NOW = '2026-08-07T00:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const t0 = Date.parse(NOW);

// Same PK-unique + CAS-eq fake as orchestration-driver.test.ts, with a
// permissive controls row (simulation may run; owner_stop=false).
function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? {
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row[key] ?? 'x' }], error: null });
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
              return Promise.resolve({ data: matched.map((r) => ({ id: r[pk(table)] })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  (client as unknown as { rpc?: unknown }).rpc = clearGateRpc(rowsOf);
  return { client, rowsOf };
}

function goal(): MasterGoal {
  return {
    id: 'goal-resume-001', title: 'phone drill', objective: 'o', source: 'dashboard',
    requested_by: 'owner@preston.nyc', status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-resume', simulation_only: true,
    created_at: NOW, updated_at: NOW,
  };
}

function docJobRow(id: string) {
  return {
    id, goal_id: 'goal-resume-001', kind: 'documentation', title: 'write summary',
    objective: 'summarize drill', risk_class: 'GREEN', assigned_role: 'claude',
    status: 'pending', attempts: 0, requires_approval: false, approval_id: null,
    runtime_job_id: null, correlation_id: 'corr-resume', evidence_refs: [],
    failure_reason: null, run_id: null, run_lease_expires_at: null,
    executed: false, created_at: NOW, updated_at: NOW,
  };
}

const MIG = {
  id: 'job-resume-mig', kind: 'migration', objective: 'draft a schema migration plan',
  title: 'draft migration plan', risk_class: 'YELLOW', assigned_role: 'claude',
};

function migJobRow() {
  return {
    id: MIG.id, goal_id: 'goal-resume-001', kind: MIG.kind, title: MIG.title,
    objective: MIG.objective, risk_class: MIG.risk_class, assigned_role: MIG.assigned_role,
    status: 'pending', attempts: 0, requires_approval: true, approval_id: 'apr-resume-0001',
    runtime_job_id: null, correlation_id: 'corr-resume', evidence_refs: [],
    failure_reason: null, run_id: null, run_lease_expires_at: null,
    executed: false, created_at: NOW, updated_at: NOW,
  };
}

// Edit-capable kinds (documentation/migration) need the worktree lock the
// deployed worker always has.
const lockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/'],
  token: (jobId: string) => `tok-${jobId}`,
};

// insertMasterGoal leaves created_at to the DB default (now()); the fake has
// no defaults, and an absent created_at parses NaN which DISARMS the engine's
// wall deadline entirely - the tests would pass vacuously. Stamp what the
// real database stamps.
async function insertGoalRow(db: ReturnType<typeof makeFakeDb>) {
  const ins = await insertMasterGoal(db.client, goal());
  expect(ins.ok).toBe(true);
  db.rowsOf('master_goals')[0].created_at = NOW;
}

async function seed(db: ReturnType<typeof makeFakeDb>) {
  await insertGoalRow(db);
  db.rowsOf('goal_jobs').push(docJobRow('job-resume-doc'), migJobRow());
  // Pending approval minted at goal creation; hash derived internally from
  // the SAME job fields the driver verifies (end-to-end binding).
  const ins = await insertJobApproval(db.client, {
    approval_id: 'apr-resume-0001', goal_id: 'goal-resume-001',
    job: { id: MIG.id, kind: MIG.kind, objective: MIG.objective, title: MIG.title, risk_class: MIG.risk_class, assigned_role: MIG.assigned_role },
    owner_identity: 'owner@preston.nyc',
    created_at: NOW, expires_at: iso(t0 + 20 * HOUR),
  });
  expect(ins.ok).toBe(true);
}

const clock = (startMs: number) => { let t = startMs; return () => (t += 1000); };

describe('post-approval resume - owner latency does not consume the wall budget', () => {
  it('parked migration -> late owner approval -> gate clears to ready -> runs in simulation -> goal completes', async () => {
    const db = makeFakeDb();
    await seed(db);

    // Drive 1: ungated doc job completes; gated migration parks. No approval yet.
    const r1 = await driveGoal(db.client, 'goal-resume-001', clock(t0), 20, () => [], lockCtx);
    expect(r1.reason).toBe('awaiting_owner_approval');
    const jobs = () => db.rowsOf('goal_jobs');
    expect(jobs().find((j) => j.id === 'job-resume-doc')!.status).toBe('completed');
    expect(jobs().find((j) => j.id === MIG.id)!.status).toBe('awaiting_approval');
    const iterAfterPark = Number(db.rowsOf('master_goals')[0].iteration);

    // Owner decides LATE: 7h after creation - PAST the 6h max_wall_ms, but
    // well inside the approval's own 20h validity window.
    const decidedMs = t0 + 7 * HOUR;
    Object.assign(db.rowsOf('orchestration_approvals')[0], {
      status: 'approved', decided_at: iso(decidedMs), nonce: 'nonce-resume-1',
    });

    // Drive 2 (fresh call = restart-safe resume) starting after the decision.
    const r2 = await driveGoal(db.client, 'goal-resume-001', clock(decidedMs + 60_000), 20, () => [], lockCtx);
    expect(r2.reason).toBe('completed'); // NOT deadline_exceeded
    const mig = jobs().find((j) => j.id === MIG.id)!;
    expect(mig.status).toBe('completed');
    expect(mig.requires_approval).toBe(false);
    expect(Number(mig.attempts)).toBe(1); // the ready job actually ran
    expect(jobs().every((j) => j.executed === false)).toBe(true);
    expect(db.rowsOf('master_goals')[0].status).toBe('completed');

    // No deadline loop: the resume spends a small bounded number of cycles
    // and reserves at most a couple of iterations - never the cycle bound.
    expect(r2.cycles).toBeLessThanOrEqual(4);
    const iterAfterResume = Number(db.rowsOf('master_goals')[0].iteration);
    expect(iterAfterResume - iterAfterPark).toBeLessThanOrEqual(2);
  });

  it('a genuine wall deadline (no verified approval) still dead-letters - in ONE cycle, ONE iteration', async () => {
    const db = makeFakeDb();
    await insertGoalRow(db);
    // realistic: the goal had been driven before stalling (dead_lettered is
    // reachable from running/blocked, not from decomposed).
    db.rowsOf('master_goals')[0].status = 'running';
    db.rowsOf('goal_jobs').push(docJobRow('job-resume-doc'));

    // First touched 7h after creation with NO approval anywhere: the
    // creation-time deadline is in force and must still fail closed.
    const r = await driveGoal(db.client, 'goal-resume-001', clock(t0 + 7 * HOUR), 20, () => [], lockCtx);
    expect(r.reason).toBe('deadline_exceeded');
    expect(r.halted).toBe(false);
    // Terminal-verdict exit: no re-stepping to the cycle bound (was 11 live).
    expect(r.cycles).toBe(1);
    expect(Number(db.rowsOf('master_goals')[0].iteration)).toBe(1);
    expect(db.rowsOf('master_goals')[0].status).toBe('dead_lettered');
    const doc = db.rowsOf('goal_jobs').find((j) => j.id === 'job-resume-doc')!;
    expect(doc.status).toBe('pending'); // never ran
    expect(Number(doc.attempts)).toBe(0);
    expect(doc.executed).toBe(false);
  });

  it('an unverifiable "approved" record (wrong hash) neither unlocks nor extends the wall anchor', async () => {
    const db = makeFakeDb();
    await insertGoalRow(db);
    // parked once before (dead_lettered is reachable from blocked).
    db.rowsOf('master_goals')[0].status = 'blocked';
    db.rowsOf('goal_jobs').push(docJobRow('job-resume-doc'), migJobRow());
    // Forged record: claims approved with a late decided_at, but its hash
    // does not bind the action - it must not anchor the deadline either.
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-resume-0001', goal_id: 'goal-resume-001', job_id: MIG.id,
      status: 'approved', owner_identity: 'owner@preston.nyc',
      action_hash: 'not-the-canonical-hash', environment: 'staging',
      nonce: 'nonce-forged', decided_at: iso(t0 + 7 * HOUR),
      created_at: NOW, expires_at: iso(t0 + 20 * HOUR),
    });

    const r = await driveGoal(db.client, 'goal-resume-001', clock(t0 + 7 * HOUR + 60_000), 20, () => [], lockCtx);
    // Deadline fires from CREATION (forged decision never anchored it).
    expect(r.reason).toBe('deadline_exceeded');
    expect(r.cycles).toBe(1);
    expect(r.unlockRefusals).toEqual([{ job_id: MIG.id, reason: 'action_hash_mismatch' }]);
    const mig = db.rowsOf('goal_jobs').find((j) => j.id === MIG.id)!;
    expect(mig.status).toBe('pending'); // still gated, never cleared, never ran
    expect(mig.requires_approval).toBe(true);
    expect(Number(mig.attempts)).toBe(0);
    expect(db.rowsOf('goal_jobs').every((j) => j.executed === false)).toBe(true);
  });
});
