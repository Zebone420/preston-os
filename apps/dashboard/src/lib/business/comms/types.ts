// Phase 1 LANE D - READ-ONLY Gmail import + Deal Intelligence types.
// Mirrors supabase/migrations/0031_p1d_communications_intelligence.sql.
//
// Everything in this directory is deterministic and pure. No LLM call,
// no network, no send/reply/draft path exists here (CLAUDE.md rule 4).
// External message content is DATA only, never instruction authority
// (CLAUDE.md rule 12).

export type IngestionClass =
  | 'INCLUDE_PROJECT'
  | 'EVENT_ONLY'
  | 'FINANCE_RESTRICTED'
  | 'DROP';

export type Direction = 'inbound' | 'outbound';

export type LinkConfidence =
  | 'orphan'
  | 'candidate'
  | 'linked_auto'
  | 'confirmed';

export const EVENT_TYPES = [
  'andersen_lead_new',
  'andersen_lead_reminder',
  'andersen_status_nudge',
  'hd_case_submitted',
  'hd_quote_received',
  'hd_quote_revised',
  'hd_receipt',
  'hd_order_status',
  'vendor_quote_received',
  'docusign_sent',
  'docusign_completed',
  'docusign_voided',
  'voice_sms',
  'voice_missed_call',
  'delivery_failed',
  'client_status_request',
  'commitment_detected',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DETECTORS = [
  'inbound_unanswered',
  'first_response_lag',
  'quote_follow_up_overdue',
  'stale_quote',
  'stale_negotiation',
  'andersen_deadline_breach',
  'orphan_communication',
  'commitment_due',
  'bounced_email',
  'vendor_quote_no_return',
  'delivery_status_overdue',
  'client_update_unanswered',
] as const;
export type DetectorName = (typeof DETECTORS)[number];

export type AttentionItemType =
  | 'OUR_COMMITMENT'
  | 'WAITING_ON'
  | 'RISK'
  | 'OPPORTUNITY';

export type Confidence = 'high' | 'medium' | 'low';

export type AttentionStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'suppressed';

export interface AttachmentMeta {
  name: string;
  mime: string;
  size: number;
}

// What the injected read-only fetch returns. Compatible with the existing
// google.ts GmailMessageSummary (id, from, subject, snippet); the remaining
// fields are optional so the summary adapter can be used as-is.
export interface ProviderMessage {
  id: string;
  threadId?: string;
  from: string;
  to?: string[];
  cc?: string[];
  subject: string;
  snippet: string;
  receivedAt?: string;
  bodyText?: string;
  attachments?: AttachmentMeta[];
  mailbox?: string;
}

// Row shape for communication_messages (0031).
export interface CommunicationMessageRow {
  id: string;
  provider: 'gmail';
  provider_message_id: string;
  provider_thread_id: string | null;
  mailbox_identity: string;
  direction: Direction;
  from_address_norm: string;
  to_addresses_norm: string[];
  cc_norm: string[];
  subject: string;
  snippet: string;
  received_at: string;
  has_attachments: boolean;
  attachment_manifest: AttachmentMeta[];
  ingestion_class: IngestionClass;
  drop_reason: string | null;
  body_text: string | null;
  project_id: string | null;
  link_confidence: LinkConfidence;
  link_signal: string;
  imported_at: string;
  import_run_id: string;
}

// Row shape for communication_events (0031).
export interface CommunicationEventRow {
  id: string;
  message_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  project_id: string | null;
  occurred_at: string;
}

export interface Evidence {
  kind: 'message' | 'event' | 'quote' | 'project' | 'vendor_order' | 'lead';
  ref: string;
  quote?: string;
  timestamp: string;
}

// Insert shape for attention_items (0031); the store adds seen timestamps.
export interface AttentionItemDraft {
  item_type: AttentionItemType;
  detector: DetectorName;
  project_id: string | null;
  subject: string;
  source_system: string;
  source_ref: string;
  evidence: Evidence[];
  confidence: Confidence;
  suggested_action: string;
  due_at: string | null;
  dedupe_key: string;
}

// Parsed event produced by a parser before it is bound to a message id.
export interface ParsedEvent {
  event_type: EventType;
  payload: Record<string, unknown>;
  occurred_at: string;
}

// Parser input: the normalized, already-neutralized message view.
export interface ParseInput {
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  bodyText: string;
  attachments: AttachmentMeta[];
  receivedAt: string;
  direction: Direction;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
}

export function hoursBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return (to - from) / HOUR_MS;
}

// Business days (Mon-Fri) added to a timestamp; weekends are skipped.
export function addBusinessDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso));
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString();
}

// Build a case-insensitive word-bounded alternation from readable parts
// (keeps pattern sources short enough for the 100-column rule).
export function wordAlt(parts: readonly string[], flags = 'i'): RegExp {
  return new RegExp('\\b(' + parts.join('|') + ')\\b', flags);
}
