// Deal Intelligence deterministic detectors v1 (plan 8.1-8.3). Pure
// functions over a normalized timeline with an injected clock. Every
// finding is an attention_items row shape with >= 1 evidence entry; a
// finding without evidence is invalid and throws. dedupe_key is stable per
// (detector, subject/source) so re-running is idempotent. ADVICE ONLY:
// nothing here acts, sends, or closes project truth (plan 8.4).

import {
  addBusinessDays,
  addHours,
  DAY_MS,
  hoursBetween,
  type AttentionItemDraft,
  type AttentionItemType,
  type Confidence,
  type DetectorName,
  type Direction,
  type EventType,
  type Evidence,
  type IngestionClass,
  type LinkConfidence,
} from './types';

export interface TimelineMessage {
  id: string;
  provider_thread_id: string | null;
  direction: Direction;
  from_address_norm: string;
  to_addresses_norm: string[];
  subject: string;
  received_at: string;
  ingestion_class: IngestionClass;
  project_id: string | null;
  link_confidence: LinkConfidence;
}

export interface TimelineEvent {
  id: string;
  message_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  project_id: string | null;
  occurred_at: string;
}

export interface TimelineProject {
  id: string;
  title: string;
  status: string;
}

export interface TimelineQuote {
  id: string;
  project_id: string | null;
  title: string;
  status: string;
  sent_at: string | null;
  decided_at: string | null;
}

export interface TimelineVendorOrder {
  id: string;
  project_id: string | null;
  vendor: string;
  order_number: string | null;
  expected_ship_date: string | null;
  delivery_status: string;
}

export interface TimelineLead {
  id: string;
  project_id: string | null;
  display_name: string;
  stage: string;
  stage_changed_at: string;
  created_at: string;
}

export interface DetectorConfig {
  inboundUnansweredHours: number;
  firstResponseHours: number;
  // Follow-up ladder after a quote is sent (owner register: 24h/48h/weekly).
  followUpHours: number[];
  staleQuoteDays: number;
  staleNegotiationDays: number;
  andersenClaimHours: number;
  andersenNudgeHours: number;
  defaultCommitmentDays: number;
  vendorQuoteBusinessDays: number;
  pickupReadyDays: number;
  clientUpdateHours: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  inboundUnansweredHours: 48,
  firstResponseHours: 24,
  followUpHours: [24, 48, 168],
  staleQuoteDays: 14,
  staleNegotiationDays: 10,
  andersenClaimHours: 48,
  andersenNudgeHours: 24,
  defaultCommitmentDays: 3,
  vendorQuoteBusinessDays: 3,
  pickupReadyDays: 5,
  clientUpdateHours: 24,
};

export interface TimelineInput {
  messages: TimelineMessage[];
  events: TimelineEvent[];
  projects: TimelineProject[];
  quotes: TimelineQuote[];
  vendorOrders: TimelineVendorOrder[];
  leads?: TimelineLead[];
  now: string;
  config?: Partial<DetectorConfig>;
}

export class InvalidFindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFindingError';
  }
}

const SYSTEM_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'andersen_lead_new',
  'andersen_lead_reminder',
  'andersen_status_nudge',
  'hd_case_submitted',
  'hd_quote_received',
  'hd_quote_revised',
  'hd_receipt',
  'hd_order_status',
  'docusign_sent',
  'docusign_completed',
  'docusign_voided',
  'voice_sms',
  'voice_missed_call',
  'delivery_failed',
]);

const CLOSED_QUOTE = new Set(['won', 'lost', 'rejected', 'superseded',
  'archived']);

// Build a finding and validate it. Evidence is mandatory.
export function makeFinding(input: {
  item_type: AttentionItemType;
  detector: DetectorName;
  project_id: string | null;
  subject: string;
  source_system: string;
  source_ref: string;
  evidence: Evidence[];
  confidence: Confidence;
  suggested_action: string;
  due_at?: string | null;
  dedupe_suffix: string;
}): AttentionItemDraft {
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new InvalidFindingError(
      `finding ${input.detector}:${input.dedupe_suffix} has no evidence`,
    );
  }
  for (const e of input.evidence) {
    if (!e.ref || !e.timestamp) {
      throw new InvalidFindingError(
        `finding ${input.detector}:${input.dedupe_suffix} has bad evidence`,
      );
    }
  }
  if (!input.source_ref) {
    throw new InvalidFindingError(`finding ${input.detector} has no source`);
  }
  return {
    item_type: input.item_type,
    detector: input.detector,
    project_id: input.project_id,
    subject: input.subject.slice(0, 200),
    source_system: input.source_system,
    source_ref: input.source_ref,
    evidence: input.evidence,
    confidence: input.confidence,
    suggested_action: input.suggested_action,
    due_at: input.due_at ?? null,
    dedupe_key: `${input.detector}:${input.dedupe_suffix}`,
  };
}

