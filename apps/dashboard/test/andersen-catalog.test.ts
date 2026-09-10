// Andersen Knowledge Core v1 STRUCTURE: catalog checks (violations only
// from verified/authorized rows; unknown never guessed) and fact import
// (uncited facts refused). Uses the SYNTHETIC fixture only.

import { describe, expect, it } from 'vitest';
import {
  checkConfiguration,
  lookupConstraints,
  type CatalogRow,
} from '../src/lib/business/andersen/catalog';
import {
  FIXTURE_ANDERSEN_CATALOG,
  FIXTURE_LABEL,
  FIXTURE_SERIES,
} from '../src/lib/business/andersen/fixture';
import {
  buildCatalogRowsFromFacts,
  type KnowledgeFactLike,
} from '../src/lib/business/andersen/import';
import type { OpeningRow } from '../src/lib/business/sales/openings';

const CATALOG = [...FIXTURE_ANDERSEN_CATALOG];

function opening(over: Partial<OpeningRow> = {}): OpeningRow {
  return {
    project_id: '11111111-1111-4111-8111-111111111111',
    opening_code: 'W01',
    room: null,
    location_note: null,
    width_in: 36,
    height_in: 60,
    unit_type: 'double_hung',
    joined_units: 'single',
    configuration: { series: FIXTURE_SERIES, glass: 'fx_clear' },
    source: 'site_visit',
    not_for_po: true,
    measured_at: null,
    measured_by: null,
    version: 1,
    ...over,
  };
}

