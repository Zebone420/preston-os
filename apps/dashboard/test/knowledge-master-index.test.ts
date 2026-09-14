// Master-index parser pins (synthetic fixture only): good rows become
// ANDERSEN_OFFICIAL source candidates; malformed rows are reported.

import { describe, expect, it } from 'vitest';
import {
  MASTER_INDEX_DOMAIN,
  parseAndersenMasterIndex,
  parseCsvLine,
} from '../src/lib/business/knowledge/master-index';

const SHA = 'a'.repeat(64);

const CSV = [
  'Title,Series,Doc Type,Version,Drive File ID,SHA256,Effective From',
  'Fixture Series A Install Guide,Series A,install_guide,2024.1,fileA0001,' + SHA + ',2024-03-01',
  '"Fixture Series B, Sizing Table",Series B,sizing_table,3,fileB0002,,',
  ',Series C,spec,1,fileC0003,,',
  'Fixture Bad Hash,Series C,spec,1,fileC0004,nothex,2024-01-01',
  'Fixture Bad Date,Series C,spec,1,fileC0005,,03/01/2024',
  'Fixture Bad Drive Id,Series C,spec,1,id,,',
  'Fixture Column Mismatch,Series C,spec',
  'Fixture Duplicate,Series A,install_guide,2024.2,fileA0001,,',
].join('\n');

describe('parseCsvLine', () => {
  it('handles quotes, embedded commas and doubled quotes', () => {
    expect(parseCsvLine('a,"b, c","d ""e""",f')).toEqual(['a', 'b, c', 'd "e"', 'f']);
    expect(parseCsvLine('')).toEqual(['']);
  });
});

describe('parseAndersenMasterIndex - CSV', () => {
  const res = parseAndersenMasterIndex(CSV);

  it('turns good rows into ANDERSEN_OFFICIAL candidates', () => {
    expect(res.format).toBe('csv');
    expect(res.total_rows).toBe(8);
    expect(res.candidates.length).toBe(2);
    const [a, b] = res.candidates;
    expect(a).toEqual({
      domain: MASTER_INDEX_DOMAIN,
      title: 'Fixture Series A Install Guide',
      authority_class: 'OFFICIAL_CURRENT',
      source_version: '2024.1',
      sha256: SHA,
      needs_hash: false,
      effective_from: '2024-03-01',
      is_current: true,
      metadata: {
        series: 'Series A', doc_type: 'install_guide',
        drive_file_id: 'fileA0001', index_row: 1,
      },
    });
    expect(b.title).toBe('Fixture Series B, Sizing Table');
    expect(b.sha256).toBeNull();
    expect(b.needs_hash).toBe(true);
    expect(b.effective_from).toBeNull();
  });

  it('reports every malformed row with its reason instead of dropping it', () => {
    const reasons = res.malformed.map((m) => [m.row, m.reason]);
    expect(reasons).toEqual([
      [3, 'missing_title'],
      [4, 'invalid_sha256'],
      [5, 'invalid_effective_from'],
      [6, 'invalid_drive_file_id'],
      [7, 'column_count_mismatch'],
      [8, 'duplicate_drive_file_id_of_row_1'],
    ]);
    expect(res.candidates.length + res.malformed.length).toBe(res.total_rows);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('candidates carry no product facts, only registry metadata', () => {
    for (const c of res.candidates) {
      expect(Object.keys(c).sort()).toEqual([
        'authority_class', 'domain', 'effective_from', 'is_current', 'metadata',
        'needs_hash', 'sha256', 'source_version', 'title',
      ]);
    }
  });
});

describe('parseAndersenMasterIndex - JSON and edge cases', () => {
  it('accepts a JSON row list with alias headers', () => {
    const json = JSON.stringify([
      { name: 'Fixture J1', product_series: 'S', type: 'spec',
        file_id: 'fileJ0001', hash: SHA.toUpperCase(), effective: '2025-01-15' },
      { title: 'Fixture J2', drive_id: 'fileJ0002' },
      'not-an-object',
      { title: 'Fixture J3' },
    ]);
    const r = parseAndersenMasterIndex(json);
    expect(r.format).toBe('json');
    expect(r.candidates.map((c) => c.title)).toEqual(['Fixture J1', 'Fixture J2']);
    expect(r.candidates[0].sha256).toBe(SHA);
    expect(r.candidates[0].effective_from).toBe('2025-01-15');
    expect(r.malformed.map((m) => m.reason))
      .toEqual(['row_not_an_object', 'invalid_drive_file_id']);
    expect(parseAndersenMasterIndex('{"rows":[{"title":"X","drive_file_id":"fileX0001"}]}')
      .candidates.length).toBe(1);
  });

  it('empty, invalid or non-list input is an explicit error, not ok', () => {
    expect(parseAndersenMasterIndex('')).toMatchObject({ ok: false, errors: ['empty_index'] });
    expect(parseAndersenMasterIndex('[not json')).toMatchObject({
      ok: false, errors: ['invalid_json'],
    });
    expect(parseAndersenMasterIndex('{"a":1}')).toMatchObject({
      ok: false, errors: ['json_not_a_row_list'],
    });
    expect(parseAndersenMasterIndex('title,drive_file_id')).toMatchObject({
      ok: false, errors: ['no_rows'], candidates: [],
    });
    expect(parseAndersenMasterIndex(42 as unknown as string).ok).toBe(false);
  });

  it('strips a leading BOM and neutralizes control characters in fields', () => {
    const bom = String.fromCharCode(0xfeff);
    const r = parseAndersenMasterIndex(
      bom + 'title,drive_file_id\nFix' + String.fromCharCode(7) + 'ture,fileZ0001',
    );
    expect(r.candidates[0].title).toBe('Fixture');
    expect(r.candidates[0].metadata.drive_file_id).toBe('fileZ0001');
  });
});