function msgEvidence(m: TimelineMessage, quote?: string): Evidence {
  return { kind: 'message', ref: m.id, quote, timestamp: m.received_at };
}

function evtEvidence(e: TimelineEvent, quote?: string): Evidence {
  return { kind: 'event', ref: e.id, quote, timestamp: e.occurred_at };
}

class Timeline {
  readonly cfg: DetectorConfig;
  readonly now: string;
  readonly byId = new Map<string, TimelineMessage>();
  readonly eventsByMessage = new Map<string, TimelineEvent[]>();
  readonly sorted: TimelineMessage[];

  constructor(readonly input: TimelineInput) {
    this.cfg = { ...DEFAULT_DETECTOR_CONFIG, ...(input.config ?? {}) };
    this.now = input.now;
    this.sorted = [...input.messages].sort((a, b) =>
      a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : 0,
    );
    for (const m of this.sorted) this.byId.set(m.id, m);
    for (const e of input.events) {
      const list = this.eventsByMessage.get(e.message_id) ?? [];
      list.push(e);
      this.eventsByMessage.set(e.message_id, list);
    }
  }

  age(iso: string): number {
    return hoursBetween(iso, this.now);
  }

  // Messages in the same conversation: thread when known, else project.
  related(threadId: string | null, projectId: string | null): TimelineMessage[] {
    if (threadId) {
      return this.sorted.filter((m) => m.provider_thread_id === threadId);
    }
    if (projectId) {
      return this.sorted.filter((m) => m.project_id === projectId);
    }
    return [];
  }

  firstAfter(
    direction: Direction,
    afterIso: string,
    threadId: string | null,
    projectId: string | null,
  ): TimelineMessage | undefined {
    return this.related(threadId, projectId).find(
      (m) => m.direction === direction && m.received_at > afterIso,
    );
  }

  inProject(projectId: string): TimelineMessage[] {
    return this.sorted.filter((m) => m.project_id === projectId);
  }

  isSystemMessage(m: TimelineMessage): boolean {
    return (this.eventsByMessage.get(m.id) ?? []).some((e) =>
      SYSTEM_EVENTS.has(e.event_type));
  }

  threadOf(messageId: string): string | null {
    return this.byId.get(messageId)?.provider_thread_id ?? null;
  }
}

// 1. Inbound business message with no outbound reply in its thread.
function inboundUnanswered(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const m of t.sorted) {
    if (m.direction !== 'inbound') continue;
    if (m.ingestion_class !== 'INCLUDE_PROJECT') continue;
    if (t.isSystemMessage(m)) continue;
    const age = t.age(m.received_at);
    if (age < t.cfg.inboundUnansweredHours) continue;
    const reply = t.firstAfter('outbound', m.received_at, m.provider_thread_id,
      m.project_id);
    if (reply) continue;
    out.push(makeFinding({
      item_type: 'OUR_COMMITMENT',
      detector: 'inbound_unanswered',
      project_id: m.project_id,
      subject: `Unanswered inbound: ${m.subject}`,
      source_system: 'gmail',
      source_ref: m.id,
      evidence: [msgEvidence(m, `inbound ${Math.floor(age)}h ago from ` +
        m.from_address_norm)],
      confidence: age >= t.cfg.inboundUnansweredHours * 2 ? 'high' : 'medium',
      suggested_action: 'Reply to this message (draft for owner review).',
      dedupe_suffix: m.id,
    }));
  }
  return out;
}

