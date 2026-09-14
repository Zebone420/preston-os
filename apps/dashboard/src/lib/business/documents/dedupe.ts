// Phase 1 Lane B - hash and duplicate detection helpers.
//
// Exact duplicates share a sha256. Probable duplicates share (name, size)
// but lack a hash on at least one side. Output is a REPORT: a
// recommendation of which file to keep. No move/delete/trash operation is
// ever produced (plan 5.3: do not mass-move the old Drive).

import { createHash } from 'node:crypto';

import { SHA256_RE } from './types';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function isSha256(v: unknown): v is string {
  return typeof v === 'string' && SHA256_RE.test(v);
}

export interface DedupeCandidate {
  drive_file_id: string;
  name: string;
  size_bytes: number | null;
  sha256: string | null;
  modified_at?: string | null;
}

export interface DuplicateGroup {
  kind: 'exact' | 'probable';
  key: string;
  // recommendation only: earliest modified (then lowest id) file
  keep: string;
  duplicates: string[];
}

export interface DedupeReport {
  exact: DuplicateGroup[];
  probable: DuplicateGroup[];
  operations: readonly never[];
}

function order(a: DedupeCandidate, b: DedupeCandidate): number {
  const am = a.modified_at ?? '';
  const bm = b.modified_at ?? '';
  if (am !== bm) return am < bm ? -1 : 1;
  return a.drive_file_id < b.drive_file_id ? -1 : 1;
}

function group(
  kind: DuplicateGroup['kind'],
  key: string,
  members: DedupeCandidate[],
): DuplicateGroup {
  const sorted = [...members].sort(order);
  return {
    kind,
    key,
    keep: sorted[0].drive_file_id,
    duplicates: sorted.slice(1).map((m) => m.drive_file_id),
  };
}

export function findDuplicates(
  rows: readonly DedupeCandidate[],
): DedupeReport {
  const byHash = new Map<string, DedupeCandidate[]>();
  for (const r of rows) {
    if (!isSha256(r.sha256)) continue;
    const list = byHash.get(r.sha256) ?? [];
    list.push(r);
    byHash.set(r.sha256, list);
  }
  const exact: DuplicateGroup[] = [];
  const exactIds = new Set<string>();
  for (const [hash, members] of [...byHash.entries()].sort()) {
    if (members.length < 2) continue;
    exact.push(group('exact', hash, members));
    for (const m of members) exactIds.add(m.drive_file_id);
  }

  const byNameSize = new Map<string, DedupeCandidate[]>();
  for (const r of rows) {
    if (r.size_bytes === null || r.size_bytes === undefined) continue;
    const key = `${r.name.toLowerCase()}|${r.size_bytes}`;
    const list = byNameSize.get(key) ?? [];
    list.push(r);
    byNameSize.set(key, list);
  }
  const probable: DuplicateGroup[] = [];
  for (const [key, members] of [...byNameSize.entries()].sort()) {
    if (members.length < 2) continue;
    // Skip groups already fully explained by an exact hash match.
    const allHashed = members.every((m) => isSha256(m.sha256));
    const hashes = new Set(members.map((m) => m.sha256));
    if (allHashed && hashes.size === 1) continue;
    if (allHashed && hashes.size === members.length) continue;
    const unexplained = members.filter((m) => !exactIds.has(m.drive_file_id));
    if (unexplained.length < 2) continue;
    probable.push(group('probable', key, unexplained));
  }
  return { exact, probable, operations: [] };
}
