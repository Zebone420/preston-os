// Alias registry (plan 7.10). Pure functions over mailbox_identities rows.
// The outbound SENDER ADDRESS is chosen here deterministically and never by
// an LLM. Selecting an address is not sending: no send path exists in this
// lane (CLAUDE.md rule 4) - this only answers "which identity would be the
// canonical sender for a class" so a later, owner-gated lane cannot pick
// a wrong or retired alias.

export type MailboxRole = 'primary' | 'send_as_alias' | 'vendor_facing' | 'legacy';

export interface MailboxIdentityRow {
  mailbox_identity: string;
  email_address: string;
  role: MailboxRole;
  active: boolean;
  canonical_sender: boolean;
  allowed_send_classes: string[];
}

export type SendClass = 'client' | 'vendor' | 'internal';

export type SenderSelection =
  | { ok: true; address: string; mailbox_identity: string }
  | { ok: false; reason: string };

// Vendor-facing domains for the owner hard rule: client contact details
// must never appear in material bound for these domains.
export const VENDOR_FACING_DOMAINS = ['homedepot.com'] as const;

const ADDRESS_RE = /<([^<>]+)>/;

// "Name <A@B.com>" -> "a@b.com"; bare addresses are lowercased and trimmed.
// Non-address strings normalize to '' so callers can fail closed.
export function normalizeAddress(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const m = ADDRESS_RE.exec(raw);
  const candidate = (m ? m[1] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return '';
  return candidate;
}

export function domainOf(address: string): string {
  const norm = normalizeAddress(address);
  const at = norm.lastIndexOf('@');
  return at < 0 ? '' : norm.slice(at + 1);
}

export function vendorFacing(
  address: string,
  extraDomains: readonly string[] = [],
): boolean {
  const domain = domainOf(address);
  if (domain === '') return false;
  const all = [...VENDOR_FACING_DOMAINS, ...extraDomains.map((d) =>
    d.toLowerCase())];
  return all.some((d) => domain === d || domain.endsWith('.' + d));
}

export function isOurAddress(
  rows: readonly MailboxIdentityRow[],
  address: string,
): boolean {
  const norm = normalizeAddress(address);
  if (norm === '') return false;
  return rows.some((r) => normalizeAddress(r.email_address) === norm);
}

// Deterministic sender pick: exactly the active canonical sender whose
// allowed_send_classes contains the class. Zero candidates => refuse;
// more than one => refuse (registry misconfiguration, owner decides).
export function selectSender(
  rows: readonly MailboxIdentityRow[],
  sendClass: SendClass,
): SenderSelection {
  const candidates = rows.filter(
    (r) =>
      r.active === true &&
      r.canonical_sender === true &&
      r.role !== 'legacy' &&
      Array.isArray(r.allowed_send_classes) &&
      r.allowed_send_classes.includes(sendClass) &&
      normalizeAddress(r.email_address) !== '',
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: `no active canonical sender allows class "${sendClass}"`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: `ambiguous: ${candidates.length} canonical senders allow ` +
        `class "${sendClass}"`,
    };
  }
  const pick = candidates[0];
  return {
    ok: true,
    address: normalizeAddress(pick.email_address),
    mailbox_identity: pick.mailbox_identity,
  };
}
