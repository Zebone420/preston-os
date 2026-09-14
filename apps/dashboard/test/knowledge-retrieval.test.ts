// Lexical retrieval pins on a synthetic corpus: citation accuracy,
// explicit 'absent' refusal, current-over-historical precedence, and
// denied domains never appearing in hits.

import { describe, expect, it } from 'vitest';
import {
  currentOverHistorical,
  authorityTier,
  rankKey,
} from '../src/lib/business/knowledge/precedence';
import {
  excerpt,
  search,
  tokenize,
  type Corpus,
  type IndexedChunk,
  type RetrievalSource,
} from '../src/lib/business/knowledge/retrieval';
import type { AuthorityClass } from '../src/lib/business/knowledge/types';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

function src(
  id: string,
  domain: string,
  authority_class: AuthorityClass,
  over: Partial<RetrievalSource> = {},
): RetrievalSource {
  return {
    id, domain, authority_class, project_id: null, is_current: true,
    superseded_by: null, ...over,
  };
}

function chunk(chunk_id: string, source_id: string, text: string,
  heading_path: string[] = [], chunk_index = 0): IndexedChunk {
  return { chunk_id, source_id, chunk_index, text, heading_path };
}

// Synthetic fixture text only. No real vendor content.
const corpus: Corpus = {
  sources: [
    src('sop-current', 'PRESTON_SOP', 'INTERNAL_APPROVED'),
    src('sop-old', 'PRESTON_SOP', 'HISTORICAL'),
    src('sop-superseded', 'PRESTON_SOP', 'SUPERSEDED',
      { is_current: false, superseded_by: 'sop-current' }),
    src('owner-ruling', 'PRESTON_SOP', 'OWNER_RULED_CURRENT'),
    src('field-guide', 'FIELD_OPERATIONS', 'INTERNAL_APPROVED'),
    src('finance-doc', 'FINANCE_RESTRICTED', 'INTERNAL_APPROVED'),
    src('proj-1-doc', 'PROJECT_DOCUMENT', 'PROJECT_RECORD', { project_id: P1 }),
    src('proj-2-doc', 'PROJECT_DOCUMENT', 'PROJECT_RECORD', { project_id: P2 }),
    src('proj-orphan', 'PROJECT_DOCUMENT', 'PROJECT_RECORD', { project_id: null }),
  ],
  chunks: [
    chunk('c-cur', 'sop-current',
      'Sill pan flashing procedure: install the sill pan before the unit is set.',
      ['Flashing']),
    chunk('c-old', 'sop-old',
      'Sill pan flashing procedure sill pan sill pan: the old method taped the sill pan.',
      ['Flashing (2019)']),
    chunk('c-sup', 'sop-superseded',
      'Sill pan flashing sill pan sill pan sill pan superseded text about the sill pan.',
      ['Flashing (2021)']),
    chunk('c-rule', 'owner-ruling',
      'Owner ruling: every sill pan is inspected and photographed before closing.',
      ['Rulings']),
    chunk('c-field', 'field-guide',
      'Ladder safety: tie off the extension ladder at the top and footing.',
      ['Ladders']),
    chunk('c-fin', 'finance-doc',
      'Quarterly ledger summary: the sill pan budget line exceeded forecast.',
      ['Ledger']),
    chunk('c-p1', 'proj-1-doc',
      'Project one survey notes: the parlor floor sill pan needs custom flashing.'),
    chunk('c-p2', 'proj-2-doc',
      'Project two survey notes: the parlor floor sill pan needs custom flashing.'),
    chunk('c-orphan', 'proj-orphan',
      'Orphan project notes about a sill pan with no project attached.'),
    chunk('c-ghost', 'no-such-source',
      'Ghost chunk about sill pan flashing whose source was never registered.'),
  ],
};

const scope = { projectIds: [P1], restrictedDomains: [] as string[] };

describe('tokenize / excerpt', () => {
  it('lowercases, drops stopwords and short tokens, singularizes', () => {
    expect(tokenize('The Sill Pans of the Windows!')).toEqual(['sill', 'pan', 'window']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });
  it('excerpt is bounded and centered on the first matched term', () => {
    const text = 'a '.repeat(200) + 'TARGET word here ' + 'b '.repeat(200);
    const q = excerpt(text, ['target'], 60);
    expect(q.length).toBeLessThanOrEqual(60);
    expect(q.toLowerCase()).toContain('target');
    expect(excerpt('short', ['x'], 60)).toBe('short');
  });
});

describe('search - citations and refusal', () => {
  it('cites the exact chunk and source that hold the answer', () => {
    const r = search(corpus, 'ladder safety tie off', {
      domain: 'FIELD_OPERATIONS', requesterScope: scope,
    });
    expect(r.status).toBe('found');
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]).toMatchObject({
      chunk_id: 'c-field', source_id: 'field-guide', heading_path: ['Ladders'],
    });
    expect(r.hits[0].quote).toContain('tie off');
    expect(r.hits[0].score).toBeGreaterThan(0);
    expect(r.hits[0].matched_terms).toEqual(['ladder', 'safety', 'tie', 'off']);
  });

  it('returns an explicit absent result instead of inventing a hit', () => {
    const r = search(corpus, 'thermal transmittance coefficient', {
      domain: 'FIELD_OPERATIONS', requesterScope: scope,
    });
    expect(r).toEqual({ status: 'absent', reason: 'no_match_above_threshold', hits: [] });
    expect(search(corpus, 'the of and', { domain: 'FIELD_OPERATIONS', requesterScope: scope }))
      .toMatchObject({ status: 'absent', reason: 'empty_query' });
    expect(search(corpus, 'sill pan', { domain: 'LPC_OFFICIAL', requesterScope: scope }))
      .toMatchObject({ status: 'absent', reason: 'no_indexed_sources_in_scope' });
  });

  it('is deterministic and bounded by limit', () => {
    const opts = { domain: 'PRESTON_SOP', requesterScope: scope, limit: 2 };
    const a = search(corpus, 'sill pan flashing', opts);
    const b = search(corpus, 'sill pan flashing', opts);
    expect(a).toEqual(b);
    expect(a.hits.length).toBe(2);
    expect(search(corpus, 'sill pan', { ...opts, limit: 999 }).hits.length)
      .toBeLessThanOrEqual(50);
  });

  it('never returns chunks whose source is unregistered', () => {
    const r = search(corpus, 'ghost chunk sill pan', {
      domain: 'PRESTON_SOP', requesterScope: scope, limit: 50,
    });
    expect(r.hits.map((h) => h.chunk_id)).not.toContain('c-ghost');
  });
});

