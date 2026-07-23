// Preston AI OS - Phase 7 orchestration read model. Server-side, owner-scoped
// (RLS-bound client). Bounded, fail-closed reads for the Command Center:
// goals, jobs, open approvals, failures, and dead-letter items. Distinguishes
// three states per bucket: applied+data, applied+empty, and MIGRATION-ABSENT
// (0010 not applied => the underlying relation does not exist). Never throws;
// never fabricates rows. Reuses the store read adapters (no duplicate queries).

import type { RuntimeClient } from '../store';
import { readSystemControlsChecked } from '../store';
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
// applied yet - a distinct, expected state the UI renders calmly (not an
// error). Shared with the dispatcher's orchestrate-once command so both
// surfaces classify the not-yet-applied state identically.
export function isMigrationAbsentError(msg: string): boolean {
  return /does not exist|relation .* does not exist|undefined table|42P01/i.test(msg);
}

function classify(res: ListOutcome): Bucket {
  if (res.ok) {
    return res.rows.length > 0
      ? { state: 'ok', rows: res.rows }
      : { state: 'empty', rows: [] };
  }
  const msg = res.error ?? '';
  if (isMigrationAbsentError(msg)) {
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
  // ANY per-goal job read failure marks the whole bucket 'error' (audit MAJOR):
  // a partial success would otherwise mask the omission and let readiness report
  // healthy on incomplete data (and undercount failures/dead-letters). Rows that
  // did load are retained for display, but the state is fail-closed 'error'.
  const jobs: Bucket = jobsErr
    ? { state: 'error', rows: allJobs, note: jobsErr }
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

// ---------------------------------------------------------------------------
// Bridge readiness / health (bridge item 13): a single, remotely-inspectable,
// fail-closed signal the owner can read (phone/dashboard) to know whether the
// bridge is safe and operable WITHOUT touching the laptop. It answers: is
// migration 0010 applied, are the safety controls readable and in the expected
// simulation-safe posture (execution OFF, remote runner OFF, Hermes observe-
// only), is the runtime halted (owner_stop/paused), and what is the work
// backlog (open approvals, failures, dead-letters). Never throws.
export interface BridgeReadiness {
  migration_applied: boolean;
  controls_readable: boolean;
  execution_enabled: boolean;
  remote_runner_enabled: boolean;
  hermes_mode: string;
  owner_stop: boolean;
  paused: boolean;
  simulation_safe: boolean; // execution off + remote runner off + hermes observe_only
  read_model_readable: boolean; // every readiness-critical bucket read cleanly
  // Backlog counts within the BOUNDED recent window (loadOrchestrationReadModel
  // caps: recent goals + their jobs + open approvals). They are a lower bound,
  // not an exact global count, and are only trustworthy when read_model_readable
  // is true; an errored read forces read_model_unreadable rather than a false 0.
  open_approvals: number;
  failed_jobs: number;
  dead_lettered_jobs: number;
  // A coarse status the owner reads at a glance. Fail-closed: any unknown
  // (unreadable controls OR unreadable read model) is NEVER 'simulation_ready'.
  status:
    | 'controls_unreadable'
    | 'read_model_unreadable'
    | 'migration_absent'
    | 'halted'
    | 'unsafe_controls'
    | 'simulation_ready';
}

export async function loadBridgeReadiness(client: RuntimeClient): Promise<BridgeReadiness> {
  const ctl = await readSystemControlsChecked(client);
  const c = ctl.controls;
  const model = await loadOrchestrationReadModel(client);
  const simulation_safe =
    ctl.readOk && c.execution_enabled === false &&
    c.remote_runner_enabled === false && c.hermes_mode === 'observe_only';
  // Every readiness-critical bucket must have read cleanly ('ok' or 'empty').
  // An 'error' state (RLS denial, network, query failure) must NOT be treated as
  // healthy - loadOrchestrationReadModel sets applied=true for an errored goals
  // read, so we check the bucket states explicitly (fail-closed).
  const readable = (s: ReadState) => s === 'ok' || s === 'empty';
  const read_model_readable = model.applied &&
    readable(model.goals.state) && readable(model.approvals.state) &&
    readable(model.jobs.state) && readable(model.failures.state) &&
    readable(model.dead_letters.state);

  let status: BridgeReadiness['status'];
  if (!ctl.readOk) status = 'controls_unreadable';        // fail-closed: cannot verify safety
  else if (!model.applied) status = 'migration_absent';   // schema not applied yet
  else if (!read_model_readable) status = 'read_model_unreadable'; // fail-closed on a read error
  else if (c.owner_stop || c.paused) status = 'halted';   // owner has stopped/paused
  else if (!simulation_safe) status = 'unsafe_controls';  // controls left an unsafe posture
  else status = 'simulation_ready';                        // applied + safe + readable + not halted

  return {
    migration_applied: model.applied,
    controls_readable: ctl.readOk,
    execution_enabled: c.execution_enabled === true,
    remote_runner_enabled: c.remote_runner_enabled === true,
    hermes_mode: String(c.hermes_mode ?? ''),
    owner_stop: c.owner_stop === true,
    paused: c.paused === true,
    simulation_safe,
    read_model_readable,
    open_approvals: model.summary.open_approvals,
    failed_jobs: model.summary.failed_jobs,
    dead_lettered_jobs: model.summary.dead_lettered_jobs,
    status,
  };
}
