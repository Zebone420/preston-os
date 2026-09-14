// Lane B pins: sha256 helpers and duplicate grouping (report only).

import { describe, expect, it } from 'vitest';

import {
  findDuplicates,
  isSha256,
  sha256Hex,
} from '../src/lib/business/documents/dedupe';
import type { DedupeCandidate } from '../src/lib/business/documents/dedupe';

const H_A = sha256Hex('synthetic file A');
const H_B = sha256Hex('synthetic file B');

describe('sha256 helpers', () => {
  it('hashes deterministically to 64 lowercase hex chars', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(new Uint8Array([97, 98, 99]))).toBe(sha256Hex('abc'));
    expect(isSha256(H_A)).toBe(true);
    expect(isSha256(H_A.toUpperCase())).toBe(false);
    expect(isSha256('deadbeef')).toBe(false);
    expect(isSha256(null)).toBe(false);
  });
});

describe('findDuplicates', () => {
  const rows: DedupeCandidate[] = [
    { drive_file_id: 'f1', name: 'Quote.pdf', size_bytes: 100, sha256: H_A,
      modified_at: '2026-01-02T00:00:00Z' },
    { drive_file_id: 'f2', name: 'Quote (1).pdf', size_bytes: 100,
      sha256: H_A, modified_at: '2026-01-01T00:00:00Z' },
    { drive_file_id: 'f3', name: 'Quote copy.pdf', size_bytes: 100,
      sha256: H_A, modified_at: '2026-01-03T00:00:00Z' },
    { drive_file_id: 'f4', name: 'Plan.pdf', size_bytes: 555, sha256: null },
    { drive_file_id: 'f5', name: 'plan.PDF', size_bytes: 555, sha256: null },
    { drive_file_id: 'f6', name: 'Other.pdf', size_bytes: 555,
      sha256: sha256Hex('six') },
    { drive_file_id: 'f7', name: 'Unique.pdf', size_bytes: 9, sha256: null },
    { drive_file_id: 'f8', name: 'Diff.pdf', size_bytes: 77, sha256: H_B },
    { drive_file_id: 'f9', name: 'Diff.pdf', size_bytes: 77,
      sha256: sha256Hex('nine') },
  ];
  const report = findDuplicates(rows);

  it('groups exact duplicates by sha256 and keeps the earliest', () => {
    expect(report.exact).toHaveLength(1);
    expect(report.exact[0]).toEqual({
      kind: 'exact', key: H_A, keep: 'f2', duplicates: ['f1', 'f3'],
    });
  });

  it('groups probable duplicates by (name, size) when hashes are missing', () => {
    expect(report.probable).toHaveLength(1);
    expect(report.probable[0]).toEqual({
      kind: 'probable', key: 'plan.pdf|555', keep: 'f4', duplicates: ['f5'],
    });
  });

  it('same name+size with two DIFFERENT hashes is not a duplicate', () => {
    const keys = report.probable.map((g) => g.key);
    expect(keys).not.toContain('diff.pdf|77');
  });

  it('emits no operations of any kind', () => {
    expect(report.operations).toEqual([]);
    const json = JSON.stringify(report).toLowerCase();
    for (const bad of ['move', 'delete', 'trash']) {
      expect(json).not.toContain(`"${bad}`);
    }
  });

  it('is deterministic regardless of input order', () => {
    const shuffled = [...rows].reverse();
    expect(findDuplicates(shuffled)).toEqual(report);
  });
});