// 2. Lead created, first outbound later than the configured window.
function firstResponseLag(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const lead of t.input.leads ?? []) {
    if (!lead.project_id) continue;
    const first = t.firstAfter('outbound', lead.created_at, null,
      lead.project_id);
    const lagHours = first
      ? hoursBetween(lead.created_at, first.received_at)
      : t.age(lead.created_at);
    if (lagHours <= t.cfg.firstResponseHours) continue;
    const evidence: Evidence[] = [
      { kind: 'lead', ref: lead.id, quote: `lead created ${lead.created_at}`,
        timestamp: lead.created_at },
    ];
    if (first) evidence.push(msgEvidence(first, 'first outbound'));
    out.push(makeFinding({
      item_type: first ? 'RISK' : 'OUR_COMMITMENT',
      detector: 'first_response_lag',
      project_id: lead.project_id,
      subject: first
        ? `Slow first response to ${lead.display_name}`
        : `No first response to ${lead.display_name}`,
      source_system: 'sales_leads',
      source_ref: lead.id,
      evidence,
      confidence: first ? 'medium' : 'high',
      suggested_action: first
        ? 'Review response-time process for new leads.'
        : 'Contact the lead now (draft for owner review).',
      due_at: addHours(lead.created_at, t.cfg.firstResponseHours),
      dedupe_suffix: lead.id,
    }));
  }
  return out;
}

function quoteOpen(q: TimelineQuote): boolean {
  return q.sent_at !== null && q.decided_at === null &&
    !CLOSED_QUOTE.has(q.status);
}

// 3. Quote sent; follow-up ladder (24h / 48h / weekly) overdue.
function quoteFollowUpOverdue(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  const ladder = t.cfg.followUpHours.length > 0
    ? t.cfg.followUpHours
    : DEFAULT_DETECTOR_CONFIG.followUpHours;
  for (const q of t.input.quotes) {
    if (!quoteOpen(q) || !q.project_id || !q.sent_at) continue;
    const outbound = t.inProject(q.project_id).filter(
      (m) => m.direction === 'outbound' && m.received_at > (q.sent_at ?? ''),
    );
    const k = outbound.length;
    const last = outbound[k - 1];
    const lastTouch = last ? last.received_at : q.sent_at;
    const interval = ladder[Math.min(k, ladder.length - 1)];
    const due = addHours(lastTouch, interval);
    if (t.now <= due) continue;
    const evidence: Evidence[] = [
      { kind: 'quote', ref: q.id, quote: `quote sent ${q.sent_at}`,
        timestamp: q.sent_at },
    ];
    if (last) evidence.push(msgEvidence(last, `follow-up ${k}`));
    out.push(makeFinding({
      item_type: 'OUR_COMMITMENT',
      detector: 'quote_follow_up_overdue',
      project_id: q.project_id,
      subject: `Follow up on quote: ${q.title}`,
      source_system: 'quotes',
      source_ref: q.id,
      evidence,
      confidence: 'medium',
      suggested_action: `Send follow-up ${k + 1} (draft for owner review).`,
      due_at: due,
      dedupe_suffix: q.id,
    }));
  }
  return out;
}

// 4. Quote sent, no decision after N days.
function staleQuote(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const q of t.input.quotes) {
    if (!quoteOpen(q) || !q.sent_at) continue;
    const days = t.age(q.sent_at) / 24;
    if (days < t.cfg.staleQuoteDays) continue;
    out.push(makeFinding({
      item_type: 'RISK',
      detector: 'stale_quote',
      project_id: q.project_id,
      subject: `Stale quote: ${q.title}`,
      source_system: 'quotes',
      source_ref: q.id,
      evidence: [{ kind: 'quote', ref: q.id, timestamp: q.sent_at,
        quote: `no decision after ${Math.floor(days)} days` }],
      confidence: days >= t.cfg.staleQuoteDays * 2 ? 'high' : 'medium',
      suggested_action: 'Decide: re-engage, revise, or mark lost.',
      dedupe_suffix: q.id,
    }));
  }
  return out;
}

