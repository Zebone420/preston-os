// Phase 1 Lane A - identity persistence adapters (migration 0028).
//
// Same idiom as lib/business/business-store.ts: server-side, RLS-bound
// RuntimeClient, every write validates first and fails closed on any
// error string, reads fail closed to empty results, and there is NO
// row-removal path (the tables grant none). Confirmation of a link and the
// decision on a review item are human acts: the adapters require the
// human's id and the DB policies refuse a runtime actor regardless.

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import { UUID_RE } from '../types';
import {
  isIdentityConfidence,
  type IdentityConfidence,
} from './confidence';
import { EXTERNAL_SYSTEMS, type ExternalSystem, type MatchSignal } from './matcher';
import {
  isReviewEntityType,
  type ReviewDecision,
  type ReviewEntityType,
} from './review-queue';

export const IDENTITY_TABLES = {
  links: 'identity_links',
  aliases: 'contact_aliases',
  reviewQueue: 'identity_review_queue',
  fieldOwnership: 'business_field_ownership',
  sequences: 'project_code_sequences',
} as const;

export const IDENTITY_ENTITY_TYPES: readonly ReviewEntityType[] = [
  'client',
  'contact',
  'property',
  'project',
  'lead',
  'communication',
] as const;

export interface ListOutcome {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

function isUniqueViolation(msg: string): boolean {
  return /duplicate key|unique constraint|already exists/i.test(msg);
}

async function runList(q: PromiseLike<QueryResult>): Promise<ListOutcome> {
  try {
    const res = await q;
    if (res.error) return { ok: false, rows: [], error: res.error.message };
    return { ok: true, rows: res.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
}

async function insertRow(
  client: RuntimeClient,
  table: string,
  row: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    const res = await client.from(table).insert(row).select('id');
    if (res.error) {
      if (isUniqueViolation(res.error.message)) {
        return { ok: true, duplicate: true, id: String(row.id ?? '') };
      }
      return { ok: false, error: `${table} record failed: ` + res.error.message };
    }
    const id = res.data?.[0]?.['id'];
    return { ok: true, id: id ? String(id) : String(row.id ?? '') };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `${table} record failed`,
    };
  }
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

// --- identity links --------------------------------------------------------

export interface IdentityLinkInput {
  entity_type: ReviewEntityType;
  entity_id: string;
  external_system: ExternalSystem;
  external_id: string;
  confidence: IdentityConfidence;
  signal: MatchSignal | string;
  evidence?: unknown[];
  proposed_by: string;
  // Required (and only meaningful) when confidence is 'confirmed'.
  confirmed_by?: string | null;
  confirmed_at?: string | null;
}

export async function insertIdentityLink(
  client: RuntimeClient,
  input: IdentityLinkInput,
): Promise<WriteOutcome> {
  if (!isReviewEntityType(input.entity_type)) {
    return { ok: false, error: 'invalid entity_type' };
  }
  if (!UUID_RE.test(input.entity_id)) {
    return { ok: false, error: 'invalid entity_id' };
  }
  if (!(EXTERNAL_SYSTEMS as readonly string[]).includes(input.external_system)) {
    return { ok: false, error: 'invalid external_system' };
  }
  if (!nonEmpty(input.external_id)) {
    return { ok: false, error: 'external_id required' };
  }
  if (!isIdentityConfidence(input.confidence)) {
    return { ok: false, error: 'invalid confidence' };
  }
  if (!nonEmpty(input.signal)) return { ok: false, error: 'signal required' };
  if (!nonEmpty(input.proposed_by)) {
    return { ok: false, error: 'proposed_by required' };
  }
  const confirmed = input.confidence === 'confirmed';
  if (confirmed && (!nonEmpty(input.confirmed_by) || !nonEmpty(input.confirmed_at))) {
    return {
      ok: false,
      error: 'confirmed link requires confirmed_by and confirmed_at',
    };
  }
  return insertRow(client, IDENTITY_TABLES.links, {
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    external_system: input.external_system,
    external_id: input.external_id,
    confidence: input.confidence,
    signal: input.signal,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    proposed_by: input.proposed_by,
    confirmed_by: confirmed ? input.confirmed_by : null,
    confirmed_at: confirmed ? input.confirmed_at : null,
  });
}

export async function listIdentityLinks(
  client: RuntimeClient,
  entity: { entity_type: ReviewEntityType; entity_id: string },
  limit = 100,
): Promise<ListOutcome> {
  if (!isReviewEntityType(entity.entity_type)) {
    return { ok: false, rows: [], error: 'invalid entity_type' };
  }
  if (!UUID_RE.test(entity.entity_id)) {
    return { ok: false, rows: [], error: 'invalid entity_id' };
  }
  return runList(
    client
      .from(IDENTITY_TABLES.links)
      .select('*')
      .eq('entity_type', entity.entity_type)
      .eq('entity_id', entity.entity_id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 500)),
  );
}

// --- review queue ----------------------------------------------------------

export interface ReviewItemRow {
  subject_type: string;
  subject_id?: string | null;
  candidate_entity_type: ReviewEntityType;
  candidate_entity_id?: string | null;
  reason: string;
  signals?: unknown[];
}

export async function insertReviewItem(
  client: RuntimeClient,
  item: ReviewItemRow,
): Promise<WriteOutcome> {
  if (!nonEmpty(item.subject_type)) {
    return { ok: false, error: 'subject_type required' };
  }
  if (!isReviewEntityType(item.candidate_entity_type)) {
    return { ok: false, error: 'invalid candidate_entity_type' };
  }
  if (
    item.candidate_entity_id !== null &&
    item.candidate_entity_id !== undefined &&
    !UUID_RE.test(item.candidate_entity_id)
  ) {
    return { ok: false, error: 'invalid candidate_entity_id' };
  }
  if (!nonEmpty(item.reason)) return { ok: false, error: 'reason required' };
  return insertRow(client, IDENTITY_TABLES.reviewQueue, {
    subject_type: item.subject_type,
    subject_id: item.subject_id ?? null,
    candidate_entity_type: item.candidate_entity_type,
    candidate_entity_id: item.candidate_entity_id ?? null,
    reason: item.reason,
    signals: Array.isArray(item.signals) ? item.signals : [],
    status: 'open',
    decided_by: null,
    decided_at: null,
  });
}

// Compare-and-set on status='open': a second decision, or a decision
// on an expired item, matches zero rows and is refused.
export async function decideReviewItem(
  client: RuntimeClient,
  itemId: string,
  decision: ReviewDecision,
  decidedBy: string,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(itemId)) return { ok: false, error: 'invalid item id' };
  if (decision !== 'confirmed' && decision !== 'rejected') {
    return { ok: false, error: 'invalid decision' };
  }
  if (!nonEmpty(decidedBy)) return { ok: false, error: 'decided_by required' };
  if (!nonEmpty(nowIso)) return { ok: false, error: 'decided_at required' };
  try {
    const res = await client
      .from(IDENTITY_TABLES.reviewQueue)
      .update({ status: decision, decided_by: decidedBy, decided_at: nowIso })
      .eq('id', itemId)
      .eq('status', 'open')
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) {
      return { ok: false, error: 'not_open' };
    }
    return { ok: true, id: itemId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'review decision failed',
    };
  }
}

