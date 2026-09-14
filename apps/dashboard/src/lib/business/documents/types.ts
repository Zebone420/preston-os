// Phase 1 Lane B - Project Document Registry: shared vocabulary.
//
// Every list here is the contract pinned by migration 0029 CHECK
// constraints. Keep the two in sync; the migration lint test reads
// the SQL text, the module tests read these arrays.

export const DOCUMENT_TYPES = [
  'intake',
  'site_photo',
  'measurement',
  'plan',
  'design',
  'product_spec',
  'vendor_quote',
  'quote_request',
  'proposal',
  'contract',
  'payment_receipt',
  'lpc_dob_building',
  'purchase_order',
  'order_confirmation',
  'delivery',
  'installation_photo',
  'punch',
  'closeout',
  'warranty',
  'knowledge',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SOURCE_SYSTEMS = [
  'drive',
  'gmail',
  'upload',
  'render',
  'docusign',
  'vendor',
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

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

export const PRIVACY_CLASSES = [
  'PUBLIC_OFFICIAL',
  'INTERNAL_APPROVED',
  'CLIENT_CONFIDENTIAL',
  'RESTRICTED_FINANCE',
  'RESTRICTED_HR',
  'ARCHIVE',
  'EXCLUDE',
] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

// Never surfaced by a general listing (plan 6.6: no unrestricted
// global index). EXCLUDE is never surfaced at all.
export const RESTRICTED_PRIVACY_CLASSES: readonly PrivacyClass[] = [
  'RESTRICTED_FINANCE',
  'RESTRICTED_HR',
  'EXCLUDE',
];

export const VERIFICATION_STATUSES = [
  'unverified',
  'verified',
  'rejected',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const INVENTORY_STATUSES = [
  'inventoried',
  'classified',
  'registered',
  'duplicate',
  'excluded',
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export type Confidence = 'high' | 'medium' | 'low';

export const SHA256_RE = /^[0-9a-f]{64}$/;
// Human project id minted by Lane A (plan 4.2), e.g. P26-0041.
export const PROJECT_CODE_RE = /^P\d{2}-\d{4}$/;

// Mirror of the public.documents row (migration 0029).
export interface DocumentRow {
  id: string;
  project_id: string | null;
  client_id: string | null;
  property_id: string | null;
  drive_file_id: string | null;
  drive_parent_id: string | null;
  source_system: SourceSystem;
  source_message_id: string | null;
  document_type: DocumentType;
  document_subtype: string | null;
  original_filename: string;
  canonical_filename: string;
  mime_type: string;
  sha256: string;
  file_size_bytes: number;
  version: number;
  is_current: boolean;
  supersedes_document_id: string | null;
  authority_class: AuthorityClass;
  privacy_class: PrivacyClass;
  verification_status: VerificationStatus;
  approved_use: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  registered_at: string;
  registered_by: string;
  metadata: Record<string, unknown>;
}

export interface Classification {
  document_type: DocumentType;
  privacy_class: PrivacyClass;
  authority_class: AuthorityClass;
  confidence: Confidence;
  reasons: string[];
  document_subtype?: string;
}

export function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === 'string' &&
    (DOCUMENT_TYPES as readonly string[]).includes(v);
}
export function isAuthorityClass(v: unknown): v is AuthorityClass {
  return typeof v === 'string' &&
    (AUTHORITY_CLASSES as readonly string[]).includes(v);
}
export function isPrivacyClass(v: unknown): v is PrivacyClass {
  return typeof v === 'string' &&
    (PRIVACY_CLASSES as readonly string[]).includes(v);
}
export function isSourceSystem(v: unknown): v is SourceSystem {
  return typeof v === 'string' &&
    (SOURCE_SYSTEMS as readonly string[]).includes(v);
}
