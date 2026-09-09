// Openings normalization / validation / not_for_po, diff, and the
// scope -> quote-engine round trip with a fixed integer-cent total.

import { describe, expect, it } from 'vitest';
import { calculateQuote, validateQuoteEngineInput } from '../src/lib/business/quote-engine';
import {
  diffOpenings,
  isPoMaterial,
  normalizeOpenings,
  parseInches,
  type OpeningRow,
} from '../src/lib/business/sales/openings';
import {
  ASSUMPTION_ESTIMATE_ONLY,
  buildScope,
} from '../src/lib/business/sales/scope';

const PROJECT = '11111111-1111-4111-8111-111111111111';

describe('parseInches', () => {
  it('parses decimals and fractions to 3dp; never guesses malformed input', () => {
    expect(parseInches('35 1/2')).toBe(35.5);
    expect(parseInches('35-1/2')).toBe(35.5);
    expect(parseInches('35.125"')).toBe(35.125);
    expect(parseInches('1/3')).toBe(0.333);
    expect(parseInches(48)).toBe(48);
    expect(parseInches('3/2')).toBeNull();
    expect(parseInches('thirty')).toBeNull();
    expect(parseInches('')).toBeNull();
    expect(parseInches(Number.NaN)).toBeNull();
  });
});

describe('normalizeOpenings', () => {
  const raw = [
    {
      code: 'w01', room: 'Living', width: '35 1/2', height: '62', unit_type: 'Double Hung',
      configuration: { series: 'FX', glass: 'fx_clear', ignored: 'x' },
    },
    { code: 'W02', width: 71.5, height: '62', unit_type: 'dh', joined_units: 'twin' },
    { code: 'D01', width: '72', height: '80', unit_type: 'gliding patio door', joined_units: 2 },
  ];
  it('normalizes intake rows: inch decimals, vocabulary, joined units, not_for_po=true', () => {
    const r = normalizeOpenings(raw, { project_id: PROJECT, source: 'intake_form', version: 1 });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.openings.map((o) => o.opening_code)).toEqual(['W01', 'W02', 'D01']);
    expect(r.openings[0]).toMatchObject({
      width_in: 35.5, height_in: 62, unit_type: 'double_hung', joined_units: 'single',
      configuration: { series: 'FX', glass: 'fx_clear' }, source: 'intake_form',
      not_for_po: true, room: 'Living', version: 1,
    });
    expect(r.openings[1].joined_units).toBe('double');
    expect(r.openings[2]).toMatchObject({
      unit_type: 'patio_door_gliding', joined_units: 'double',
    });
    expect(r.openings.every((o) => !isPoMaterial(o))).toBe(true);
  });
  it('estimate/site_visit rows are pricing-estimate only; final_measure is PO material', () => {
    for (const source of ['estimate', 'site_visit'] as const) {
      const r = normalizeOpenings(raw, { project_id: PROJECT, source, version: 1 });
      expect(r.openings.every((o) => o.not_for_po)).toBe(true);
    }
    const fm = normalizeOpenings(
      raw.map((x) => ({ ...x, measured_at: '2026-09-08T15:00:00.000Z', measured_by: 'staff-a' })),
      { project_id: PROJECT, source: 'final_measure', version: 2 },
    );
    expect(fm.ok).toBe(true);
    expect(fm.openings.every((o) => o.not_for_po === false && isPoMaterial(o))).toBe(true);
    const missing = normalizeOpenings(raw, {
      project_id: PROJECT, source: 'final_measure', version: 2,
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.map((e) => e.reason)).toContain('final_measure_requires_measured_at');
    expect(missing.errors.map((e) => e.reason)).toContain('final_measure_requires_measured_by');
  });
  it('validation: positive sizes, code format, duplicates, unknown unit types', () => {
    const r = normalizeOpenings([
      { code: 'W01', width: '0', height: '62', unit_type: 'casement' },
      { code: 'W01', width: '30', height: '-5', unit_type: 'casement' },
      { code: 'bad code', width: '30', height: '40', unit_type: 'casement' },
      { code: 'W03', width: '30', height: '40', unit_type: 'porthole' },
      { code: 'W04', width: '300', height: '40', unit_type: 'casement', joined_units: 'quad' },
    ], { project_id: PROJECT, source: 'site_visit', version: 1 });
    expect(r.ok).toBe(false);
    expect(r.openings).toEqual([]);
    const reasons = r.errors.map((e) => `${e.code ?? '-'}:${e.reason}`);
    expect(reasons).toContain('W01:width_out_of_range');
    expect(reasons).toContain('W01:code_duplicate');
    expect(reasons).toContain('W01:height_missing_or_malformed');
    expect(reasons).toContain('BAD CODE:code_invalid');
    expect(reasons).toContain('W03:unit_type_unknown');
    expect(reasons).toContain('W04:width_out_of_range');
    expect(reasons).toContain('W04:joined_units_invalid');
    expect(normalizeOpenings(raw, {
      project_id: PROJECT, source: 'guess' as never, version: 1,
    }).ok).toBe(false);
  });
  it('diffOpenings reports adds/removes/changes and flags material changes', () => {
    const a = normalizeOpenings(raw, { project_id: PROJECT, source: 'site_visit', version: 1 })
      .openings;
    const b = normalizeOpenings([
      { ...raw[0], width: '36' },
      { ...raw[1], room: 'Den' },
      { code: 'W05', width: '20', height: '30', unit_type: 'awning' },
    ], { project_id: PROJECT, source: 'site_visit', version: 2 }).openings;
    const d = diffOpenings(a, b);
    expect(d.added).toEqual(['W05']);
    expect(d.removed).toEqual(['D01']);
    expect(d.changed).toEqual([
      { opening_code: 'W01', fields: { width_in: { from: 35.5, to: 36 } } },
      { opening_code: 'W02', fields: { room: { from: null, to: 'Den' } } },
    ]);
    expect(d.material_change).toBe(true);
    const cosmetic = diffOpenings(a, a.map((o, i) => (i === 1 ? { ...o, room: 'Den' } : o)));
    expect(cosmetic.material_change).toBe(false);
    expect(diffOpenings(a, a)).toEqual({
      added: [], removed: [], changed: [], material_change: false,
    });
  });
});

