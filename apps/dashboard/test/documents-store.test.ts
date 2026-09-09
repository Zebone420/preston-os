// Lane B pins: document registry store adapters over a fake RuntimeClient.
// Insert-only + CAS supersession; no delete path exists.

import { describe, expect, it } from 'vitest';

import type { RuntimeClient } from '../src/lib/ai-os/store';
import { buildInventoryPlan } from '../src/lib/business/documents/inventory';
import {
  DOCUMENT_TABLES,
  insertDocument,
  insertDriveFolder,
  listCurrentDocuments,
  markSuperseded,
  upsertInventoryRows,
  validateDocumentRow,
} from '../src/lib/business/documents/store';
import type { DocumentRow } from '../src/lib/business/documents/types';

type FakeRow = Record<string, unknown>;

const UNIQUE_KEYS: Record<string, string[][]> = {
  documents: [['id'], ['drive_file_id']],
  project_drive_folders: [['project_id'], ['drive_folder_id']],
  drive_inventory: [['drive_file_id']],
};

function makeFakeDb(failTables: Set<string> = new Set()) {
  const tables = new Map<string, FakeRow[]>();
  let nextId = 1;
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const dupError = () => Promise.resolve({
    data: null,
    error: { message: 'duplicate key value violates unique constraint' },
  });
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: FakeRow) {
          return {
            select(cols: string) {
              if (failTables.has(table)) {
                return Promise.resolve({
                  data: null, error: { message: 'injected failure' },
                });
              }
              const rows = rowsOf(table);
              for (const keys of UNIQUE_KEYS[table] ?? []) {
                const clash = rows.find((r) => keys.every(
                  (k) => r[k] !== undefined && r[k] !== null &&
                    r[k] === row[k]));
                if (clash) return dupError();
              }
              const stored: FakeRow = { ...row };
              if (table !== 'project_drive_folders') {
                stored.id = row.id ?? `00000000-0000-4000-9000-${
                  String(nextId++).padStart(12, '0')}`;
              }
              rows.push(stored);
              // like PostgREST, return only the requested column
              return Promise.resolve({
                data: [{ [cols]: stored[cols] }], error: null,
              });
            },
          };
        },
        select() {
          const chain = (filters: Array<(r: FakeRow) => boolean>) => ({
            eq(col: string, val: string) {
              return chain([...filters, (r) => String(r[col]) === val]);
            },
            order(col: string, opts: { ascending: boolean }) {
              return {
                limit(n: number) {
                  const rows = rowsOf(table)
                    .filter((r) => filters.every((f) => f(r)))
                    .sort((a, b) => {
                      const av = String(a[col] ?? '');
                      const bv = String(b[col] ?? '');
                      return opts.ascending
                        ? av.localeCompare(bv) : bv.localeCompare(av);
                    })
                    .slice(0, n);
                  return Promise.resolve({ data: rows, error: null });
                },
              };
            },
            limit(n: number) {
              const rows = rowsOf(table)
                .filter((r) => filters.every((f) => f(r))).slice(0, n);
              return Promise.resolve({ data: rows, error: null });
            },
          });
          return chain([]);
        },
        update(patch: FakeRow) {
          const chain = (filters: Array<(r: FakeRow) => boolean>) => ({
            eq(col: string, val: string) {
              return chain([...filters, (r) => String(r[col]) === val]);
            },
            lte() { return chain(filters); },
            gt() { return chain(filters); },
            select() {
              const matched = rowsOf(table)
                .filter((r) => filters.every((f) => f(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({
                data: matched.map((r) => ({ id: r.id })), error: null,
              });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

const PROJECT = '00000000-0000-4000-8000-000000000401';
const uuid = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const hash = (n: number) => n.toString(16).padStart(64, '0');

function doc(n: number, over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: uuid(n),
    project_id: PROJECT,
    client_id: null,
    property_id: null,
    drive_file_id: `drive-${n}`,
    drive_parent_id: null,
    source_system: 'upload',
    source_message_id: null,
    document_type: 'proposal',
    document_subtype: null,
    original_filename: `proposal ${n}.pdf`,
    canonical_filename: `P26-0041_PROPOSAL_CLIENT_V0${n}.pdf`,
    mime_type: 'application/pdf',
    sha256: hash(n),
    file_size_bytes: 10,
    version: n,
    is_current: true,
    supersedes_document_id: null,
    authority_class: 'INTERNAL_APPROVED',
    privacy_class: 'CLIENT_CONFIDENTIAL',
    verification_status: 'unverified',
    approved_use: null,
    source_created_at: null,
    source_modified_at: null,
    registered_at: `2026-09-0${n}T00:00:00.000Z`,
    registered_by: 'test',
    metadata: {},
    ...over,
  };
}

describe('insertDocument', () => {
  it('validates before writing and inserts a good row', async () => {
    const db = makeFakeDb();
    expect(await insertDocument(db.client, doc(1))).toEqual({
      ok: true, id: uuid(1),
    });
    expect(db.rowsOf('documents')).toHaveLength(1);
    const bad = await insertDocument(db.client, doc(2, { sha256: 'nope' }));
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid sha256');
    expect(db.rowsOf('documents')).toHaveLength(1);
  });

  it('rejects a current SUPERSEDED row and unknown enums', () => {
    expect(validateDocumentRow(doc(1, {
      authority_class: 'SUPERSEDED', is_current: true,
    }))).toBe('superseded row cannot be current');
    expect(validateDocumentRow(doc(1, {
      document_type: 'selfie' as unknown as 'other',
    }))).toBe('invalid document_type');
    expect(validateDocumentRow(doc(1, { version: 0 }))).toBe('invalid version');
    expect(validateDocumentRow(doc(1, { project_id: 'p1' })))
      .toBe('invalid project_id');
    expect(validateDocumentRow(doc(1, { registered_by: '' })))
      .toBe('missing registered_by');
    expect(validateDocumentRow(doc(1))).toBeNull();
  });

  it('reports a duplicate drive_file_id idempotently', async () => {
    const db = makeFakeDb();
    await insertDocument(db.client, doc(1));
    const again = await insertDocument(db.client, doc(2, {
      drive_file_id: 'drive-1',
    }));
    expect(again).toEqual({ ok: true, duplicate: true, id: uuid(2) });
    expect(db.rowsOf('documents')).toHaveLength(1);
  });

  it('fails closed on a database error', async () => {
    const db = makeFakeDb(new Set(['documents']));
    const res = await insertDocument(db.client, doc(1));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('injected failure');
  });
});

describe('markSuperseded (CAS)', () => {
  it('supersedes a current row exactly once', async () => {
    const db = makeFakeDb();
    await insertDocument(db.client, doc(1));
    expect(await markSuperseded(db.client, uuid(1))).toEqual({
      ok: true, id: uuid(1),
    });
    expect(db.rowsOf('documents')[0]).toMatchObject({
      is_current: false, authority_class: 'SUPERSEDED',
    });
    // second attempt: row is no longer current -> refused
    expect(await markSuperseded(db.client, uuid(1))).toEqual({
      ok: false, error: 'not_current',
    });
  });

  it('refuses an unknown id or a non-current row', async () => {
    const db = makeFakeDb();
    await insertDocument(db.client, doc(1, { is_current: false }));
    expect(await markSuperseded(db.client, uuid(1))).toEqual({
      ok: false, error: 'not_current',
    });
    expect(await markSuperseded(db.client, uuid(99))).toEqual({
      ok: false, error: 'not_current',
    });
    expect((await markSuperseded(db.client, 'bad')).ok).toBe(false);
  });
});

describe('listCurrentDocuments', () => {
  it('returns current rows for the project with the privacy gate', async () => {
    const db = makeFakeDb();
    await insertDocument(db.client, doc(1, { is_current: false,
      authority_class: 'SUPERSEDED' }));
    await insertDocument(db.client, doc(2));
    await insertDocument(db.client, doc(3, {
      document_type: 'payment_receipt', privacy_class: 'RESTRICTED_FINANCE',
    }));
    await insertDocument(db.client, doc(4, {
      document_type: 'other', privacy_class: 'EXCLUDE',
    }));
    await insertDocument(db.client, doc(5, {
      project_id: '00000000-0000-4000-8000-000000000999',
    }));
    const general = await listCurrentDocuments(db.client, PROJECT, {
      allowRestricted: false,
    });
    expect(general.ok).toBe(true);
    expect(general.rows.map((r) => r.id)).toEqual([uuid(2)]);
    const restricted = await listCurrentDocuments(db.client, PROJECT, {
      allowRestricted: true,
    });
    expect(restricted.rows.map((r) => r.id).sort())
      .toEqual([uuid(2), uuid(3)]);
  });

  it('fails closed to an empty list', async () => {
    const db = makeFakeDb();
    const res = await listCurrentDocuments(db.client, 'not-a-uuid', {
      allowRestricted: false,
    });
    expect(res).toEqual({ ok: false, rows: [], error: 'invalid project id' });
  });
});

describe('insertDriveFolder', () => {
  const binding = {
    project_id: PROJECT,
    drive_folder_id: 'folder-abc',
    folder_name: 'P26-0041 - 123 W 78th St Apt 4A',
    template_version: 1,
    subfolders: { '00 Intake': 'f0', '13 Warranty': 'f13' },
    created_by: 'test',
  };
  it('inserts one binding per project and reports duplicates', async () => {
    const db = makeFakeDb();
    expect(await insertDriveFolder(db.client, binding)).toEqual({
      ok: true, id: PROJECT,
    });
    const again = await insertDriveFolder(db.client, {
      ...binding, drive_folder_id: 'folder-other',
    });
    expect(again.duplicate).toBe(true);
    expect(db.rowsOf('project_drive_folders')).toHaveLength(1);
  });
  it('validates every field', async () => {
    const db = makeFakeDb();
    for (const bad of [
      { ...binding, project_id: 'x' },
      { ...binding, drive_folder_id: '' },
      { ...binding, folder_name: '' },
      { ...binding, template_version: 0 },
      { ...binding, created_by: '' },
      { ...binding, subfolders: { '00 Intake': '' } },
    ]) {
      expect((await insertDriveFolder(db.client, bad)).ok).toBe(false);
    }
    expect(db.rowsOf('project_drive_folders')).toHaveLength(0);
  });
});

describe('upsertInventoryRows (insert-only)', () => {
  const plan = buildInventoryPlan([
    { id: 'd1', name: 'PO_1.pdf', mimeType: 'application/pdf', size: 1 },
    { id: 'd2', name: 'PO_2.pdf', mimeType: 'application/pdf', size: 1 },
  ], 'run-1');

  it('inserts new rows and reports existing ids as conflicts', async () => {
    const db = makeFakeDb();
    expect(await upsertInventoryRows(db.client, plan.rows)).toEqual({
      ok: true, inserted: 2, conflicts: [],
    });
    expect(await upsertInventoryRows(db.client, plan.rows)).toEqual({
      ok: true, inserted: 0, conflicts: ['d1', 'd2'],
    });
    expect(db.rowsOf('drive_inventory')).toHaveLength(2);
    expect(db.rowsOf('drive_inventory')[0]).toMatchObject({
      drive_file_id: 'd1', status: 'classified', inventory_run_id: 'run-1',
    });
  });

  it('stops at the first hard error and reports progress', async () => {
    const db = makeFakeDb(new Set(['drive_inventory']));
    const res = await upsertInventoryRows(db.client, plan.rows);
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(0);
    expect(res.error).toContain('injected failure');
  });

  it('rejects malformed rows before writing', async () => {
    const db = makeFakeDb();
    const res = await upsertInventoryRows(db.client, [
      { ...plan.rows[0], sha256: 'bad' },
    ]);
    expect(res.ok).toBe(false);
    expect(db.rowsOf('drive_inventory')).toHaveLength(0);
  });
});

describe('store surface', () => {
  it('names only the three 0029 tables and exposes no delete', () => {
    expect(Object.values(DOCUMENT_TABLES).sort()).toEqual([
      'documents', 'drive_inventory', 'project_drive_folders',
    ]);
  });
});
