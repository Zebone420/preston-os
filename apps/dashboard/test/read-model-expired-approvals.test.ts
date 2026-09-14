import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  loadBridgeReadiness,
  loadOrchestrationReadModel,
} from '../src/lib/ai-os/orchestration/read-model';
import { hermesObserveOrchestration } from '../src/lib/ai-os/hermes-service';

// ===========================================================================
// Status truth (P0 defect B, repaired 2026-09-08): an approval that expired
// UNDECIDED keeps status='pending' in the table (expiry is enforced at
// decision time), and the aggregate open_approvals counted every pending
// row. The owner therefore saw "N approval(s) waiting" / approval_attention
// for approvals nobody can decide any more - in preston_status, the Hermes
// status row, and the dashboard summary. These suites pin the repair: only
// rows whose decision is still OPEN under the caller's clock count; the
// expired rows remain in the bucket for display (decision_open=false).
// ===========================================================================

const NOW = '2026-09-08T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const PAST = '2026-09-08T11:00:00.000Z';
const FUTURE = '2026-09-08T13:00:00.000Z';

function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            rowsOf(table).push({ ...row });
            return Promise.resolve({ data: [{ id: row['id'] ?? 'x' }], error: null });
          } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order(col: string, o?: { ascending?: boolean }) {
              return { limit(n: number) {
                const asc = o?.ascending !== false;
                const rows = rowsOf(table).filter((r) => f.every((g) => g(r)))
                  .sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
                return Promise.resolve({ data: rows.slice(0, n), error: null });
              } };
            },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
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

function seed(db: ReturnType<typeof makeFakeDb>, approvals: Array<{ id: string; expires_at: string }>) {
  db.rowsOf('master_goals').push({
    id: 'g1', title: 't', status: 'blocked', simulation_only: true,
    environment: 'staging', created_at: NOW, updated_at: NOW,
  });
  for (const a of approvals) {
    db.rowsOf('goal_jobs').push({
      id: `j-${a.id}`, goal_id: 'g1', kind: 'migration', title: 'm', status: 'awaiting_approval',
      requires_approval: true, approval_id: a.id, attempts: 0,
      evidence_refs: [], executed: false, created_at: NOW, updated_at: NOW,
    });
    db.rowsOf('orchestration_approvals').push({
      approval_id: a.id, goal_id: 'g1', job_id: `j-${a.id}`, status: 'pending',
      expires_at: a.expires_at, created_at: NOW,
    });
  }
}

describe('read model - expired approvals are not open approvals', () => {
  it('counts only decision-open rows; expired rows stay visible, labeled', async () => {
    const db = makeFakeDb();
    seed(db, [{ id: 'apr-expired', expires_at: PAST }, { id: 'apr-open', expires_at: FUTURE }]);
    const rm = await loadOrchestrationReadModel(db.client, 20, NOW_MS);
    expect(rm.approvals.state).toBe('ok');
    expect(rm.approvals.rows).toHaveLength(2);
    const byId = Object.fromEntries(rm.approvals.rows.map((r) => [String(r.approval_id), r.decision_open]));
    expect(byId['apr-expired']).toBe(false);
    expect(byId['apr-open']).toBe(true);
    expect(rm.summary.open_approvals).toBe(1);
  });

  it('an unparseable expiry is expired (fail-closed), never counted as open', async () => {
    const db = makeFakeDb();
    seed(db, [{ id: 'apr-bad', expires_at: 'not-a-date' }]);
    const rm = await loadOrchestrationReadModel(db.client, 20, NOW_MS);
    expect(rm.approvals.rows).toHaveLength(1);
    expect(rm.summary.open_approvals).toBe(0);
  });

  it('bridge readiness honors the caller clock', async () => {
    const db = makeFakeDb();
    seed(db, [{ id: 'apr-1', expires_at: FUTURE }]);
    const before = await loadBridgeReadiness(db.client, NOW_MS);
    expect(before.open_approvals).toBe(1);
    const after = await loadBridgeReadiness(db.client, Date.parse(FUTURE) + 1);
    expect(after.open_approvals).toBe(0);
    expect(after.status).toBe('simulation_ready'); // an expired approval is not an unhealthy state
  });
});

describe('hermes status observer - no attention for expired approvals', () => {
  it('records open_approvals:0 without approval_attention when every pending approval expired', async () => {
    const db = makeFakeDb();
    seed(db, [{ id: 'apr-old-1', expires_at: PAST }, { id: 'apr-old-2', expires_at: PAST }]);
    const r = await hermesObserveOrchestration(db.client, NOW);
    expect(r.recorded).toBe(true);
    expect(r.open_approvals).toBe(0);
    expect(r.approval_attention).toBe(false);
    const row = db.rowsOf('orchestration_decisions')[0];
    const reasons = row.reasons as string[];
    expect(reasons).toContain('open_approvals:0');
    expect(reasons).not.toContain('approval_attention');
  });

  it('still flags attention for an approval that is open at the tick clock', async () => {
    const db = makeFakeDb();
    seed(db, [{ id: 'apr-old', expires_at: PAST }, { id: 'apr-live', expires_at: FUTURE }]);
    const r = await hermesObserveOrchestration(db.client, NOW);
    expect(r.open_approvals).toBe(1);
    expect(r.approval_attention).toBe(true);
  });
});
