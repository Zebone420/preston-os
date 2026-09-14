// Preston AI OS - Phase 3 drive.file.write validation + canonical
// rendering. PURE. EXTERNAL side effect (writes into the company Drive);
// only the sandbox adapter exists in this phase. Requires the project id,
// a Drive folder BINDING for that same project, a canonical deterministic
// filename (master build plan section 5.8) and the content sha256. The
// schema can only express operation 'create': move/delete do not exist.

import type { ParamsValidation } from '../registry';
import {
  CANONICAL_FILENAME_RE,
  DriveFileWriteParamsSchema,
  parseWith,
  type DriveFileWriteParams,
} from './schemas';
import { ALLOWED_ATTACHMENT_MIMES } from './attachment-manifest';

export interface DriveFileCanonical extends Record<string, unknown> {
  kind: 'drive.file.write';
  operation: 'create';
  project_id: string;
  folder_id: string;
  path: string;
  document_id: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  mime: string;
  version: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function validateDriveFileWrite(params: Record<string, unknown>): ParamsValidation {
  const parsed = parseWith(DriveFileWriteParamsSchema, params);
  if (!parsed.ok) return parsed;
  const p: DriveFileWriteParams = parsed.data;

  if (p.folder_binding.project_id !== p.project_id) {
    return { ok: false, reason: 'folder_binding_project_mismatch' };
  }
  const name = p.document.filename;
  if (!CANONICAL_FILENAME_RE.test(name)) return { ok: false, reason: 'filename_not_canonical' };
  if (!name.startsWith(p.project_id + '_')) {
    return { ok: false, reason: 'filename_project_mismatch' };
  }
  if (!name.includes(`_V${pad2(p.document.version)}.`)) {
    return { ok: false, reason: 'filename_version_mismatch' };
  }
  if (!ALLOWED_ATTACHMENT_MIMES.includes(p.document.mime)) {
    return { ok: false, reason: 'attachment_mime_not_allowed' };
  }

  const canonical: DriveFileCanonical = {
    kind: 'drive.file.write',
    operation: 'create',
    project_id: p.project_id,
    folder_id: p.folder_binding.folder_id,
    path: p.folder_binding.path,
    document_id: p.document.document_id,
    filename: name,
    sha256: p.document.sha256,
    size_bytes: p.document.size_bytes,
    mime: p.document.mime,
    version: p.document.version,
  };
  return {
    ok: true,
    canonical,
    binding: {
      project_id: p.project_id,
      document_hash: p.document.sha256,
      amount: null,
      recipient: null,
    },
  };
}
