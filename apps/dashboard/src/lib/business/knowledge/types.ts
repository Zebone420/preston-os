// Knowledge Fabric (Phase 1 Lane C) - shared row shapes.
//
// These mirror supabase/migrations/0030_p1c_knowledge_fabric.sql. The
// fabric is a REGISTRY over registered, cited sources: it stores where a
// statement came from and who verified it. It never invents a product,
// price, or compliance fact - every fact row cites registered chunks and
// only a human actor can verify or authorize it.

export const AUTHORITY_CLASSES = [
  'OFFICIAL_CURRENT',
  'OWNER_RULED_CURRENT',
  'INTERNAL_APPROVED',
  'PROJECT_RECORD',
  'CLIENT_EXECUTED',
  'THIRD_PARTY_REFERENCE',
  'HISTORICAL',
  'SUPERSEDED',
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export function isAuthorityClass(v: unknown): v is AuthorityClass {
  return (
    typeof v === 'string' &&
    (AUTHORITY_CLASSES as readonly string[]).includes(v)
  );
}

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Registered source (knowledge_sources row). document_id points at the
// Lane B document registry by uuid without a hard FK.
export interface KnowledgeSource {
  id: string;
  document_id: string;
  project_id: string | null;
  domain: string;
  title: string;
  authority_class: AuthorityClass;
  source_version: string;
  sha256: string;
  effective_from: string | null;
  superseded_by: string | null;
  is_current: boolean;
  registered_at?: string;
  registered_by: string;
  metadata: Record<string, unknown>;
}

// Deterministic chunk (knowledge_chunks row). text is exactly
// source_text.slice(char_start, char_end).
export interface KnowledgeChunk {
  id?: string;
  source_id?: string;
  chunk_index: number;
  text: string;
  char_start: number;
  char_end: number;
  token_estimate: number;
  sha256: string;
  heading_path: string[];
}

export interface Citation {
  source_id: string;
  chunk_id: string;
  quote: string;
}
