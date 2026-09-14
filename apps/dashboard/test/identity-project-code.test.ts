// Phase 1 Lane A - human Project ID (P26-0001) pure helpers.

import { describe, expect, it } from 'vitest';
import {
  formatProjectCode,
  isProjectCode,
  nextProjectCode,
  normalizeProjectCodeInText,
  parseProjectCode,
  PROJECT_CODE_MAX_SEQ,
  yearYYOf,
} from '../src/lib/business/identity/project-code';

describe('project code format', () => {
  it('accepts exactly P<YY>-<NNNN>', () => {
    expect(isProjectCode('P26-0001')).toBe(true);
    expect(isProjectCode('P99-9999')).toBe(true);
    for (const bad of ['p26-0001', 'P26-001', 'P2026-0001', 'P26_0001',
      'P26-00011', ' P26-0001', 'P26-0001 ', '', null, undefined, 260001]) {
      expect(isProjectCode(bad)).toBe(false);
    }
  });

  it('parses and formats symmetrically', () => {
    expect(parseProjectCode('P26-0001')).toEqual({ yy: '26', seq: 1 });
    expect(parseProjectCode('P26-0042')).toEqual({ yy: '26', seq: 42 });
    expect(parseProjectCode('P26-0000')).toBeNull(); // never minted
    expect(parseProjectCode('nope')).toBeNull();
    expect(formatProjectCode('26', 1)).toBe('P26-0001');
    expect(formatProjectCode('26', 9999)).toBe('P26-9999');
    expect(formatProjectCode('07', 12)).toBe('P07-0012');
    for (let seq = 1; seq <= 50; seq++) {
      const code = formatProjectCode('26', seq);
      expect(parseProjectCode(code)).toEqual({ yy: '26', seq });
    }
  });

  it('refuses out-of-range sequences and malformed years', () => {
    expect(() => formatProjectCode('26', 0)).toThrow(RangeError);
    expect(() => formatProjectCode('26', PROJECT_CODE_MAX_SEQ + 1))
      .toThrow(RangeError);
    expect(() => formatProjectCode('26', 1.5)).toThrow(RangeError);
    expect(() => formatProjectCode('2026', 1)).toThrow(RangeError);
    expect(() => formatProjectCode('2', 1)).toThrow(RangeError);
  });

  it('derives the two-digit year like to_char(now(), YY)', () => {
    expect(yearYYOf(new Date('2026-09-08T12:00:00Z'))).toBe('26');
    expect(yearYYOf(new Date('2030-01-01T00:00:00Z'))).toBe('30');
    expect(yearYYOf(new Date('2105-06-01T00:00:00Z'))).toBe('05');
  });
});

describe('next project code (preview mirror of the DB counter)', () => {
  it('starts each year at 0001 and increments by one', () => {
    expect(nextProjectCode(null, '26')).toBe('P26-0001');
    expect(nextProjectCode('P26-0001', '26')).toBe('P26-0002');
    expect(nextProjectCode('P26-0999', '26')).toBe('P26-1000');
  });

  it('rolls over to 0001 when the year changes', () => {
    expect(nextProjectCode('P25-0042', '26')).toBe('P26-0001');
    expect(nextProjectCode('P26-0042', '27')).toBe('P27-0001');
  });

  it('never reuses a code: the sequence is strictly increasing', () => {
    const seen = new Set<string>();
    let cur: string | null = null;
    for (let i = 0; i < 200; i++) {
      cur = nextProjectCode(cur, '26');
      expect(seen.has(cur)).toBe(false);
      seen.add(cur);
    }
    expect(cur).toBe('P26-0200');
  });

  it('refuses to wrap at 9999 (exhaustion is an error, not reuse)', () => {
    expect(() => nextProjectCode('P26-9999', '26')).toThrow(/exhausted/);
    expect(() => nextProjectCode('garbage', '26')).toThrow(RangeError);
    expect(() => nextProjectCode(null, '2026')).toThrow(RangeError);
  });
});

describe('project code detection in text', () => {
  it('finds canonical codes in subjects and filenames', () => {
    expect(normalizeProjectCodeInText('Re: P26-0001 windows'))
      .toEqual(['P26-0001']);
    expect(normalizeProjectCodeInText('P26-0003_proposal_v2.pdf'))
      .toEqual(['P26-0003']);
    expect(normalizeProjectCodeInText('[P26-0007] final measure'))
      .toEqual(['P26-0007']);
  });

  it('canonicalizes case and separator variants, de-duplicating', () => {
    expect(normalizeProjectCodeInText('p26-0002 and P26_0002 again'))
      .toEqual(['P26-0002']);
    const enDash = String.fromCharCode(0x2013);
    expect(normalizeProjectCodeInText(`P26${enDash}0004`)).toEqual(['P26-0004']);
    expect(normalizeProjectCodeInText('P26-0001 then P26-0002 then P26-0001'))
      .toEqual(['P26-0001', 'P26-0002']);
  });

  it('does not match look-alikes', () => {
    expect(normalizeProjectCodeInText('XP26-0001')).toEqual([]);
    expect(normalizeProjectCodeInText('P26-00012')).toEqual([]);
    expect(normalizeProjectCodeInText('P26-0000')).toEqual([]);
    expect(normalizeProjectCodeInText('P2026-0001')).toEqual([]);
    expect(normalizeProjectCodeInText('P26 0001')).toEqual([]);
    expect(normalizeProjectCodeInText('')).toEqual([]);
  });
});
