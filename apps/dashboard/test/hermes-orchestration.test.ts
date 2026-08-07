// Phase 8 - Hermes orchestration STATUS observation. Read-only pins:
// records one idempotent status decision per minute bucket, surfaces
// approval_attention, and halts on every owner/mode gate without reading
// the goal graph. Hermes gains NO write, approval, or send capability.

import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { hermesObserveOrchestration } from '../src/lib/ai-os/hermes-service';

const NOW = '2026-08-07T06:00:00.000Z';

function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? {
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const reads: string[] = [];
  const client: RuntimeClient = {
    from(table: string) {
      reads.push(table);
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table);
            if (rows.some((r) => r.id === row.id)) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row.id }], error: null });
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
        update() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() { return Promise.resolve({ data: [], error: null }); },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf, reads };
}

function seedGraph(db: ReturnType<typeof makeFakeDb>) {
  db.rowsOf('master_goals').push({
    id: 'g1', title: 't', status: 'blocked', simulation_only: true,
    environment: 'staging', created_at: NOW, updated_at: NOW,
  });
  db.rowsOf('goal_jobs').push({
    id: 'j1', goal_id: 'g1', kind: 'migration', title: 'm', status: 'awaiting_approval',
    requires_approval: true, approval_id: 'apr-h-1', attempts: 0,
    evidence_refs: [], executed: false, created_at: NOW, updated_at: NOW,
  });
  db.rowsOf('orchestration_approvals').push({
    approval_id: 'apr-h-1', goal_id: 'g1', job_id: 'j1', status: 'pending',
    expires_at: '2026-08-08T06:00:00.000Z', created_at: NOW,
  });
}

describe('hermesObserveOrchestration - read-only status bridge', () => {
  it('records one idempotent status decision and flags approval attention', async () => {
    const db = makeFakeDb();
    seedGraph(db);
    const r = await hermesObserveOrchestration(db.client, NOW);
    expect(r.recorded).toBe(true);
    expect(r.open_approvals).toBe(1);
    expect(r.approval_attention).toBe(true);
    const rows = db.rowsOf('orchestration_decisions');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].id)).toMatch(/^od-orchstatus-/);
    expect(rows[0].decision).toBe('orchestration_status');
    expect((rows[0].reasons as string[]).join()).toContain('approval_attention');
    // Same minute bucket => PK dedup: idempotent success, no second row
    // (append-log contract: a unique violation reports ok).
    const again = await hermesObserveOrchestration(db.client, NOW);
    expect(again.recorded).toBe(true);
    expect(db.rowsOf('orchestration_decisions')).toHaveLength(1);
  });

  it('halts on disabled/stopped/paused/owner_stop WITHOUT reading the graph', async () => {
    for (const patch of [
      { hermes_mode: 'disabled' }, { hermes_mode: 'stopped' },
      { hermes_mode: 'paused' }, { owner_stop: true }, { paused: true },
    ]) {
      const db = makeFakeDb({
        id: 'global', execution_enabled: false, owner_stop: false, paused: false,
        hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
        ...patch,
      });
      seedGraph(db);
      const r = await hermesObserveOrchestration(db.client, NOW);
      expect(r.recorded).toBe(false);
      expect(r.status).toBe('skipped');
      expect(db.rowsOf('orchestration_decisions')).toHaveLength(0);
      expect(db.reads.filter((t) => t === 'master_goals')).toHaveLength(0);
    }
  });

  it('performs no writes beyond the single decisions row (read-only pin)', async () => {
    const db = makeFakeDb();
    seedGraph(db);
    const before = {
      goals: JSON.stringify(db.rowsOf('master_goals')),
      jobs: JSON.stringify(db.rowsOf('goal_jobs')),
      approvals: JSON.stringify(db.rowsOf('orchestration_approvals')),
    };
    await hermesObserveOrchestration(db.client, NOW);
    expect(JSON.stringify(db.rowsOf('master_goals'))).toBe(before.goals);
    expect(JSON.stringify(db.rowsOf('goal_jobs'))).toBe(before.jobs);
    expect(JSON.stringify(db.rowsOf('orchestration_approvals'))).toBe(before.approvals);
  });
});
