// Commitment + status-request extraction (plan 7.9). Deterministic phrase
// tables only - no model. Party resolution depends on direction:
//   first-person promise ("I will call you") in an OUTBOUND message => us
//   first-person promise in an INBOUND message                     => them
//   request ("please call me back") in an INBOUND message          => us
//   request in an OUTBOUND message                                 => them

import type { Direction, ParsedEvent, ParseInput } from '../types';
import { DAY_MS } from '../types';

export type CommitmentParty = 'us' | 'them';

export interface Commitment {
  party: CommitmentParty;
  phrase: string;
  kind: 'promise' | 'request';
  due_hint: string | null;
  due_at: string | null;
}

const PROMISE_PHRASES = [
  "i will call you",
  "i'll call you",
  "i will send",
  "i'll send",
  "we will send",
  "we'll send",
  "i will get back to you",
  "i'll get back to you",
  "we will get back to you",
  "i will follow up",
  "i'll follow up",
  "we will follow up",
  "i will confirm",
  "we will confirm",
  "i will schedule",
  "we will schedule",
];

const REQUEST_PHRASES = [
  'please call me back',
  'call me back',
  'can you send',
  'could you send',
  'please send',
  'let me know by',
  'please let me know',
  'can you confirm',
  'could you confirm',
  'please confirm',
  'can you call',
  'please call',
];

const STATUS_REQUEST_RE = new RegExp(
  "\\b(any update|any news|status update|what'?s the status|checking in|" +
    "haven'?t heard|following up on|where are we|when can i expect|" +
    'any progress|eta\\?)',
  'i',
);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday'];

const DUE_HINT_RE = new RegExp(
  '\\b(?:(?:by|before|on|until)\\s+)?(tomorrow|today|' +
    'end of (?:the )?(?:day|week)|eod|eow|monday|tuesday|wednesday|' +
    'thursday|friday|saturday|sunday|next week|' +
    '(?:\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?))\\b',
  'i',
);

// Resolve a due hint to a timestamp relative to the message receipt.
// Unknown hints resolve to null (the detector applies a default window).
export function resolveDueHint(hint: string, receivedAt: string): string | null {
  const base = Date.parse(receivedAt);
  if (!Number.isFinite(base)) return null;
  const h = hint.toLowerCase().trim();
  const endOfDay = (t: number) => {
    const d = new Date(t);
    d.setUTCHours(23, 59, 59, 0);
    return d.toISOString();
  };
  if (h === 'today' || h === 'eod' || h === 'end of day' ||
    h === 'end of the day') {
    return endOfDay(base);
  }
  if (h === 'tomorrow') return endOfDay(base + DAY_MS);
  if (h === 'eow' || h === 'end of week' || h === 'end of the week') {
    const d = new Date(base);
    const add = (5 - d.getUTCDay() + 7) % 7;
    return endOfDay(base + add * DAY_MS);
  }
  if (h === 'next week') return endOfDay(base + 7 * DAY_MS);
  const dow = WEEKDAYS.indexOf(h);
  if (dow >= 0) {
    const d = new Date(base);
    let add = (dow - d.getUTCDay() + 7) % 7;
    if (add === 0) add = 7;
    return endOfDay(base + add * DAY_MS);
  }
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(h);
  if (m) {
    const d = new Date(base);
    const year = m[3]
      ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]))
      : d.getUTCFullYear();
    const when = Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 23, 59, 59);
    if (!Number.isFinite(when)) return null;
    return new Date(when).toISOString();
  }
  return null;
}

function partyFor(kind: 'promise' | 'request', direction: Direction):
  CommitmentParty {
  if (kind === 'promise') return direction === 'outbound' ? 'us' : 'them';
  return direction === 'inbound' ? 'us' : 'them';
}

export function extractCommitments(
  text: string,
  direction: Direction,
  receivedAt: string,
): Commitment[] {
  const lower = text.toLowerCase();
  const out: Commitment[] = [];
  const seen = new Set<string>();
  const consider = (phrases: string[], kind: 'promise' | 'request') => {
    for (const phrase of phrases) {
      const at = lower.indexOf(phrase);
      if (at < 0) continue;
      const key = `${kind}:${phrase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const window = text.slice(at, at + 140);
      const hint = DUE_HINT_RE.exec(window)?.[1] ?? null;
      out.push({
        party: partyFor(kind, direction),
        phrase,
        kind,
        due_hint: hint,
        due_at: hint ? resolveDueHint(hint, receivedAt) : null,
      });
    }
  };
  consider(PROMISE_PHRASES, 'promise');
  consider(REQUEST_PHRASES, 'request');
  return out;
}

export function parseCommitments(input: ParseInput): ParsedEvent | null {
  const text = `${input.snippet}\n${input.bodyText}`;
  const found = extractCommitments(text, input.direction, input.receivedAt);
  if (found.length === 0) return null;
  return {
    event_type: 'commitment_detected',
    occurred_at: input.receivedAt,
    payload: { commitments: found },
  };
}

// Inbound "any update?" style asks from a counterparty.
export function parseStatusRequest(input: ParseInput): ParsedEvent | null {
  if (input.direction !== 'inbound') return null;
  const text = `${input.subject}\n${input.snippet}\n${input.bodyText}`;
  const m = STATUS_REQUEST_RE.exec(text);
  if (!m) return null;
  return {
    event_type: 'client_status_request',
    occurred_at: input.receivedAt,
    payload: { phrase: m[1].toLowerCase() },
  };
}
