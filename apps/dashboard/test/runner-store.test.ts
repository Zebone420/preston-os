// Runner store adapters against a fake client enforcing unique keys and
// eq() compare-and-set, plus the migration 0033 lint pins.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { createRun } from '../src/lib/business/runner/runner';
import {
  advanceRun,
  insertRun,
  listWaitingRuns,
  registerPlaybook,
} from '../src/lib/business/runner/store';
import { declarationHash } from '../src/lib/business/runner/playbook';
import { LEAD_INTAKE_V1 } from '../src/lib/business/runner/playbooks';

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

function makeFakeDb(uniqueCols: Record<string, string[][]>) {
  const tables = new Map<string, Row[]>();
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Row) {
          return {
            select() {
              const rows = rowsOf(table);
              for (const key of uniqueCols[table] ?? []) {
                if (rows.some((r) => key.every((c) => r[c] === row[c]))) {
                  return Promise.resolve({
                    data: null, error: { message: 'duplicate key value' },
                  });
                }
              }
              rows.push({ ...row });
              return Promise.resolve({ data: [{ ...row }], error: null });
            },
          };
        },
        select() {
          const chain = (f: Pred[]) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order(col: string, o: { ascending: boolean }) {
              return {
                limit(n: number) {
                  const rows = rowsOf(table).filter((r) => f.every((fn) => fn(r)))
                    .sort((a, b) => String(a[col]).localeCompare(String(b[col])));
                  if (!o.ascending) rows.reverse();
                  return Promise.resolve({ data: rows.slice(0, n), error: null });
                },
              };
            },
            limit(n: number) {
              return Promise.resolve({
                data: rowsOf(table).filter((r) => f.every((fn) => fn(r))).slice(0, n),
                error: null,
              });
            },
          });
          return chain([]);
        },
        update(patch: Row) {
          const chain = (f: Pred[]) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); },
            gt() { return chain(f); },
            select() {
              const matched = rowsOf(table).filter((r) => f.every((fn) => fn(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({
                data: matched.map((r) => ({ id: r.id })), error: null,
              });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

const UNIQUES = {
  playbook_registry: [['playbook_id', 'version']],
  playbook_runs: [['id'], ['idempotency_key']],
};
const NOW = '2026-09-08T12:00:00.000Z';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

describe('registerPlaybook - insert only, never enabled by the runtime', () => {
  it('writes the declaration hash, allow-list and classes with enabled=false', async () => {
    const db = makeFakeDb(UNIQUES);
    const r = await registerPlaybook(db.client, LEAD_INTAKE_V1, 'test-suite');
    expect(r.ok).toBe(true);
    const row = db.rowsOf('playbook_registry')[0];
    expect(row.sha256).toBe(declarationHash(LEAD_INTAKE_V1));
    expect(row.enabled).toBe(false);
    expect(row.allowed_capabilities).toEqual(LEAD_INTAKE_V1.allowed_capabilities);
    expect(row.approval_classes).toEqual(LEAD_INTAKE_V1.approvals);
    const dup = await registerPlaybook(db.client, LEAD_INTAKE_V1, 'test-suite');
    expect(dup).toMatchObject({ ok: true, duplicate: true });
    expect(db.rowsOf('playbook_registry')).toHaveLength(1);
  });
  it('refuses an invalid declaration before touching the client', async () => {
    const db = makeFakeDb(UNIQUES);
    const bad = { ...LEAD_INTAKE_V1, approvals: {} };
    const r = await registerPlaybook(db.client, bad, 'test-suite');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/approval_class_missing/);
    expect(db.rowsOf('playbook_registry')).toHaveLength(0);
  });
});

describe('insertRun / advanceRun / listWaitingRuns', () => {
  const run = () => createRun(LEAD_INTAKE_V1, {
    id: RUN_ID, project_id: null, trigger_ref: 'gmail:msg-1',
    idempotency_key: 'lead.intake:gmail:msg-1', now: NOW,
  });
  it('insertRun is idempotent on idempotency_key', async () => {
    const db = makeFakeDb(UNIQUES);
    expect((await insertRun(db.client, run())).ok).toBe(true);
    const again = await insertRun(db.client, {
      ...run(), id: '44444444-4444-4444-8444-444444444444',
    });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(db.rowsOf('playbook_runs')).toHaveLength(1);
    const notFresh = await insertRun(db.client, { ...run(), step_cursor: 2 });
    expect(notFresh.ok).toBe(false);
  });
  it('advanceRun applies only when (step_cursor, state) still match', async () => {
    const db = makeFakeDb(UNIQUES);
    await insertRun(db.client, run());
    const next = { ...run(), step_cursor: 1, state: 'waiting' as const, waiting_for: 'x' };
    const ok = await advanceRun(db.client, { step_cursor: 0, state: 'running' }, next);
    expect(ok.ok).toBe(true);
    expect(db.rowsOf('playbook_runs')[0]).toMatchObject({ step_cursor: 1, state: 'waiting' });
    // A second driver still holding the old expectation loses the race.
    const stale = await advanceRun(db.client, { step_cursor: 0, state: 'running' }, next);
    expect(stale).toMatchObject({ ok: false, error: 'run_moved_elsewhere' });
    // Terminal expectation / backwards cursor are refused before any write.
    const back = await advanceRun(db.client, { step_cursor: 1, state: 'waiting' }, run());
    expect(back.ok).toBe(false);
    const term = await advanceRun(db.client, { step_cursor: 1, state: 'blocked' }, next);
    expect(term.ok).toBe(false);
  });
  it('listWaitingRuns returns elapsed or unbounded waits, oldest first', async () => {
    const db = makeFakeDb(UNIQUES);
    const rows = db.rowsOf('playbook_runs');
    rows.push({ id: 'a', state: 'waiting', wait_until: '2026-09-08T11:00:00.000Z' });
    rows.push({ id: 'b', state: 'waiting', wait_until: '2026-09-09T11:00:00.000Z' });
    rows.push({ id: 'c', state: 'waiting', wait_until: null });
    rows.push({ id: 'd', state: 'running', wait_until: null });
    const out = await listWaitingRuns(db.client, NOW);
    expect(out.ok).toBe(true);
    expect(out.rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect((await listWaitingRuns(db.client, 'not-a-date')).ok).toBe(false);
  });
  it('the store module has no delete path', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'business', 'runner', 'store.ts'), 'utf8',
    );
    expect(src).not.toMatch(/\.delete\(/);
  });
});

describe('migration 0033 - runner, clocks, openings, catalog', () => {
  const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const sql = readFileSync(join(MIG, '0033_p4_runner_playbooks_clocks.sql'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  const TABLES = [
    'playbook_registry', 'playbook_runs', 'follow_up_clocks', 'openings', 'andersen_catalog',
  ];
  it('creates the five tables with their state/check sets', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
    }
    expect(sql).toMatch(/primary key \(playbook_id, version\)/);
    expect(sql).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).toMatch(/enabled boolean not null default false/);
    for (const s of ['running', 'waiting', 'blocked', 'completed', 'failed', 'cancelled']) {
      expect(sql).toContain(`'${s}'`);
    }
    expect(sql).toMatch(/evidence jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/create unique index if not exists uq_playbook_runs_idempotency_key/);
    expect(sql).toMatch(/subject_type in \('quote','proposal','lead','vendor_quote'\)/);
    expect(sql).toMatch(/schedule in \('h24','h48','weekly'\)/);
    for (const s of ['armed', 'due', 'paused', 'owner_final_call', 'closed_lost',
      'closed_won', 'stopped']) {
      expect(sql).toContain(`'${s}'`);
    }
    expect(sql).toMatch(/source in \('estimate','intake_form','site_visit','final_measure'\)/);
    expect(sql).toMatch(
      /uq_openings_project_code_version[\s\S]*?\(project_id, opening_code, version\)/,
    );
    expect(sql).toMatch(/not_for_po = true or source = 'final_measure'/);
    expect(sql).toMatch(/constraint_kind in \('availability','size_min','size_max',/);
    expect(sql).toMatch(/state in \('candidate','verified','authorized'\)/);
    expect(sql).toMatch(
      /uq_andersen_catalog_key[\s\S]*?\(series, unit_type, attribute, value,\s*constraint_kind\)/,
    );
    expect(sql).toMatch(/state = 'candidate' or fact_id is not null/);
  });
  it('RLS on every table: owner+runtime select/insert, anon revoked, NO delete grant', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(new RegExp(
        `${t}_owner_runtime_sel[\\s\\S]*?for select[\\s\\S]*?is_runtime_service`));
      expect(sql).toMatch(new RegExp(
        `${t}_owner_runtime_ins[\\s\\S]*?for insert[\\s\\S]*?is_runtime_service`));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from anon`));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from authenticated`));
    }
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).not.toMatch(new RegExp('dro' + 'p table', 'i'));
    expect(sql).not.toMatch(new RegExp('trun' + 'cate', 'i'));
    expect(sql).not.toMatch(new RegExp('dele' + 'te from', 'i'));
  });
  it('enabling a playbook and promoting catalog state are owner-only updates', () => {
    const ownerOnlyUpd = (policy: string) => new RegExp(
      policy + '[\\s\\S]*?for update[\\s\\S]*?' +
        'is_owner\\(\\)\\) with check \\(public\\.is_owner\\(\\)',
    );
    expect(sql).toMatch(ownerOnlyUpd('playbook_registry_owner_upd'));
    expect(sql).toMatch(ownerOnlyUpd('andersen_catalog_owner_upd'));
    // Openings are versioned, never updated.
    expect(sql).not.toMatch(/openings_owner[a-z_]*_upd/);
    expect(sql).toMatch(/grant select, insert on public\.openings to authenticated/);
  });
  it('seeds no product data and never weakens existing objects', () => {
    expect(sql).not.toMatch(/insert into/i);
    for (const t of ['goal_jobs', 'master_goals', 'sales_leads', 'quotes', 'knowledge_facts']) {
      expect(sql).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*${t}`, 'i'));
    }
  });
});
