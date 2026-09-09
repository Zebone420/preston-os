// Knowledge Fabric - Supabase adapters (Phase 1 Lane C).
//
// Same idiom as business-store.ts: server-side, RLS-bound client,
// service-role key NEVER used, every write validates first, reads fail
// closed to empty results with an error string. No delete path exists.
// transitionFact is compare-and-set on state and refuses non-human
// actors for VERIFIED / AUTHORIZED_FOR_USE / REJECTED.

import type {
  QueryResult,
  RuntimeClient,
  WriteOutcome,
} from '../../ai-os/store';
import { UUID_RE } from '../types';
import { isKnowledgeDomain, isProjectScopedDomain } from './domains';
import {
  canTransition,
  validateFact,
  type Actor,
  type FactState,
  type KnowledgeFact,
} from './facts';
import {
  isAuthorityClass,
  ISO_DATE_RE,
  SHA256_RE,
  type KnowledgeChunk,
  type KnowledgeSource,
} from './types';

export const KNOWLEDGE_TABLES = {
  domains: 'knowledge_domains',
  sources: 'knowledge_sources',
  chunks: 'knowledge_chunks',
  facts: 'knowledge_facts',
  evalSet: 'knowledge_eval_set',
} as const;

export const CHUNK_BATCH_MAX = 500;
const LIST_LIMIT = 500;

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

// --- sources ---------------------------------------------------------------

export type SourceInput = Omit<KnowledgeSource, 'id' | 'registered_at'> & {
  id?: string;
};

export function validateSourceInput(s: SourceInput): string[] {
  const errors: string[] = [];
  if (!s || typeof s !== 'object') return ['source_missing'];
  if (s.id !== undefined && !UUID_RE.test(s.id)) errors.push('invalid_id');
  if (!UUID_RE.test(String(s.document_id))) errors.push('invalid_document_id');
  if (s.project_id !== null && s.project_id !== undefined) {
    if (!UUID_RE.test(s.project_id)) errors.push('invalid_project_id');
  }
  if (!isKnowledgeDomain(s.domain)) errors.push('unknown_domain');
  else if (isProjectScopedDomain(s.domain) && !s.project_id) {
    errors.push('project_id_required_for_project_document');
  }
  if (typeof s.title !== 'string' || s.title.trim() === '') errors.push('title_required');
  if (!isAuthorityClass(s.authority_class)) errors.push('invalid_authority_class');
  if (!SHA256_RE.test(String(s.sha256))) errors.push('invalid_sha256');
  if (s.effective_from !== null && s.effective_from !== undefined) {
    if (!ISO_DATE_RE.test(s.effective_from)) errors.push('invalid_effective_from');
  }
  if (s.superseded_by !== null && s.superseded_by !== undefined) {
    if (!UUID_RE.test(s.superseded_by)) errors.push('invalid_superseded_by');
    if (s.is_current !== false) errors.push('superseded_source_cannot_be_current');
  }
  if (typeof s.is_current !== 'boolean') errors.push('is_current_required');
  if (typeof s.registered_by !== 'string' || s.registered_by === '') {
    errors.push('registered_by_required');
  }
  if (s.metadata !== undefined && (s.metadata === null || typeof s.metadata !== 'object')) {
    errors.push('invalid_metadata');
  }
  return errors;
}

export async function insertSource(
  client: RuntimeClient,
  source: SourceInput,
): Promise<WriteOutcome> {
  const errors = validateSourceInput(source);
  if (errors.length > 0) return { ok: false, error: 'invalid source: ' + errors.join(',') };
  const row: Record<string, unknown> = {
    document_id: source.document_id,
    project_id: source.project_id ?? null,
    domain: source.domain,
    title: source.title.trim(),
    authority_class: source.authority_class,
    source_version: source.source_version ?? '',
    sha256: source.sha256,
    effective_from: source.effective_from ?? null,
    superseded_by: source.superseded_by ?? null,
    is_current: source.is_current,
    registered_by: source.registered_by,
    metadata: source.metadata ?? {},
  };
  if (source.id) row.id = source.id;
  return insertRow(client, KNOWLEDGE_TABLES.sources, row);
}

export async function listCurrentSources(
  client: RuntimeClient,
  domain: string,
): Promise<ListOutcome> {
  if (!isKnowledgeDomain(domain)) return { ok: false, rows: [], error: 'unknown_domain' };
  return runList(
    client
      .from(KNOWLEDGE_TABLES.sources)
      .select('*')
      .eq('domain', domain)
      .eq('is_current', 'true')
      .order('registered_at', { ascending: false })
      .limit(LIST_LIMIT),
  );
}

// --- chunks ----------------------------------------------------------------

export interface BatchOutcome {
  ok: boolean;
  inserted: number;
  duplicates: number;
  error?: string;
}

function validateChunk(c: KnowledgeChunk): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(c.chunk_index) || c.chunk_index < 0) errors.push('bad_index');
  if (typeof c.text !== 'string' || c.text === '') errors.push('empty_text');
  if (!Number.isInteger(c.char_start) || c.char_start < 0) errors.push('bad_char_start');
  if (!Number.isInteger(c.char_end) || c.char_end < c.char_start) errors.push('bad_char_end');
  if (!Number.isInteger(c.token_estimate) || c.token_estimate < 0) errors.push('bad_tokens');
  if (!SHA256_RE.test(String(c.sha256))) errors.push('invalid_sha256');
  if (!Array.isArray(c.heading_path) || !c.heading_path.every((h) => typeof h === 'string')) {
    errors.push('bad_heading_path');
  }
  return errors;
}

