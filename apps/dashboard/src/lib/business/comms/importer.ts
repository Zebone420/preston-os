// READ-ONLY Gmail import orchestration. Pure over an injected read-only
// fetch (the google.ts summary adapter or a compatible mock). Pipeline per
// message: normalize -> classify -> DROP short-circuit (no body kept) ->
// neutralize -> parse events -> link -> rows. No send/reply/draft path
// exists in this directory (CLAUDE.md rule 4); message content is DATA
// only (rule 12). No LLM call anywhere - deterministic code only.

import { createHash } from 'node:crypto';
import { neutralizeUntrusted } from '../../guards';
import {
  isOurAddress,
  normalizeAddress,
  type MailboxIdentityRow,
} from './alias-registry';
import { classifyMessage } from './classify';
import {
  detectClientContactLeak,
  type ClientContact,
  type ContactLeakFinding,
} from './contact-leak';
import type { TimelineEvent, TimelineMessage } from './detectors';
import { linkMessageToProject, type LinkIndex } from './linker';
import { parseAllEvents } from './parsers';
import type {
  AttachmentMeta,
  CommunicationEventRow,
  CommunicationMessageRow,
  Direction,
  ParseInput,
  ProviderMessage,
} from './types';

export const SNIPPET_MAX = 500;
export const BODY_MAX = 20_000;
const SUBJECT_MAX = 1_000;
const TRUNC_SUFFIX_LEN = ' [truncated]'.length;

export interface ImportOptions {
  fetch: () => Promise<ProviderMessage[]>;
  registry: readonly MailboxIdentityRow[];
  index: LinkIndex;
  now: string;
  importRunId?: string;
  knownContacts?: readonly string[];
  vendorDomains?: readonly string[];
  clientContacts?: ClientContact[];
}

export interface ImportResult {
  messages: CommunicationMessageRow[];
  events: CommunicationEventRow[];
  dropped: { count: number; reasons: Record<string, number> };
  findingsInput: { messages: TimelineMessage[]; events: TimelineEvent[] };
  leaks: { message_id: string; finding: ContactLeakFinding }[];
}

// Deterministic UUID-shaped id from a stable key (sha256, v4-formatted) so
// re-imports of the same provider message produce the same row id.
export function stableId(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return (
    h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) +
    h.slice(17, 20) + '-' + h.slice(20, 32)
  );
}

function bounded(text: unknown, max: number): string {
  return neutralizeUntrusted(text, Math.max(1, max - TRUNC_SUFFIX_LEN));
}

function manifest(list: AttachmentMeta[] | undefined): AttachmentMeta[] {
  return (list ?? []).map((a) => ({
    name: bounded(a.name, 255),
    mime: bounded(a.mime, 100),
    size: Number.isFinite(a.size) && a.size >= 0 ? Math.floor(a.size) : 0,
  }));
}

function defaultMailbox(registry: readonly MailboxIdentityRow[]): string {
  const primary = registry.find((r) => r.role === 'primary' && r.active);
  return primary?.mailbox_identity ?? registry[0]?.mailbox_identity ?? 'unknown';
}

