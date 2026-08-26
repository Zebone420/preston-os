import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  driveGoal,
  type RealExecutionResult,
} from '../src/lib/ai-os/orchestration/driver';
import {
  insertGoalJob,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import { decomposeGoal, type TaskSpec } from '../src/lib/ai-os/orchestration/decomposition';
import { extractResultText } from '../src/lib/ai-os/real-claude-adapter';
import { clearGateRpc } from './_clear-gate-rpc';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

// Bridge B2: the durable driver records ONE bounded, redacted, readable
// JobResultRecorded event per attempt into os_events, after (and only after)
// the run-owned terminal CAS. Pins: deterministic per-attempt ids, simulation
// vs real payloads, retry/multi-attempt behavior, failed-append visibility,
// and the adapter-side result-text extraction + redaction.

const NOW = '2026-08-26T12:00:00.000Z';

function makeFakeDb(opts: { failEventInsert?: boolean } = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            if (table === 'os_events' && opts.failEventInsert) {
              return Promise.resolve({ data: null, error: { message: 'event insert denied' } });
            }
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
    id: 'goal-b2-000001', title: 'g', objective: 'o', source: 'chatgpt',
    requested_by: 'owner@preston.nyc', status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-b2-01', simulation_only: true,
    created_at: NOW, updated_at: NOW,
  };
}

async function seedGoal(db: ReturnType<typeof makeFakeDb>, kinds: Array<TaskSpec['kind']> = ['documentation']) {
  await insertMasterGoal(db.client, goal());
  const specs: TaskSpec[] = kinds.map((kind, i) => ({
    local_id: `t${i}`, kind, title: `task ${i}`, objective: `do task ${i}`, depends_on_local: [],
  }));
  const d = decomposeGoal(goal(), specs, (l) => `job-b2-${l}`, NOW);
  if (!d.ok) throw new Error('decompose failed');
  for (const j of d.jobs) await insertGoalJob(db.client, j);
  return () => [] as string[];
}

const lockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/src/'],
  token: (jobId: string) => `tok-${jobId}`,
};

const events = (db: ReturnType<typeof makeFakeDb>) =>
  db.rowsOf('os_events').filter((e) => e.type === 'JobResultRecorded');

