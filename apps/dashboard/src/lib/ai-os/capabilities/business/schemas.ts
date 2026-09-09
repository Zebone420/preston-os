// Preston AI OS - Phase 3 business capability parameter schemas (zod).
// PURE. One schema per capability; the validators in the sibling modules
// parse with these FIRST, then apply business policy. A schema failure is
// reported as 'schema_invalid:<path>' (static, never provider free text).

import { z } from 'zod';

export const PROJECT_ID_RE = /^P\d{2}-\d{4}$/;
export const PROJECT_ID = z.string().regex(PROJECT_ID_RE);
export const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
export const DOC_ID = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const EMAIL = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).max(254);
export const ISO_DATETIME = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
);
export const CONTACT_CLASS = z.enum(['client', 'vendor', 'internal', 'owner']);
export const SHORT_TEXT = z.string().min(1).max(300);
export const BODY_TEXT = z.string().min(1).max(4000);

export const AllowlistEntrySchema = z.object({
  email: EMAIL,
  class: CONTACT_CLASS,
  name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  project_id: PROJECT_ID.optional(),
});

// Alias registry entry (master build plan section 7.10). The sender of an
// outbound message is SELECTED by mailbox_identity - never free text.
export const SenderAliasSchema = z.object({
  mailbox_identity: z.string().regex(/^[a-z0-9_-]{2,64}$/),
  email: EMAIL,
  role: z.string().min(1).max(60),
  active: z.boolean(),
  canonical_sender: z.boolean(),
  allowed_send_classes: z.array(CONTACT_CLASS).max(4),
});

export const ManifestEntrySchema = z.object({
  document_id: DOC_ID,
  sha256: SHA256,
  size_bytes: z.number().int().min(0),
  mime: z.string().min(1).max(100),
  filename: z.string().min(1).max(200),
});

// Raw attachment descriptor: canonical fields REQUIRED, any other field
// tolerated here so metadata-strip.ts can drop it deterministically.
export const AttachmentDescriptorSchema = z.looseObject({
  document_id: DOC_ID,
  sha256: SHA256,
  size_bytes: z.number().int().min(0),
  mime: z.string().min(1).max(100),
  filename: z.string().min(1).max(200),
});

export const GmailDraftParamsSchema = z.object({
  project_id: PROJECT_ID,
  sender: z.object({ mailbox_identity: z.string().regex(/^[a-z0-9_-]{2,64}$/) }),
  sender_aliases: z.array(SenderAliasSchema).min(1).max(20),
  recipient_allowlist: z.array(AllowlistEntrySchema).min(1).max(100),
  to: z.array(EMAIL).min(1).max(20),
  cc: z.array(EMAIL).max(20).optional(),
  subject: SHORT_TEXT,
  body_text: BODY_TEXT,
  attachments: z.array(AttachmentDescriptorSchema).max(10),
  attachment_manifest: z.array(ManifestEntrySchema).max(50),
});
export type GmailDraftParams = z.infer<typeof GmailDraftParamsSchema>;

export const CalendarEventParamsSchema = z.object({
  project_id: PROJECT_ID,
  project_identity: z.object({
    project_id: PROJECT_ID,
    human_project_id: PROJECT_ID,
    confirmed: z.boolean(),
  }),
  title: SHORT_TEXT,
  start: ISO_DATETIME,
  end: ISO_DATETIME,
  attendees: z.array(EMAIL).min(1).max(20),
  recipient_allowlist: z.array(AllowlistEntrySchema).min(1).max(100),
  location: z.string().max(300).optional(),
  description: z.string().max(4000).optional(),
});
export type CalendarEventParams = z.infer<typeof CalendarEventParamsSchema>;

export const CANONICAL_FILENAME_RE = /^P\d{2}-\d{4}_[A-Z0-9][A-Z0-9_-]*_V\d{2}\.[a-z0-9]{2,5}$/;

