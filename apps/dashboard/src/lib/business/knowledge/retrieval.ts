// Deterministic lexical retrieval with citations (BM25-lite).
//
// No vector index, no vendor, no network. The access policy runs FIRST and
// a denied query returns no hits at all. When nothing scores above the
// threshold the result is an explicit 'absent' - the mandated
// "not found in the indexed documents" fallback - never a fabricated
// answer. Precedence (current over historical, owner rulings over
// document text) is applied as a tier override on the ranking.

import { accessPolicy, type RequesterScope } from './domains';
import { authorityTier, authorityWeight, rankKey } from './precedence';
import type { KnowledgeSource } from './types';

export interface IndexedChunk {
  chunk_id: string;
  source_id: string;
  chunk_index: number;
  text: string;
  heading_path: string[];
}

export type RetrievalSource = Pick<
  KnowledgeSource,
  'id' | 'domain' | 'project_id' | 'authority_class' | 'is_current' | 'superseded_by'
>;

export interface Corpus {
  sources: readonly RetrievalSource[];
  chunks: readonly IndexedChunk[];
}

export interface SearchOptions {
  domain?: string | null;
  projectId?: string | null;
  requesterScope: RequesterScope;
  limit?: number;
  minScore?: number;
}

export interface Hit {
  chunk_id: string;
  source_id: string;
  score: number;
  tier: number;
  quote: string;
  heading_path: string[];
  matched_terms: string[];
}

export type SearchStatus = 'found' | 'absent' | 'denied';

export interface SearchResult {
  status: SearchStatus;
  reason: string;
  hits: Hit[];
}

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 50;
export const DEFAULT_MIN_SCORE = 0.4;
export const QUOTE_MAX_CHARS = 300;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'was', 'were', 'will', 'with', 'what', 'which', 'who', 'how', 'does',
  'do', 'can', 'may',
]);

export function tokenize(text: string): string[] {
  if (typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

const K1 = 1.2;
const B = 0.75;

interface Scored {
  chunk: IndexedChunk;
  source: RetrievalSource;
  raw: number;
  matched: string[];
}

function bm25(candidates: { chunk: IndexedChunk; source: RetrievalSource }[],
  queryTerms: string[]): Scored[] {
  const docs = candidates.map((c) => tokenize(c.chunk.text));
  const n = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(n, 1);
  const uniqueTerms = Array.from(new Set(queryTerms));
  const df = new Map<string, number>();
  for (const t of uniqueTerms) {
    df.set(t, docs.filter((d) => d.includes(t)).length);
  }
  return candidates.map((c, i) => {
    const d = docs[i];
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let raw = 0;
    const matched: string[] = [];
    for (const t of uniqueTerms) {
      const f = tf.get(t) ?? 0;
      if (f === 0) continue;
      matched.push(t);
      // Smoothed idf: a term present in every candidate still counts
      // (ln 2 floor) so small corpora do not go 'absent' on their own
      // vocabulary; rarer terms count more.
      const idf = Math.log(1 + n / Math.max(df.get(t) ?? 0, 1));
      const denom = f + K1 * (1 - B + (B * d.length) / Math.max(avgLen, 1));
      raw += idf * ((f * (K1 + 1)) / denom);
    }
    return { chunk: c.chunk, source: c.source, raw, matched };
  });
}

// Bounded excerpt around the first matched term; whitespace collapsed.
export function excerpt(text: string, matched: string[], max = QUOTE_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of matched) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, max);
  const half = Math.floor(max / 2);
  let start = Math.max(0, at - half);
  if (start + max > flat.length) start = Math.max(0, flat.length - max);
  return flat.slice(start, start + max);
}

export function search(corpus: Corpus, query: string, opts: SearchOptions): SearchResult {
  const decision = accessPolicy({
    domain: opts.domain ?? null,
    projectId: opts.projectId ?? null,
    requesterScope: opts.requesterScope,
  });
  if (!decision.allow) return { status: 'denied', reason: decision.reason, hits: [] };

  const allowedDomains = new Set<string>(decision.domains);
  const projectId = opts.projectId ?? null;
  const sourceById = new Map<string, RetrievalSource>();
  for (const s of corpus.sources) sourceById.set(s.id, s);

  const candidates: { chunk: IndexedChunk; source: RetrievalSource }[] = [];
  for (const chunk of corpus.chunks) {
    const source = sourceById.get(chunk.source_id);
    if (!source) continue; // orphan chunk: never retrievable
    if (!allowedDomains.has(source.domain)) continue;
    if (source.project_id !== null && source.project_id !== undefined) {
      if (source.project_id !== projectId) continue;
    } else if (source.domain === 'PROJECT_DOCUMENT') {
      continue; // project document without a project: never retrievable
    }
    candidates.push({ chunk, source });
  }

  const terms = tokenize(query);
  if (terms.length === 0) return { status: 'absent', reason: 'empty_query', hits: [] };
  if (candidates.length === 0) {
    return { status: 'absent', reason: 'no_indexed_sources_in_scope', hits: [] };
  }

  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const scored = bm25(candidates, terms)
    .filter((s) => s.matched.length > 0 && s.raw >= minScore)
    .map((s) => ({ ...s, key: rankKey(s.source, s.raw) }))
    .sort((a, b) => {
      if (b.key !== a.key) return b.key - a.key;
      if (a.chunk.source_id !== b.chunk.source_id) {
        return a.chunk.source_id < b.chunk.source_id ? -1 : 1;
      }
      return a.chunk.chunk_index - b.chunk.chunk_index;
    })
    .slice(0, limit);

  if (scored.length === 0) {
    return { status: 'absent', reason: 'no_match_above_threshold', hits: [] };
  }
  const hits: Hit[] = scored.map((s) => ({
    chunk_id: s.chunk.chunk_id,
    source_id: s.chunk.source_id,
    score: Number((s.raw * authorityWeight(s.source)).toFixed(6)),
    tier: authorityTier(s.source),
    quote: excerpt(s.chunk.text, s.matched),
    heading_path: [...s.chunk.heading_path],
    matched_terms: s.matched,
  }));
  return { status: 'found', reason: 'ok', hits };
}