export async function importGmailReadOnly(
  opts: ImportOptions,
): Promise<ImportResult> {
  const raw = await opts.fetch();
  const runId = opts.importRunId ?? `run:${opts.now}`;
  const messages: CommunicationMessageRow[] = [];
  const events: CommunicationEventRow[] = [];
  const leaks: ImportResult['leaks'] = [];
  const reasons: Record<string, number> = {};
  const seen = new Set<string>();

  for (const pm of raw) {
    const providerId = typeof pm.id === 'string' ? pm.id.trim() : '';
    if (providerId === '' || seen.has(providerId)) continue;
    seen.add(providerId);

    const from = normalizeAddress(pm.from);
    const to = (pm.to ?? []).map(normalizeAddress).filter((a) => a !== '');
    const cc = (pm.cc ?? []).map(normalizeAddress).filter((a) => a !== '');
    const direction: Direction = isOurAddress(opts.registry, from)
      ? 'outbound'
      : 'inbound';
    const receivedAt = pm.receivedAt && Number.isFinite(Date.parse(pm.receivedAt))
      ? new Date(Date.parse(pm.receivedAt)).toISOString()
      : opts.now;
    const threadId = pm.threadId ? bounded(pm.threadId, 200) : null;
    const subject = bounded(pm.subject, SUBJECT_MAX);
    const attachments = manifest(pm.attachments);
    const id = stableId(`gmail:${providerId}`);
    const mailbox = pm.mailbox ? bounded(pm.mailbox, 200)
      : defaultMailbox(opts.registry);

    const cls = classifyMessage({
      from,
      to,
      subject,
      snippet: neutralizeUntrusted(pm.snippet),
      attachments,
      knownContacts: opts.knownContacts,
      knownThread: threadId !== null && Boolean(opts.index.threadMap?.[threadId]),
    });

    const base = {
      id,
      provider: 'gmail' as const,
      provider_message_id: providerId,
      provider_thread_id: threadId,
      mailbox_identity: mailbox,
      direction,
      from_address_norm: from,
      to_addresses_norm: to,
      cc_norm: cc,
      subject,
      received_at: receivedAt,
      has_attachments: attachments.length > 0,
      attachment_manifest: attachments,
      imported_at: opts.now,
      import_run_id: runId,
    };

    if (cls.ingestion_class === 'DROP') {
      // Short-circuit: no body, no snippet, no events, no link attempt.
      const reason = cls.drop_reason ?? 'unspecified';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      messages.push({
        ...base,
        snippet: '',
        ingestion_class: 'DROP',
        drop_reason: reason,
        body_text: null,
        project_id: null,
        link_confidence: 'orphan',
        link_signal: 'dropped',
      });
      continue;
    }

    const snippet = bounded(pm.snippet, SNIPPET_MAX);
    const bodyText = bounded(pm.bodyText ?? '', BODY_MAX);
    const link = linkMessageToProject(
      { subject, bodyText, attachments, threadId, from, to },
      opts.index,
    );
    const row: CommunicationMessageRow = {
      ...base,
      snippet,
      ingestion_class: cls.ingestion_class,
      drop_reason: null,
      body_text: bodyText,
      project_id: link.project_id,
      link_confidence: link.link_confidence,
      link_signal: link.review_reason
        ? `${link.link_signal} (${link.review_reason})`
        : link.link_signal,
    };
    messages.push(row);

    const parseInput: ParseInput = {
      from,
      to,
      subject,
      snippet,
      bodyText,
      attachments,
      receivedAt,
      direction,
    };
    for (const ev of parseAllEvents(parseInput, {
      vendorDomains: opts.vendorDomains,
    })) {
      events.push({
        id: stableId(`event:${id}:${ev.event_type}`),
        message_id: id,
        event_type: ev.event_type,
        payload: ev.payload,
        project_id: link.project_id,
        occurred_at: ev.occurred_at,
      });
    }

    if (direction === 'outbound' && opts.clientContacts) {
      const finding = detectClientContactLeak({
        recipients: [...to, ...cc],
        bodyText,
        clientContacts: opts.clientContacts,
        allowedDomains: opts.registry.map((r) =>
          normalizeAddress(r.email_address).split('@')[1] ?? ''),
        vendorDomains: opts.vendorDomains,
      });
      if (finding.leaked) leaks.push({ message_id: id, finding });
    }
  }

  const dropCount = Object.values(reasons).reduce((a, b) => a + b, 0);
  return {
    messages,
    events,
    dropped: { count: dropCount, reasons },
    findingsInput: {
      messages: messages
        .filter((m) => m.ingestion_class !== 'DROP')
        .map((m) => ({
          id: m.id,
          provider_thread_id: m.provider_thread_id,
          direction: m.direction,
          from_address_norm: m.from_address_norm,
          to_addresses_norm: m.to_addresses_norm,
          subject: m.subject,
          received_at: m.received_at,
          ingestion_class: m.ingestion_class,
          project_id: m.project_id,
          link_confidence: m.link_confidence,
        })),
      events: events.map((e) => ({ ...e })),
    },
    leaks,
  };
}
