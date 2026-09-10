// Phase 1 Lane B - Supabase adapters for the document registry.
//
// Same idiom as lib/business/business-store.ts: RuntimeClient injected,
// RLS-bound, service-role key never used, every write validates first,
// reads fail closed to empty results with an error string. No deletes
// exist (migration 0029 grants none). Nothing here touches Google Drive.

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import { UUID_RE } from '../types';
import { listForRetrieval } from './registry';
import type { RegistryRow } from './registry';
import type { DriveInventoryRow } from './inventory';
import {
  isAuthorityClass,
  isDocumentType,
  isPrivacyClass,
  isSourceSystem,
  SHA256_RE,
} from './types';
import type { DocumentRow } from './types';

export const DOCUMENT_TABLES = {
  documents: 'documents',
  projectDriveFolders: 'project_drive_folders',
  driveInventory: 'drive_inventory',
} as const;

export interface DocumentListOutcome {
  ok: boolean;
  rows: DocumentRow[];
  error?: string;
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

// idCol names the key column returned by the insert (project_drive_folders
// is keyed by project_id and has no id column).
async function insertRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
  idCol: string = 'id',
): Promise<WriteOutcome> {
  const fallback = String(row[idCol] ?? '');
  try {
    const res = await client.from(table).insert(row).select(idCol);
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: fallback };
      }
      return { ok: false, error: `${table} insert failed: ` +
        res.error.message };
    }
    const id = res.data?.[0]?.[idCol];
    return { ok: true, id: id ? String(id) : fallback };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `${table} insert failed`,
    };
  }
}

function optionalUuid(v: unknown): boolean {
  return v === null || v === undefined ||
    (typeof v === 'string' && UUID_RE.test(v));
}

export function validateDocumentRow(row: DocumentRow): string | null {
  if (!UUID_RE.test(row.id)) return 'invalid id';
  if (!optionalUuid(row.project_id)) return 'invalid project_id';
  if (!optionalUuid(row.client_id)) return 'invalid client_id';
  if (!optionalUuid(row.property_id)) return 'invalid property_id';
  if (!optionalUuid(row.supersedes_document_id)) {
    return 'invalid supersedes_document_id';
  }
  if (!isSourceSystem(row.source_system)) return 'invalid source_system';
  if (!isDocumentType(row.document_type)) return 'invalid document_type';
  if (!SHA256_RE.test(row.sha256)) return 'invalid sha256';
  if (!Number.isInteger(row.version) || row.version < 1) {
    return 'invalid version';
  }
  if (!Number.isInteger(row.file_size_bytes) || row.file_size_bytes < 0) {
    return 'invalid file_size_bytes';
  }
  if (!isAuthorityClass(row.authority_class)) {
    return 'invalid authority_class';
  }
  if (!isPrivacyClass(row.privacy_class)) return 'invalid privacy_class';
  if (row.is_current && row.authority_class === 'SUPERSEDED') {
    return 'superseded row cannot be current';
  }
  for (const k of ['original_filename', 'canonical_filename',
    'registered_by'] as const) {
    if (typeof row[k] !== 'string' || row[k].length === 0) {
      return `missing ${k}`;
    }
  }
  return null;
}

export async function insertDocument(
  client: RuntimeClient,
  row: DocumentRow,
): Promise<WriteOutcome> {
  const err = validateDocumentRow(row);
  if (err) return { ok: false, error: err };
  return insertRow(client, DOCUMENT_TABLES.documents, { ...row });
}

// Compare-and-set supersession: only a row that is STILL current can be
// superseded. Zero matched rows = already superseded or unknown id.
export async function markSuperseded(
  client: RuntimeClient,
  documentId: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(documentId)) {
    return { ok: false, error: 'invalid document id' };
  }
  try {
    const res = await client
      .from(DOCUMENT_TABLES.documents)
      .update({ is_current: false, authority_class: 'SUPERSEDED' })
      .eq('id', documentId)
      .eq('is_current', 'true')
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'not_current' };
    }
    return { ok: true, id: documentId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'supersede failed',
    };
  }
}

export interface CurrentListOptions {
  allowRestricted: boolean;
  limit?: number;
}

