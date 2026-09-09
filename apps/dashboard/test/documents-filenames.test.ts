// Lane B pins: deterministic canonical filenames (plan 5.8).

import { describe, expect, it } from 'vitest';

import {
  canonicalFilename,
  isCanonicalFilename,
  normalizeParty,
  normalizeRef,
  parseCanonicalFilename,
  TYPE_TOKENS,
} from '../src/lib/business/documents/filenames';
import { DOCUMENT_TYPES } from '../src/lib/business/documents/types';
import type { CanonicalNameParts } from '../src/lib/business/documents/filenames';

describe('canonicalFilename - plan 5.8 examples', () => {
  it('builds the four plan examples exactly', () => {
    expect(canonicalFilename({
      projectCode: 'P26-0041', documentType: 'vendor_quote',
      party: 'HOMEDEPOT', ref: 'H1256-471919', version: 2, ext: 'pdf',
    })).toBe('P26-0041_VENDOR_HOMEDEPOT_QUOTE_H1256-471919_V02.pdf');
    expect(canonicalFilename({
      projectCode: 'P26-0041', documentType: 'proposal',
      party: 'CLIENT', version: 3, ext: 'pdf',
    })).toBe('P26-0041_PROPOSAL_CLIENT_V03.pdf');
    expect(canonicalFilename({
      projectCode: 'P26-0041', documentType: 'measurement',
      qualifier: 'FINAL', version: 2, ext: 'pdf',
    })).toBe('P26-0041_FINAL_MEASURE_V02.pdf');
    expect(canonicalFilename({
      projectCode: 'P26-0041', documentType: 'purchase_order',
      version: 1, ext: 'pdf',
    })).toBe('P26-0041_PO_V01.pdf');
  });

  it('zero-pads the version to two digits', () => {
    const n = canonicalFilename({
      projectCode: 'P26-0001', documentType: 'contract', version: 7,
      ext: 'pdf',
    });
    expect(n).toBe('P26-0001_CONTRACT_V07.pdf');
    expect(canonicalFilename({
      projectCode: 'P26-0001', documentType: 'contract', version: 42,
      ext: 'pdf',
    })).toBe('P26-0001_CONTRACT_V42.pdf');
  });

  it('has a unique, upper-case type token for every document type', () => {
    const tokens = DOCUMENT_TYPES.map((t) => TYPE_TOKENS[t]);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const tok of tokens) expect(tok).toMatch(/^[A-Z]+$/);
    expect(tokens).not.toContain('VENDOR');
  });
});

describe('canonicalFilename - rejection of unsafe input', () => {
  const base: CanonicalNameParts = {
    projectCode: 'P26-0041', documentType: 'proposal', version: 1,
    ext: 'pdf',
  };
  it('rejects bad project codes', () => {
    expect(() => canonicalFilename({ ...base, projectCode: 'X26-0041' }))
      .toThrow();
    expect(() => canonicalFilename({ ...base, projectCode: 'P26_0041' }))
      .toThrow();
  });
  it('rejects unsafe party, ref, ext and version values', () => {
    expect(() => canonicalFilename({ ...base, party: 'home depot' }))
      .toThrow();
    expect(() => canonicalFilename({ ...base, party: 'HOME_DEPOT' }))
      .toThrow();
    expect(() => canonicalFilename({ ...base, party: 'Home' })).toThrow();
    expect(() => canonicalFilename({ ...base, ref: '../etc' })).toThrow();
    expect(() => canonicalFilename({ ...base, ref: 'ABC' })).toThrow();
    expect(() => canonicalFilename({ ...base, ref: 'A 1' })).toThrow();
    expect(() => canonicalFilename({ ...base, ext: 'PDF' })).toThrow();
    expect(() => canonicalFilename({ ...base, ext: 'p.df' })).toThrow();
    expect(() => canonicalFilename({ ...base, ext: '' })).toThrow();
    expect(() => canonicalFilename({ ...base, version: 0 })).toThrow();
    expect(() => canonicalFilename({ ...base, version: 100 })).toThrow();
    expect(() => canonicalFilename({ ...base, version: 1.5 })).toThrow();
  });
  it('rejects an unknown qualifier and vendor_quote without a party', () => {
    expect(() => canonicalFilename({
      ...base, qualifier: 'LATEST' as unknown as 'FINAL',
    })).toThrow();
    expect(() => canonicalFilename({
      ...base, documentType: 'vendor_quote',
    })).toThrow();
    expect(() => canonicalFilename({
      ...base, documentType: 'vendor_quote', party: 'ANDERSEN',
      qualifier: 'FINAL',
    })).toThrow();
  });
});

describe('parseCanonicalFilename', () => {
  it('inverts the plan examples', () => {
    expect(parseCanonicalFilename(
      'P26-0041_VENDOR_HOMEDEPOT_QUOTE_H1256-471919_V02.pdf',
    )).toEqual({
      projectCode: 'P26-0041', documentType: 'vendor_quote',
      party: 'HOMEDEPOT', ref: 'H1256-471919', version: 2, ext: 'pdf',
    });
    expect(parseCanonicalFilename('P26-0041_PROPOSAL_CLIENT_V03.pdf'))
      .toEqual({
        projectCode: 'P26-0041', documentType: 'proposal', party: 'CLIENT',
        version: 3, ext: 'pdf',
      });
    expect(parseCanonicalFilename('P26-0041_FINAL_MEASURE_V02.pdf'))
      .toEqual({
        projectCode: 'P26-0041', documentType: 'measurement',
        qualifier: 'FINAL', version: 2, ext: 'pdf',
      });
    expect(parseCanonicalFilename('P26-0041_PO_V01.pdf')).toEqual({
      projectCode: 'P26-0041', documentType: 'purchase_order', version: 1,
      ext: 'pdf',
    });
  });

  it('round-trips every document type with optional parts', () => {
    for (const t of DOCUMENT_TYPES) {
      const parts: CanonicalNameParts = {
        projectCode: 'P26-0099', documentType: t, version: 5, ext: 'pdf',
        ref: 'REF-77',
      };
      if (t === 'vendor_quote') parts.party = 'ANDERSEN';
      else parts.qualifier = 'DRAFT';
      const name = canonicalFilename(parts);
      expect(parseCanonicalFilename(name)).toEqual(parts);
      expect(isCanonicalFilename(name)).toBe(true);
    }
  });

  it('returns null for non-canonical names', () => {
    for (const bad of [
      'P26-0041_PROPOSAL_CLIENT.pdf',
      'P26-0041_PROPOSAL_CLIENT_V3.pdf',
      'proposal final.pdf',
      'P26-0041_UNKNOWNTYPE_V01.pdf',
      'P26-0041_VENDOR_HOMEDEPOT_V01.pdf',
      'P26-0041_PROPOSAL_CLIENT_EXTRA_MORE_V01.pdf',
      'P26-0041_PROPOSAL_V01.PDF',
      'P26-0041_PROPOSAL_V00.pdf',
      '../P26-0041_PROPOSAL_V01.pdf',
      'P26-0041_PROPOSAL_V01',
    ]) {
      expect(parseCanonicalFilename(bad), bad).toBeNull();
      expect(isCanonicalFilename(bad), bad).toBe(false);
    }
  });
});

describe('normalizers', () => {
  it('reduce free text to the strict charsets', () => {
    expect(normalizeParty('Home Depot, Inc.')).toBe('HOMEDEPOTINC');
    expect(normalizeRef('h1256-471919 / rev b')).toBe('H1256-471919REVB');
  });
});
