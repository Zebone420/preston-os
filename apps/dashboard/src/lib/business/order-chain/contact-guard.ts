// Order chain - client contact leak guard (Phase 5 SAFE unit).
//
// Owner rule (plan section 19): customer contact must never leak into
// vendor-facing material. Vendor material may carry the client's NAME
// (a job-site attention line) but never the client's email or phone.
//
// Detection is over the canonical JSON of the material, so nested
// notes and free-text fields are covered:
//   - any email address whose domain is not Preston's is a leak;
//   - any phone number whose digits match a known client phone is a
//     leak (digits compared after stripping formatting; a US leading
//     country code of 1 is ignored).
// Pure and deterministic.

import { canonicalJson } from './hash';

export const PRESTON_CONTACT_DOMAIN = 'preston.nyc';

export interface ClientContactFacts {
  emails: string[];
  phones: string[];
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits;
}

export function isPrestonEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === PRESTON_CONTACT_DOMAIN;
}

// Returns a sorted, de-duplicated list of leak descriptors, or an
// empty list when the material is clean.
export function findContactLeaks(
  material: unknown,
  client: ClientContactFacts,
): string[] {
  const text = canonicalJson(material) ?? '';
  const leaks = new Set<string>();
  for (const email of text.match(EMAIL_RE) ?? []) {
    if (!isPrestonEmail(email)) leaks.add(`email:${email.toLowerCase()}`);
  }
  const clientPhones = new Set(
    (client.phones ?? []).map(normalizePhone).filter((p) => p.length >= 10),
  );
  for (const raw of text.match(PHONE_RE) ?? []) {
    const norm = normalizePhone(raw);
    if (clientPhones.has(norm)) leaks.add(`phone:${norm}`);
  }
  const lowered = text.toLowerCase();
  for (const email of client.emails ?? []) {
    if (email && lowered.includes(email.toLowerCase())) {
      leaks.add(`email:${email.toLowerCase()}`);
    }
  }
  return [...leaks].sort();
}
