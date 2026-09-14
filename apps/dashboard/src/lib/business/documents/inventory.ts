// Phase 1 Lane B - Stage A Drive inventory plan (plan 5.3).
//
// Pure pass over listed Drive file METADATA producing drive_inventory rows
// with a proposed classification and a status. This module NEVER produces
// a move, copy, rename, trash or delete operation; the plan type has no
// slot for one. Listing the Drive is a read capability owned elsewhere
// (google.ts stays read-only; Drive writes stay blocked).

import { classifyDocument } from './classifier';
import { isSha256 } from './dedupe';
import type { Classification, InventoryStatus } from './types';

export interface ListedDriveFile {
  id: string;
  name: string;
  mimeType?: string | null;
  parents?: readonly string[] | null;
  path?: string | null;
  size?: number | string | null;
  modifiedTime?: string | null;
  sha256?: string | null;
}

export interface DriveInventoryRow {
  drive_file_id: string;
  name: string;
  mime_type: string | null;
  parent_id: string | null;
  path: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  sha256: string | null;
  classification: Classification;
  inventory_run_id: string;
  status: InventoryStatus;
}

export interface InventoryPlan {
  readonly kind: 'drive_inventory_plan';
  readonly inventory_run_id: string;
  readonly rows: DriveInventoryRow[];
  readonly counts: Record<InventoryStatus, number>;
  readonly skipped: Array<{ id: string; reason: string }>;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const EXCLUDED_PATH_RE =
  /(^|\/)(\.trash|trash|tmp|temp|cache|\.git|node_modules|system)(\/|$)/i;
const FINANCE_PATH_RE = new RegExp(
  '(^|/)[^/]*(finance|financials|accounting|bookkeeping|bank|taxes|' +
    'tax returns|quickbooks)[^/]*(/|$)',
  'i',
);
const HR_PATH_RE = new RegExp(
  '(^|/)[^/]*(payroll|\\bhr\\b|human resources|employees|personnel)' +
    '[^/]*(/|$)',
  'i',
);

function toSize(v: ListedDriveFile['size']): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function buildInventoryPlan(
  files: readonly ListedDriveFile[],
  inventoryRunId: string,
): InventoryPlan {
  if (typeof inventoryRunId !== 'string' || inventoryRunId.length === 0) {
    throw new Error('inventory run id required');
  }
  const rows: DriveInventoryRow[] = [];
  const skipped: InventoryPlan['skipped'] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  // Stable order (id, then name) so the plan is identical for any listing
  // order, including a listing that repeats an id.
  const sorted = [...files].sort((a, b) => {
    const ai = String(a.id ?? '');
    const bi = String(b.id ?? '');
    if (ai !== bi) return ai < bi ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  for (const f of sorted) {
    if (typeof f.id !== 'string' || f.id.length === 0) {
      skipped.push({ id: '', reason: 'missing id' });
      continue;
    }
    if (seenIds.has(f.id)) {
      skipped.push({ id: f.id, reason: 'listed twice' });
      continue;
    }
    seenIds.add(f.id);
    if (f.mimeType === FOLDER_MIME) {
      skipped.push({ id: f.id, reason: 'folder' });
      continue;
    }
    const path = f.path ?? null;
    const classification = classifyDocument({
      filename: f.name,
      mimeType: f.mimeType ?? undefined,
      sourceSystem: 'drive',
      folderPath: path ?? undefined,
    });
    // Path-based restriction overrides: a file under a finance/HR folder is
    // restricted no matter what its name suggests.
    if (path && HR_PATH_RE.test(path)) {
      classification.privacy_class = 'RESTRICTED_HR';
      classification.reasons.push('hr folder path');
    } else if (path && FINANCE_PATH_RE.test(path)) {
      classification.privacy_class = 'RESTRICTED_FINANCE';
      classification.reasons.push('finance folder path');
    }
    if (path && EXCLUDED_PATH_RE.test(path)) {
      classification.privacy_class = 'EXCLUDE';
      classification.reasons.push('excluded folder path');
    }

    const sha = isSha256(f.sha256) ? f.sha256 : null;
    let status: InventoryStatus = 'classified';
    if (classification.privacy_class === 'EXCLUDE') {
      status = 'excluded';
    } else if (sha && seenHashes.has(sha)) {
      status = 'duplicate';
    } else if (classification.confidence === 'low') {
      status = 'inventoried';
    }
    if (sha) seenHashes.add(sha);

    rows.push({
      drive_file_id: f.id,
      name: f.name,
      mime_type: f.mimeType ?? null,
      parent_id: f.parents && f.parents.length > 0 ? f.parents[0] : null,
      path,
      size_bytes: toSize(f.size),
      modified_at: f.modifiedTime ?? null,
      sha256: sha,
      classification,
      inventory_run_id: inventoryRunId,
      status,
    });
  }

  const counts: Record<InventoryStatus, number> = {
    inventoried: 0,
    classified: 0,
    registered: 0,
    duplicate: 0,
    excluded: 0,
  };
  for (const r of rows) counts[r.status] += 1;
  return {
    kind: 'drive_inventory_plan',
    inventory_run_id: inventoryRunId,
    rows,
    counts,
    skipped,
  };
}