describe('search - precedence', () => {
  it('owner ruling outranks current, current outranks historical and superseded', () => {
    const r = search(corpus, 'sill pan flashing procedure', {
      domain: 'PRESTON_SOP', requesterScope: scope, limit: 10,
    });
    expect(r.status).toBe('found');
    const order = r.hits.map((h) => h.source_id);
    // The historical and superseded chunks repeat the query terms far more
    // often (higher raw lexical score) yet never outrank the current ones.
    expect(order.indexOf('owner-ruling')).toBeLessThan(order.indexOf('sop-current'));
    expect(order.indexOf('sop-current')).toBeLessThan(order.indexOf('sop-old'));
    expect(order.indexOf('sop-old')).toBeLessThan(order.indexOf('sop-superseded'));
    expect(r.hits.find((h) => h.source_id === 'owner-ruling')?.tier).toBe(3);
    expect(r.hits.find((h) => h.source_id === 'sop-superseded')?.tier).toBe(0);
  });

  it('currentOverHistorical sorts sources by tier, stable within a tier', () => {
    const ordered = currentOverHistorical([
      corpus.sources[2], corpus.sources[1], corpus.sources[0], corpus.sources[3],
    ]);
    expect(ordered.map((s) => s.id)).toEqual([
      'owner-ruling', 'sop-current', 'sop-old', 'sop-superseded',
    ]);
    expect(authorityTier(src('x', 'PRESTON_SOP', 'OFFICIAL_CURRENT', { is_current: false })))
      .toBe(0);
    // A huge lexical score in a lower tier never crosses a tier boundary.
    expect(rankKey(src('h', 'PRESTON_SOP', 'HISTORICAL'), 500))
      .toBeLessThan(rankKey(src('c', 'PRESTON_SOP', 'OFFICIAL_CURRENT'), 0.01));
  });
});

describe('search - access policy comes first', () => {
  it('denied restricted domain: status denied and zero hits', () => {
    const r = search(corpus, 'sill pan budget ledger', {
      domain: 'FINANCE_RESTRICTED', requesterScope: scope,
    });
    expect(r).toEqual({ status: 'denied', reason: 'restricted_domain_not_granted', hits: [] });
    const granted = search(corpus, 'sill pan budget ledger', {
      domain: 'FINANCE_RESTRICTED',
      requesterScope: { projectIds: [], restrictedDomains: ['FINANCE_RESTRICTED'] },
    });
    expect(granted.hits.map((h) => h.chunk_id)).toEqual(['c-fin']);
  });

  it('a domain query never leaks restricted or project chunks', () => {
    const r = search(corpus, 'sill pan', {
      domain: 'PRESTON_SOP', requesterScope: scope, limit: 50,
    });
    const ids = r.hits.map((h) => h.chunk_id);
    expect(ids).not.toContain('c-fin');
    expect(ids).not.toContain('c-p1');
    expect(ids).not.toContain('c-p2');
    expect(ids).not.toContain('c-orphan');
  });

  it('global unscoped query is refused', () => {
    expect(search(corpus, 'sill pan', { requesterScope: scope }))
      .toEqual({ status: 'denied', reason: 'global_unscoped_query_refused', hits: [] });
  });

  it('project scope returns only that project, never another or an orphan', () => {
    const r = search(corpus, 'parlor floor sill pan survey', {
      projectId: P1, requesterScope: scope, limit: 50,
    });
    expect(r.status).toBe('found');
    expect(r.hits.map((h) => h.chunk_id)).toEqual(['c-p1']);
    expect(search(corpus, 'parlor floor', { projectId: P2, requesterScope: scope }).status)
      .toBe('denied');
    expect(search(corpus, 'parlor floor', {
      domain: 'PROJECT_DOCUMENT', requesterScope: scope,
    })).toMatchObject({ status: 'denied', reason: 'project_scope_required' });
  });
});