// 5. Lead in negotiation/follow_up with no message traffic for N days.
function staleNegotiation(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const lead of t.input.leads ?? []) {
    if (!['negotiation', 'follow_up'].includes(lead.stage)) continue;
    if (!lead.project_id) continue;
    const msgs = t.inProject(lead.project_id).filter(
      (m) => m.received_at > lead.stage_changed_at,
    );
    const last = msgs[msgs.length - 1];
    const lastTouch = last ? last.received_at : lead.stage_changed_at;
    const days = t.age(lastTouch) / 24;
    if (days < t.cfg.staleNegotiationDays) continue;
    const evidence: Evidence[] = [
      { kind: 'lead', ref: lead.id, timestamp: lead.stage_changed_at,
        quote: `stage ${lead.stage} since ${lead.stage_changed_at}` },
    ];
    if (last) evidence.push(msgEvidence(last, 'last message'));
    out.push(makeFinding({
      item_type: 'RISK',
      detector: 'stale_negotiation',
      project_id: lead.project_id,
      subject: `Stale negotiation: ${lead.display_name}`,
      source_system: 'sales_leads',
      source_ref: lead.id,
      evidence,
      confidence: 'medium',
      suggested_action: 'Re-engage or move the lead to deferred/lost.',
      dedupe_suffix: lead.id,
    }));
  }
  return out;
}

// 6. Andersen 48h claim/contact deadline breached; nudges unanswered.
function andersenDeadlineBreach(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const e of t.input.events) {
    if (e.event_type === 'andersen_lead_new') {
      const deadline = typeof e.payload['claim_deadline'] === 'string'
        ? (e.payload['claim_deadline'] as string)
        : addHours(e.occurred_at, t.cfg.andersenClaimHours);
      const acked = e.project_id
        ? t.firstAfter('outbound', e.occurred_at, null, e.project_id)
        : undefined;
      if (acked || t.now <= deadline) continue;
      const evidence: Evidence[] = [evtEvidence(e, `claim deadline ${deadline}`)];
      const src = t.byId.get(e.message_id);
      if (src) evidence.push(msgEvidence(src, 'lead email'));
      out.push(makeFinding({
        item_type: 'RISK',
        detector: 'andersen_deadline_breach',
        project_id: e.project_id,
        subject: `Andersen lead deadline passed (${String(
          e.payload['homeowner_name'] ?? 'unknown homeowner')})`,
        source_system: 'andersen',
        source_ref: e.id,
        evidence,
        confidence: e.project_id ? 'high' : 'medium',
        suggested_action: 'Claim/contact the lead now or record the outcome.',
        due_at: deadline,
        dedupe_suffix: e.id,
      }));
    }
    if (e.event_type === 'andersen_status_nudge' ||
      e.event_type === 'andersen_lead_reminder') {
      if (t.age(e.occurred_at) < t.cfg.andersenNudgeHours) continue;
      const answered = e.project_id
        ? t.firstAfter('outbound', e.occurred_at, null, e.project_id)
        : undefined;
      if (answered) continue;
      out.push(makeFinding({
        item_type: 'OUR_COMMITMENT',
        detector: 'andersen_deadline_breach',
        project_id: e.project_id,
        subject: `Andersen ${e.event_type === 'andersen_status_nudge'
          ? 'status nudge' : 'reminder'} unanswered`,
        source_system: 'andersen',
        source_ref: e.id,
        evidence: [evtEvidence(e, e.event_type)],
        confidence: 'medium',
        suggested_action: 'Update the lead status with Andersen.',
        dedupe_suffix: e.id,
      }));
    }
  }
  return out;
}

// 7. Business message with no project link.
function orphanCommunication(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const m of t.sorted) {
    if (m.ingestion_class !== 'INCLUDE_PROJECT') continue;
    if (m.project_id !== null || m.link_confidence !== 'orphan') continue;
    out.push(makeFinding({
      item_type: 'RISK',
      detector: 'orphan_communication',
      project_id: null,
      subject: `Unlinked business message: ${m.subject}`,
      source_system: 'gmail',
      source_ref: m.id,
      evidence: [msgEvidence(m, `from ${m.from_address_norm}`)],
      confidence: 'low',
      suggested_action: 'Link this message to a project or open a new lead.',
      dedupe_suffix: m.id,
    }));
  }
  return out;
}

interface CommitmentPayload {
  party?: string;
  phrase?: string;
  due_at?: string | null;
  due_hint?: string | null;
}

