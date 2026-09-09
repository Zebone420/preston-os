import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(ROOT, 'supabase', 'migrations',
  '0037_p5_order_chain_hardening.sql'), 'utf8');
const rollback = readFileSync(join(ROOT, 'reports', 'p2_evidence', 'rollback',
  'rollback_0037.sql.txt'), 'utf8');

describe('migration 0037 - safe Phase 5 hardening', () => {
  it('adds every application binding without changing migration 0032', () => {
    expect(sql).toMatch(/contracts[\s\S]*included_forms text\[\]/);
    expect(sql).toMatch(/payment_expectations[\s\S]*quote_version_id uuid/);
    for (const column of ['measurement_sha256', 'measurement_version',
      'template_sha256', 'product_line', 'document_sha256', 'approved_at',
      'approval_evidence_hash']) {
      expect(sql).toMatch(new RegExp(`purchase_order_packages[\\s\\S]*${column}`));
    }
    expect(sql).toMatch(/unique index[^;]*contract_templates[^;]*where is_current/i);
  });

  it('creates fully bound append-only receipt evidence with durable replay key', () => {
    expect(sql).toContain('create table if not exists public.payment_receipt_events');
    for (const column of ['project_id', 'contract_id', 'quote_version_id',
      'milestone', 'quote_hash', 'expected_amount_cents', 'amount_cents',
      'idempotency_key', 'occurred_at', 'recorded_by', 'source_ref']) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(sql).toMatch(/idempotency_key text not null unique/);
    expect(sql).toContain('grant select, insert on public.payment_receipt_events');
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*payment_receipt_events/i);
  });

  it('runtime policies cannot fabricate owner-only states', () => {
    expect(sql).toMatch(/runtime_service\(\) and not is_current[\s\S]*approved_by is null/);
    expect(sql).toMatch(/runtime_service\(\) and state <> 'waived_by_owner'/);
    expect(sql).toMatch(/runtime_service\(\) and status <> 'approved'/);
    expect(sql).toMatch(/runtime_service\(\) and state <> 'approved'/);
    expect(sql).toMatch(/runtime_service\(\) and state = 'prepared'[\s\S]*placed_at is null/);
  });

  it('contains no provider or consequential execution primitive', () => {
    const executable = sql.replace(/^--.*$/gm, '');
    expect(executable).not.toMatch(/create (or replace )?(function|procedure|trigger)/i);
    expect(executable).not.toMatch(
      /http_|pg_net|fetch|refund|charge|place_order|send_envelope/i);
  });

  it('has a bounded rollback that restores all replaced 0032 policies', () => {
    expect(rollback).toContain('drop table if exists public.payment_receipt_events');
    for (const policy of ['contract_templates_owner_runtime_ins',
      'payment_expectations_owner_runtime_ins',
      'final_measurements_owner_runtime_ins', 'change_orders_owner_runtime_ins',
      'purchase_order_packages_owner_runtime_ins',
      'payment_expectations_owner_runtime_upd',
      'final_measurements_owner_runtime_upd', 'change_orders_owner_runtime_upd']) {
      expect(rollback).toContain(`create policy ${policy}`);
    }
  });
});
