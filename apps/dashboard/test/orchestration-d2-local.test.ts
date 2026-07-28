import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';

// Phase 7 drill D2 - LOCAL EQUIVALENT of the staging goal-intake drill.
// Pins the exact D2 topology (audit + gated migration dep:1 +
// documentation dep:1 + gated migration standalone => 4 jobs, 2 dep
// edges) through decomposition and persistence, and pins the FORM-LAYER
// contract: every submitMasterGoal invocation mints a fresh goal id and
// correlation id (new-goal semantics; same-correlation idempotency is
// the RPC layer's guarantee, proven in 4.7 B1). Supporting evidence for
// the owner-run staging drill - NOT a substitute for it.

const resolveOwnerMock = vi.fn();

vi.mock('@/lib/ai-os/owner-context', async (importOriginal) => {
  const real = await importOriginal<
    typeof import('../src/lib/ai-os/owner-context')
  >();
  return { ...real, resolveOwner: () => resolveOwnerMock() };
});

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error('NEXT_REDIRECT:' + url);
  },
}));

import { submitMasterGoal } from '../src/app/os/orchestration/actions';
import {
  addRow,
  depIssues,
  initialRows,
  KIND_OPTIONS,
  MAX_TASK_ROWS,
  removeRow,
} from '../src/app/os/orchestration/task-rows';
import {
  decomposeGoal,
  type TaskSpec,
} from '../src/lib/ai-os/orchestration/decomposition';
import { persistDecomposedGoal } from '../src/lib/ai-os/orchestration/store';
import { DEFAULT_BUDGET, type MasterGoal } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-07-28T12:00:00.000Z';
const OWNER = 'info@preston.nyc';

// Minimal fake RuntimeClient: insert-only with PK uniqueness (the D2
// surface needs no update/CAS paths).
function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const pk = (t: string) =>
    t === 'orchestration_approvals' ? 'approval_id' : 'id';
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              const rows = rowsOf(table);
              const key = pk(table);
              if (
                row[key] !== undefined &&
                rows.some((r) => r[key] === row[key])
              ) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'duplicate key unique constraint' },
                });
              }
              rows.push({ ...row });
              return Promise.resolve({
                data: [{ id: row[key] ?? 'x' }],
                error: null,
              });
            },
          };
        },
        select() {
          const chain = (
            filters: Array<(r: Record<string, unknown>) => boolean>,
          ) => ({
            eq(col: string, val: string) {
              return chain([...filters, (r) => String(r[col]) === val]);
            },
            order() {
              return {
                limit(n: number) {
                  return Promise.resolve({
                    data: rowsOf(table)
                      .filter((r) => filters.every((f) => f(r)))
                      .slice(0, n),
                    error: null,
                  });
                },
              };
            },
            limit(n: number) {
              return Promise.resolve({
                data: rowsOf(table)
                  .filter((r) => filters.every((f) => f(r)))
                  .slice(0, n),
                error: null,
              });
            },
          });
          return chain([]);
        },
        update() {
          throw new Error('update not expected in D2 local drill');
        },
      };
    },
  } as unknown as RuntimeClient;
  return { client, rowsOf };
}