// 8. Explicit commitment due/missed without the fulfilling message.
function commitmentDue(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const e of t.input.events) {
    if (e.event_type !== 'commitment_detected') continue;
    const list = Array.isArray(e.payload['commitments'])
      ? (e.payload['commitments'] as CommitmentPayload[])
      : [];
    const thread = t.threadOf(e.message_id);
    list.forEach((c, i) => {
      const party = c.party === 'them' ? 'them' : 'us';
      const due = typeof c.due_at === 'string' && c.due_at
        ? c.due_at
        : new Date(Date.parse(e.occurred_at) +
          t.cfg.defaultCommitmentDays * DAY_MS).toISOString();
      if (t.now <= due) return;
      const fulfilled = t.firstAfter(
        party === 'us' ? 'outbound' : 'inbound',
        e.occurred_at, thread, e.project_id,
      );
      if (fulfilled) return;
      const evidence: Evidence[] = [evtEvidence(e, `"${c.phrase ?? ''}"`)];
      const src = t.byId.get(e.message_id);
      if (src) evidence.push(msgEvidence(src));
      out.push(makeFinding({
        item_type: party === 'us' ? 'OUR_COMMITMENT' : 'WAITING_ON',
        detector: 'commitment_due',
        project_id: e.project_id,
        subject: party === 'us'
          ? `Our commitment overdue: "${c.phrase ?? ''}"`
          : `Waiting on them: "${c.phrase ?? ''}"`,
        source_system: 'gmail',
        source_ref: e.id,
        evidence,
        confidence: c.due_hint ? 'high' : 'medium',
        suggested_action: party === 'us'
          ? 'Fulfil the promise or update the counterparty.'
          : 'Nudge the counterparty (draft for owner review).',
        due_at: due,
        dedupe_suffix: `${e.id}:${i}`,
      }));
    });
  }
  return out;
}

// 9. Delivery failure to a client/vendor address.
function bouncedEmail(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const e of t.input.events) {
    if (e.event_type !== 'delivery_failed') continue;
    const recipient = String(e.payload['failed_recipient'] ?? 'unknown');
    out.push(makeFinding({
      item_type: 'RISK',
      detector: 'bounced_email',
      project_id: e.project_id,
      subject: `Email bounced: ${recipient}`,
      source_system: 'gmail',
      source_ref: e.id,
      evidence: [evtEvidence(e, `reason ${String(e.payload['reason'] ??
        'unknown')}`)],
      confidence: 'high',
      suggested_action:
        'Correct the contact address before any further send to it.',
      dedupe_suffix: e.id,
    }));
  }
  return out;
}

// 10. HD case submitted; no quote back after N business days.
function vendorQuoteNoReturn(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const e of t.input.events) {
    if (e.event_type !== 'hd_case_submitted') continue;
    const due = addBusinessDays(e.occurred_at, t.cfg.vendorQuoteBusinessDays);
    if (t.now <= due) continue;
    const thread = t.threadOf(e.message_id);
    const caseNumber = String(e.payload['case_number'] ?? '');
    const returned = t.input.events.some((x) =>
      (x.event_type === 'hd_quote_received' ||
        x.event_type === 'hd_quote_revised') &&
      x.occurred_at > e.occurred_at &&
      ((thread && t.threadOf(x.message_id) === thread) ||
        (e.project_id !== null && x.project_id === e.project_id) ||
        (caseNumber !== '' && String(x.payload['case_number'] ?? '') ===
          caseNumber)));
    if (returned) continue;
    out.push(makeFinding({
      item_type: 'WAITING_ON',
      detector: 'vendor_quote_no_return',
      project_id: e.project_id,
      subject: `Home Depot quote not returned (case ${caseNumber || '?'})`,
      source_system: 'homedepot',
      source_ref: e.id,
      evidence: [evtEvidence(e, `case submitted ${e.occurred_at}`)],
      confidence: 'medium',
      suggested_action: 'Ping Home Depot Pro on the open case.',
      due_at: due,
      dedupe_suffix: e.id,
    }));
  }
  return out;
}

