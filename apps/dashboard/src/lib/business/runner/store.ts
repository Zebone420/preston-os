// Phase 4 - runner persistence adapters (playbook_registry, playbook_runs;
// migration 0033). Same idiom as business-store.ts / knowledge/store.ts:
// RLS-bound client injected by the caller, service-role key never used,
// every write validates first, insert-only for the registry, CAS for run
// advancement, NO deletes anywhere. Reads fail closed to empty results.

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import { UUID_RE } from '../types';
import {
  declarationHash,
  validateDeclaration,
  type PlaybookDeclaration,
} from './playbook';
import { TERMINAL_RUN_STATES, type PlaybookRun, type RunState } from './runner';

export const RUNNER_TABLES = {
  registry: 'playbook_registry',
  runs: 'playbook_runs',
} as const;

export interface ListOutcome {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_LIST = 200;

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

async function insertRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
  selectCol: string,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(table).insert(row).select(selectCol);
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: String(row.id ?? '') };
      }
      return { ok: false, error: `${table} insert failed: ` + res.error.message };
    }
    const id = res.data?.[0]?.[selectCol];
    return { ok: true, id: id ? String(id) : String(row.id ?? '') };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `${table} insert failed`,
    };
  }
}

async function runList(q: PromiseLike<QueryResult>): Promise<ListOutcome> {
  try {
    const res = await q;
    if (res.error) return { ok: false, rows: [], error: res.error.message };
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
}

// Insert-only registration. enabled is ALWAYS false on insert: enabling a
// playbook is an owner update (RLS owner-only), never a runtime write.
export async function registerPlaybook(
  client: RuntimeClient,
  decl: PlaybookDeclaration,
  registeredBy: string,
): Promise<WriteOutcome> {
  const v = validateDeclaration(decl);
  if (!v.ok) {
    return { ok: false, error: 'invalid declaration: ' + v.errors.join(',') };
  }
  if (typeof registeredBy !== 'string' || !registeredBy.trim()) {
    return { ok: false, error: 'registered_by required' };
  }
  return insertRow(
    client,
    RUNNER_TABLES.registry,
    {
      playbook_id: decl.id,
      version: decl.version,
      sha256: declarationHash(decl),
      allowed_capabilities: [...decl.allowed_capabilities],
      approval_classes: { ...decl.approvals },
      enabled: false,
      registered_by: registeredBy,
    },
    'playbook_id',
  );
}

export function validateRunRow(run: PlaybookRun): string[] {
  const errors: string[] = [];
  if (!UUID_RE.test(run.id)) errors.push('id_invalid');
  if (run.project_id !== null && !UUID_RE.test(run.project_id)) {
    errors.push('project_id_invalid');
  }
  if (!IDEMPOTENCY_RE.test(run.idempotency_key)) {
    errors.push('idempotency_key_invalid');
  }
  if (typeof run.trigger_ref !== 'string' || !run.trigger_ref.trim()) {
    errors.push('trigger_ref_missing');
  }
  if (!Number.isSafeInteger(run.step_cursor) || run.step_cursor < 0) {
    errors.push('step_cursor_invalid');
  }
  if (!Array.isArray(run.evidence)) errors.push('evidence_invalid');
  return errors;
}

// Idempotent run creation: the unique idempotency_key makes a replayed
// insert a duplicate no-op.
export async function insertRun(
  client: RuntimeClient,
  run: PlaybookRun,
): Promise<WriteOutcome> {
  const errors = validateRunRow(run);
  if (errors.length > 0) {
    return { ok: false, error: 'invalid run: ' + errors.join(',') };
  }
  if (run.state !== 'running' || run.step_cursor !== 0) {
    return { ok: false, error: 'runs are inserted at cursor 0 in state running' };
  }
  return insertRow(
    client,
    RUNNER_TABLES.runs,
    {
      id: run.id,
      playbook_id: run.playbook_id,
      version: run.version,
      project_id: run.project_id,
      trigger_ref: run.trigger_ref,
      state: run.state,
      step_cursor: run.step_cursor,
      waiting_for: null,
      wait_until: null,
      evidence: run.evidence,
      last_error: null,
      idempotency_key: run.idempotency_key,
      started_at: run.started_at,
      updated_at: run.updated_at,
      completed_at: null,
    },
    'id',
  );
}

export interface AdvanceExpectation {
  step_cursor: number;
  state: RunState;
}

// Compare-and-set advancement: the patch applies only if the stored row
// is still at the (step_cursor, state) the runner computed from. Zero
// matched rows = another driver moved it (or a terminal state was reached
// elsewhere) - the caller re-reads; nothing is overwritten.
export async function advanceRun(
  client: RuntimeClient,
  expected: AdvanceExpectation,
  next: PlaybookRun,
): Promise<WriteOutcome> {
  const errors = validateRunRow(next);
  if (errors.length > 0) {
    return { ok: false, error: 'invalid run: ' + errors.join(',') };
  }
  if (TERMINAL_RUN_STATES.includes(expected.state)) {
    return { ok: false, error: 'terminal runs cannot be advanced' };
  }
  if (next.step_cursor < expected.step_cursor) {
    return { ok: false, error: 'cursor cannot move backwards' };
  }
  try {
    const res = await client
      .from(RUNNER_TABLES.runs)
      .update({
        state: next.state,
        step_cursor: next.step_cursor,
        waiting_for: next.waiting_for,
        wait_until: next.wait_until,
        evidence: next.evidence,
        last_error: next.last_error,
        updated_at: next.updated_at,
        completed_at: next.completed_at,
      })
      .eq('id', next.id)
      .eq('step_cursor', String(expected.step_cursor))
      .eq('state', expected.state)
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'run_moved_elsewhere' };
    }
    return { ok: true, id: next.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'run advance failed',
    };
  }
}

// Waiting runs whose wait_until has elapsed (or is unbounded and thus
// event-driven). Ordered by wait_until so the oldest waits drive first.
export async function listWaitingRuns(
  client: RuntimeClient,
  nowIso: string,
  limit = 50,
): Promise<ListOutcome> {
  if (Number.isNaN(Date.parse(nowIso))) {
    return { ok: false, rows: [], error: 'invalid now' };
  }
  const n = Math.max(1, Math.min(limit, MAX_LIST));
  const out = await runList(
    client
      .from(RUNNER_TABLES.runs)
      .select('*')
      .eq('state', 'waiting')
      .order('wait_until', { ascending: true })
      .limit(MAX_LIST),
  );
  if (!out.ok) return out;
  const now = Date.parse(nowIso);
  const rows = out.rows
    .filter((r) => {
      const wu = r.wait_until;
      if (wu === null || wu === undefined) return true;
      return Date.parse(String(wu)) <= now;
    })
    .slice(0, n);
  return { ok: true, rows };
}