export async function listOpenReviewItems(
  client: RuntimeClient,
  limit = 100,
): Promise<ListOutcome> {
  return runList(
    client
      .from(IDENTITY_TABLES.reviewQueue)
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 500)),
  );
}

// --- aliases ---------------------------------------------------------------

export interface AliasInput {
  alias_kind: 'email' | 'phone' | 'address';
  normalized_value: string;
  display_value?: string;
  client_id?: string | null;
  contact_id?: string | null;
  property_id?: string | null;
  project_id?: string | null;
  source?: string;
  // Approval is an owner decision; the DB policy refuses a runtime
  // actor writing approved=true, so default false here.
  approved?: boolean;
}

export async function insertAlias(
  client: RuntimeClient,
  input: AliasInput,
): Promise<WriteOutcome> {
  if (!['email', 'phone', 'address'].includes(input.alias_kind)) {
    return { ok: false, error: 'invalid alias_kind' };
  }
  if (!nonEmpty(input.normalized_value)) {
    return { ok: false, error: 'normalized_value required' };
  }
  const targets = ['client_id', 'contact_id', 'property_id', 'project_id'] as const;
  let anyTarget = false;
  for (const t of targets) {
    const v = input[t];
    if (v === null || v === undefined) continue;
    if (!UUID_RE.test(v)) return { ok: false, error: `invalid ${t}` };
    anyTarget = true;
  }
  if (!anyTarget) return { ok: false, error: 'alias needs a target entity' };
  return insertRow(client, IDENTITY_TABLES.aliases, {
    alias_kind: input.alias_kind,
    normalized_value: input.normalized_value,
    display_value: input.display_value ?? input.normalized_value,
    client_id: input.client_id ?? null,
    contact_id: input.contact_id ?? null,
    property_id: input.property_id ?? null,
    project_id: input.project_id ?? null,
    source: input.source ?? 'manual',
    approved: input.approved === true,
    active: true,
  });
}
