// Preston AI OS - Phase 3 recipient allowlist + client-contact leakage
// guard (master build plan sections 7.10/16/19). PURE, deterministic.
//
// An allowlist is INPUT to a capability (data, bound by the payload hash):
// entries carry a contact class (client | vendor | internal | owner). Every
// outbound recipient must resolve to exactly one entry; the audience of a
// message is derived from the resolved classes; a message that mixes client
// and vendor recipients is refused; and vendor-facing payloads are refused
// when ANY known client contact (email / phone / name) appears in them
// (owner rule: customer contact must not leak into vendor-facing material).

export type ContactClass = 'client' | 'vendor' | 'internal' | 'owner';

export const CONTACT_CLASSES: readonly ContactClass[] =
  ['client', 'vendor', 'internal', 'owner'];

export interface AllowlistEntry {
  email: string;
  class: ContactClass;
  name?: string;
  phone?: string;
  project_id?: string; // when present the entry is scoped to one project
}

export interface ResolvedRecipient {
  email: string;
  class: ContactClass;
}

export type RecipientResolution =
  | { ok: true; resolved: ResolvedRecipient[]; audience: ContactClass }
  | { ok: false; reason:
      | 'recipient_missing'
      | 'recipient_invalid'
      | 'recipient_not_allowlisted'
      | 'recipient_project_mismatch'
      | 'mixed_client_vendor_recipients' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(e: unknown): string {
  return String(e ?? '').trim().toLowerCase();
}

export function resolveRecipients(
  recipients: string[],
  allowlist: AllowlistEntry[],
  projectId: string | null,
): RecipientResolution {
  const wanted = [...new Set(recipients.map(normalizeEmail))];
  if (wanted.length === 0) return { ok: false, reason: 'recipient_missing' };
  const byEmail = new Map<string, AllowlistEntry>();
  for (const a of allowlist) byEmail.set(normalizeEmail(a.email), a);
  const resolved: ResolvedRecipient[] = [];
  for (const email of wanted) {
    if (!EMAIL_RE.test(email)) return { ok: false, reason: 'recipient_invalid' };
    const entry = byEmail.get(email);
    if (!entry) return { ok: false, reason: 'recipient_not_allowlisted' };
    if (entry.project_id && entry.project_id !== projectId) {
      return { ok: false, reason: 'recipient_project_mismatch' };
    }
    resolved.push({ email, class: entry.class });
  }
  const classes = new Set(resolved.map((r) => r.class));
  if (classes.has('client') && classes.has('vendor')) {
    return { ok: false, reason: 'mixed_client_vendor_recipients' };
  }
  const audience: ContactClass = classes.has('client') ? 'client'
    : classes.has('vendor') ? 'vendor'
      : classes.has('owner') ? 'owner' : 'internal';
  return { ok: true, resolved, audience };
}

export interface ClientContact {
  email?: string;
  phone?: string;
  name?: string;
}

export function clientContactsFromAllowlist(allowlist: AllowlistEntry[]): ClientContact[] {
  return allowlist
    .filter((a) => a.class === 'client')
    .map((a) => ({ email: a.email, phone: a.phone, name: a.name }));
}

export interface ContactLeak {
  via: 'email' | 'phone' | 'name';
  field_index: number; // which text field leaked
}

const PHONE_TOKEN_RE = /\+?\d[\d\s().-]{5,}\d/g;

function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

function phoneMatches(text: string, clientDigits: string): boolean {
  if (clientDigits.length < 7) return false;
  const tail = clientDigits.slice(-10);
  for (const tok of text.match(PHONE_TOKEN_RE) ?? []) {
    const d = digitsOf(tok);
    if (d === clientDigits) return true;
    if (d.length >= 10 && tail.length === 10 && d.endsWith(tail)) return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMatches(text: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 4) return false;
  const re = new RegExp('\\b' + escapeRe(n).replace(/\s+/g, '\\s+') + '\\b', 'i');
  return re.test(text);
}

// First leak found, scanning fields in order (deterministic). null = clean.
export function findClientContactLeak(
  textFields: string[],
  contacts: ClientContact[],
): ContactLeak | null {
  for (let i = 0; i < textFields.length; i++) {
    const text = String(textFields[i] ?? '');
    const lower = text.toLowerCase();
    for (const c of contacts) {
      const email = normalizeEmail(c.email);
      if (email && lower.includes(email)) return { via: 'email', field_index: i };
      const digits = digitsOf(String(c.phone ?? ''));
      if (digits && phoneMatches(text, digits)) return { via: 'phone', field_index: i };
      if (c.name && nameMatches(text, c.name)) return { via: 'name', field_index: i };
    }
  }
  return null;
}

// Vendor-facing payloads must carry no client contact at all.
export function vendorLeakReason(
  audience: ContactClass,
  textFields: string[],
  allowlist: AllowlistEntry[],
): 'client_contact_leakage' | null {
  if (audience !== 'vendor') return null;
  const leak = findClientContactLeak(textFields, clientContactsFromAllowlist(allowlist));
  return leak ? 'client_contact_leakage' : null;
}
