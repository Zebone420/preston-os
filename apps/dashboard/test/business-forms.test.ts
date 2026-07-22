import { describe, expect, it } from 'vitest';
import {
  humanizeQuoteCode,
  humanizeQuoteCodes,
  humanizeRecommendationOutcome,
  validateClientForm,
  validateLeadForm,
  validatePaymentForm,
  validateStageChange,
} from '../src/lib/business/business-forms';
import { updateLeadStageCAS } from '../src/lib/business/business-store';
import { makeFakeDb } from './business-agent.test';

describe('owner data-entry validation', () => {
  it('client form requires a name and valid type', () => {
    expect(
      validateClientForm({
        display_name: 'Test Client',
        client_type: 'residential',
        primary_email: '',
        primary_phone: '',
        notes: '',
      }).ok,
    ).toBe(true);
    expect(
      validateClientForm({
        display_name: '  ',
        client_type: 'residential',
        primary_email: '',
        primary_phone: '',
        notes: '',
      }).ok,
    ).toBe(false);
    expect(
      validateClientForm({
        display_name: 'X',
        client_type: 'alien',
        primary_email: '',
        primary_phone: '',
        notes: '',
      }).ok,
    ).toBe(false);
  });

  it('lead form validates stage and optional client uuid', () => {
    const base = {
      display_name: 'A lead',
      stage: 'lead',
      client_id: '',
      lead_source: '',
      owner_next_action: '',
    };
    expect(validateLeadForm(base).ok).toBe(true);
    expect(validateLeadForm({ ...base, stage: 'warp' }).ok).toBe(false);
    expect(
      validateLeadForm({ ...base, client_id: 'not-a-uuid' }).ok,
    ).toBe(false);
    expect(validateStageChange('won').ok).toBe(true);
    expect(validateStageChange('zzz').ok).toBe(false);
  });

  it('payment form fails closed on bad amounts and targets', () => {
    const base = {
      project_id: '00000000-0000-4000-8000-000000000501',
      quote_id: '',
      kind: 'payment_recorded',
      amount_cents: 125000,
      method: '',
      note: '',
    };
    expect(validatePaymentForm(base).ok).toBe(true);
    expect(
      validatePaymentForm({ ...base, amount_cents: undefined }).ok,
    ).toBe(false);
    expect(
      validatePaymentForm({ ...base, amount_cents: Number.NaN }).ok,
    ).toBe(false);
    expect(
      validatePaymentForm({ ...base, amount_cents: 0 }).ok,
    ).toBe(false);
    // Negative money only as an explicit adjustment.
    expect(
      validatePaymentForm({ ...base, amount_cents: -500 }).ok,
    ).toBe(false);
    expect(
      validatePaymentForm({
        ...base,
        kind: 'adjustment_recorded',
        amount_cents: -500,
      }).ok,
    ).toBe(true);
    expect(
      validatePaymentForm({ ...base, project_id: '', quote_id: '' })
        .ok,
    ).toBe(false);
    expect(
      validatePaymentForm({ ...base, kind: 'invoice_sent' }).ok,
    ).toBe(false);
  });
});

describe('owner-readable quote error wording', () => {
  it('maps machine codes to owner English with line numbers', () => {
    expect(
      humanizeQuoteCode('missing:items[0].unit_material_cents'),
    ).toBe('Line 1: enter the material price in dollars.');
    expect(humanizeQuoteCode('items[2].quantity_invalid')).toBe(
      'Line 3: enter a whole-number quantity.',
    );
    expect(humanizeQuoteCode('jurisdiction_unsupported')).toBe(
      'Only NYC and NJ are supported.',
    );
    expect(humanizeQuoteCode('missing:client_id')).toBe(
      'Pick a client.',
    );
    expect(humanizeQuoteCode('markup_input_mismatch')).toContain(
      'matching the selected mode',
    );
  });

  it('deduplicates repeated messages and passes unknowns through', () => {
    const out = humanizeQuoteCodes([
      'missing:title',
      'title',
      'strange_new_code',
    ]);
    expect(out).toEqual(['Add a quote title.', 'strange_new_code']);
  });

  it('maps recommendation outcomes to owner English', () => {
    expect(
      humanizeRecommendationOutcome('not_in_expected_status'),
    ).toContain('already decided');
    expect(humanizeRecommendationOutcome('dismissed')).toContain(
      'not re-fire',
    );
  });
});

describe('updateLeadStageCAS', () => {
  const LEAD_ID = '00000000-0000-4000-8000-000000000301';

  it('moves stage only from the expected current stage', async () => {
    const db = makeFakeDb();
    db.rowsOf('sales_leads').push({
      id: LEAD_ID,
      stage: 'lead',
      display_name: 'x',
    });
    const ok = await updateLeadStageCAS(
      db.client,
      LEAD_ID,
      'lead',
      'qualified',
      '2026-07-21T12:00:00.000Z',
    );
    expect(ok.ok).toBe(true);
    expect(db.rowsOf('sales_leads')[0].stage).toBe('qualified');
    // Second move from the stale from-stage loses the CAS.
    const stale = await updateLeadStageCAS(
      db.client,
      LEAD_ID,
      'lead',
      'site_visit',
      '2026-07-21T12:01:00.000Z',
    );
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe('stage_changed_elsewhere');
    expect(db.rowsOf('sales_leads')[0].stage).toBe('qualified');
  });

  it('rejects invalid lead ids before any query', async () => {
    const db = makeFakeDb();
    const res = await updateLeadStageCAS(
      db.client,
      'nope',
      'lead',
      'qualified',
      '2026-07-21T12:00:00.000Z',
    );
    expect(res.ok).toBe(false);
  });
});
