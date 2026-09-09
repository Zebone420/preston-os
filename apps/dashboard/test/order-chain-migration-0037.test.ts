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
    expect(sql).toMatch(/expected_amount_cents between 0 and 50000000000/);
    expect(sql).toMatch(/amount_cents between 1 and 50000000000/);
    expect(sql).toMatch(/length\(btrim\(idempotency_key\)\) between 1 and 256/);
    expect(sql).toMatch(/length\(btrim\(source_ref\)\) between 1 and 512/);
    expect(sql).toMatch(/exists \([\s\S]*payment_expectations p[\s\S]*p\.project_id = payment_receipt_events\.project_id[\s\S]*p\.quote_version_id = payment_receipt_events\.quote_version_id[\s\S]*p\.expected_amount_cents =/);
    expect(sql).toContain('grant select, insert on public.payment_receipt_events');
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*payment_receipt_events/i);
  });

  it('runtime policies cannot fabricate owner-only states', () => {
    expect(sql).toMatch(/contracts_owner_runtime_ins[\s\S]*state = 'drafted'[\s\S]*provider_event_verified = false/);
    expect(sql).toMatch(/runtime_service\(\) and not is_current[\s\S]*approved_by is null/);
    expect(sql).toMatch(/is_owner\(\) or public\.is_runtime_service\(\)\) and[\s\S]*state = 'expected'[\s\S]*received_cents = 0[\s\S]*reconciliation_state = 'unreconciled'/);
    expect(sql).toMatch(/reconciliation_state = 'unreconciled'[\s\S]*quote_version_id is not null[\s\S]*quote_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(sql).not.toContain('create policy payment_expectations_runtime_upd');
    expect(sql).not.toContain('create policy payment_expectations_owner_upd');
    expect(sql).toMatch(/is_owner\(\) or public\.is_runtime_service\(\)\) and[\s\S]*status <> 'approved'[\s\S]*approved_by is null/);
    expect(sql).toMatch(/is_owner\(\) or public\.is_runtime_service\(\)\) and[\s\S]*state in \('proposed','owner_review'\)/);
    expect(sql).toMatch(/is_owner\(\) or public\.is_runtime_service\(\)\) and[\s\S]*state = 'prepared'[\s\S]*placed_at is null/);
    expect(sql).toMatch(/recorded_by = auth\.uid\(\)::text/);
    expect(sql).toMatch(/final_measurements_owner_upd[\s\S]*status <> 'approved' or approved_by = auth\.uid\(\)::text/);
    expect(sql).toMatch(/contract_templates_owner_runtime_ins[\s\S]*approved_by = auth\.uid\(\)::text/);
  });

  it('contains no provider or consequential execution primitive', () => {
    const executable = sql.replace(/^--.*$/gm, '');
    expect((executable.match(/create or replace function/g) ?? [])).toHaveLength(5);
    expect(executable).toContain('function public.guard_contract_state_update()');
    expect(executable).toContain('function public.guard_contract_template_approval()');
    expect(executable).toContain('function public.guard_final_measurement_update()');
    expect(executable).toContain('function public.guard_change_order_update()');
    expect(executable).toContain('function public.guard_purchase_order_package_update()');
    expect(executable).not.toMatch(
      /http_|pg_net|fetch|refund|charge|place_order|send_envelope/i);
  });

  it('freezes change-order and PO facts and disables unevidenced terminal states', () => {
    for (const field of ['reason', 'from_measurement_id', 'to_measurement_id',
      'delta']) {
      expect(sql).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
    expect(sql).toMatch(/old\.state = 'proposed' and new\.state = 'owner_review'/);
    for (const field of ['configuration_hash', 'po_hash', 'document_id', 'vendor',
      'line_items', 'sold_to', 'ship_to', 'measurement_sha256',
      'measurement_version', 'template_sha256', 'product_line',
      'document_sha256']) {
      expect(sql).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
    expect(sql).toContain("old.state = 'prepared' and new.state in ('owner_review','cancelled')");
    expect(sql).toContain('purchase order approval persistence is not enabled');
  });

  it('freezes final-measure evidence and allows only governed transitions', () => {
    for (const field of ['project_id', 'contract_id', 'version', 'source',
      'measured_at', 'measured_by', 'openings', 'sha256', 'supersedes_id']) {
      expect(sql).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
    expect(sql).toMatch(/old\.status = 'submitted' and new\.status = 'approved'/);
    expect(sql).toMatch(/new\.approved_by is distinct from auth\.uid\(\)::text/);
    expect(sql).toMatch(/before update on public\.final_measurements/);
    expect(sql).toMatch(/select c\.signed_at into contract_signed_at[\s\S]*c\.id = new\.contract_id[\s\S]*c\.project_id = new\.project_id[\s\S]*c\.state = 'completed'[\s\S]*c\.provider_event_verified = true/);
    expect(sql).toContain("contract_signed_at at time zone 'UTC'");
    expect(sql).toContain('while business_days < 3 loop');
    expect(sql).toMatch(/extract\(isodow from earliest_measure_utc\) < 6/);
    expect(sql).toContain("earliest_measure_utc + interval '1 day'");
    expect(sql).toMatch(
      /new\.measured_at < earliest_measure_utc at time zone 'UTC'/);
  });

  it('freezes approved template versions while permitting deactivation', () => {
    for (const field of ['name', 'version', 'sha256', 'document_id',
      'required_forms', 'approved_by', 'approved_at', 'created_at']) {
      expect(sql).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
    expect(sql).toContain('(not old.is_current and new.is_current)');
    expect(sql).toContain('approved template version is immutable');
  });

  it('requires bound PO integrity and evidence for every new approved row', () => {
    for (const fragment of ['measurement_sha256 is not null',
      'measurement_version is not null', 'measurement_version >= 1',
      'template_sha256 is not null', 'product_line is not null',
      'length(btrim(product_line)) > 0', 'document_sha256 is not null',
      'approval_evidence_hash is not null']) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toMatch(/po_packages_integrity_bindings_required[\s\S]*not valid/);
    expect(sql).toMatch(/po_packages_approval_evidence_required[\s\S]*approved_at is not null[\s\S]*approval_evidence_hash ~ '[^']*64/);
    expect(sql).toMatch(/state = 'prepared'[\s\S]*measurement_sha256 ~ '[^']*64[\s\S]*approval_evidence_hash is null/);
  });

  it('guards immutable contract bindings, transitions, and completion evidence', () => {
    for (const field of ['project_id', 'quote_version_id', 'template_id',
      'template_sha256', 'payload_hash', 'included_forms', 'provider']) {
      expect(sql).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
    expect(sql).toContain("e.event_type = 'envelope-completed'");
    expect(sql).toContain('e.verified = true');
    expect(sql).toMatch(/e\.payload ->> 'provider_envelope_id' = new\.provider_envelope_id/);
    expect(sql).toMatch(/before update on public\.contracts/);
    expect(sql).toMatch(/old\.state = 'completed' and new\.state = 'superseded'[\s\S]*new\.signed_at is not distinct from old\.signed_at/);
    expect(sql).toMatch(
      /new\.state in \('sent','viewed','completed'\) and not exists \([\s\S]*contract_templates t/);
    expect(sql).toMatch(/t\.is_current = true[\s\S]*t\.approved_by is not null[\s\S]*t\.approved_at is not null/);
    expect(sql).toMatch(/t\.sha256 = new\.template_sha256/);
    expect(sql).toMatch(/t\.required_forms <@ new\.included_forms/);
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
    expect(rollback.indexOf(
      'drop policy if exists purchase_order_packages_owner_runtime_ins'))
      .toBeLessThan(rollback.indexOf('drop column if exists approved_at'));
    expect(rollback.indexOf('drop trigger if exists trg_guard_contract_template_approval'))
      .toBeLessThan(rollback.indexOf('drop column if exists included_forms'));
    expect(rollback).toContain('drop trigger if exists trg_guard_final_measurement_update');
    expect(rollback).toContain('drop trigger if exists trg_guard_change_order_update');
    expect(rollback).toContain('drop trigger if exists trg_guard_purchase_order_package_update');
    expect(rollback.indexOf('drop constraint if exists po_packages_integrity_bindings_required'))
      .toBeLessThan(rollback.indexOf('drop column if exists measurement_sha256'));
  });
});
