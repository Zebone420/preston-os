// Provider-neutral vendor quote parser (plan 7.3): alternate suppliers send
// quote / lead-time conversations. Home Depot has its own parser and is
// excluded here so the two never double-fire.

import type { ParsedEvent, ParseInput } from '../types';
import { domainOf } from '../alias-registry';
import { isHomeDepotSender } from './home-depot';
import { isAndersenSender } from './andersen-lead';

const QUOTE_WORD_RE = /\b(quote|quotation|estimate|pricing|proposal)\b/i;
const QUOTE_REF_RE = new RegExp(
  '\\b(?:quote|quotation|estimate|ref(?:erence)?|proposal)\\s*' +
    '(?:#|no\\.?|number)?\\s*[:#]?\\s*([A-Z]{1,4}[-]?\\d{3,10}|\\d{4,10})\\b',
  'i',
);
const LEAD_TIME_RE = new RegExp(
  '\\b(lead[- ]time[^.\\n]{0,60}|(\\d{1,3})\\s*(?:-\\s*\\d{1,3}\\s*)?' +
    '(weeks?|business days|days)\\b[^.\\n]{0,40})',
  'i',
);

export interface VendorQuoteOptions {
  // Optional approved vendor domains; when given, only these fire.
  vendorDomains?: readonly string[];
}

export function parseVendorQuote(
  input: ParseInput,
  opts: VendorQuoteOptions = {},
): ParsedEvent | null {
  if (input.direction !== 'inbound') return null;
  if (isHomeDepotSender(input.from) || isAndersenSender(input.from)) return null;
  const domain = domainOf(input.from);
  if (domain === '') return null;
  if (opts.vendorDomains && !opts.vendorDomains.some((d) =>
    domain === d.toLowerCase() || domain.endsWith('.' + d.toLowerCase()))) {
    return null;
  }
  const text = `${input.subject}\n${input.snippet}\n${input.bodyText}`;
  if (!QUOTE_WORD_RE.test(text)) return null;
  const pdf = input.attachments.some((a) =>
    /\.pdf$/i.test(a.name) || a.mime === 'application/pdf');
  const ref = QUOTE_REF_RE.exec(text)?.[1] ?? null;
  if (!pdf && ref === null) return null;
  const lead = LEAD_TIME_RE.exec(text)?.[0]?.trim() ?? null;
  return {
    event_type: 'vendor_quote_received',
    occurred_at: input.receivedAt,
    payload: {
      vendor_domain: domain,
      quote_ref: ref,
      has_pdf: pdf,
      lead_time_mention: lead,
    },
  };
}
