// Google Voice notification parser (plan 7.4): text-message and missed-call
// notification emails land in Gmail. Counterparty numbers are normalized to
// 10 digits. OTP/security content is dropped upstream by the classifier
// and never reaches this parser.

import type { ParsedEvent, ParseInput } from '../types';
import { domainOf, normalizeAddress } from '../alias-registry';
import { normalizePhone } from '../contact-leak';

const SMS_RE = /new text message from\s+(.+)$/i;
const MISSED_RE = /missed call from\s+(.+)$/i;
const VOICEMAIL_RE = /new voicemail from\s+(.+)$/i;

export function isVoiceSender(from: string): boolean {
  const norm = normalizeAddress(from);
  return norm.startsWith('voice-noreply@') && domainOf(norm) === 'google.com';
}

function counterparty(raw: string): { phone: string; label: string } {
  const phone = normalizePhone(raw);
  const label = raw.replace(/[()\s.-]+/g, ' ').trim();
  return { phone, label };
}

export function parseGoogleVoice(input: ParseInput): ParsedEvent | null {
  if (!isVoiceSender(input.from)) return null;
  const sms = SMS_RE.exec(input.subject.trim());
  if (sms) {
    const c = counterparty(sms[1]);
    return {
      event_type: 'voice_sms',
      occurred_at: input.receivedAt,
      payload: {
        counterparty_phone: c.phone || null,
        counterparty_label: c.label,
        // Message text stays in body_text (data only); only length here.
        text_length: input.snippet.length,
      },
    };
  }
  const missed = MISSED_RE.exec(input.subject.trim()) ??
    VOICEMAIL_RE.exec(input.subject.trim());
  if (missed) {
    const c = counterparty(missed[1]);
    return {
      event_type: 'voice_missed_call',
      occurred_at: input.receivedAt,
      payload: {
        counterparty_phone: c.phone || null,
        counterparty_label: c.label,
        voicemail: VOICEMAIL_RE.test(input.subject),
      },
    };
  }
  return null;
}