describe('buildScope -> quote-engine round trip', () => {
  const openings: OpeningRow[] = normalizeOpenings([
    { code: 'W01', width: '35 1/2', height: '62', unit_type: 'dh',
      configuration: { series: 'FX', glass: 'fx_clear' } },
    { code: 'W02', width: '71.5', height: '62', unit_type: 'dh', joined_units: 'double',
      configuration: { series: 'FX', glass: 'fx_clear' } },
  ], { project_id: PROJECT, source: 'site_visit', version: 1 }).openings;
  const pricing = {
    W01: { unit_material_cents: 120_000, unit_labor_cents: 45_000 },
    W02: { unit_material_cents: 115_000, unit_labor_cents: 40_000, line_fees_cents: 5_000 },
  };
  it('feeds the engine and the engine owns every number (fixed integer cents)', () => {
    const s = buildScope(openings, {
      scope_type: 'installation', jurisdiction: 'NYC', product_line: 'fixture_line',
      pricing, quote_fees_cents: 25_000, exclusions: ['custom_exclusion'],
    });
    expect(s.ok).toBe(true);
    expect(s.input).not.toBeNull();
    expect(s.lines.map((l) => [l.opening_code, l.quantity])).toEqual([['W01', 1], ['W02', 2]]);
    expect(s.assumptions).toEqual([ASSUMPTION_ESTIMATE_ONLY]);
    expect(s.exclusions).toContain('custom_exclusion');
    expect(validateQuoteEngineInput(s.input!)).toEqual({ ok: true, missing_fields: [] });
    const q = calculateQuote(s.input!);
    // material 120000 + 2*115000 = 350000; labor 45000 + 2*40000 = 125000;
    // fees 25000 + 5000 = 30000; subtotal 505000; NYC tax 8.875% = 44819
    // (505000*8875/100000 = 44818.75 -> half-up 44819); total 549819.
    expect(q.material_cents).toBe(350_000);
    expect(q.labor_cents).toBe(125_000);
    expect(q.fees_cents).toBe(30_000);
    expect(q.subtotal_cents).toBe(505_000);
    expect(q.tax_cents).toBe(44_819);
    expect(q.total_cents).toBe(549_819);
    expect(Number.isSafeInteger(q.total_cents)).toBe(true);
    expect(q.payment_schedule.stages.map((st) => st.amount_cents)).toEqual([
      274_910, 137_455, 137_454,
    ]);
    expect(q.exclusions).toEqual(s.exclusions);
    expect(q.items.map((i) => i.opening_label)).toEqual(['W01', 'W02']);
  });
  it('product_only drops labor; missing pricing or bad cents fail closed with input=null', () => {
    const po = buildScope(openings, {
      scope_type: 'product_only', jurisdiction: 'NJ', product_line: 'fixture_line',
      pricing: { W01: { unit_material_cents: 100 }, W02: { unit_material_cents: 200 } },
    });
    expect(po.ok).toBe(true);
    expect(po.input!.items!.every((i) => i.unit_labor_cents === undefined)).toBe(true);
    expect(calculateQuote(po.input!).total_cents).toBe(533); // 500 * 1.06625 = 533.125
    const missing = buildScope(openings, {
      scope_type: 'installation', jurisdiction: 'NYC', product_line: 'x',
      pricing: { W01: pricing.W01 },
    });
    expect(missing.ok).toBe(false);
    expect(missing.input).toBeNull();
    expect(missing.errors).toEqual(['pricing_missing:W02']);
    const bad = buildScope(openings, {
      scope_type: 'installation', jurisdiction: 'NYC', product_line: 'x',
      pricing: { ...pricing, W01: { unit_material_cents: 12.5, unit_labor_cents: 1 } },
    });
    expect(bad.errors).toEqual(['unit_material_invalid:W01']);
    expect(buildScope(openings, {
      scope_type: 'rental', jurisdiction: 'TX', product_line: 'x', pricing,
    }).errors).toEqual(['scope_type_invalid', 'jurisdiction_invalid']);
  });
  it('flags incomplete configuration per opening without pricing anything', () => {
    const bare = openings.map((o) => ({ ...o, configuration: {} }));
    const s = buildScope(bare, {
      scope_type: 'installation', jurisdiction: 'NYC', product_line: 'x', pricing,
    });
    expect(s.assumptions).toEqual([
      ASSUMPTION_ESTIMATE_ONLY, 'configuration_incomplete:W01', 'configuration_incomplete:W02',
    ]);
    expect(JSON.stringify(s)).not.toMatch(/total_cents|tax_cents/);
  });
});
