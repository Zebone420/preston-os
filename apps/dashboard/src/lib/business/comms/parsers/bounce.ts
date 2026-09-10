// Delivery-failure parser (plan 7.8): mailer-daemon bounces become
// communication.delivery_failed events. Nothing may resend to a bounced
// address until contact data is corrected (a detector raises the item).

import { wordAlt, type ParsedEvent, type ParseInput } from '../types';
import { normalizeAddress } from '../alias-registry';

const DAEMON_RE = /^(mailer-daemon|postmaster)@/i;
const SUBJECT_RE = wordAlt([
  'delivery status notification', 'undeliverable', 'delivery failure',
  'message not delivered', "wasn't delivered", 'could not be delivered',
]);
const EMAIL_SRC = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
const RECIPIENT_RE = new RegExp(
  "(?:wasn'?t delivered to|could not be delivered to|delivery to|recipient|" +
    'to:?)\\s*<?(' + EMAIL_SRC + ')>?',
  'i',
);
const ANY_EMAIL_RE = new RegExp(EMAIL_SRC);
const REASON_RULES: { reason: string; re: RegExp }[] = [
  {
    reason: 'address_not_found',
    re: wordAlt([
      "couldn'?t be found", 'does not exist', 'no such user', 'user unknown',
      'address not found',
    ]),
  },
  { reason: 'mailbox_full', re: wordAlt(['mailbox (is )?full', 'over quota']) },
  { reason: 'rejected', re: wordAlt(['rejected', 'blocked', 'spam']) },
  {
    reason: 'domain_not_found',
    re: wordAlt(['domain (name )?not found', 'dns error']),
  },
];

export function parseBounce(input: ParseInput): ParsedEvent | null {
  const from = normalizeAddress(input.from);
  const daemon = DAEMON_RE.test(from);
  if (!daemon && !SUBJECT_RE.test(input.subject)) return null;
  const text = `${input.snippet}\n${input.bodyText}`;
  const recipient =
    RECIPIENT_RE.exec(text)?.[1]?.toLowerCase() ??
    ANY_EMAIL_RE.exec(text)?.[0]?.toLowerCase() ??
    null;
  const reason = REASON_RULES.find((r) => r.re.test(text))?.reason ?? 'unknown';
  return {
    event_type: 'delivery_failed',
    occurred_at: input.receivedAt,
    payload: {
      failed_recipient: recipient,
      reason,
      parse_complete: recipient !== null,
    },
  };
}
