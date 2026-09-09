// SYNTHETIC FIXTURE - NOT ANDERSEN DATA.
//
// Every value below is invented for tests of the catalog STRUCTURE and
// check logic. None of these numbers, options or availability flags
// describe a real Andersen product. Never import this module from
// runtime code; never promote these rows to a real catalog.

import type { CatalogRow } from './catalog';

export const FIXTURE_LABEL = 'SYNTHETIC FIXTURE - NOT ANDERSEN DATA';

const FIXTURE_CITATION = {
  source_id: '00000000-0000-4000-8000-00000000f1c1',
  chunk_id: '00000000-0000-4000-8000-00000000f1c2',
  quote: FIXTURE_LABEL,
  fixture: true,
  note: FIXTURE_LABEL,
};

const FACT_A = '00000000-0000-4000-8000-0000000000a1';
const FACT_B = '00000000-0000-4000-8000-0000000000a2';
const FACT_C = '00000000-0000-4000-8000-0000000000a3';
const FACT_D = '00000000-0000-4000-8000-0000000000a4';
const FACT_E = '00000000-0000-4000-8000-0000000000a5';
const FACT_F = '00000000-0000-4000-8000-0000000000a6';

function row(
  partial: Omit<CatalogRow, 'source_citation'>,
): CatalogRow {
  return { ...partial, source_citation: { ...FIXTURE_CITATION } };
}

// Series 'FX' is a fictional series so the fixture can never be mistaken
// for a real catalog entry even if it leaks into a query.
export const FIXTURE_SERIES = 'FX';

export const FIXTURE_ANDERSEN_CATALOG: readonly CatalogRow[] = Object.freeze([
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'unit_type',
    value: 'double_hung', constraint_kind: 'availability',
    constraint_value: { available: true }, fact_id: FACT_A, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'width_in',
    value: '*', constraint_kind: 'size_min',
    constraint_value: { min: 20 }, fact_id: FACT_B, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'width_in',
    value: '*', constraint_kind: 'size_max',
    constraint_value: { max: 48 }, fact_id: FACT_B, state: 'authorized',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'height_in',
    value: '*', constraint_kind: 'size_min',
    constraint_value: { min: 24 }, fact_id: FACT_C, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'height_in',
    value: '*', constraint_kind: 'size_max',
    constraint_value: { max: 84 }, fact_id: FACT_C, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'glass',
    value: 'fx_clear', constraint_kind: 'glass',
    constraint_value: { available: true }, fact_id: FACT_D, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'glass',
    value: 'fx_discontinued', constraint_kind: 'glass',
    constraint_value: { available: false }, fact_id: FACT_D, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'grille',
    value: 'fx_colonial', constraint_kind: 'grille',
    constraint_value: { available: true }, fact_id: FACT_E, state: 'verified',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'grille',
    value: 'fx_colonial', constraint_kind: 'compatibility',
    constraint_value: { excludes: { glass: ['fx_clear'] } },
    fact_id: FACT_E, state: 'verified',
  }),
  // Candidate rows: hints only, never violations.
  row({
    series: FIXTURE_SERIES, unit_type: 'double_hung', attribute: 'color',
    value: 'fx_black', constraint_kind: 'color',
    constraint_value: { available: false }, fact_id: null, state: 'candidate',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'casement', attribute: 'width_in',
    value: '*', constraint_kind: 'size_max',
    constraint_value: { max: 36 }, fact_id: null, state: 'candidate',
  }),
  row({
    series: FIXTURE_SERIES, unit_type: 'casement', attribute: 'unit_type',
    value: 'casement', constraint_kind: 'availability',
    constraint_value: { available: false }, fact_id: FACT_F, state: 'verified',
  }),
]);