describe('B2 result summaries - driver emits JobResultRecorded per attempt', () => {
  it('simulation completion records one readable result per job with deterministic ids', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db, ['documentation', 'code']);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-b2-000001', () => (t += 1000), 100, depends, lockCtx);
    expect(r.reason).toBe('completed');
    const evs = events(db);
    expect(evs.map((e) => e.id).sort()).toEqual(['ev-result-job-b2-t0-1', 'ev-result-job-b2-t1-1']);
    const p = evs[0].payload as Record<string, unknown>;
    expect(p.mode).toBe('simulation');
    expect(p.executed).toBe(false);
    expect(p.outcome).toBe('completed');
    expect(String(p.summary).length).toBeGreaterThan(0);
    expect(String(p.summary).length).toBeLessThanOrEqual(400);
    expect((evs[0].correlation_id as string).startsWith('result:job:')).toBe(true);
  });

  it('a real executor result records executed + excerpt + files_changed', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db, ['documentation']);
    const real: RealExecutionResult = {
      outcome: 'completed', executed: true,
      evidence_refs: ['real:goal:g:job:j:run:r:attempt:1:completed:executed:true'],
      failure_reason: null,
      summary: 'REAL level-1 documentation run completed (exit 0, bounded)',
      report: {
        result_excerpt: 'Wrote the requested summary into docs/summary.md.',
        files_changed: ['docs/summary.md'],
      },
    };
    let t = Date.parse(NOW);
    const r = await driveGoal(
      db.client, 'goal-b2-000001', () => (t += 1000), 100, depends, lockCtx,
      undefined, async () => real,
    );
    expect(r.reason).toBe('completed');
    const evs = events(db);
    expect(evs).toHaveLength(1);
    const p = evs[0].payload as Record<string, unknown>;
    expect(p.mode).toBe('real');
    expect(p.executed).toBe(true);
    expect(p.result_excerpt).toContain('docs/summary.md');
    expect(p.files_changed).toEqual(['docs/summary.md']);
  });

  it('failed attempts and retries record one report per attempt', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db, ['documentation']);
    let calls = 0;
    const exec = async (): Promise<RealExecutionResult> => {
      calls++;
      if (calls === 1) {
        return {
          outcome: 'failed', executed: false, evidence_refs: [],
          failure_reason: 'exit_1', summary: 'run failed',
          report: { result_excerpt: null, files_changed: [] },
        };
      }
      return {
        outcome: 'completed', executed: true, evidence_refs: [],
        failure_reason: null, summary: 'run completed',
        report: { result_excerpt: 'done', files_changed: [] },
      };
    };
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-b2-000001', () => (t += 1000), 100, depends, lockCtx, undefined, exec);
    expect(r.reason).toBe('completed');
    const evs = events(db).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    expect(evs.map((e) => e.id)).toEqual(['ev-result-job-b2-t0-1', 'ev-result-job-b2-t0-2']);
    expect((evs[0].payload as Record<string, unknown>).outcome).toBe('failed');
    expect((evs[0].payload as Record<string, unknown>).failure_reason).toBe('exit_1');
    expect((evs[1].payload as Record<string, unknown>).outcome).toBe('completed');
  });

  it('a large summary/excerpt is bounded before persistence', async () => {
    const db = makeFakeDb();
    const depends = await seedGoal(db, ['documentation']);
    const real: RealExecutionResult = {
      outcome: 'completed', executed: true, evidence_refs: [],
      failure_reason: null, summary: 'S'.repeat(5000),
      report: { result_excerpt: 'E'.repeat(5000), files_changed: Array.from({ length: 200 }, (_, i) => `f${i}`) },
    };
    let t = Date.parse(NOW);
    await driveGoal(db.client, 'goal-b2-000001', () => (t += 1000), 100, depends, lockCtx, undefined, async () => real);
    const p = events(db)[0].payload as Record<string, unknown>;
    expect(String(p.summary).length).toBe(400);
    // The driver trusts the adapter's 2000-char bound for the excerpt but
    // never widens it; files are capped at 50.
    expect((p.files_changed as unknown[]).length).toBe(50);
  });

  it('a failed event append never fails the job and is surfaced in the step reason', async () => {
    const db = makeFakeDb({ failEventInsert: true });
    const depends = await seedGoal(db, ['documentation']);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-b2-000001', () => (t += 1000), 1, depends, lockCtx);
    expect(String(r.reason)).toContain('result_event_unrecorded');
    // The job outcome itself persisted fine.
    expect(db.rowsOf('goal_jobs')[0].status).toBe('completed');
    expect(events(db)).toHaveLength(0);
  });
});

describe('B2 extractResultText - readable text from agent CLI output', () => {
  it('parses the claude CLI json result field', () => {
    const out = JSON.stringify({ type: 'result', result: 'I updated the docs.', cost_usd: 0.01 });
    expect(extractResultText(out)).toBe('I updated the docs.');
  });

  it('falls back to raw sanitized text for non-JSON output', () => {
    expect(extractResultText('plain progress text')).toBe('plain progress text');
    expect(extractResultText('   ')).toBeNull();
  });

  it('redacts secret-shaped values in either path', () => {
    const secretish = ['api_key', ['A1B2C3D4E5F6G7H8', 'ZZ'].join('')].join('=');
    const viaJson = extractResultText(JSON.stringify({ result: `done ${secretish}` }));
    expect(viaJson).not.toContain('A1B2C3D4E5F6G7H8');
    expect(viaJson).toContain('[REDACTED]');
    const viaRaw = extractResultText(`done ${secretish}`);
    expect(viaRaw).not.toContain('A1B2C3D4E5F6G7H8');
  });

  it('bounds output to the excerpt cap', () => {
    const long = extractResultText('x'.repeat(10_000));
    expect(long!.length).toBe(2000);
  });
});