function drillGoal(): MasterGoal {
  return {
    id: '00000000-0000-4000-8000-00000000d2a0',
    title: 'Remote-live drill goal',
    objective: 'produce drill evidence for the remote-live bridge in simulation',
    source: 'dashboard',
    requested_by: OWNER,
    status: 'proposed',
    environment: 'staging',
    budget: DEFAULT_BUDGET,
    correlation_id: 'goal-d2local1',
    simulation_only: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

// The EXACT D2 topology from the staging drill instructions.
function drillSpecs(): TaskSpec[] {
  return [
    {
      local_id: 't1', kind: 'audit', title: 'Config audit',
      objective: 'review dashboard configuration in an isolated worktree',
      depends_on_local: [],
    },
    {
      local_id: 't2', kind: 'migration', title: 'Schema change draft',
      objective: 'draft a schema change plan for owner review',
      depends_on_local: ['t1'],
    },
    {
      local_id: 't3', kind: 'documentation', title: 'Findings summary',
      objective: 'summarize audit findings in a local report',
      depends_on_local: ['t1'],
    },
    {
      local_id: 't4', kind: 'migration', title: 'Expiry fixture',
      objective: 'draft a follow-up schema note for owner review',
      depends_on_local: [],
    },
  ];
}

describe('D2 local - exact drill topology decomposition', () => {
  it('classifies 2 GREEN + 2 gated RED migration jobs, 2 dep edges', () => {
    const d = decomposeGoal(drillGoal(), drillSpecs(), (l) => `job-d2-${l}`, NOW);
    if (!d.ok) throw new Error('decompose failed: ' + d.errors.join(','));
    expect(d.jobs).toHaveLength(4);

    const byKindTitle = new Map(d.jobs.map((j) => [`${j.kind}:${j.title}`, j]));
    const audit = byKindTitle.get('audit:Config audit')!;
    const docs = byKindTitle.get('documentation:Findings summary')!;
    const mig1 = byKindTitle.get('migration:Schema change draft')!;
    const mig2 = byKindTitle.get('migration:Expiry fixture')!;

    // GREEN, auto-runnable in simulation
    for (const j of [audit, docs]) {
      expect(j.risk_class).toBe('GREEN');
      expect(j.requires_approval).toBe(false);
    }
    // D2-C1: migration kind deterministically GATED regardless of wording.
    // The persisted risk_class column carries the RAW classifier score
    // (YELLOW for these objectives), NOT the escalated policy tier:
    // classifyJob returns tier RED + requires_approval true for any
    // \bmigrat match, while risk_class passes through classifyRisk. The
    // authoritative, driver-enforced gate is requires_approval; the tier
    // is not a persisted column. Pinned EXACTLY so any classifier change
    // surfaces here instead of silently shifting staged expectations.
    for (const j of [mig1, mig2]) {
      expect(j.risk_class).toBe('YELLOW');
      expect(j.requires_approval).toBe(true);
      expect(j.approval_id).toBeNull();
    }
    // all persistable as pending, zero attempts
    for (const j of d.jobs) {
      expect(j.status).toBe('pending');
      expect(j.attempts).toBe(0);
    }
    // dependency edges: exactly 2, both onto the audit job
    const edges = d.jobs.flatMap((j) => j.depends_on.map((dep) => [j.id, dep]));
    expect(edges).toHaveLength(2);
    expect(mig1.depends_on).toEqual([audit.id]);
    expect(docs.depends_on).toEqual([audit.id]);
    expect(mig2.depends_on).toEqual([]);
  });

  it('is deterministic across repeated decompositions', () => {
    const a = decomposeGoal(drillGoal(), drillSpecs(), (l) => `job-d2-${l}`, NOW);
    const b = decomposeGoal(drillGoal(), drillSpecs(), (l) => `job-d2-${l}`, NOW);
    if (!a.ok || !b.ok) throw new Error('decompose failed');
    expect(a.jobs).toEqual(b.jobs);
  });
});

describe('D2 local - atomic persistence, no partial rows', () => {
  it('persists 1 goal + 4 jobs (executed:false) + 2 edges; re-persist adds nothing', async () => {
    const db = makeFakeDb();
    const d = decomposeGoal(drillGoal(), drillSpecs(), (l) => `job-d2-${l}`, NOW);
    if (!d.ok) throw new Error('decompose failed');
    const state = {
      goal: { ...drillGoal(), status: 'decomposed' as const },
      jobs: d.jobs,
      iteration: 0,
      started_at: NOW,
    };
    const r = await persistDecomposedGoal(db.client, state);
    expect(r.ok).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    expect(db.rowsOf('goal_jobs')).toHaveLength(4);
    expect(db.rowsOf('job_dependencies')).toHaveLength(2);
    // the store layer forces the execution pin on every job row
    for (const row of db.rowsOf('goal_jobs')) {
      expect(row.executed).toBe(false);
    }
    expect(db.rowsOf('master_goals')[0].simulation_only).toBe(true);
    expect(db.rowsOf('master_goals')[0].environment).toBe('staging');

  });

  // D2-L1 KNOWN LATENT DEFECT - recorded, NOT desired behavior. Dependency
  // edges are NOT idempotent on re-persist: job_dependencies has a
  // random-uuid PK and no unique(goal_id, job_id, depends_on_job_id), and
  // persistDecomposedGoal re-inserts edges, so a same-state re-persist
  // duplicates them. Unreachable from the form (fresh goal ids per
  // submission). This test asserts the DESIRED behavior (edges stay 2)
  // under it.fails: it "passes" only while the defect exists. When a
  // later owner-gated migration adds the natural-key constraint and an
  // idempotent insert, this marker will error ("expected to fail but
  // passed") and MUST then be promoted to a plain it() - the defect can
  // never be silently entrenched or its fix concealed.
  it.fails('D2-L1: dependency re-persist SHOULD be idempotent (known defect)', async () => {
    const db = makeFakeDb();
    const d = decomposeGoal(drillGoal(), drillSpecs(), (l) => `job-d2-${l}`, NOW);
    if (!d.ok) throw new Error('decompose failed');
    const state = {
      goal: { ...drillGoal(), status: 'decomposed' as const },
      jobs: d.jobs,
      iteration: 0,
      started_at: NOW,
    };
    await persistDecomposedGoal(db.client, state);
    await persistDecomposedGoal(db.client, state);
    expect(db.rowsOf('job_dependencies')).toHaveLength(2);
  });
});

describe('D2 local - form capacity matches parser capacity (D2-C2)', () => {
  // D2-C2 regression pin: the deployed form rendered only rows 1-3 while
  // readTasks parses up to 6, making a 4-task goal unsubmittable. The UI
  // must keep rendering ALL six parser-supported rows via the single
  // task${i}_* field template.
  it('page delegates to TaskRows; component keeps the field + kind contract', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const page = readFileSync(
      join(__dirname, '../src/app/os/orchestration/page.tsx'),
      'utf8',
    );
    const comp = readFileSync(
      join(__dirname, '../src/app/os/orchestration/task-rows.tsx'),
      'utf8',
    );
    // page renders the dynamic component; no static row template remains
    expect(page).toContain('<TaskRows />');
    expect(page).not.toContain('task${i}_kind');
    expect(page).not.toContain('{[1, 2, 3].map');
    // component: sequential field names by VISIBLE position (contract)
    expect(comp).toContain('name={`task${i + 1}_kind`}');
    for (const f of ['title', 'objective', 'depends']) {
      expect(comp).toContain('name={`task${i + 1}_' + f + '`}');
    }
    // kind stays a controlled SELECT; arbitrary text not enterable
    expect(comp).toContain('<select');
    expect(comp).not.toContain('<input name={`task${i + 1}_kind`}');
    // every parser-accepted kind with its exact submitted value + blank
    const values = KIND_OPTIONS.map((o) => o.value);
    expect(values).toEqual(['', 'documentation', 'code', 'test',
      'migration', 'audit', 'repair', 'recommendation', 'unknown']);
    expect(KIND_OPTIONS[0].label).toBe('Select work type');
    expect(
      KIND_OPTIONS.find((o) => o.value === 'migration')!.label,
    ).toBe('Migration - owner approval required');
    expect(comp).toContain(
      'Some work types may require owner approval before execution.',
    );
    // accessibility: per-row names for every field + the row controls
    expect(comp).toContain('aria-label={`Task ${i + 1} kind`}');
    expect(comp).toContain('aria-label={`Task ${i + 1} title`}');
    expect(comp).toContain('aria-label={`Task ${i + 1} objective`}');
    expect(comp).toContain('aria-label={`Task ${i + 1} dependencies`}');
    expect(comp).toContain('aria-label={`Remove task ${i + 1}`}');
    expect(comp).toContain('aria-label="Add task"');
    // cap enforced in the component render too (Add hidden at max)
    expect(comp).toContain('rows.length < MAX_TASK_ROWS');
  });

  it('row state machine: start at one, add to six, never seven', () => {
    let rows = initialRows();
    expect(rows).toHaveLength(1);
    for (let i = 2; i <= 6; i++) {
      rows = addRow(rows);
      expect(rows).toHaveLength(i);
    }
    expect(addRow(rows)).toHaveLength(6); // 7th refused
    expect(MAX_TASK_ROWS).toBe(6);
  });

  it('row 1 is not removable; rows 2-6 are', () => {
    let rows = initialRows();
    rows = addRow(addRow(rows));
    expect(removeRow(rows, 0).rows).toHaveLength(3); // refused, unchanged
    expect(removeRow(rows, 0).rows).toBe(rows);
    expect(removeRow(rows, 2).rows).toHaveLength(2);
    expect(removeRow(rows, 1).rows).toHaveLength(2);
  });

  it('removal re-numbers rows and shifts dependency references down', () => {
    // 4 rows; row3 depends on 1, row4 depends on 3 -> remove row 2:
    // old row3 becomes row2 (deps "1" kept), old row4 becomes row3 and
    // its "3" reference must follow the moved row down to "2".
    let rows = initialRows();
    rows = addRow(addRow(addRow(rows)));
    rows = rows.map((r, i) => ({ ...r, title: `t${i + 1}` }));
    rows[2] = { ...rows[2], depends: '1' };
    rows[3] = { ...rows[3], depends: '3' };
    const res = removeRow(rows, 1);
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => r.title)).toEqual(['t1', 't3', 't4']);
    expect(res.rows[1].depends).toBe('1');
    expect(res.rows[2].depends).toBe('2');
    expect(res.clearedFrom).toEqual([]);
  });

  it('removing a referenced row clears that dependency and reports it', () => {
    let rows = initialRows();
    rows = addRow(addRow(rows));
    rows[2] = { ...rows[2], depends: '1,2' }; // row3 references row2
    const res = removeRow(rows, 1); // remove row2
    expect(res.rows).toHaveLength(2);
    // the "2" reference is CLEARED, never re-pointed; "1" survives
    expect(res.rows[1].depends).toBe('1');
    expect(res.clearedFrom).toEqual([2]); // new row number that lost a dep
  });

  it('advisory validation flags self-references and missing rows', () => {
    const rows = addRow(initialRows());
    rows[1] = { ...rows[1], depends: '2' }; // self
    expect(depIssues(rows)).toEqual(['task 2 cannot depend on itself']);
    rows[1] = { ...rows[1], depends: '5' }; // nonexistent
    expect(depIssues(rows)).toEqual([
      'task 2 depends on row 5, which does not exist',
    ]);
    rows[1] = { ...rows[1], depends: '1' };
    expect(depIssues(rows)).toEqual([]);
  });

  it('six-task submission flows through the parser (rows 4-6 live)', async () => {
    const db = makeFakeDb();
    resolveOwnerMock.mockResolvedValue({
      ownerEmail: OWNER,
      client: db.client,
      audit: {},
    });
    const fd = new FormData();
    fd.set('title', 'Capacity check goal');
    fd.set('objective', 'verify six-row intake in simulation');
    for (let i = 1; i <= 6; i++) {
      fd.set(`task${i}_kind`, 'audit');
      fd.set(`task${i}_title`, `Row ${i} check`);
      fd.set(`task${i}_objective`, `record row ${i} evidence in a local note`);
    }
    let msg = '';
    try {
      await submitMasterGoal(fd);
      throw new Error('expected redirect');
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(decodeURIComponent(msg)).toContain('goal submitted: 6 jobs');
    expect(db.rowsOf('goal_jobs')).toHaveLength(6);
  });

  it('the exact four-task D2 topology submits through the form action', async () => {
    const db = makeFakeDb();
    resolveOwnerMock.mockResolvedValue({
      ownerEmail: OWNER,
      client: db.client,
      audit: {},
    });

    const fd = new FormData();
    fd.set('title', 'Remote-live drill goal');
    fd.set('objective',
      'produce drill evidence for the remote-live bridge in simulation');
    const rows: Array<[string, string, string, string]> = [
      ['audit', 'Config audit',
        'review dashboard configuration in an isolated worktree', ''],
      ['migration', 'Schema change draft',
        'draft a schema change plan for owner review', '1'],
      ['documentation', 'Findings summary',
        'summarize audit findings in a local report', '1'],
      ['migration', 'Expiry fixture',
        'draft a follow-up schema note for owner review', ''],
    ];
    rows.forEach(([kind, title, objective, depends], idx) => {
      const i = idx + 1;
      fd.set(`task${i}_kind`, kind);
      fd.set(`task${i}_title`, title);
      fd.set(`task${i}_objective`, objective);
      if (depends) fd.set(`task${i}_depends`, depends);
    });
    // rows 5-6 left blank: readTasks must ignore them

    let redirectMsg = '';
    try {
      await submitMasterGoal(fd);
      throw new Error('expected redirect');
    } catch (e) {
      redirectMsg = String((e as Error).message);
    }
    expect(decodeURIComponent(redirectMsg)).toContain(
      'goal submitted: 4 jobs',
    );

    expect(db.rowsOf('master_goals')).toHaveLength(1);
    const jobs = db.rowsOf('goal_jobs');
    expect(jobs).toHaveLength(4);
    expect(db.rowsOf('job_dependencies')).toHaveLength(2);
    const gated = jobs.filter((j) => j.requires_approval === true);
    expect(gated).toHaveLength(2);
    for (const j of gated) expect(j.kind).toBe('migration');
    for (const j of jobs) expect(j.executed).toBe(false);
  });
});

