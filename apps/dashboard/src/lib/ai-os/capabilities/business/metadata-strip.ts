// Preston AI OS - Phase 3 metadata stripping (master build plan section
// 17: "metadata"). PURE, DESCRIPTOR-LEVEL ONLY: no binary is parsed here.
// An attachment descriptor handed to an outbound capability is reduced to
// the canonical field set by WHITELIST; every other field (EXIF, author,
// title, creator, producer, GPS, device, comments, ...) is dropped
// deterministically and the dropped field names are reported (sorted) so
// the evidence shows what was removed. The filename is reduced to its
// basename with control characters removed.

export const CANONICAL_DESCRIPTOR_FIELDS = [
  'document_id', 'filename', 'mime', 'size_bytes', 'sha256',
] as const;

export type CanonicalDescriptorField = (typeof CANONICAL_DESCRIPTOR_FIELDS)[number];

export interface StrippedDescriptor {
  document_id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
}

export interface StripResult {
  descriptor: StrippedDescriptor;
  stripped: string[]; // sorted names of the dropped fields
}

export function sanitizeFilename(name: unknown): string {
  const base = String(name ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  return base.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200);
}

export function stripDescriptorMetadata(raw: Record<string, unknown>): StripResult {
  const keep = new Set<string>(CANONICAL_DESCRIPTOR_FIELDS);
  const stripped = Object.keys(raw).filter((k) => !keep.has(k)).sort();
  const size = Number(raw.size_bytes);
  return {
    descriptor: {
      document_id: String(raw.document_id ?? ''),
      filename: sanitizeFilename(raw.filename),
      mime: String(raw.mime ?? '').trim().toLowerCase(),
      size_bytes: Number.isInteger(size) ? size : -1,
      sha256: String(raw.sha256 ?? '').trim().toLowerCase(),
    },
    stripped,
  };
}