export async function listCurrentDocuments(
  client: RuntimeClient,
  projectId: string,
  opts: CurrentListOptions,
): Promise<DocumentListOutcome> {
  if (!UUID_RE.test(projectId)) {
    return { ok: false, rows: [], error: 'invalid project id' };
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  let res: QueryResult;
  try {
    res = await client
      .from(DOCUMENT_TABLES.documents)
      .select('*')
      .eq('project_id', projectId)
      .eq('is_current', 'true')
      .order('registered_at', { ascending: false })
      .limit(limit);
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
  if (res.error) return { ok: false, rows: [], error: res.error.message };
  const rows = (res.data ?? []) as unknown as DocumentRow[];
  // Privacy gate is applied in-process as well as by the caller's
  // allowRestricted flag; the database never returns EXCLUDE to a list.
  const filtered = listForRetrieval<DocumentRow & RegistryRow>(rows, {
    allowRestricted: opts.allowRestricted,
  });
  return { ok: true, rows: filtered };
}

export interface DriveFolderBinding {
  project_id: string;
  drive_folder_id: string;
  folder_name: string;
  template_version: number;
  subfolders: Record<string, string>;
  created_by: string;
}

export async function insertDriveFolder(
  client: RuntimeClient,
  binding: DriveFolderBinding,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(binding.project_id)) {
    return { ok: false, error: 'invalid project id' };
  }
  if (typeof binding.drive_folder_id !== 'string' ||
    binding.drive_folder_id.length === 0) {
    return { ok: false, error: 'drive_folder_id required' };
  }
  if (typeof binding.folder_name !== 'string' ||
    binding.folder_name.length === 0) {
    return { ok: false, error: 'folder_name required' };
  }
  if (!Number.isInteger(binding.template_version) ||
    binding.template_version < 1) {
    return { ok: false, error: 'invalid template_version' };
  }
  if (typeof binding.created_by !== 'string' ||
    binding.created_by.length === 0) {
    return { ok: false, error: 'created_by required' };
  }
  for (const [k, v] of Object.entries(binding.subfolders)) {
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, error: `subfolder ${k} missing drive id` };
    }
  }
  return insertRow(client, DOCUMENT_TABLES.projectDriveFolders, {
    project_id: binding.project_id,
    drive_folder_id: binding.drive_folder_id,
    folder_name: binding.folder_name,
    template_version: binding.template_version,
    subfolders: binding.subfolders,
    created_by: binding.created_by,
  }, 'project_id');
}

export interface InventoryUpsertOutcome {
  ok: boolean;
  inserted: number;
  // drive_file_ids already present (insert-only: existing rows untouched)
  conflicts: string[];
  error?: string;
}

// Insert-only: an existing drive_file_id is reported as a conflict and
// left untouched. Stops at the first hard error (fail closed) and reports
// how far it got.
export async function upsertInventoryRows(
  client: RuntimeClient,
  rows: readonly DriveInventoryRow[],
): Promise<InventoryUpsertOutcome> {
  let inserted = 0;
  const conflicts: string[] = [];
  for (const r of rows) {
    if (typeof r.drive_file_id !== 'string' || r.drive_file_id.length === 0) {
      return { ok: false, inserted, conflicts, error: 'missing drive_file_id' };
    }
    if (r.sha256 !== null && !SHA256_RE.test(r.sha256)) {
      return {
        ok: false, inserted, conflicts,
        error: `invalid sha256 for ${r.drive_file_id}`,
      };
    }
    const res = await insertRow(client, DOCUMENT_TABLES.driveInventory, {
      drive_file_id: r.drive_file_id,
      name: r.name,
      mime_type: r.mime_type,
      parent_id: r.parent_id,
      path: r.path,
      size_bytes: r.size_bytes,
      modified_at: r.modified_at,
      sha256: r.sha256,
      classification: r.classification,
      inventory_run_id: r.inventory_run_id,
      status: r.status,
    });
    if (!res.ok) {
      return { ok: false, inserted, conflicts, error: res.error };
    }
    if (res.duplicate) conflicts.push(r.drive_file_id);
    else inserted += 1;
  }
  return { ok: true, inserted, conflicts };
}
