// Runs every deterministic parser over one normalized message and returns
// the parsed events. Provider-specific parsers are mutually exclusive by
// sender domain; commitments and status requests can co-occur.

import type { ParsedEvent, ParseInput } from '../types';
import { parseAndersenLead } from './andersen-lead';
import { parseBounce } from './bounce';
import { parseCommitments, parseStatusRequest } from './commitments';
import { parseDocusign } from './docusign';
import { parseGoogleVoice } from './google-voice';
import { parseHomeDepot } from './home-depot';
import { parseVendorQuote, type VendorQuoteOptions } from './vendor-quote';

export function parseAllEvents(
  input: ParseInput,
  opts: VendorQuoteOptions = {},
): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const provider =
    parseBounce(input) ??
    parseGoogleVoice(input) ??
    parseAndersenLead(input) ??
    parseHomeDepot(input) ??
    parseDocusign(input) ??
    parseVendorQuote(input, opts);
  if (provider) out.push(provider);
  // System notifications carry no human commitments.
  const system = provider && provider.event_type !== 'vendor_quote_received';
  if (!system) {
    const c = parseCommitments(input);
    if (c) out.push(c);
    const s = parseStatusRequest(input);
    if (s) out.push(s);
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.event_type)) return false;
    seen.add(e.event_type);
    return true;
  });
}