// Bounded batch insert (<= 500 rows). Validates the whole batch before
// writing anything; stops at the first failed row and reports the count.
export async function insertChunks(
  client: RuntimeClient,
  sourceId: string,
  chunks: readonly KnowledgeChunk[],
): Promise<BatchOutcome> {
  if (!UUID_RE.test(sourceId)) {
    return { ok: false, inserted: 0, duplicates: 0, error: 'invalid source id' };
  }
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { ok: false, inserted: 0, duplicates: 0, error: 'no chunks' };
  }
  if (chunks.length > CHUNK_BATCH_MAX) {
    return { ok: false, inserted: 0, duplicates: 0, error: 'batch exceeds 500' };
  }
  const seen = new Set<number>();
  for (const c of chunks) {
    const errors = validateChunk(c);
    if (seen.has(c.chunk_index)) errors.push('duplicate_index');
    seen.add(c.chunk_index);
    if (errors.length > 0) {
      return {
        ok: false,
        inserted: 0,
        duplicates: 0,
        error: `invalid chunk ${c.chunk_index}: ` + errors.join(','),
      };
    }
  }
  let inserted = 0;
  let duplicates = 0;
  for (const c of chunks) {
    const res = await insertRow(client, KNOWLEDGE_TABLES.chunks, {
      source_id: sourceId,
      chunk_index: c.chunk_index,
      text: c.text,
      char_start: c.char_start,
      char_end: c.char_end,
      token_estimate: c.token_estimate,
      sha256: c.sha256,
      heading_path: c.heading_path,
    });
    if (!res.ok) return { ok: false, inserted, duplicates, error: res.error };
    if (res.duplicate) duplicates += 1;
    else inserted += 1;
  }
  return { ok: true, inserted, duplicates };
}

export async function listChunks(
  client: RuntimeClient,
  sourceId: string,
): Promise<ListOutcome> {
  if (!UUID_RE.test(sourceId)) return { ok: false, rows: [], error: 'invalid source id' };
  return runList(
    client
      .from(KNOWLEDGE_TABLES.chunks)
      .select('*')
      .eq('source_id', sourceId)
      .order('chunk_index', { ascending: true })
      .limit(LIST_LIMIT),
  );
}

// --- facts -----------------------------------------------------------------

// Facts enter ONLY as candidates. Verification and authorization happen
// through transitionFact with a human actor.
export async function insertFact(
  client: RuntimeClient,
  fact: KnowledgeFact,
): Promise<WriteOutcome> {
  const v = validateFact(fact);
  if (!v.ok) return { ok: false, error: 'invalid fact: ' + v.errors.join(',') };
  if (fact.state !== 'EXTRACTED_CANDIDATE') {
    return { ok: false, error: 'facts are inserted as EXTRACTED_CANDIDATE only' };
  }
  if (fact.project_id && !UUID_RE.test(fact.project_id)) {
    return { ok: false, error: 'invalid project id' };
  }
  const row: Record<string, unknown> = {
    domain: fact.domain,
    project_id: fact.project_id ?? null,
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    value_json: fact.value_json ?? {},
    criticality: fact.criticality,
    state: 'EXTRACTED_CANDIDATE',
    citations: fact.citations,
    extracted_by: fact.extracted_by,
    supersedes_fact_id: fact.supersedes_fact_id ?? null,
  };
  if (fact.id) {
    if (!UUID_RE.test(fact.id)) return { ok: false, error: 'invalid fact id' };
    row.id = fact.id;
  }
  return insertRow(client, KNOWLEDGE_TABLES.facts, row);
}

// Compare-and-set state move. Zero matched rows = the fact is no longer
// in the state the actor saw (or does not exist) - the caller re-reads.
export async function transitionFact(
  client: RuntimeClient,
  factId: string,
  fromState: FactState,
  toState: FactState,
  actor: Actor,
  nowIso: string,
): Promise<WriteOutcome> {
  if (!UUID_RE.test(factId)) return { ok: false, error: 'invalid fact id' };
  const check = canTransition(fromState, toState, actor);
  if (!check.ok) return { ok: false, error: check.reason };
  const patch: Record<string, unknown> = { state: toState, updated_at: nowIso };
  if (toState === 'VERIFIED') {
    patch.verified_by = actor.id;
    patch.verified_at = nowIso;
  }
  if (toState === 'AUTHORIZED_FOR_USE') {
    patch.authorized_by = actor.id;
    patch.authorized_at = nowIso;
  }
  try {
    const res = await client
      .from(KNOWLEDGE_TABLES.facts)
      .update(patch)
      .eq('id', factId)
      .eq('state', fromState)
      .select('id');
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data || res.data.length === 0) return { ok: false, error: 'state_conflict' };
    return { ok: true, id: factId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'fact transition failed',
    };
  }
}