describe('fixture hygiene', () => {
  it('is labeled synthetic, uses a fictional series, and every row is cited', () => {
    expect(FIXTURE_LABEL).toMatch(/SYNTHETIC FIXTURE/);
    expect(['100', '400', 'E', 'A']).not.toContain(FIXTURE_SERIES);
    for (const r of CATALOG) {
      expect(r.series).toBe(FIXTURE_SERIES);
      expect(r.source_citation.fixture).toBe(true);
      if (r.state !== 'candidate') expect(r.fact_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('lookupConstraints / checkConfiguration', () => {
  it('returns a deterministic ordered subset for (series, unitType)', () => {
    const rows = lookupConstraints(CATALOG, { series: FIXTURE_SERIES, unitType: 'casement' });
    expect(rows.map((r) => r.constraint_kind)).toEqual(['availability', 'size_max']);
    expect(lookupConstraints(CATALOG, { series: '400', unitType: 'casement' })).toEqual([]);
  });
  it('a fully covered valid configuration passes with no unknowns', () => {
    const c = checkConfiguration(CATALOG, opening());
    expect(c.violations).toEqual([]);
    expect(c.unknown).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.complete).toBe(true);
  });
  it('size out of range is a violation only because the bound rows are trusted', () => {
    const c = checkConfiguration(CATALOG, opening({ width_in: 60, height_in: 10 }));
    expect(c.ok).toBe(false);
    expect(c.violations.map((v) => [v.kind, v.attribute, v.detail])).toEqual([
      ['size_out_of_range', 'width_in', { bound: 'max', max: 48 }],
      ['size_out_of_range', 'height_in', { bound: 'min', min: 24 }],
    ]);
    expect(c.violations.every((v) => v.fact_id !== null)).toBe(true);
  });
  it('unavailable option and incompatible option are violations from verified rows', () => {
    const c = checkConfiguration(CATALOG, opening({
      configuration: { series: FIXTURE_SERIES, glass: 'fx_discontinued', grille: 'fx_colonial' },
    }));
    expect(c.violations.map((v) => v.kind)).toEqual(['option_unavailable']);
    const d = checkConfiguration(CATALOG, opening({
      configuration: { series: FIXTURE_SERIES, glass: 'fx_clear', grille: 'fx_colonial' },
    }));
    expect(d.violations.map((v) => [v.kind, v.attribute, v.detail])).toEqual([
      ['incompatible_option', 'grille', { conflicts_with: { glass: 'fx_clear' } }],
    ]);
    const e = checkConfiguration(CATALOG, opening({ unit_type: 'casement' }));
    expect(e.violations.map((v) => v.kind)).toEqual(['unit_type_unavailable']);
  });
  it('candidate rows NEVER produce a violation - only a candidate_hint', () => {
    // color fx_black is a candidate row saying available:false.
    const c = checkConfiguration(CATALOG, opening({
      configuration: { series: FIXTURE_SERIES, glass: 'fx_clear', color: 'fx_black' },
    }));
    expect(c.violations).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.candidate_hints).toEqual([{
      attribute: 'color', value: 'fx_black', constraint_kind: 'color',
      detail: { available: false, state: 'candidate' },
    }]);
    expect(c.unknown).toEqual(['color:fx_black']);
    // casement width max is a candidate: an oversize casement is unknown, not violated.
    const w = checkConfiguration(CATALOG, opening({ unit_type: 'casement', width_in: 100 }));
    expect(w.violations.map((v) => v.kind)).toEqual(['unit_type_unavailable']);
    expect(w.unknown).toContain('width_in:range');
    expect(w.candidate_hints.some((h) => h.constraint_kind === 'size_max')).toBe(true);
  });
  it('no fact -> unknown; never guessed; empty catalog knows nothing', () => {
    const c = checkConfiguration([], opening({
      configuration: { series: FIXTURE_SERIES, glass: 'fx_clear', hardware: 'fx_lever' },
    }));
    expect(c.violations).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.complete).toBe(false);
    expect(c.unknown).toEqual([
      'unit_type:double_hung', 'width_in:range', 'height_in:range',
      'glass:fx_clear', 'hardware:fx_lever',
    ]);
    const noSeries = checkConfiguration(CATALOG, opening({ configuration: {} }));
    expect(noSeries.unknown).toEqual(['series:missing']);
    expect(noSeries.complete).toBe(false);
  });
  it('a candidate copy of the catalog produces zero violations for the same bad opening', () => {
    const candidates: CatalogRow[] = CATALOG.map((r) => ({
      ...r, state: 'candidate', fact_id: null,
    }));
    const c = checkConfiguration(candidates, opening({ width_in: 60, unit_type: 'casement' }));
    expect(c.violations).toEqual([]);
    expect(c.candidate_hints.length).toBeGreaterThan(0);
  });
});

describe('buildCatalogRowsFromFacts', () => {
  const CITE = [{ source_id: 'src-1', chunk_id: 'chk-1', quote: 'fixture quote' }];
  const FACT_ID = '00000000-0000-4000-8000-0000000000b1';
  function fact(over: Partial<KnowledgeFactLike> = {}): KnowledgeFactLike {
    return {
      id: FACT_ID,
      domain: 'andersen',
      subject: `andersen.series.${FIXTURE_SERIES}.unit.double_hung`,
      predicate: 'size_max',
      object: '*',
      value_json: { attribute: 'width_in', max: 48 },
      state: 'AUTHORIZED_FOR_USE',
      citations: CITE,
      ...over,
    };
  }
  it('maps an authorized, cited fact into an authorized catalog row with citation', () => {
    const r = buildCatalogRowsFromFacts([fact()]);
    expect(r.refused).toEqual([]);
    expect(r.rows).toEqual([{
      series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'width_in', value: '*',
      constraint_kind: 'size_max', constraint_value: { max: 48 }, fact_id: FACT_ID,
      source_citation: {
        source_id: 'src-1', chunk_id: 'chk-1', quote: 'fixture quote', citation_count: 1,
      },
      state: 'authorized',
    }]);
    expect(buildCatalogRowsFromFacts([fact({ state: 'VERIFIED' })]).rows[0].state)
      .toBe('verified');
    expect(buildCatalogRowsFromFacts([fact({ state: 'EXTRACTED_CANDIDATE', id: null })])
      .rows[0]).toMatchObject({ state: 'candidate', fact_id: null });
  });
  it('refuses facts without citations, wrong domain, bad state, bad shape, missing id', () => {
    const cases: Array<[Partial<KnowledgeFactLike>, string]> = [
      [{ citations: [] }, 'citation_missing'],
      [{ citations: [{ source_id: 'src', chunk_id: '', quote: 'q' }] }, 'citation_missing'],
      [{ citations: 'not-a-list' }, 'citation_missing'],
      [{ domain: 'lpc' }, 'domain_not_andersen'],
      [{ state: 'REJECTED' }, 'fact_state_not_importable'],
      [{ state: 'SUPERSEDED' }, 'fact_state_not_importable'],
      [{ id: null }, 'fact_id_required_for_trusted_row'],
      [{ subject: 'andersen 400 double hung' }, 'subject_format_invalid'],
      [{ predicate: 'price' }, 'predicate_not_constraint_kind'],
      [{ value_json: { max: 48 } }, 'attribute_missing'],
      [{ value_json: { attribute: 'width_in', max: -1 } }, 'dimension_bound_invalid'],
      [{ object: '' }, 'object_missing'],
    ];
    for (const [over, reason] of cases) {
      const r = buildCatalogRowsFromFacts([fact(over)]);
      expect(r.rows, reason).toEqual([]);
      expect(r.refused.map((x) => x.reason), reason).toEqual([reason]);
    }
  });
  it('deduplicates by the catalog unique key and keeps refusals indexed', () => {
    const r = buildCatalogRowsFromFacts([fact(), fact(), fact({ domain: 'x' })]);
    expect(r.rows).toHaveLength(1);
    expect(r.refused).toEqual([
      { index: 1, fact_id: FACT_ID, reason: 'duplicate_key' },
      { index: 2, fact_id: FACT_ID, reason: 'domain_not_andersen' },
    ]);
  });
});