describe('D2 local - form layer mints fresh identity per submission', () => {
  it('two identical submissions create two goals with distinct ids and correlations', async () => {
    const db = makeFakeDb();
    resolveOwnerMock.mockResolvedValue({
      ownerEmail: OWNER,
      client: db.client,
      audit: {},
    });

    const fd = new FormData();
    fd.set('title', 'Duplicate intake check');
    fd.set('objective', 'verify per-submission identity in simulation');
    fd.set('task1_kind', 'audit');
    fd.set('task1_title', 'Intake check');
    fd.set('task1_objective', 'record intake evidence in a local note');

    const redirects: string[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        await submitMasterGoal(fd);
        throw new Error('expected redirect');
      } catch (e) {
        redirects.push(String((e as Error).message));
      }
    }

    // both submissions succeeded (1 job decomposed each)
    for (const r of redirects) {
      expect(r).toContain('NEXT_REDIRECT:');
      expect(decodeURIComponent(r)).toContain('goal submitted: 1 jobs');
    }

    const goals = db.rowsOf('master_goals');
    expect(goals).toHaveLength(2);
    const [g1, g2] = goals;
    expect(g1.id).not.toBe(g2.id);
    expect(g1.correlation_id).not.toBe(g2.correlation_id);
    for (const g of goals) {
      expect(String(g.correlation_id)).toMatch(/^goal-[0-9a-f]{8}$/);
      expect(g.simulation_only).toBe(true);
      expect(g.environment).toBe('staging');
    }
    // one complete job set per goal, executed pin intact
    const jobs = db.rowsOf('goal_jobs');
    expect(jobs).toHaveLength(2);
    expect(jobs.filter((j) => j.goal_id === g1.id)).toHaveLength(1);
    expect(jobs.filter((j) => j.goal_id === g2.id)).toHaveLength(1);
    for (const j of jobs) expect(j.executed).toBe(false);
    expect(db.rowsOf('job_dependencies')).toHaveLength(0);
  });
});
