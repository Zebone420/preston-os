// Lane B pins: Stage A Drive inventory plan (plan 5.3) - classify only,
// never move/delete. Synthetic listing only.

import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../src/lib/business/documents/dedupe';
import { buildInventoryPlan } from '../src/lib/business/documents/inventory';
import type { ListedDriveFile } from '../src/lib/business/documents/inventory';
import { INVENTORY_STATUSES } from '../src/lib/business/documents/types';

const H = sha256Hex('same bytes');

const LISTING: ListedDriveFile[] = [
  { id: 'd01', name: 'Quote H1256-471919.pdf', mimeType: 'application/pdf',
    parents: ['p1'], path: 'Old/Clients/Synthetic/Quote H1256-471919.pdf',
    size: '12000', modifiedTime: '2026-05-01T00:00:00Z', sha256: H },
  { id: 'd02', name: 'Quote H1256-471919 (1).pdf',
    mimeType: 'application/pdf', parents: ['p1'],
    path: 'Old/Clients/Synthetic/Quote H1256-471919 (1).pdf',
    size: 12000, modifiedTime: '2026-05-02T00:00:00Z', sha256: H },
  { id: 'd03', name: 'Clients', mimeType: 'application/vnd.google-apps.folder',
    parents: ['root'], path: 'Old/Clients' },
  { id: 'd04', name: '.DS_Store', mimeType: 'application/octet-stream',
    parents: ['p1'], path: 'Old/Clients/.DS_Store', size: 6 },
  { id: 'd05', name: 'Statement.pdf', mimeType: 'application/pdf',
    parents: ['p9'], path: 'Old/Finance/2025/Statement.pdf', size: 1 },
  { id: 'd06', name: 'Site notes.pdf', mimeType: 'application/pdf',
    parents: ['p8'], path: 'Old/Payroll/Site notes.pdf', size: 1 },
  { id: 'd07', name: 'zzz.bin', mimeType: 'application/octet-stream',
    parents: ['p1'], path: 'Old/Clients/Synthetic/zzz.bin', size: 1 },
  { id: 'd08', name: 'Proposal V2.pdf', mimeType: 'application/pdf',
    parents: ['p2'], path: 'Old/tmp/Proposal V2.pdf', size: 20 },
  { id: 'd09', name: 'Punch list.pdf', mimeType: 'application/pdf',
    parents: null, path: null, size: null, modifiedTime: null },
  { id: 'd09', name: 'Punch list dup id.pdf', mimeType: 'application/pdf' },
  { id: '', name: 'no id.pdf' },
];

describe('buildInventoryPlan', () => {
  const plan = buildInventoryPlan(LISTING, 'run-2026-09-08-synthetic');
  const byId = (id: string) => plan.rows.find((r) => r.drive_file_id === id);

  it('produces one row per file, skips folders/dup ids/missing ids', () => {
    expect(plan.kind).toBe('drive_inventory_plan');
    expect(plan.rows.map((r) => r.drive_file_id)).toEqual([
      'd01', 'd02', 'd04', 'd05', 'd06', 'd07', 'd08', 'd09',
    ]);
    expect(plan.skipped).toEqual([
      { id: '', reason: 'missing id' },
      { id: 'd03', reason: 'folder' },
      { id: 'd09', reason: 'listed twice' },
    ]);
    for (const r of plan.rows) {
      expect(INVENTORY_STATUSES).toContain(r.status);
      expect(r.inventory_run_id).toBe('run-2026-09-08-synthetic');
    }
  });

  it('classifies and carries metadata (size coerced, first parent)', () => {
    const r = byId('d01')!;
    expect(r.status).toBe('classified');
    expect(r.classification.document_type).toBe('vendor_quote');
    expect(r.size_bytes).toBe(12000);
    expect(r.parent_id).toBe('p1');
    expect(r.sha256).toBe(H);
    expect(byId('d09')).toMatchObject({
      parent_id: null, path: null, size_bytes: null, modified_at: null,
      sha256: null, status: 'classified',
    });
    expect(byId('d09')!.classification.document_type).toBe('punch');
  });

  it('marks the second identical hash as duplicate', () => {
    expect(byId('d02')!.status).toBe('duplicate');
  });

  it('excludes system files and excluded paths', () => {
    expect(byId('d04')).toMatchObject({ status: 'excluded' });
    expect(byId('d04')!.classification.privacy_class).toBe('EXCLUDE');
    expect(byId('d08')).toMatchObject({ status: 'excluded' });
    expect(byId('d08')!.classification.reasons).toContain('excluded folder path');
  });

  it('restricts finance and HR folder paths regardless of filename', () => {
    expect(byId('d05')!.classification.privacy_class).toBe('RESTRICTED_FINANCE');
    expect(byId('d06')!.classification.privacy_class).toBe('RESTRICTED_HR');
    expect(byId('d06')!.classification.reasons).toContain('hr folder path');
  });

  it('leaves low-confidence files as inventoried (not registered)', () => {
    expect(byId('d07')).toMatchObject({ status: 'inventoried' });
    expect(plan.counts).toEqual({
      inventoried: 1, classified: 4, registered: 0, duplicate: 1, excluded: 2,
    });
    expect(plan.rows.every((r) => r.status !== 'registered')).toBe(true);
  });

  it('NEVER emits move, delete, trash, rename or copy operations', () => {
    const json = JSON.stringify(plan).toLowerCase();
    for (const bad of ['"move', '"delete', '"trash', '"rename', '"copy',
      '"operations']) {
      expect(json).not.toContain(bad);
    }
    expect(Object.keys(plan).sort()).toEqual([
      'counts', 'inventory_run_id', 'kind', 'rows', 'skipped',
    ]);
  });

  it('is deterministic regardless of listing order', () => {
    const again = buildInventoryPlan([...LISTING].reverse(),
      'run-2026-09-08-synthetic');
    expect(again).toEqual(plan);
  });

  it('requires a run id', () => {
    expect(() => buildInventoryPlan(LISTING, '')).toThrow();
  });
});
