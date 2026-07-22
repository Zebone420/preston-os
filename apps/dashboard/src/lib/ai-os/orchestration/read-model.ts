// Preston AI OS - Phase 7 orchestration read model. Server-side, owner-scoped
// (RLS-bound client). Bounded, fail-closed reads for the Command Center:
// goals, jobs, open approvals, failures, and dead-letter items. Distinguishes
// three states per bucket: applied+data, applied+empty, and MIGRATION-ABSENT
// (0010 not applied => the underlying relation does not exist). Never throws;
// never fabricates rows. Reuses the store read adapters (no duplicate queries).

import type { RuntimeClient } from '../store';
import {
  listGoals,
  listJobsForGoal,
  listOpenApprovals,
  type ListOutcome,
} from './store';

export type ReadState = 'ok' | 'empty' | 'migration_absent' | 'error';

export interface Bucket {
  state: ReadState;
  rows: Record<string, unknown>[];
  note?: string;
}

// A read error mentioning a missing relation means migration 0010 is not
// applied yet - a distinct, expected state the UI renders calmly (not an error).
function classify(res: ListOutcome): Bucket {
  if (res.ok) {
    return res.rows.length > 0
      ? { state: 'ok', rows: res.rows }
      : { state: 'empty', rows: [] };
  }
  const msg = res.error ?? '';
  if (/does not exist|relation .* does not exist|undefined table|42P01/i.test(msg)) {
    return { state: 'migration_absent', rows: [], note: 'migration 0010 not applied' };
  }
  return { state: 'error', rows: [], note: msg };
}

export interface OrchestrationReadModel {
  applied: boolean; // false when 0010 tables are absent
  goals: Bucket;
  approvals: Bucket;
  jobs: Bucket; // jobs for the most recent goals (bounded)
  failures: Bucket; // jobs in status 'failed'
  dead_letters: Bucket; // jobs in status 'dead_lettered'
  summary: {
    total_goals: number;
    running_goals: number;
    blocked_goals: number;
    open_approvals: number;
    failed_jobs: number;
    dead_lettered_jobs: number;
  };
}

const str = (r: Record<string, unknown>, k: string) => String(r[k] ?? '');

// Build the read model. Bounded: at most `goalLimit` goals and their jobs.
export async function loadOrchestrationReadModel(
  client: RuntimeClient,
  goalLimit = 20,
): Promise<OrchestrationReadModel> {
  const goalsRes = await listGoals(client, goalLimit);
  const goals = classify(goalsRes);
  const approvals = classify(await listOpenApprovals(client, 50));

  // If the goals relation is absent, every Phase-7 table is; short-circuit.
  const applied = goals.state !== 'migration_absent';
  if (!applied) {
    const absent: Bucket = { state: 'migration_absent', rows: [], note: 'migration 0010 not applied' };
    return {
      applied: false, goals, approvals: absent, jobs: absent,
      failures: absent, dead_letters: absent,
      summary: { total_goals: 0, running_goals: 0, blocked_goals: 0, open_approvals: 0, failed_jobs: 0, dead_lettered_jobs: 0 },
    };
  }

  // Gather jobs for the loaded goals (bounded).
  const allJobs: Record<string, unknown>[] = [];
  let jobsErr: string | undefined;
  for (const g of goals.rows) {
    const jr = await listJobsForGoal(client, str(g, 'id'), 200);
    if (!jr.ok) { jobsErr = jr.error; continue; }
    allJobs.push(...jr.rows);
  }
  const jobs: Bucket = jobsErr && allJobs.length === 0
    ? { state: 'error', rows: [], note: jobsErr }
    : allJobs.length > 0 ? { state: 'ok', rows: allJobs } : { state: 'empty', rows: [] };

  const failedRows = allJobs.filter((j) => str(j, 'status') === 'failed');
  const deadRows = allJobs.filter((j) => str(j, 'status') === 'dead_lettered');

  return {
    applied: true,
    goals,
    approvals,
    jobs,
    failures: failedRows.length ? { state: 'ok', rows: failedRows } : { state: 'empty', rows: [] },
    dead_letters: deadRows.length ? { state: 'ok', rows: deadRows } : { state: 'empty', rows: [] },
    summary: {
      total_goals: goals.rows.length,
      running_goals: goals.rows.filter((g) => str(g, 'status') === 'running').length,
      blocked_goals: goals.rows.filter((g) => str(g, 'status') === 'blocked').length,
      open_approvals: approvals.state === 'ok' ? approvals.rows.length : 0,
      failed_jobs: failedRows.length,
      dead_lettered_jobs: deadRows.length,
    },
  };
}
