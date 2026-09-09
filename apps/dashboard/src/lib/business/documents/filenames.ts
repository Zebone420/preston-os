// Phase 1 Lane B - deterministic canonical filenames (plan 5.8).
//
//   P26-0041_VENDOR_HOMEDEPOT_QUOTE_H1256-471919_V02.pdf
//   P26-0041_PROPOSAL_CLIENT_V03.pdf
//   P26-0041_FINAL_MEASURE_V02.pdf
//   P26-0041_PO_V01.pdf
//
// Grammar (tokens joined by '_'):
//   <code> [<qualifier>] <type-token> [<party>] [<ref>] V<nn>.<ext>
//   vendor_quote is special: <code> VENDOR <party> QUOTE [<ref>] V<nn>.<ext>
// Token classes are disjoint by charset so parsing is unambiguous:
//   qualifier: fixed allow-list of letters      (FINAL, DRAFT, ...)
//   type-token: fixed map from document_type    (MEASURE, PO, ...)
//   party: letters only, 2..20                  (CLIENT, HOMEDEPOT)
//   ref: letters/digits/hyphen, MUST contain a digit (H1256-471919)
//   version: two-digit zero-padded, 1..99
//   ext: lowercase letters/digits, 1..5

import { PROJECT_CODE_RE } from './types';
import type { DocumentType } from './types';

export const TYPE_TOKENS: Record<DocumentType, string> = {
  intake: 'INTAKE',
  site_photo: 'SITEPHOTO',
  measurement: 'MEASURE',
  plan: 'PLAN',
  design: 'DESIGN',
  product_spec: 'SPEC',
  vendor_quote: 'QUOTE',
  quote_request: 'RFQ',
  proposal: 'PROPOSAL',
  contract: 'CONTRACT',
  payment_receipt: 'RECEIPT',
  lpc_dob_building: 'LPC',
  purchase_order: 'PO',
  order_confirmation: 'ORDERCONF',
  delivery: 'DELIVERY',
  installation_photo: 'INSTALLPHOTO',
  punch: 'PUNCH',
  closeout: 'CLOSEOUT',
  warranty: 'WARRANTY',
  knowledge: 'KNOWLEDGE',
  other: 'DOC',
};

export const QUALIFIERS = [
  'FINAL',
  'DRAFT',
  'PRELIM',
  'REVISED',
  'SIGNED',
] as const;
export type Qualifier = (typeof QUALIFIERS)[number];

const PARTY_RE = /^[A-Z]{2,20}$/;
const REF_RE = /^(?=.*\d)[A-Z0-9-]{1,40}$/;
const EXT_RE = /^[a-z0-9]{1,5}$/;
const VERSION_RE = /^V(\d{2})$/;

const TOKEN_TO_TYPE: Record<string, DocumentType> = Object.fromEntries(
  (Object.keys(TYPE_TOKENS) as DocumentType[]).map((t) => [
    TYPE_TOKENS[t],
    t,
  ]),
) as Record<string, DocumentType>;

export interface CanonicalNameParts {
  projectCode: string;
  documentType: DocumentType;
  qualifier?: Qualifier;
  party?: string;
  ref?: string;
  version: number;
  ext: string;
}

export function normalizeParty(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '');
}

export function normalizeRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function fail(msg: string): never {
  throw new Error(`canonical filename: ${msg}`);
}

export function canonicalFilename(parts: CanonicalNameParts): string {
  if (!PROJECT_CODE_RE.test(parts.projectCode)) {
    fail(`invalid project code ${parts.projectCode}`);
  }
  const typeToken = TYPE_TOKENS[parts.documentType];
  if (!typeToken) fail(`unknown document type ${parts.documentType}`);
  if (
    !Number.isInteger(parts.version) ||
    parts.version < 1 ||
    parts.version > 99
  ) {
    fail(`version out of range ${parts.version}`);
  }
  if (!EXT_RE.test(parts.ext)) fail(`invalid extension ${parts.ext}`);
  if (parts.qualifier !== undefined &&
    !(QUALIFIERS as readonly string[]).includes(parts.qualifier)) {
    fail(`invalid qualifier ${parts.qualifier}`);
  }
  if (parts.party !== undefined && !PARTY_RE.test(parts.party)) {
    fail(`invalid party ${parts.party}`);
  }
  if (parts.ref !== undefined && !REF_RE.test(parts.ref)) {
    fail(`invalid ref ${parts.ref}`);
  }
  const tokens: string[] = [parts.projectCode];
  if (parts.documentType === 'vendor_quote') {
    if (!parts.party) fail('vendor_quote requires a party');
    if (parts.qualifier) fail('vendor_quote does not take a qualifier');
    tokens.push('VENDOR', parts.party, 'QUOTE');
  } else {
    if (parts.qualifier) tokens.push(parts.qualifier);
    tokens.push(typeToken);
    if (parts.party) tokens.push(parts.party);
  }
  if (parts.ref) tokens.push(parts.ref);
  tokens.push(`V${String(parts.version).padStart(2, '0')}`);
  return `${tokens.join('_')}.${parts.ext}`;
}

export function parseCanonicalFilename(
  name: string,
): CanonicalNameParts | null {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    return null;
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  if (!EXT_RE.test(ext)) return null;
  const tokens = name.slice(0, dot).split('_');
  if (tokens.length < 3) return null;
  const projectCode = tokens[0];
  if (!PROJECT_CODE_RE.test(projectCode)) return null;
  const vm = VERSION_RE.exec(tokens[tokens.length - 1]);
  if (!vm) return null;
  const version = Number(vm[1]);
  if (version < 1) return null;
  const middle = tokens.slice(1, -1);
  if (middle.length === 0) return null;

  const out: CanonicalNameParts = {
    projectCode,
    documentType: 'other',
    version,
    ext,
  };
  let rest: string[];
  if (middle[0] === 'VENDOR') {
    if (middle.length < 3 || middle[2] !== 'QUOTE') return null;
    if (!PARTY_RE.test(middle[1])) return null;
    out.documentType = 'vendor_quote';
    out.party = middle[1];
    rest = middle.slice(3);
    if (rest.length > 1) return null;
  } else {
    let i = 0;
    if ((QUALIFIERS as readonly string[]).includes(middle[0])) {
      out.qualifier = middle[0] as Qualifier;
      i = 1;
    }
    const type = TOKEN_TO_TYPE[middle[i] ?? ''];
    if (!type) return null;
    out.documentType = type;
    rest = middle.slice(i + 1);
    if (rest.length > 2) return null;
    if (rest.length > 0 && PARTY_RE.test(rest[0])) {
      out.party = rest[0];
      rest = rest.slice(1);
    }
    if (rest.length > 1) return null;
  }
  if (rest.length === 1) {
    if (!REF_RE.test(rest[0])) return null;
    out.ref = rest[0];
  }
  return out;
}

// Round-trip guard: a name is canonical iff parsing then rebuilding
// yields the exact same string.
export function isCanonicalFilename(name: string): boolean {
  const parsed = parseCanonicalFilename(name);
  if (!parsed) return false;
  try {
    return canonicalFilename(parsed) === name;
  } catch {
    return false;
  }
}
