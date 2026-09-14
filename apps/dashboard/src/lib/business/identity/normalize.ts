// Phase 1 Lane A - deterministic normalizers for identity matching.
//
// Every function is pure, total (bad input -> '' rather than a throw)
// and stable: the same raw value always yields the same key, so the
// keys can be stored in contact_aliases.normalized_value and compared
// with plain equality. No fuzzy logic lives here by design.

// --- email -----------------------------------------------------------------

// Lowercase + trim. Gmail dots and plus-tags are PRESERVED as-is: other
// providers treat john.doe and johndoe as different mailboxes, and a
// plus-tag can be the only thing distinguishing two intake streams
// (andersen+leads@...). Equivalences the owner knows about are recorded
// explicitly as approved aliases instead of guessed here.
export function normalizeEmail(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  // "Name <addr@host>" -> addr@host
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(s);
  if (angle) s = angle[1];
  if (s.startsWith('mailto:')) s = s.slice(7);
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@') || at === s.length - 1) {
    return '';
  }
  if (/\s/.test(s)) return '';
  const domain = s.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return '';
  }
  return s;
}

// --- phone -----------------------------------------------------------------

// US numbers -> E.164 (+1NNNNNNNNNN). Numbers given with a non-US
// country code -> '+' followed by digits. Bare digit strings that are
// neither 10 nor 11(leading 1) digits are returned as digits only.
// Fewer than 7 digits is not a phone number -> ''.
export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  // Drop extensions ("x123", "ext. 12") before counting digits.
  let noExt = trimmed.replace(/\s*(x|ext\.?|extension)\s*\d+\s*$/i, '');
  const hasPlus = noExt.startsWith('+');
  // International trunk-zero notation "+49 (0)30 ..." drops the (0).
  if (hasPlus) noExt = noExt.replace(/\(0\)/g, '');
  const digits = noExt.replace(/[^0-9]/g, '');
  if (digits.length < 7) return '';
  if (hasPlus) {
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.startsWith('1')) return digits; // malformed +1, keep digits
    return digits.length <= 15 ? `+${digits}` : '';
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

// --- address ---------------------------------------------------------------

// Street-suffix and directional abbreviations (USPS style, subset).
const STREET_WORDS: Record<string, string> = {
  STREET: 'ST',
  STR: 'ST',
  AVENUE: 'AVE',
  AV: 'AVE',
  BOULEVARD: 'BLVD',
  BLV: 'BLVD',
  ROAD: 'RD',
  DRIVE: 'DR',
  DRV: 'DR',
  LANE: 'LN',
  PLACE: 'PL',
  COURT: 'CT',
  TERRACE: 'TER',
  PARKWAY: 'PKWY',
  HIGHWAY: 'HWY',
  EXPRESSWAY: 'EXPY',
  SQUARE: 'SQ',
  CIRCLE: 'CIR',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
};

// Unit designators collapse to three canonical tokens: APT (apartment,
// unit, number sign), STE (suite, office) and FL (floor). "PH"
// (penthouse) stays PH.
const UNIT_WORDS: Record<string, string> = {
  APARTMENT: 'APT',
  APT: 'APT',
  UNIT: 'APT',
  SUITE: 'STE',
  STE: 'STE',
  OFFICE: 'STE',
  OFC: 'STE',
  FLOOR: 'FL',
  FL: 'FL',
  FLR: 'FL',
  PENTHOUSE: 'PH',
  PH: 'PH',
};

const UNIT_TOKENS = new Set(['APT', 'STE', 'FL', 'PH']);

export function normalizeAddress(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.toUpperCase();
  // "#4B" and "# 4B" are apartment markers.
  s = s.replace(/#\s*/g, ' APT ');
  // Strip punctuation except hyphens (Queens house numbers: 12-34) and
  // the hyphen inside unit labels; slashes become spaces.
  s = s.replace(/[.,;:'"()\/\\]/g, ' ');
  const tokens = s.split(/\s+/).filter((t) => t.length > 0);
  const out: string[] = [];
  for (const t of tokens) {
    if (UNIT_WORDS[t]) {
      out.push(UNIT_WORDS[t]);
    } else if (STREET_WORDS[t]) {
      out.push(STREET_WORDS[t]);
    } else {
      out.push(t);
    }
  }
  // "APT APT 4B" (from "Apt #4B") -> "APT 4B".
  const dedup: string[] = [];
  for (const t of out) {
    if (UNIT_TOKENS.has(t) && dedup[dedup.length - 1] === t) continue;
    dedup.push(t);
  }
  // "4B APT" style trailing unit words are left alone - not guessed.
  // Unit values like "4-B" normalize to "4B".
  for (let i = 0; i < dedup.length - 1; i++) {
    if (UNIT_TOKENS.has(dedup[i])) {
      dedup[i + 1] = dedup[i + 1].replace(/-/g, '');
    }
  }
  return dedup.join(' ');
}

export interface AddressParts {
  street: string;
  unit: string | null;
}

// Splits a normalized address into the street part and the unit part
// (from the first unit designator onward), so "same building, different
// apartment" never compares equal at the street level by accident: the
// property key below always includes the unit.
export function splitAddressUnit(normalized: string): AddressParts {
  const tokens = normalized.split(' ').filter((t) => t.length > 0);
  const idx = tokens.findIndex((t) => UNIT_TOKENS.has(t));
  if (idx < 0) return { street: tokens.join(' '), unit: null };
  const unit = tokens.slice(idx).join(' ');
  return { street: tokens.slice(0, idx).join(' '), unit: unit || null };
}

// The exact-property key used by the matcher: normalized street line
// plus the normalized unit (explicit unit column wins over an inline
// one). Two units in one building produce two different keys.
export function propertyKey(
  addressLine: string,
  unit?: string | null,
): string {
  const norm = normalizeAddress(addressLine);
  const parts = splitAddressUnit(norm);
  let unitPart = parts.unit;
  if (typeof unit === 'string' && unit.trim().length > 0) {
    const u = normalizeAddress(unit);
    unitPart = UNIT_TOKENS.has(u.split(' ')[0]) ? u : `APT ${u}`;
  }
  return unitPart ? `${parts.street}|${unitPart}` : parts.street;
}
