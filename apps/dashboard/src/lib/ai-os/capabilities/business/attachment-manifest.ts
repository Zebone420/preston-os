// Preston AI OS - Phase 3 attachment manifest (master build plan sections
// 5/16/17). PURE, descriptor-level (no binary parsing). An outbound draft
// may only attach documents that are LISTED in the manifest it carries, and
// every attachment descriptor must match its manifest entry exactly
// (document id, sha256, size, mime). Unknown/unlisted attachments refuse.
// A tight mime allowlist refuses executable/archive/markup attachments
// (malicious attachment class).

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const DOCUMENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIMES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
];

export interface ManifestEntry {
  document_id: string;
  sha256: string;
  size_bytes: number;
  mime: string;
  filename: string;
}

export interface AttachmentRef {
  document_id: string;
  sha256: string;
  size_bytes: number;
  mime: string;
  filename: string;
}

export type ManifestVerification =
  | { ok: true; entries: ManifestEntry[]; manifest_sha256: string }
  | { ok: false; reason:
      | 'manifest_entry_invalid'
      | 'manifest_duplicate_document'
      | 'attachment_unlisted'
      | 'attachment_hash_mismatch'
      | 'attachment_size_mismatch'
      | 'attachment_mime_mismatch'
      | 'attachment_mime_not_allowed'
      | 'attachment_too_large'
      | 'attachment_duplicate' };

import { sha256Canonical } from '../contract';

function entryValid(e: ManifestEntry): boolean {
  return DOCUMENT_ID_RE.test(String(e.document_id ?? ''))
    && SHA256_RE.test(String(e.sha256 ?? ''))
    && Number.isInteger(e.size_bytes) && e.size_bytes >= 0
    && typeof e.mime === 'string' && e.mime.length > 0
    && typeof e.filename === 'string' && e.filename.length > 0;
}

export function manifestHash(entries: ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.document_id < b.document_id ? -1 : 1);
  return sha256Canonical(sorted.map((e) => ({
    document_id: e.document_id, sha256: e.sha256, size_bytes: e.size_bytes,
    mime: e.mime, filename: e.filename,
  })));
}

export function verifyAttachmentManifest(
  attachments: AttachmentRef[],
  manifest: ManifestEntry[],
): ManifestVerification {
  const byId = new Map<string, ManifestEntry>();
  for (const e of manifest) {
    if (!entryValid(e)) return { ok: false, reason: 'manifest_entry_invalid' };
    if (byId.has(e.document_id)) return { ok: false, reason: 'manifest_duplicate_document' };
    byId.set(e.document_id, e);
  }
  const seen = new Set<string>();
  const entries: ManifestEntry[] = [];
  for (const a of attachments) {
    const id = String(a.document_id ?? '');
    if (seen.has(id)) return { ok: false, reason: 'attachment_duplicate' };
    seen.add(id);
    const m = byId.get(id);
    if (!m) return { ok: false, reason: 'attachment_unlisted' };
    if (String(a.sha256) !== m.sha256) return { ok: false, reason: 'attachment_hash_mismatch' };
    if (a.size_bytes !== m.size_bytes) return { ok: false, reason: 'attachment_size_mismatch' };
    if (String(a.mime) !== m.mime) return { ok: false, reason: 'attachment_mime_mismatch' };
    if (!ALLOWED_ATTACHMENT_MIMES.includes(m.mime)) {
      return { ok: false, reason: 'attachment_mime_not_allowed' };
    }
    if (m.size_bytes > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'attachment_too_large' };
    entries.push(m);
  }
  return { ok: true, entries, manifest_sha256: manifestHash(entries) };
}
