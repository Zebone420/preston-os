// Shared fake ComposerClient for the Composer test suites. In-memory tables
// with PK uniqueness, guarded updates, and an EMULATION of the migration-0010
// submit_goal_decomposition RPC semantics (atomic graph commit, id+correlation
// idempotency, idempotency_conflict on a cross match). Emulates enough FK
// discipline to prove ordering (an approval insert requires its goal and job
// rows; a job approval link requires the approval row). NOT a database - real
// durability/RLS/CHECK/locking are proven on the migrated staging DB.

import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';
import { clearGateRpc } from './_clear-gate-rpc';

export interface FakeDbOptions {
  controls?: Record<string, unknown> | null;
  // Return an error message to make an insert into `table` fail.
  failInsert?: (table: string, row: Record<string, unknown>) => string | null;
  // Return an error message to make the RPC fail (atomic: nothing persists).
  failRpc?: (args: Record<string, unknown>) => string | null;
}

export function makeComposerFakeDb(opts: FakeDbOptions = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  if (opts.controls !== null) {
    rowsOf('system_controls').push(opts.controls ?? {
      id: 'global', execution_enabled: false, owner_stop: false, paused: false,
      hermes_mode: 'observe_only', remote_runner_enabled: false,
    });
  }
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');

  const client: ComposerClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select(cols?: string) {
              // PostgREST semantics: requesting a representation column the
              // table does not have REJECTS THE WHOLE INSERT. Emulated after
              // the Gate D drill defect (select('id') on
              // orchestration_approvals, whose key is approval_id) passed
              // the un-strict fake but failed on real staging.
              if (cols && cols !== '*') {
                for (const c of cols.split(',').map((s) => s.trim())) {
                  if (!(c in row)) {
                    return Promise.resolve({
                      data: null,
                      error: { message: `column ${table}.${c} does not exist` },
                    });
                  }
                }
              }
              const fail = opts.failInsert?.(table, row);
              if (fail) return Promise.resolve({ data: null, error: { message: fail } });
              const rows = rowsOf(table);
              const key = pk(table);
              if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
                return Promise.resolve({
                  data: null, error: { message: 'duplicate key unique constraint' },
                });
              }
              if (table === 'orchestration_approvals') {
                // FK discipline: goal and job rows must already exist.
                if (row.goal_id && !rowsOf('master_goals').some((g) => g.id === row.goal_id)) {
                  return Promise.resolve({ data: null, error: { message: 'fk violation: goal_id' } });
                }
                if (row.job_id && !rowsOf('goal_jobs').some((j) => j.id === row.job_id)) {
                  return Promise.resolve({ data: null, error: { message: 'fk violation: job_id' } });
                }
              }
              rows.push({ ...row });
              return Promise.resolve({ data: [{ ...row }], error: null });
            },
          };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order(col: string, o: { ascending: boolean }) {
              return {
                limit(n: number) {
                  const sorted = rowsOf(table)
                    .filter((r) => f.every((g) => g(r)))
                    .sort((a, b) => {
                      const x = String(a[col] ?? ''); const y = String(b[col] ?? '');
                      return o.ascending ? x.localeCompare(y) : y.localeCompare(x);
                    });
                  return Promise.resolve({ data: sorted.slice(0, n), error: null });
                },
              };
            },
            limit(n: number) {
              return Promise.resolve({
                data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n),
                error: null,
              });
            },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte(c: string, v: string) { return chain([...f, (r) => String(r[c]) <= v]); },
            gt(c: string, v: string) { return chain([...f, (r) => String(r[c]) > v]); },
            select(cols?: string) {
              if (table === 'goal_jobs' && patch.approval_id !== undefined) {
                // FK discipline: the approval row must exist before linking.
                if (!rowsOf('orchestration_approvals')
                  .some((a) => a.approval_id === patch.approval_id)) {
                  return Promise.resolve({ data: null, error: { message: 'fk violation: approval_id' } });
                }
              }
              const m = rowsOf(table).filter((r) => f.every((g) => g(r)));
              // Same PostgREST representation-column strictness as insert.
              if (cols && cols !== '*' && m.length > 0) {
                for (const c of cols.split(',').map((s) => s.trim())) {
                  if (!m.some((r) => c in r) && !(c in patch)) {
                    return Promise.resolve({
                      data: null,
                      error: { message: `column ${table}.${c} does not exist` },
                    });
                  }
                }
              }
              for (const r of m) Object.assign(r, patch);
              return Promise.resolve({ data: m.map((r) => ({ ...r })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === 'clear_approval_gate') return clearGateRpc(rowsOf)(fn, args);
      if (fn !== 'submit_goal_decomposition') {
        return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
      }
      const fail = opts.failRpc?.(args);
      if (fail) return Promise.resolve({ data: null, error: { message: fail } });
      const goal = args.p_goal as Record<string, unknown>;
      const jobs = (args.p_jobs ?? []) as Record<string, unknown>[];
      const deps = (args.p_deps ?? []) as Record<string, unknown>[];
      const goals = rowsOf('master_goals');
      const byId = goals.find((g) => g.id === goal.id);
      const byCorr = goals.find((g) => g.correlation_id === goal.correlation_id);
      if (byId || byCorr) {
        if (byId && byCorr && byId === byCorr) {
          return Promise.resolve({ data: { goal_id: goal.id, created: false }, error: null });
        }
        return Promise.resolve({ data: null, error: { message: 'idempotency_conflict' } });
      }
      if (!Array.isArray(jobs) || jobs.length === 0) {
        return Promise.resolve({ data: null, error: { message: 'jobs_required' } });
      }
      // Atomic commit: everything or nothing (build first, then push).
      const goalRow = {
        ...goal, environment: 'staging', simulation_only: true, iteration: 0,
        status: goal.status ?? 'decomposed',
        created_at: goal.created_at ?? '2026-07-28T15:00:00.000Z',
        updated_at: goal.updated_at ?? '2026-07-28T15:00:00.000Z',
      };
      const jobRows = jobs.map((j) => ({
        ...j, goal_id: goal.id, executed: false, failure_reason: null,
        created_at: j.created_at ?? '2026-07-28T15:00:00.000Z',
        updated_at: j.updated_at ?? '2026-07-28T15:00:00.000Z',
      }));
      const depRows = deps.map((d) => ({
        goal_id: goal.id, job_id: d.job_id, depends_on_job_id: d.depends_on_job_id,
      }));
      goals.push(goalRow);
      rowsOf('goal_jobs').push(...jobRows);
      rowsOf('job_dependencies').push(...depRows);
      return Promise.resolve({
        data: { goal_id: goal.id, created: true, jobs: jobs.length },
        error: null,
      });
    },
  };
  return { client, rowsOf };
}
