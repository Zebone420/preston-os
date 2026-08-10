// SSOT B1 - first consumer of the Hermes decisions log (2026-08-10).
// Pins three things:
//   1. listOrchestrationDecisions: bounded, newest-first, fail-closed.
//   2. loadLatestHermesStatus: finds the latest od-orchstatus- row within
//      the bounded window; absent is a NORMAL state (timer disabled), a
//      read failure is an error, never a silent empty.
//   3. Cross-artifact CHECK pin: every decision value the Hermes status
//      bridge writes is allowed by the 0004 CHECK constraint. The live DB
//      enforces it; the test fakes do not - this pin closes that gap (the
//      original code wrote 'orchestration_status', which the real table
//      would have rejected on first live fire).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { listOrchestrationDecisions } from '../src/lib/ai-os/store';
import { hermesObserveOrchestration } from '../src/lib/ai-os/hermes-service';
import { loadLatestHermesStatus } from '../src/lib/ai-os/orchestration/read-model';

const NOW = '2026-08-10T06:00:00.000Z';

// Fake with real order() semantics: created_at desc, like PostgREST serves
// the adapter. Optional failure injection per table.
function makeFakeDb(failTables: Record<string, string> = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const client: RuntimeClient = {
    from(table: string) {
      const fail = failTables[table];
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            if (fail) return Promise.resolve({ data: null, error: { message: fail } });
            const rows = rowsOf(table);
            if (rows.some((r) => r.id === row.id)) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row.id }], error: null });
          } };
        },
        select() {
          const result = (filters: Array<(r: Record<string, unknown>) => boolean>, sort: boolean, n: number) => {
            if (fail) return Promise.resolve({ data: null, error: { message: fail } });
            let rows = rowsOf(table).filter((r) => filters.every((f) => f(r)));
            if (sort) {
              rows = [...rows].sort((a, b) =>
                String(b['created_at'] ?? '').localeCompare(String(a['created_at'] ?? '')));
            }
            return Promise.resolve({ data: rows.slice(0, n), error: null });
          };
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return result(f, true, n); } }; },
            limit(n: number) { return result(f, false, n); },
          });
          return chain([]);
        },
        update() {
          const chain = () => ({
            eq() { return chain(); }, lte() { return chain(); }, gt() { return chain(); },
            select() { return Promise.resolve({ data: [], error: null }); },
          });
          return chain();
        },
      };
    },
  };
  return { client, rowsOf };
}

function seedDecision(db: ReturnType<typeof makeFakeDb>, id: string, createdAt: string, reasons: string[] = []) {
  db.rowsOf('orchestration_decisions').push({
    id, hermes_mode: 'observe_only', decision: 'observe', reasons,
    correlation_id: 'c-' + id, created_at: createdAt,
  });
}

describe('listOrchestrationDecisions - bounded newest-first reader', () => {
  it('returns newest-first and honors the bound', async () => {
    const db = makeFakeDb();
    seedDecision(db, 'od-a', '2026-08-10T01:00:00.000Z');
    seedDecision(db, 'od-b', '2026-08-10T03:00:00.000Z');
    seedDecision(db, 'od-c', '2026-08-10T02:00:00.000Z');
    const res = await listOrchestrationDecisions(db.client, 2);
    expect(res.error).toBeUndefined();
    expect(res.rows.map((r) => r.id)).toEqual(['od-b', 'od-c']);
  });

  it('fails closed: surfaces the read error with zero rows', async () => {
    const db = makeFakeDb({ orchestration_decisions: 'permission denied' });
    const res = await listOrchestrationDecisions(db.client, 10);
    expect(res.rows).toEqual([]);
    expect(res.error).toContain('permission denied');
  });
});

describe('loadLatestHermesStatus - latest od-orchstatus- observation', () => {
  it('finds the newest status row and parses bucket + reasons', async () => {
    const db = makeFakeDb();
    seedDecision(db, 'od-other-job', '2026-08-10T05:00:00.000Z');
    seedDecision(db, 'od-orchstatus-202608100400', '2026-08-10T04:00:00.000Z',
      ['orchestration_status', 'status:halted', 'open_approvals:0', 'failed:0', 'dead_lettered:0']);
    seedDecision(db, 'od-orchstatus-202608100430', '2026-08-10T04:30:00.000Z',
      ['orchestration_status', 'status:simulation_ready', 'open_approvals:1', 'failed:0', 'dead_lettered:0', 'approval_attention']);
    const v = await loadLatestHermesStatus(db.client);
    expect(v.state).toBe('ok');
    expect(v.observed_bucket).toBe('202608100430');
    expect(v.reasons).toContain('status:simulation_ready');
    expect(v.reasons).toContain('approval_attention');
  });

  it('reports empty (a normal state) when no status rows exist', async () => {
    const db = makeFakeDb();
    seedDecision(db, 'od-other-job', '2026-08-10T05:00:00.000Z');
    const v = await loadLatestHermesStatus(db.client);
    expect(v.state).toBe('empty');
  });

  it('reports error on a failed read - never a silent empty', async () => {
    const db = makeFakeDb({ orchestration_decisions: 'network unreachable' });
    const v = await loadLatestHermesStatus(db.client);
    expect(v.state).toBe('error');
    expect(v.note).toContain('network unreachable');
  });

  it('classifies a missing relation as migration_absent', async () => {
    const db = makeFakeDb({
      orchestration_decisions: 'relation "orchestration_decisions" does not exist',
    });
    const v = await loadLatestHermesStatus(db.client);
    expect(v.state).toBe('migration_absent');
  });

  it('round-trips: the row hermesObserveOrchestration records is readable', async () => {
    const db = makeFakeDb();
    const obs = await hermesObserveOrchestration(db.client, NOW);
    expect(obs.recorded).toBe(true);
    // Fake insert leaves created_at unset; the reader still finds the row
    // (single-row window) - the ordering path is pinned above.
    const v = await loadLatestHermesStatus(db.client);
    expect(v.state).toBe('ok');
    expect(v.observed_bucket).toBe('202608100600');
    expect(v.reasons?.[0]).toBe('orchestration_status');
  });
});

describe('cross-artifact pin: written decision values satisfy the 0004 CHECK', () => {
  it('hermesObserveOrchestration writes a decision the live table accepts', async () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0004_phase3_runtime.sql'),
      'utf8',
    );
    const m = sql.match(/decision text not null check \(decision in \(([^)]+)\)\)/);
    expect(m, '0004 decision CHECK constraint not found').toBeTruthy();
    const allowed = new Set(
      m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    );
    // Sanity: the constraint still lists the known runtime decision values.
    expect(allowed.has('observe')).toBe(true);

    const db = makeFakeDb();
    await hermesObserveOrchestration(db.client, NOW);
    const rows = db.rowsOf('orchestration_decisions');
    expect(rows).toHaveLength(1);
    expect(allowed.has(String(rows[0].decision))).toBe(true);
  });
});