export const DriveFileWriteParamsSchema = z.object({
  project_id: PROJECT_ID,
  folder_binding: z.object({
    project_id: PROJECT_ID,
    folder_id: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
    path: z.string().min(1).max(300),
  }),
  document: z.object({
    document_id: DOC_ID,
    filename: z.string().min(1).max(200),
    sha256: SHA256,
    size_bytes: z.number().int().min(0),
    mime: z.string().min(1).max(100),
    version: z.number().int().min(1).max(99),
  }),
  // The ONLY operation this capability can express. move/delete do not
  // exist in the schema, so they cannot be requested.
  operation: z.literal('create'),
});
export type DriveFileWriteParams = z.infer<typeof DriveFileWriteParamsSchema>;

export const QuoteLineItemSchema = z.object({
  line_no: z.number().int().min(1),
  description: z.string().min(1).max(300),
  qty: z.number().int().min(1),
  unit_price_cents: z.number().int().min(0),
  line_total_cents: z.number().int().min(0),
});

export const ProposalRenderParamsSchema = z.object({
  project_id: PROJECT_ID,
  template_id: z.enum(['proposal_v1']),
  quote: z.object({
    quote_id: DOC_ID,
    version: z.number().int().min(1).max(99),
    currency: z.literal('USD'),
    line_items: z.array(QuoteLineItemSchema).min(1).max(100),
    subtotal_cents: z.number().int().min(0),
    tax_cents: z.number().int().min(0),
    total_cents: z.number().int().min(0),
  }),
});
export type ProposalRenderParams = z.infer<typeof ProposalRenderParamsSchema>;

export const ClientContactSchema = z.object({
  email: EMAIL.optional(),
  phone: z.string().max(40).optional(),
  name: z.string().max(120).optional(),
});

export const VendorQuoteParseParamsSchema = z.object({
  project_id: PROJECT_ID,
  source: z.object({ document_id: DOC_ID, sha256: SHA256 }),
  quote_text: z.string().min(1).max(6000),
  client_contacts: z.array(ClientContactSchema).max(20).optional(),
});
export type VendorQuoteParseParams = z.infer<typeof VendorQuoteParseParamsSchema>;

export const VendorLineSchema = z.object({
  line_no: z.number().int().min(1),
  qty: z.number().int().min(0),
  spec: z.record(z.string(), z.string()),
});

export const RequestedSpecLineSchema = z.object({
  line_no: z.number().int().min(1),
  sku: z.string().min(1).max(60),
  qty: z.number().int().min(1),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  options: z.record(z.string(), z.string()),
});

export const VendorQuoteReconcileParamsSchema = z.object({
  project_id: PROJECT_ID,
  vendor_quote: z.object({
    quote_number: z.string().max(60).nullable(),
    line_items: z.array(VendorLineSchema).max(100),
  }),
  requested_spec: z.object({
    spec_id: DOC_ID,
    version: z.number().int().min(1),
    source: z.enum(['iqplus', 'nqr', 'manual']),
    lines: z.array(RequestedSpecLineSchema).min(1).max(100),
  }),
});
export type VendorQuoteReconcileParams = z.infer<typeof VendorQuoteReconcileParamsSchema>;

export const IqplusIngestParamsSchema = z.object({
  project_id: PROJECT_ID,
  source: z.object({ document_id: DOC_ID, sha256: SHA256 }),
  report_text: z.string().min(1).max(6000),
  client_contacts: z.array(ClientContactSchema).max(20).optional(),
});
export type IqplusIngestParams = z.infer<typeof IqplusIngestParamsSchema>;

export type SchemaParse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

// Static reason: 'schema_invalid:<dotted.path>' (or 'schema_invalid:root').
export function parseWith<T>(schema: z.ZodType<T>, params: unknown): SchemaParse<T> {
  const r = schema.safeParse(params);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  const path = first && first.path.length > 0
    ? first.path.map((p) => String(p)).join('.') : 'root';
  return { ok: false, reason: `schema_invalid:${path}` };
}
