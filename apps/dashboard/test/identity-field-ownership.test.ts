// Phase 1 Lane A - business field-ownership matrix pins.

import { describe, expect, it } from 'vitest';
import {
  assertWritable,
  FIELD_OWNERSHIP,
  mirroredToAirtable,
  requireWritable,
  writableFieldsFor,
} from '../src/lib/business/identity/field-ownership';

describe('assertWritable', () => {
  it('refuses Airtable writing projects.stage (Supabase owns stage)', () => {
    const v = assertWritable('projects.stage', 'airtable');
    expect(v.ok).toBe(false);
    expect(v.owner_system).toBe('supabase');
    if (!v.ok) expect(v.reason).toMatch(/owned by supabase/);
    expect(() => requireWritable('projects.stage', 'airtable'))
      .toThrow(/field_ownership_refused/);
  });

  it('refuses Airtable on every mirrored field', () => {
    for (const f of mirroredToAirtable()) {
      expect(assertWritable(f, 'airtable').ok).toBe(false);
    }
    expect(mirroredToAirtable()).toContain('projects.project_code');
    expect(writableFieldsFor('airtable')).toEqual([]);
  });

  it('allows only the owner system', () => {
    expect(assertWritable('projects.stage', 'supabase').ok).toBe(true);
    expect(assertWritable('projects.project_code', 'supabase').ok).toBe(true);
    expect(assertWritable('business_clients.notes', 'owner').ok).toBe(true);
    expect(assertWritable('business_clients.notes', 'supabase').ok).toBe(false);
    expect(assertWritable('communication_records.subject', 'gmail').ok).toBe(true);
    expect(assertWritable('communication_records.subject', 'supabase').ok)
      .toBe(false);
    expect(assertWritable('vendor_orders.order_number', 'iqplus').ok).toBe(true);
    expect(assertWritable('vendor_orders.order_number', 'supabase').ok)
      .toBe(false);
    expect(() => requireWritable('projects.stage', 'supabase')).not.toThrow();
  });

  it('fails closed on unknown fields and unknown writers', () => {
    const unknownField = assertWritable('projects.secret_flag', 'supabase');
    expect(unknownField).toEqual({
      ok: false,
      reason: 'no ownership entry for projects.secret_flag',
      owner_system: null,
    });
    const unknownWriter = assertWritable('projects.stage', 'zapier');
    expect(unknownWriter.ok).toBe(false);
    expect(unknownWriter.owner_system).toBe('supabase');
  });
});

describe('matrix invariants', () => {
  it('has exactly one owner per field and covers the 0009 key fields', () => {
    for (const k of ['business_clients.display_name', 'business_contacts.email',
      'business_properties.address_line', 'sales_leads.stage', 'quotes.status',
      'projects.status', 'projects.stage', 'project_milestones.status',
      'vendor_orders.delivery_status', 'installation_events.scheduled_date',
      'payment_events.amount_cents', 'communication_records.subject']) {
      expect(FIELD_OWNERSHIP[k]).toBeDefined();
    }
    for (const [k, v] of Object.entries(FIELD_OWNERSHIP)) {
      expect(k).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(['supabase', 'airtable', 'gmail', 'drive', 'iqplus', 'owner'])
        .toContain(v.owner_system);
    }
  });

  it('money and finance fields are never mirrored to Airtable', () => {
    for (const k of Object.keys(FIELD_OWNERSHIP)) {
      if (/_cents$|payment_/.test(k)) {
        expect(FIELD_OWNERSHIP[k].sync_direction).toBe('none');
        expect(FIELD_OWNERSHIP[k].owner_system).toBe('supabase');
      }
    }
  });

  it('sync direction always points away from the owner', () => {
    for (const v of Object.values(FIELD_OWNERSHIP)) {
      if (v.sync_direction === 'supabase_to_airtable') {
        expect(['supabase', 'owner']).toContain(v.owner_system);
      }
      if (v.sync_direction === 'airtable_to_supabase') {
        expect(v.owner_system).toBe('airtable');
      }
    }
  });
});
