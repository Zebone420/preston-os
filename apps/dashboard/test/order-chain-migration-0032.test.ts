// Migration 0032 lint - Phase 5 order-chain SAFE models. Same style as
// migration-0026-0027: the SQL text is the contract under test.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0032_p5_order_chain_safe_models.sql'), 'utf8');
const sql = raw
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const TABLES = [
  'contract_templates',
  'contracts',
  'contract_provider_events',
  'payment_expectations',
  'final_measurements',
  'change_orders',
  'order_readiness_checks',
  'purchase_order_packages',
];

function block(table: string): string {
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  expect(start, table).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('\n);', start);
  return sql.slice(start, end);
}

describe('migration 0032 - tables and constraints', () => {
  it('creates all eight tables additively (if not exists) in public', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`create table if not exists public.${t} (`);
    }
    // Fragment idiom: the repo scanner flags literal destructive SQL words.
    expect(sql).not.toMatch(new RegExp('dro' + 'p table', 'i'));
    expect(sql).not.toMatch(new RegExp('trun' + 'cate', 'i'));
    expect(sql).not.toMatch(new RegExp('dele' + 'te from', 'i'));
    expect(sql).not.toMatch(/alter table[^;]*(drop|rename)/i);
  });

  it('contract_templates: versioned, sha-pinned, unique (name, version)', () => {
    const b = block('contract_templates');
    expect(b).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(b).toMatch(/required_forms text\[\]/);
    expect(b).toMatch(/unique \(name, version\)/);
    expect(b).toMatch(/document_id uuid,/);
    expect(b).not.toMatch(/document_id uuid[^,]*references/);
  });

  it('contracts: docusign-only provider, state set, completion pinned to verified', () => {
    const b = block('contracts');
    expect(b).toMatch(
      /provider text not null default 'docusign'\s+check \(provider in \('docusign'\)\)/,
    );
    for (const s of ['drafted', 'sent', 'viewed', 'completed', 'voided', 'expired',
      'superseded']) {
      expect(b).toContain(`'${s}'`);
    }
    expect(b).toMatch(/provider_envelope_id text unique/);
    expect(b).toMatch(/check \(state <> 'completed' or provider_event_verified\)/);
    expect(b).toMatch(/check \(state <> 'completed' or signed_at is not null\)/);
    expect(b).toMatch(/references public\.projects \(id\)/);
    expect(b).toMatch(/references public\.quote_versions \(id\)/);
    expect(b).toMatch(/references public\.contract_templates \(id\)/);
  });

  it('contract_provider_events: UNIQUE provider_event_id (duplicate webhook rejected)', () => {
    const b = block('contract_provider_events');
    expect(b).toMatch(/provider_event_id text not null unique/);
    expect(b).toMatch(/references public\.contracts \(id\)/);
    expect(b).toMatch(/payload jsonb not null/);
  });

  it('payment_expectations: plan/milestone/state sets, integer cents, unique milestone', () => {
    const b = block('payment_expectations');
    expect(b).toMatch(/plan_type in \('installation_50_25_25','product_only_75_25'\)/);
    expect(b).toMatch(/milestone in \('deposit','pre_install','final','pre_order'\)/);
    for (const s of ['expected', 'partially_received', 'received', 'waived_by_owner',
      'overdue']) {
      expect(b).toContain(`'${s}'`);
    }
    expect(b).toMatch(/\('unreconciled','reconciled','mismatch'\)/);
    expect(b).toMatch(
      /expected_amount_cents bigint not null\s+check \(expected_amount_cents >= 0\)/,
    );
    expect(b).toMatch(/received_cents bigint not null default 0 check \(received_cents >= 0\)/);
    expect(b).toMatch(/unique \(contract_id, milestone\)/);
    expect(b).not.toMatch(/numeric|decimal|float|real/i);
  });

  it('final_measurements: versioned, hashed, approval-pinned, estimate cannot be approved', () => {
    const b = block('final_measurements');
    expect(b).toMatch(/openings jsonb not null,/);
    expect(b).toMatch(/check \(jsonb_typeof\(openings\) = 'array'\)/);
    expect(b).toMatch(/status in \('draft','submitted','approved','superseded'\)/);
    expect(b).toMatch(/source in \('final_measure','estimate','intake'\)/);
    expect(b).toMatch(/check \(status <> 'approved' or source = 'final_measure'\)/);
    expect(b).toMatch(new RegExp(
      "check \\(status <> 'approved'\\s+or " +
      '\\(approved_by is not null and approved_at is not null\\)\\)',
    ));
    expect(b).toMatch(/unique \(project_id, version\)/);
    expect(b).toMatch(/supersedes_id uuid references public\.final_measurements \(id\)/);
  });

  it('change_orders: reason and state sets, measurement links', () => {
    const b = block('change_orders');
    expect(b).toMatch(
      /reason in \('configuration_change','size_change',\s+'material_change','scope_change'\)/,
    );
    expect(b).toMatch(/state in \('proposed','owner_review','approved','rejected'\)/);
    expect(b).toMatch(/from_measurement_id uuid references public\.final_measurements/);
    expect(b).toMatch(/to_measurement_id uuid references public\.final_measurements/);
  });

  it('order_readiness_checks: predicates jsonb object, blocked_by array, consistency', () => {
    const b = block('order_readiness_checks');
    expect(b).toMatch(/predicates jsonb not null,/);
    expect(b).toMatch(/check \(jsonb_typeof\(predicates\) = 'object'\)/);
    expect(b).toMatch(/blocked_by text\[\] not null default '\{\}'/);
    expect(b).toMatch(/check \(all_ok = false or cardinality\(blocked_by\) = 0\)/);
    expect(b).toMatch(/all_ok boolean not null default false/);
  });

  it('purchase_order_packages: hash-bound, unique po_hash, placement pinned to placed_at', () => {
    const b = block('purchase_order_packages');
    expect(b).toMatch(/po_hash text not null unique check \(po_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(b).toMatch(/configuration_hash text not null\s+check \(configuration_hash ~/);
    expect(b).toMatch(
      /measurement_id uuid not null\s+references public\.final_measurements \(id\)/,
    );
    for (const s of ['prepared', 'owner_review', 'approved_for_placement',
      'placed_by_owner', 'cancelled']) {
      expect(b).toContain(`'${s}'`);
    }
    expect(b).toMatch(/check \(state <> 'placed_by_owner' or placed_at is not null\)/);
    expect(b).toMatch(new RegExp(
      "check \\(state not in \\('approved_for_placement','placed_by_owner'\\)" +
      '\\s+or approved_by is not null\\)',
    ));
  });
});

describe('migration 0032 - RLS, grants, and the no-placement pin', () => {
  it('enables RLS on every table', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
    }
  });

  it('owner+runtime select/insert policies on every table (0027 idiom)', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(
        `create policy ${t}_owner_runtime_sel[\\s\\S]*?for select to authenticated` +
        `[\\s\\S]*?using \\(public\\.is_owner\\(\\) or public\\.is_runtime_service\\(\\)\\)`));
      expect(sql).toMatch(new RegExp(
        `create policy ${t}_owner_runtime_ins[\\s\\S]*?for insert to authenticated` +
        '[\\s\\S]*?with check \\(public\\.is_owner\\(\\) or ' +
        'public\\.is_runtime_service\\(\\)\\)'));
    }
  });

  it('owner-only update on templates and PO packages; append-only evidence tables', () => {
    for (const t of ['contract_templates', 'purchase_order_packages']) {
      expect(sql).toMatch(new RegExp(
        `create policy ${t}_owner_upd[\\s\\S]*?for update to authenticated` +
        `\\s+using \\(public\\.is_owner\\(\\)\\) with check \\(public\\.is_owner\\(\\)\\)`));
      expect(sql).not.toMatch(new RegExp(`create policy ${t}_owner_runtime_upd`));
    }
    for (const t of ['contract_provider_events', 'order_readiness_checks']) {
      expect(sql).not.toMatch(new RegExp(`create policy ${t}[a-z_]*_upd`));
      expect(sql).toContain(`grant select, insert on public.${t}`);
      expect(sql).not.toMatch(new RegExp(`grant[^;]*update[^;]*public\\.${t}\\b`));
    }
  });

  it('revokes everything from anon and authenticated before re-granting; no delete grant', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`revoke all on public.${t} from anon;`);
      expect(sql).toContain(`revoke all on public.${t} from authenticated;`);
    }
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/to anon/i);
    expect(sql).not.toMatch(/service_role/i);
    expect((sql.match(/grant select, insert(, update)? on public\./g) ?? []).length)
      .toBe(TABLES.length);
  });

  it('defines NO function, trigger, or procedure - nothing can place, send, or pay', () => {
    expect(sql).not.toMatch(/create (or replace )?function/i);
    expect(sql).not.toMatch(/create (or replace )?procedure/i);
    expect(sql).not.toMatch(/create (or replace )?trigger/i);
    expect(sql).not.toMatch(/\bcall\b|\bperform\b|language plpgsql|pg_net|http_/i);
    expect(sql).not.toMatch(/placeOrder|refund|payout|sendEnvelope/i);
  });

  it('never weakens existing objects', () => {
    for (const t of ['projects', 'quote_versions', 'payment_events', 'payment_schedules',
      'vendor_orders', 'approvals', 'documents', 'artifacts']) {
      expect(sql).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*public\\.${t}\\b`, 'i'));
    }
  });

  it('is ASCII and under 100 columns per line', () => {
    const lines = raw.split('\n');
    for (const [i, line] of lines.entries()) {
      expect(line.length, `line ${i + 1}`).toBeLessThan(100);
      expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(line), `line ${i + 1} ascii`).toBe(true);
    }
  });
});
