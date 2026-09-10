// Lane B pins: registry state machine (plan 5.7 versioning rule).

import { describe, expect, it } from 'vitest';

import {
  chainKey,
  currentDocument,
  listForRetrieval,
  registerVersion,
  versionHistory,
} from '../src/lib/business/documents/registry';
import type {
  RegisterCandidate,
  RegistryRow,
} from '../src/lib/business/documents/registry';
import type { DocumentRow } from '../src/lib/business/documents/types';

const PROJECT = '00000000-0000-4000-8000-000000000301';
const hash = (n: number) => n.toString(16).padStart(64, '0');
const uuid = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

function candidate(
  n: number,
  over: Partial<RegisterCandidate> = {},
): RegisterCandidate {
  return {
    id: uuid(n),
    project_id: PROJECT,
    client_id: null,
    property_id: null,
    drive_file_id: `drive-${n}`,
    drive_parent_id: null,
    source_system: 'upload',
    source_message_id: null,
    document_type: 'proposal',
    document_subtype: null,
    original_filename: `proposal-${n}.pdf`,
    canonical_filename: `P26-0041_PROPOSAL_CLIENT_V0${n}.pdf`,
    mime_type: 'application/pdf',
    sha256: hash(n),
    file_size_bytes: 1000 + n,
    authority_class: 'INTERNAL_APPROVED',
    privacy_class: 'CLIENT_CONFIDENTIAL',
    verification_status: 'unverified',
    approved_use: null,
    source_created_at: null,
    source_modified_at: null,
    registered_at: '2026-09-08T00:00:00.000Z',
    registered_by: 'test',
    metadata: {},
    ...over,
  };
}

function apply(rows: DocumentRow[], c: RegisterCandidate): DocumentRow[] {
  const out = registerVersion(rows, c);
  if (out.kind !== 'register') throw new Error(out.kind);
  const next = rows.map((r) => {
    const u = out.updates.find((x) => x.id === r.id);
    return u ? { ...r, ...u.patch } : r;
  });
  return [...next, out.insert];
}

