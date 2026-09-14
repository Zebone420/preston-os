// Andersen certified-contractor lead parser (plan 7.1). Deterministic.
// Shape (synthetic fixtures mirror the verified structure):
//   From: certifiedcontractor@e.andersencorp.com
//   Subject: "<Owner first name>, you have a new lead!"
//   Body: homeowner name, city/state, a "Claim this lead" link, a Trade ID.
//   Claim deadline ~48h after receipt. Nudges: "What's the status of your
//   lead?"; reminders: "time-sensitive" / "reminder".

import type { ParsedEvent, ParseInput } from '../types';
import { addHours } from '../types';
import { domainOf } from '../alias-registry';

export const ANDERSEN_CLAIM_HOURS = 48;

const NEW_LEAD_RE = /you have a new lead/i;
const STATUS_NUDGE_RE = /what'?s the status of your lead/i;
const REMINDER_RE = /\b(reminder|time[- ]sensitive|don'?t forget|still waiting)\b/i;

const HOMEOWNER_RE = /(?:homeowner|name)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,60})/i;
const LOCATION_RE = /(?:location|city\/state|city)\s*[:\-]\s*([A-Za-z .'-]+,\s*[A-Z]{2})\b/i;
const TRADE_ID_RE = /trade\s*id\s*[:#]?\s*([A-Za-z0-9-]{3,32})/i;
const CLAIM_LINK_RE = /claim this lead/i;

export function isAndersenSender(from: string): boolean {
  const d = domainOf(from);
  return d === 'andersencorp.com' || d.endsWith('.andersencorp.com') ||
    d === 'andersenwindows.com' || d.endsWith('.andersenwindows.com');
}

export function parseAndersenLead(input: ParseInput): ParsedEvent | null {
  if (!isAndersenSender(input.from)) return null;
  if (input.direction !== 'inbound') return null;
  const text = `${input.snippet}\n${input.bodyText}`;

  if (NEW_LEAD_RE.test(input.subject)) {
    const homeowner = HOMEOWNER_RE.exec(text)?.[1]?.trim() ?? null;
    const cityState = LOCATION_RE.exec(text)?.[1]?.trim() ?? null;
    const tradeId = TRADE_ID_RE.exec(text)?.[1] ?? null;
    return {
      event_type: 'andersen_lead_new',
      occurred_at: input.receivedAt,
      payload: {
        homeowner_name: homeowner,
        city_state: cityState,
        trade_id: tradeId,
        claim_link_present: CLAIM_LINK_RE.test(text),
        claim_deadline: addHours(input.receivedAt, ANDERSEN_CLAIM_HOURS),
        parse_complete: homeowner !== null && tradeId !== null,
      },
    };
  }
  if (STATUS_NUDGE_RE.test(input.subject) || STATUS_NUDGE_RE.test(text)) {
    return {
      event_type: 'andersen_status_nudge',
      occurred_at: input.receivedAt,
      payload: { trade_id: TRADE_ID_RE.exec(text)?.[1] ?? null },
    };
  }
  if (REMINDER_RE.test(input.subject) && /\blead\b/i.test(input.subject)) {
    return {
      event_type: 'andersen_lead_reminder',
      occurred_at: input.receivedAt,
      payload: { trade_id: TRADE_ID_RE.exec(text)?.[1] ?? null },
    };
  }
  return null;
}
