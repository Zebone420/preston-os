// Home Depot Pro quote-cycle parser (plan 7.2). Deterministic.
// Verified sequence (synthetic fixtures use the same shapes):
//   outbound "Pricing Quote Request - {client} - {address}" to prosupport
//   -> auto-reply "Case Submitted #nnnnnnnn"
//   -> reply with "H1256-nnnnnn Quote - Design Specifications.pdf"
//      + "H1256-nnnnnn Quote.pdf" (prices valid ~7 days)
//   -> revisions V1 / V2 / Update
//   -> receipt -> order / pickup / delivery reminders.

import type { ParsedEvent, ParseInput } from '../types';
import { domainOf } from '../alias-registry';

export const HD_QUOTE_VALID_DAYS = 7;

const CASE_RE = /case\s*(?:submitted\s*)?#?\s*(\d{6,10})/i;
const QUOTE_NUM_RE = /\b(H1256-\d{4,8})\b/i;
const SPEC_FILE_RE = /^(H1256-\d{4,8})\s+Quote\s*-\s*Design Specifications\.pdf$/i;
const QUOTE_FILE_RE = /^(H1256-\d{4,8})\s+Quote\.pdf$/i;
const REVISION_RE = /\b(V\d+|Update(?:d)?|Revised|Revision\s*\d*)\b/i;
const RECEIPT_RE = /\b(receipt|thank you for your (order|purchase))\b/i;
const ORDER_STATUS: { status: string; re: RegExp }[] = [
  { status: 'ready_for_pickup', re: /\b(ready for pickup|order is ready)\b/i },
  { status: 'delivered', re: /\b(has been delivered|was delivered)\b/i },
  { status: 'out_for_delivery', re: /\bout for delivery\b/i },
  { status: 'delivery_scheduled', re: /\b(delivery (is )?scheduled|scheduled delivery)\b/i },
  { status: 'pickup_reminder', re: /\bpickup reminder\b/i },
  { status: 'shipped', re: /\b(has shipped|shipped)\b/i },
];

export function isHomeDepotSender(from: string): boolean {
  const d = domainOf(from);
  return d === 'homedepot.com' || d.endsWith('.homedepot.com');
}

export function parseHomeDepot(input: ParseInput): ParsedEvent | null {
  if (!isHomeDepotSender(input.from)) return null;
  if (input.direction !== 'inbound') return null;
  const text = `${input.subject}\n${input.snippet}\n${input.bodyText}`;

  const caseMatch = CASE_RE.exec(input.subject) ?? CASE_RE.exec(input.snippet);
  const names = input.attachments.map((a) => a.name.trim());
  const spec = names.map((n) => SPEC_FILE_RE.exec(n)).find((m) => m !== null);
  const quote = names.map((n) => QUOTE_FILE_RE.exec(n)).find((m) => m !== null);

  if (spec || quote) {
    const quoteNumber = (spec?.[1] ?? quote?.[1] ?? '').toUpperCase();
    const revision = REVISION_RE.exec(input.subject)?.[1] ?? null;
    return {
      event_type: revision ? 'hd_quote_revised' : 'hd_quote_received',
      occurred_at: input.receivedAt,
      payload: {
        quote_number: quoteNumber,
        has_spec: Boolean(spec),
        has_quote: Boolean(quote),
        attachment_pair_complete: Boolean(spec) && Boolean(quote),
        revision_marker: revision,
        case_number: caseMatch?.[1] ?? null,
        prices_valid_days: HD_QUOTE_VALID_DAYS,
      },
    };
  }

  if (/case\s*submitted/i.test(input.subject) && caseMatch) {
    return {
      event_type: 'hd_case_submitted',
      occurred_at: input.receivedAt,
      payload: { case_number: caseMatch[1] },
    };
  }

  if (RECEIPT_RE.test(input.subject)) {
    return {
      event_type: 'hd_receipt',
      occurred_at: input.receivedAt,
      payload: {
        quote_number: QUOTE_NUM_RE.exec(text)?.[1]?.toUpperCase() ?? null,
        order_number: /order\s*#?\s*([A-Z0-9-]{6,20})/i.exec(text)?.[1] ?? null,
      },
    };
  }

  for (const rule of ORDER_STATUS) {
    if (rule.re.test(text)) {
      return {
        event_type: 'hd_order_status',
        occurred_at: input.receivedAt,
        payload: {
          status: rule.status,
          order_number: /order\s*#?\s*([A-Z0-9-]{6,20})/i.exec(text)?.[1] ??
            null,
          quote_number: QUOTE_NUM_RE.exec(text)?.[1]?.toUpperCase() ?? null,
        },
      };
    }
  }
  return null;
}