// 11. Vendor order past its expected ship date; pickup-ready left waiting.
function deliveryStatusOverdue(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const o of t.input.vendorOrders) {
    if (['shipped', 'delivered'].includes(o.delivery_status)) continue;
    if (!o.expected_ship_date) continue;
    const expected = `${o.expected_ship_date}T00:00:00.000Z`;
    const late = t.age(expected) / 24;
    if (late <= 0) continue;
    out.push(makeFinding({
      item_type: 'WAITING_ON',
      detector: 'delivery_status_overdue',
      project_id: o.project_id,
      subject: `Order ${o.order_number ?? '(no number)'} from ${o.vendor} ` +
        'past expected ship date',
      source_system: 'vendor_orders',
      source_ref: o.id,
      evidence: [{ kind: 'vendor_order', ref: o.id, timestamp: expected,
        quote: `status ${o.delivery_status}, ${Math.floor(late)} day(s) late` }],
      confidence: late > 7 ? 'high' : 'medium',
      suggested_action: 'Ask the vendor for an updated ship date.',
      due_at: expected,
      dedupe_suffix: o.id,
    }));
  }
  for (const e of t.input.events) {
    if (e.event_type !== 'hd_order_status') continue;
    if (e.payload['status'] !== 'ready_for_pickup') continue;
    if (t.age(e.occurred_at) / 24 < t.cfg.pickupReadyDays) continue;
    const later = t.input.events.some((x) =>
      x.event_type === 'hd_order_status' && x.occurred_at > e.occurred_at &&
      ['delivered', 'shipped', 'out_for_delivery'].includes(
        String(x.payload['status'])) &&
      (x.project_id === e.project_id ||
        t.threadOf(x.message_id) === t.threadOf(e.message_id)));
    if (later) continue;
    out.push(makeFinding({
      item_type: 'OUR_COMMITMENT',
      detector: 'delivery_status_overdue',
      project_id: e.project_id,
      subject: 'Home Depot order waiting for pickup',
      source_system: 'homedepot',
      source_ref: e.id,
      evidence: [evtEvidence(e, 'ready_for_pickup')],
      confidence: 'medium',
      suggested_action: 'Schedule the pickup or confirm it happened.',
      dedupe_suffix: e.id,
    }));
  }
  return out;
}

// 12. Client asked for an update; no outbound afterwards.
function clientUpdateUnanswered(t: Timeline): AttentionItemDraft[] {
  const out: AttentionItemDraft[] = [];
  for (const e of t.input.events) {
    if (e.event_type !== 'client_status_request') continue;
    if (t.age(e.occurred_at) < t.cfg.clientUpdateHours) continue;
    const thread = t.threadOf(e.message_id);
    const reply = t.firstAfter('outbound', e.occurred_at, thread, e.project_id);
    if (reply) continue;
    const evidence: Evidence[] = [evtEvidence(e, `"${String(
      e.payload['phrase'] ?? '')}"`)];
    const src = t.byId.get(e.message_id);
    if (src) evidence.push(msgEvidence(src));
    out.push(makeFinding({
      item_type: 'OUR_COMMITMENT',
      detector: 'client_update_unanswered',
      project_id: e.project_id,
      subject: `Client asked for an update: ${src?.subject ?? ''}`,
      source_system: 'gmail',
      source_ref: e.id,
      evidence,
      confidence: 'high',
      suggested_action: 'Send the client a status update (draft for review).',
      due_at: addHours(e.occurred_at, t.cfg.clientUpdateHours),
      dedupe_suffix: e.id,
    }));
  }
  return out;
}

export const DETECTOR_FUNCTIONS: Record<
  DetectorName,
  (t: Timeline) => AttentionItemDraft[]
> = {
  inbound_unanswered: inboundUnanswered,
  first_response_lag: firstResponseLag,
  quote_follow_up_overdue: quoteFollowUpOverdue,
  stale_quote: staleQuote,
  stale_negotiation: staleNegotiation,
  andersen_deadline_breach: andersenDeadlineBreach,
  orphan_communication: orphanCommunication,
  commitment_due: commitmentDue,
  bounced_email: bouncedEmail,
  vendor_quote_no_return: vendorQuoteNoReturn,
  delivery_status_overdue: deliveryStatusOverdue,
  client_update_unanswered: clientUpdateUnanswered,
};

export function runDetectors(
  input: TimelineInput,
  only?: readonly DetectorName[],
): AttentionItemDraft[] {
  const t = new Timeline(input);
  const names = only ?? (Object.keys(DETECTOR_FUNCTIONS) as DetectorName[]);
  const out: AttentionItemDraft[] = [];
  const keys = new Set<string>();
  for (const name of names) {
    for (const f of DETECTOR_FUNCTIONS[name](t)) {
      if (keys.has(f.dedupe_key)) continue;
      keys.add(f.dedupe_key);
      out.push(f);
    }
  }
  return out.sort((a, b) =>
    a.dedupe_key < b.dedupe_key ? -1 : a.dedupe_key > b.dedupe_key ? 1 : 0);
}
