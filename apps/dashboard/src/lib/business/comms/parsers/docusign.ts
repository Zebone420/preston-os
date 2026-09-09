// DocuSign event parser (plan 7.6). Verified event kinds: sent/review,
// completed, voided. Contract state is updated from these provider events
// only - never inferred from ordinary email language.

import { wordAlt, type ParsedEvent, type ParseInput } from '../types';
import { domainOf } from '../alias-registry';

const ENVELOPE_RE = new RegExp(
  'envelope\\s*id\\s*[:#]?\\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-' +
    '[0-9a-f]{4}-[0-9a-f]{12})',
  'i',
);
const COMPLETED_RE = wordAlt([
  'completed', 'has been completed', 'all parties have signed',
]);
const VOIDED_RE = wordAlt(['voided', 'has been voided']);
const SENT_RE = wordAlt([
  'please (review and )?sign', 'sent you a document', 'review document',
  'waiting for you to sign', 'reminder:',
]);

export function isDocusignSender(from: string): boolean {
  const d = domainOf(from);
  return d === 'docusign.net' || d.endsWith('.docusign.net') ||
    d === 'docusign.com' || d.endsWith('.docusign.com');
}

export function parseDocusign(input: ParseInput): ParsedEvent | null {
  if (!isDocusignSender(input.from)) return null;
  const text = `${input.subject}\n${input.snippet}\n${input.bodyText}`;
  const envelope = ENVELOPE_RE.exec(text)?.[1]?.toLowerCase() ?? null;
  const documentTitle = /:\s*(.+)$/.exec(input.subject)?.[1]?.trim() ?? null;
  const payload = { envelope_id: envelope, document_title: documentTitle };

  if (VOIDED_RE.test(input.subject)) {
    return { event_type: 'docusign_voided', occurred_at: input.receivedAt, payload };
  }
  if (COMPLETED_RE.test(input.subject)) {
    return { event_type: 'docusign_completed', occurred_at: input.receivedAt, payload };
  }
  if (SENT_RE.test(input.subject) || SENT_RE.test(input.snippet)) {
    return { event_type: 'docusign_sent', occurred_at: input.receivedAt, payload };
  }
  return null;
}
