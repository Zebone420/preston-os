// Owner HARD RULE: client contact details (email/phone) must never appear
// in vendor-facing (homedepot.com) material. This detector flags any
// vendor-bound message whose body or attachment text carries a client
// email or phone. Pure and deterministic; it flags, it never sends.

import { normalizeAddress, vendorFacing } from './alias-registry';

export interface ClientContact {
  email?: string | null;
  phone?: string | null;
}

export interface ContactLeakInput {
  recipients: string[];
  bodyText: string;
  attachmentsText?: string;
  clientContacts: ClientContact[];
  // Domains that are ours or the vendor's; addresses there are not leaks.
  allowedDomains?: readonly string[];
  vendorDomains?: readonly string[];
}

export interface LeakHit {
  kind: 'email' | 'phone';
  masked: string;
  location: 'body' | 'attachment';
  match: 'client_contact' | 'unknown_contact';
}

export interface ContactLeakFinding {
  vendor_bound: boolean;
  leaked: boolean;
  vendor_recipients: string[];
  hits: LeakHit[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// US-style phone: optional +1, 3-3-4 with common separators.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

function maskEmail(addr: string): string {
  const [local, domain] = addr.split('@');
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

function maskPhone(digits: string): string {
  return `***-***-${digits.slice(-4)}`;
}

function scan(
  text: string,
  location: 'body' | 'attachment',
  clientEmails: Set<string>,
  clientPhones: Set<string>,
  ignoreDomains: readonly string[],
): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const m of text.match(EMAIL_RE) ?? []) {
    const norm = normalizeAddress(m);
    if (norm === '') continue;
    const domain = norm.slice(norm.lastIndexOf('@') + 1);
    if (ignoreDomains.some((d) => domain === d || domain.endsWith('.' + d))) {
      continue;
    }
    hits.push({
      kind: 'email',
      masked: maskEmail(norm),
      location,
      match: clientEmails.has(norm) ? 'client_contact' : 'unknown_contact',
    });
  }
  for (const m of text.match(PHONE_RE) ?? []) {
    const norm = normalizePhone(m);
    if (norm === '') continue;
    hits.push({
      kind: 'phone',
      masked: maskPhone(norm),
      location,
      match: clientPhones.has(norm) ? 'client_contact' : 'unknown_contact',
    });
  }
  return hits;
}

export function detectClientContactLeak(
  input: ContactLeakInput,
): ContactLeakFinding {
  const vendorDomains = input.vendorDomains ?? [];
  const vendorRecipients = input.recipients
    .map(normalizeAddress)
    .filter((a) => a !== '' && vendorFacing(a, vendorDomains));
  const vendorBound = vendorRecipients.length > 0;
  if (!vendorBound) {
    return { vendor_bound: false, leaked: false, vendor_recipients: [], hits: [] };
  }
  const clientEmails = new Set(
    input.clientContacts.map((c) => normalizeAddress(c.email)).filter((e) =>
      e !== ''),
  );
  const clientPhones = new Set(
    input.clientContacts.map((c) => normalizePhone(c.phone)).filter((p) =>
      p !== ''),
  );
  const ignore = [
    ...(input.allowedDomains ?? []),
    'homedepot.com',
    ...vendorDomains,
  ].map((d) => d.toLowerCase());
  const hits = [
    ...scan(input.bodyText ?? '', 'body', clientEmails, clientPhones, ignore),
    ...scan(
      input.attachmentsText ?? '',
      'attachment',
      clientEmails,
      clientPhones,
      ignore,
    ),
  ];
  return {
    vendor_bound: true,
    leaked: hits.length > 0,
    vendor_recipients: vendorRecipients,
    hits,
  };
}
