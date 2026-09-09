// Gmail ingestion classifier (plan 7.11). Pure and deterministic.
// Order of evaluation: DROP rules first (the message never reaches AI
// context and its body is never stored), then FINANCE_RESTRICTED, then
// EVENT_ONLY, then INCLUDE_PROJECT when a business party is involved.
// Anything with no business signal is DROP with reason 'no_business_signal'
// so unknown mail never leaks into project context by default.

import { wordAlt, type AttachmentMeta, type IngestionClass } from './types';
import { domainOf, normalizeAddress } from './alias-registry';

export interface ClassifyInput {
  from: string;
  to?: string[];
  subject: string;
  snippet: string;
  attachments?: AttachmentMeta[];
  // Optional known business addresses (approved client/contact/vendor
  // aliases) and known thread membership, both treated as business signals.
  knownContacts?: readonly string[];
  knownThread?: boolean;
}

export interface Classification {
  ingestion_class: IngestionClass;
  drop_reason: string | null;
  signal: string;
}

// Business-party domains (synthetic-safe; only role/provider domains).
export const BUSINESS_DOMAINS = [
  'andersencorp.com',
  'andersenwindows.com',
  'homedepot.com',
  'docusign.net',
  'docusign.com',
  'nyc.gov',
] as const;

const FINANCE_DOMAINS = [
  'stripe.com',
  'squareup.com',
  'paypal.com',
  'intuit.com',
  'quickbooks.com',
  'chase.com',
  'amex.com',
  'americanexpress.com',
];

const DROP_RULES: { reason: string; re: RegExp }[] = [
  {
    reason: 'otp_code',
    re: wordAlt([
      'one[- ]time (pass)?code', 'verification code', 'security code',
      'passcode', '2fa', 'two[- ]factor', 'confirmation code',
    ]),
  },
  { reason: 'otp_code', re: /\b\d{6}\b\s+is your\b/i },
  {
    reason: 'password_reset',
    re: wordAlt(['password reset', 'reset your password', 'reset password']),
  },
  {
    reason: 'security_alert',
    re: wordAlt([
      'security alert', 'new sign[- ]in', 'new login',
      'suspicious (activity|sign[- ]in)', 'critical security',
    ]),
  },
  {
    reason: 'auth_link',
    re: wordAlt([
      'sign[- ]in link', 'magic link', 'login link',
      'verify your (email|account)', 'click to (sign|log) in',
    ]),
  },
];

const PROMO_RE = wordAlt([
  'unsubscribe', '% off', 'percent off', 'flash sale', 'newsletter',
  'webinar', 'limited time offer', 'special offer',
]);

const FINANCE_RE = wordAlt([
  'receipt', 'invoice', 'payment (received|due|reminder|confirmation)',
  'statement is (ready|available)', 'billing', 'your (bill|subscription)',
  'card ending', 'bank account', 'premium (due|notice)',
  'insurance (premium|billing)', 'renewal notice', 'charged?\\b.*\\$',
]);

const BOUNCE_RE = wordAlt([
  'delivery status notification', 'undeliverable', 'delivery failure',
  'message not delivered', "wasn't delivered", 'could not be delivered',
]);
const VOICE_RE = wordAlt([
  'new text message from', 'missed call from', 'new voicemail from',
]);
const ORDER_READY_RE = wordAlt([
  'ready for pickup', 'order (is )?ready', 'out for delivery',
  'has been delivered', 'delivery scheduled', 'pickup reminder',
]);

const BUSINESS_KEYWORDS_RE = wordAlt([
  'window', 'windows', 'door', 'doors', 'quote', 'estimate', 'install',
  'installation', 'measure', 'measurement', 'proposal', 'contract',
  'landmarks', 'lpc', 'docket', 'architect', 'contractor',
  'building management', 'property manager', 'site visit', 'permit',
  'delivery', 'lead', 'case submitted', 'design specifications', 'skylight',
  'glass', 'replacement',
]);

function isMailerDaemon(from: string): boolean {
  const norm = normalizeAddress(from);
  return /^(mailer-daemon|postmaster)@/.test(norm) ||
    /mailer-daemon/i.test(from);
}

function anyDomain(addresses: string[], domains: readonly string[]): boolean {
  return addresses.some((a) => {
    const d = domainOf(a);
    return d !== '' && domains.some((x) => d === x || d.endsWith('.' + x));
  });
}

export function classifyMessage(input: ClassifyInput): Classification {
  const text = `${input.subject}\n${input.snippet}`;
  const parties = [input.from, ...(input.to ?? [])];
  const businessDomain = anyDomain(parties, BUSINESS_DOMAINS);
  const known = new Set((input.knownContacts ?? []).map(normalizeAddress));
  const knownParty = parties.some((a) => known.has(normalizeAddress(a)));
  const businessParty =
    businessDomain || knownParty || input.knownThread === true ||
    BUSINESS_KEYWORDS_RE.test(text) ||
    (input.attachments ?? []).some((a) => /H1256-\d+/i.test(a.name));

  // 1. DROP rules (never reach AI context; body never stored).
  for (const rule of DROP_RULES) {
    if (rule.re.test(text)) {
      return { ingestion_class: 'DROP', drop_reason: rule.reason, signal: rule.reason };
    }
  }
  if (!businessParty && PROMO_RE.test(text)) {
    return { ingestion_class: 'DROP', drop_reason: 'promotional_noise', signal: 'promo' };
  }

  // 2. FINANCE_RESTRICTED: evidence for reconciliation, never authority.
  if (anyDomain([input.from], FINANCE_DOMAINS)) {
    return { ingestion_class: 'FINANCE_RESTRICTED', drop_reason: null, signal: 'finance_domain' };
  }
  if (FINANCE_RE.test(text)) {
    return { ingestion_class: 'FINANCE_RESTRICTED', drop_reason: null, signal: 'finance_keyword' };
  }

  // 3. EVENT_ONLY: bounce, voice notification, order-ready.
  if (isMailerDaemon(input.from) || BOUNCE_RE.test(text)) {
    return { ingestion_class: 'EVENT_ONLY', drop_reason: null, signal: 'bounce' };
  }
  if (domainOf(input.from) === 'google.com' && VOICE_RE.test(text)) {
    return { ingestion_class: 'EVENT_ONLY', drop_reason: null, signal: 'voice' };
  }
  if (VOICE_RE.test(input.subject)) {
    return { ingestion_class: 'EVENT_ONLY', drop_reason: null, signal: 'voice' };
  }
  if (ORDER_READY_RE.test(text)) {
    return { ingestion_class: 'EVENT_ONLY', drop_reason: null, signal: 'order_status' };
  }

  // 4. INCLUDE_PROJECT when a business party is involved.
  if (businessParty) {
    const signal = businessDomain
      ? 'business_domain'
      : knownParty
        ? 'known_contact'
        : input.knownThread
          ? 'known_thread'
          : 'business_keyword';
    return { ingestion_class: 'INCLUDE_PROJECT', drop_reason: null, signal };
  }
  if (PROMO_RE.test(text)) {
    return { ingestion_class: 'DROP', drop_reason: 'promotional_noise', signal: 'promo' };
  }
  return { ingestion_class: 'DROP', drop_reason: 'no_business_signal', signal: 'none' };
}
