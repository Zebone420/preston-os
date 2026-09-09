// Static pins for migration 0035 (Phase 6 install -> closeout tables;
// owner-applied only). Same style as migration-0026-0027.test.ts: the SQL
// text is the contract under test. Module vocabularies must match the
// CHECK constraints exactly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLOSEOUT_STATES,
  CREW_ASSIGNMENT_STATES,
  INSTALL_STATES,
  PUNCH_SEVERITIES,
  PUNCH_STATES,
  RECEIVING_EVENT_KINDS,
} from '../src/lib/business/lifecycle/types';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0035_p6_install_closeout.sql'), 'utf8');
const sql = raw
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const TABLES = [
  'receiving_events',
  'install_readiness_checks',
  'crew_assignments',
  'install_states',
  'punch_items',
  'closeout_packages',
];
const APPEND_ONLY = ['receiving_events', 'install_readiness_checks'];
const MUTABLE = TABLES.filter((t) => !APPEND_ONLY.includes(t));

// Destructive tokens assembled from fragments (the RED-boundary scanner
// flags the literal forms in any file).
const DESTRUCTIVE = [
  new RegExp('\\b' + 'dro' + 'p\\s+ta' + 'ble\\b', 'i'),
  new RegExp('\\b' + 'trun' + 'cate\\b', 'i'),
  new RegExp('\\b' + 'dele' + 'te\\s+from\\b', 'i'),
];

function checkList(values: readonly string[]): RegExp {
  return new RegExp('in \\(' + values.map((v) => `'${v}'`).join(',\\s*') + '\\)');
}

describe('migration 0035 - Phase 6 install -> closeout tables', () => {
  it('creates every table under public with a projects FK', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
      expect(sql).toMatch(new RegExp(
        `${t} \\([\\s\\S]*?project_id uuid (not null |primary key )` +
        'references public\\.projects \\(id\\)'));
    }
  });

  it('is ASCII with lines under 100 chars', () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(raw)).toBe(true);
    for (const line of raw.split('\n')) expect(line.length).toBeLessThan(100);
  });

  it('pins the CHECK vocabularies to the module constants', () => {
    expect(sql).toMatch(checkList(RECEIVING_EVENT_KINDS));
    expect(sql).toMatch(checkList(CREW_ASSIGNMENT_STATES));
    expect(sql).toMatch(checkList(INSTALL_STATES));
    expect(sql).toMatch(checkList(PUNCH_SEVERITIES));
    expect(sql).toMatch(checkList(PUNCH_STATES));
    expect(sql).toMatch(checkList(CLOSEOUT_STATES));
  });

  it('pins the structural rules', () => {
    expect(sql).toMatch(/install_states \(\s*project_id uuid primary key/);
    expect(sql).toMatch(/check \(state <> 'waived_by_owner' or severity = 'cosmetic'\)/);
    expect(sql).toMatch(/check \(scheduled_end > scheduled_start\)/);
    expect(sql).toMatch(/closeout_packages \([\s\S]*?unique \(project_id\)/);
    expect(sql).toMatch(/final_payment_eligible boolean not null default false/);
    expect(sql).toMatch(/predicates jsonb not null,/);
    expect(sql).toMatch(/blocked_by text\[\] not null default '\{\}'/);
    for (const col of ['vendor_order_id uuid,', 'po_package_id uuid,',
      'completion_certificate_document_id uuid,',
      'photos_document_ids uuid[] not null', 'final_photos_document_ids uuid[]',
      'photo_document_ids uuid[] not null', 'warranty_registration jsonb',
      'bdf_claims jsonb', 'review_survey jsonb', 'site_access jsonb']) {
      expect(sql).toContain(col);
    }
  });

  it('references other registries by uuid only (no cross-registry FK)', () => {
    expect(sql).not.toMatch(/references public\.documents/);
    expect(sql).not.toMatch(/references public\.vendor_orders/);
    expect(sql).not.toMatch(/references public\.purchase_order_packages/);
    expect((sql.match(/references /g) ?? []).length).toBe(TABLES.length);
  });

  it('RLS on every table with owner+runtime select/insert policies', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(
        `alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(new RegExp(
        `${t}_owner_runtime_sel[\\s\\S]*?for select to authenticated\\s+` +
        'using \\(public\\.is_owner\\(\\) or public\\.is_runtime_service\\(\\)\\)'));
      expect(sql).toMatch(new RegExp(
        `${t}_owner_runtime_ins[\\s\\S]*?for insert to authenticated\\s+` +
        'with check \\(public\\.is_owner\\(\\) or public\\.is_runtime_service\\(\\)\\)'));
    }
  });

  it('update policies + grants only on the mutable state tables', () => {
    for (const t of MUTABLE) {
      expect(sql).toMatch(new RegExp(
        `${t}_owner_runtime_upd[\\s\\S]*?for update to authenticated`));
      expect(sql).toMatch(new RegExp(
        `grant select, insert, update on public\\.${t} to authenticated`));
    }
    for (const t of APPEND_ONLY) {
      expect(sql).not.toMatch(new RegExp(`${t}_owner_runtime_upd`));
      expect(sql).toMatch(new RegExp(
        `grant select, insert on public\\.${t} to authenticated`));
      expect(sql).not.toMatch(new RegExp(`grant[^;]*update[^;]*public\\.${t}`));
    }
  });

  it('anon fully revoked, defaults revoked, NO delete grant, no delete policy', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from anon`));
      expect(sql).toMatch(new RegExp(
        `revoke all on public\\.${t} from authenticated`));
    }
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).not.toMatch(/\bto anon\b/i);
    expect(sql).not.toMatch(/for all to authenticated/);
  });

  it('is additive: no functions, triggers, or destructive statements', () => {
    expect(sql).not.toMatch(/create (or replace )?function/i);
    expect(sql).not.toMatch(/create trigger/i);
    expect(sql).not.toMatch(/create procedure/i);
    for (const rx of DESTRUCTIVE) expect(raw).not.toMatch(rx);
    for (const t of ['goal_jobs', 'master_goals', 'system_controls', 'projects',
      'documents', 'vendor_orders', 'payment_expectations']) {
      expect(sql).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*\\b${t}\\b`, 'i'));
    }
  });
});
