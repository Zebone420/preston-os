// Phase 1 Lane B - registry state machine (plan 5.7 versioning rule).
//
// Pure functions over document rows. registerVersion computes the exact
// rows to insert/update; the store adapters apply them. Invariants:
//   - identical bytes (sha256) never create a new version -> 'duplicate'
//   - new version = max(version in chain) + 1
//   - the previous current row becomes is_current=false + SUPERSEDED and
//     the new row points at it via supersedes_document_id
//   - a low-confidence candidate is registered but NOT current and does
//     not supersede anything (owner ruling required)
//   - only is_current rows may drive downstream (currentDocument)
//   - restricted privacy classes never appear in a general listing

import {
  isAuthorityClass,
  isPrivacyClass,
  RESTRICTED_PRIVACY_CLASSES,
  SHA256_RE,
} from './types';
import type {
  Confidence,
  DocumentRow,
  DocumentType,
} from './types';

export type RegistryRow = Pick<
  DocumentRow,
  | 'id'
  | 'project_id'
  | 'document_type'
  | 'document_subtype'
  | 'sha256'
  | 'version'
  | 'is_current'
  | 'authority_class'
  | 'privacy_class'
  | 'supersedes_document_id'
>;

export type RegisterCandidate = Omit<
  DocumentRow,
  'version' | 'is_current' | 'supersedes_document_id'
> & {
  // classifier confidence; 'low' => never current
  confidence?: Confidence;
};

export interface SupersedeUpdate {
  id: string;
  expect: { is_current: true };
  patch: { is_current: false; authority_class: 'SUPERSEDED' };
}

export type RegisterOutcome =
  | { kind: 'duplicate'; existing_id: string; sha256: string }
  | { kind: 'rejected'; reason: string }
  | {
      kind: 'register';
      version: number;
      insert: DocumentRow;
      updates: SupersedeUpdate[];
    };

export function chainKey(
  projectId: string | null,
  type: DocumentType,
  subtype: string | null | undefined,
): string {
  return `${projectId ?? ''}|${type}|${subtype ?? ''}`;
}

function sameChain(a: RegistryRow, c: RegisterCandidate): boolean {
  return chainKey(a.project_id, a.document_type, a.document_subtype) ===
    chainKey(c.project_id, c.document_type, c.document_subtype);
}

export function registerVersion(
  existing: readonly RegistryRow[],
  candidate: RegisterCandidate,
): RegisterOutcome {
  if (!SHA256_RE.test(candidate.sha256)) {
    return { kind: 'rejected', reason: 'invalid sha256' };
  }
  if (!isAuthorityClass(candidate.authority_class) ||
    candidate.authority_class === 'SUPERSEDED') {
    return { kind: 'rejected', reason: 'invalid authority_class' };
  }
  if (!isPrivacyClass(candidate.privacy_class)) {
    return { kind: 'rejected', reason: 'invalid privacy_class' };
  }
  if (existing.some((r) => r.id === candidate.id)) {
    return { kind: 'rejected', reason: 'candidate id already registered' };
  }
  const dup = existing.find((r) => r.sha256 === candidate.sha256);
  if (dup) {
    return { kind: 'duplicate', existing_id: dup.id, sha256: dup.sha256 };
  }
  const chain = existing.filter((r) => sameChain(r, candidate));
  const currents = chain.filter((r) => r.is_current);
  if (currents.length > 1) {
    return { kind: 'rejected', reason: 'chain has more than one current' };
  }
  const maxVersion = chain.reduce((m, r) => Math.max(m, r.version), 0);
  const version = maxVersion + 1;
  const becomesCurrent = candidate.confidence !== 'low';
  const previous = currents[0];
  const updates: SupersedeUpdate[] = [];
  let supersedes: string | null = null;
  if (becomesCurrent && previous) {
    updates.push({
      id: previous.id,
      expect: { is_current: true },
      patch: { is_current: false, authority_class: 'SUPERSEDED' },
    });
    supersedes = previous.id;
  }
  const base = { ...candidate };
  delete base.confidence;
  const insert: DocumentRow = {
    ...base,
    version,
    is_current: becomesCurrent,
    supersedes_document_id: supersedes,
  };
  return { kind: 'register', version, insert, updates };
}

export function currentDocument<T extends RegistryRow>(
  rows: readonly T[],
  type: DocumentType,
  subtype?: string | null,
): T | null {
  const matches = rows.filter(
    (r) => r.is_current && r.document_type === type &&
      (subtype === undefined || (r.document_subtype ?? null) ===
        (subtype ?? null)),
  );
  if (matches.length !== 1) return null;
  return matches[0];
}

export function versionHistory<T extends RegistryRow>(
  rows: readonly T[],
  type: DocumentType,
  subtype?: string | null,
): T[] {
  return rows
    .filter(
      (r) => r.document_type === type &&
        (subtype === undefined || (r.document_subtype ?? null) ===
          (subtype ?? null)),
    )
    .sort((a, b) => a.version - b.version);
}

export interface RetrievalOptions {
  allowRestricted: boolean;
  includeHistory?: boolean;
}

// General listing: current rows only unless history is explicitly
// requested; RESTRICTED_* only when the caller is allowed; EXCLUDE never.
export function listForRetrieval<T extends RegistryRow>(
  rows: readonly T[],
  opts: RetrievalOptions,
): T[] {
  return rows.filter((r) => {
    if (r.privacy_class === 'EXCLUDE') return false;
    if (!opts.allowRestricted &&
      RESTRICTED_PRIVACY_CLASSES.includes(r.privacy_class)) {
      return false;
    }
    if (!opts.includeHistory && !r.is_current) return false;
    return true;
  });
}