describe('registerVersion', () => {
  it('first version is V1 and current with no supersession', () => {
    const out = registerVersion([], candidate(1));
    expect(out.kind).toBe('register');
    if (out.kind !== 'register') return;
    expect(out.version).toBe(1);
    expect(out.insert.version).toBe(1);
    expect(out.insert.is_current).toBe(true);
    expect(out.insert.supersedes_document_id).toBeNull();
    expect(out.updates).toEqual([]);
    expect('confidence' in out.insert).toBe(false);
  });

  it('V1 -> V2 -> V3: previous current becomes SUPERSEDED, chain links', () => {
    let rows = apply([], candidate(1));
    rows = apply(rows, candidate(2));
    rows = apply(rows, candidate(3));
    const history = versionHistory(rows, 'proposal');
    expect(history.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(history.map((r) => r.is_current)).toEqual([false, false, true]);
    expect(history.map((r) => r.authority_class)).toEqual([
      'SUPERSEDED', 'SUPERSEDED', 'INTERNAL_APPROVED',
    ]);
    expect(history[1].supersedes_document_id).toBe(uuid(1));
    expect(history[2].supersedes_document_id).toBe(uuid(2));
    expect(currentDocument(rows, 'proposal')?.id).toBe(uuid(3));
    // all versions remain available (plan 5.7)
    expect(rows).toHaveLength(3);
  });

  it('supersession updates are CAS-shaped (expect is_current=true)', () => {
    const rows = apply([], candidate(1));
    const out = registerVersion(rows, candidate(2));
    if (out.kind !== 'register') throw new Error('expected register');
    expect(out.updates).toEqual([{
      id: uuid(1),
      expect: { is_current: true },
      patch: { is_current: false, authority_class: 'SUPERSEDED' },
    }]);
  });

  it('identical sha256 is a duplicate: no new version, no updates', () => {
    const rows = apply([], candidate(1));
    const out = registerVersion(rows, candidate(9, { sha256: hash(1) }));
    expect(out).toEqual({
      kind: 'duplicate', existing_id: uuid(1), sha256: hash(1),
    });
    expect(currentDocument(rows, 'proposal')?.id).toBe(uuid(1));
  });

  it('low-confidence candidate registers as non-current, no supersession', () => {
    const rows = apply([], candidate(1));
    const out = registerVersion(rows, candidate(2, { confidence: 'low' }));
    if (out.kind !== 'register') throw new Error('expected register');
    expect(out.version).toBe(2);
    expect(out.insert.is_current).toBe(false);
    expect(out.insert.supersedes_document_id).toBeNull();
    expect(out.updates).toEqual([]);
    const next = [...rows, out.insert];
    expect(currentDocument(next, 'proposal')?.id).toBe(uuid(1));
  });

  it('versions and currency are scoped per (project, type, subtype)', () => {
    let rows = apply([], candidate(1, {
      document_type: 'vendor_quote', document_subtype: 'HOMEDEPOT',
    }));
    rows = apply(rows, candidate(2, {
      document_type: 'vendor_quote', document_subtype: 'ANDERSEN',
    }));
    rows = apply(rows, candidate(3, {
      document_type: 'vendor_quote', document_subtype: 'HOMEDEPOT',
    }));
    expect(rows.map((r) => r.version)).toEqual([1, 1, 2]);
    expect(currentDocument(rows, 'vendor_quote', 'HOMEDEPOT')?.id)
      .toBe(uuid(3));
    expect(currentDocument(rows, 'vendor_quote', 'ANDERSEN')?.id)
      .toBe(uuid(2));
    // ambiguous (two currents across subtypes) => null, never a guess
    expect(currentDocument(rows, 'vendor_quote')).toBeNull();
    expect(chainKey(PROJECT, 'vendor_quote', null))
      .not.toBe(chainKey(PROJECT, 'vendor_quote', 'HOMEDEPOT'));
  });

  it('rejects invalid candidates and inconsistent chains', () => {
    expect(registerVersion([], candidate(1, { sha256: 'abc' })).kind)
      .toBe('rejected');
    expect(registerVersion([], candidate(1, {
      authority_class: 'SUPERSEDED',
    })).kind).toBe('rejected');
    expect(registerVersion([], candidate(1, {
      privacy_class: 'SECRET' as unknown as 'EXCLUDE',
    })).kind).toBe('rejected');
    const rows = apply([], candidate(1));
    expect(registerVersion(rows, candidate(1, { sha256: hash(5) })).kind)
      .toBe('rejected');
    const broken: RegistryRow[] = [
      { ...rows[0] },
      { ...rows[0], id: uuid(7), sha256: hash(7), version: 2 },
    ];
    expect(registerVersion(broken, candidate(8)).kind).toBe('rejected');
  });
});

describe('listForRetrieval - privacy gate', () => {
  const rows: RegistryRow[] = [
    {
      id: uuid(1), project_id: PROJECT, document_type: 'proposal',
      document_subtype: null, sha256: hash(1), version: 2, is_current: true,
      authority_class: 'INTERNAL_APPROVED',
      privacy_class: 'CLIENT_CONFIDENTIAL', supersedes_document_id: null,
    },
    {
      id: uuid(2), project_id: PROJECT, document_type: 'proposal',
      document_subtype: null, sha256: hash(2), version: 1, is_current: false,
      authority_class: 'SUPERSEDED', privacy_class: 'CLIENT_CONFIDENTIAL',
      supersedes_document_id: null,
    },
    {
      id: uuid(3), project_id: PROJECT, document_type: 'payment_receipt',
      document_subtype: null, sha256: hash(3), version: 1, is_current: true,
      authority_class: 'PROJECT_RECORD', privacy_class: 'RESTRICTED_FINANCE',
      supersedes_document_id: null,
    },
    {
      id: uuid(4), project_id: PROJECT, document_type: 'other',
      document_subtype: null, sha256: hash(4), version: 1, is_current: true,
      authority_class: 'HISTORICAL', privacy_class: 'RESTRICTED_HR',
      supersedes_document_id: null,
    },
    {
      id: uuid(5), project_id: PROJECT, document_type: 'other',
      document_subtype: 'tmp', sha256: hash(5), version: 1, is_current: true,
      authority_class: 'HISTORICAL', privacy_class: 'EXCLUDE',
      supersedes_document_id: null,
    },
  ];

  it('default listing: current only, restricted and excluded hidden', () => {
    const ids = listForRetrieval(rows, { allowRestricted: false })
      .map((r) => r.id);
    expect(ids).toEqual([uuid(1)]);
  });

  it('allowRestricted surfaces finance/HR but never EXCLUDE', () => {
    const ids = listForRetrieval(rows, { allowRestricted: true })
      .map((r) => r.id);
    expect(ids).toEqual([uuid(1), uuid(3), uuid(4)]);
  });

  it('history is opt-in only', () => {
    const ids = listForRetrieval(rows, {
      allowRestricted: false, includeHistory: true,
    }).map((r) => r.id);
    expect(ids).toEqual([uuid(1), uuid(2)]);
  });

  it('currentDocument never returns a non-current row', () => {
    expect(currentDocument(rows, 'proposal')?.version).toBe(2);
    expect(currentDocument([rows[1]], 'proposal')).toBeNull();
  });
});
