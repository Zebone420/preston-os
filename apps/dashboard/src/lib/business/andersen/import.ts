// Phase 4 - Andersen catalog import from knowledge facts. PURE.
//
// Maps knowledge_facts rows (subject / predicate / object shape, Lane C
// knowledge fabric) into andersen_catalog rows. The fact type is a
// structural mirror (no import across lanes). Rules:
//   - facts without at least one complete citation are REFUSED;
//   - only domain 'andersen' facts are accepted;
//   - AUTHORIZED_FOR_USE -> 'authorized', VERIFIED -> 'verified',
//     EXTRACTED_CANDIDATE -> 'candidate'; anything else is refused;
//   - a non-candidate row must carry the fact id (uuid) as provenance.
// Subject format: andersen.series.<series>.unit.<unit_type>
// Predicate: constraint kind. Object: the value ('*' for dimensions).
// value_json: { attribute, ...constraint_value }.

import { UUID_RE } from '../types';
import {
  isConstraintKind,
  type CatalogRow,
  type CatalogState,
  type ConstraintKind,
} from './catalog';

export interface FactCitationLike {
  source_id?: unknown;
  chunk_id?: unknown;
  quote?: unknown;
}

export interface KnowledgeFactLike {
  id?: string | null;
  domain: string;
  subject: string;
  predicate: string;
  object: string;
  value_json?: Record<string, unknown>;
  state: string;
  citations: unknown;
}

export interface ImportRefusal {
  index: number;
  fact_id: string | null;
  reason: string;
}

export interface ImportResult {
  rows: CatalogRow[];
  refused: ImportRefusal[];
}

export const SUBJECT_RE = /^andersen\.series\.([A-Za-z0-9]+)\.unit\.([a-z_]+)$/;

const STATE_MAP: Readonly<Record<string, CatalogState>> = Object.freeze({
  AUTHORIZED_FOR_USE: 'authorized',
  VERIFIED: 'verified',
  EXTRACTED_CANDIDATE: 'candidate',
});

function completeCitation(c: unknown): c is Required<FactCitationLike> {
  if (!c || typeof c !== 'object') return false;
  const x = c as FactCitationLike;
  return (
    typeof x.source_id === 'string' && x.source_id.trim() !== '' &&
    typeof x.chunk_id === 'string' && x.chunk_id.trim() !== '' &&
    typeof x.quote === 'string' && x.quote.trim() !== ''
  );
}

const DIMENSION_KINDS: readonly ConstraintKind[] = ['size_min', 'size_max'];

export function buildCatalogRowsFromFacts(
  facts: KnowledgeFactLike[],
): ImportResult {
  const rows: CatalogRow[] = [];
  const refused: ImportRefusal[] = [];
  const seen = new Set<string>();
  facts.forEach((f, index) => {
    const factId = typeof f.id === 'string' ? f.id : null;
    const refuse = (reason: string) => refused.push({ index, fact_id: factId, reason });
    if (f.domain !== 'andersen') return refuse('domain_not_andersen');
    const state = STATE_MAP[f.state];
    if (!state) return refuse('fact_state_not_importable');
    const cites = Array.isArray(f.citations) ? f.citations : [];
    if (cites.length === 0 || !cites.every(completeCitation)) {
      return refuse('citation_missing');
    }
    if (state !== 'candidate' && (!factId || !UUID_RE.test(factId))) {
      return refuse('fact_id_required_for_trusted_row');
    }
    if (factId && !UUID_RE.test(factId)) return refuse('fact_id_invalid');
    const m = SUBJECT_RE.exec(f.subject);
    if (!m) return refuse('subject_format_invalid');
    if (!isConstraintKind(f.predicate)) return refuse('predicate_not_constraint_kind');
    const kind = f.predicate;
    const vj = f.value_json ?? {};
    const attribute = typeof vj.attribute === 'string' ? vj.attribute : null;
    if (!attribute) return refuse('attribute_missing');
    const value = typeof f.object === 'string' ? f.object.trim() : '';
    if (!value) return refuse('object_missing');
    if (DIMENSION_KINDS.includes(kind)) {
      const bound = kind === 'size_min' ? vj.min : vj.max;
      if (typeof bound !== 'number' || !Number.isFinite(bound) || bound <= 0) {
        return refuse('dimension_bound_invalid');
      }
    }
    const { attribute: _attr, ...constraintValue } = vj;
    void _attr;
    const key = [m[1], m[2], attribute, value, kind].join('|');
    if (seen.has(key)) return refuse('duplicate_key');
    seen.add(key);
    const first = cites[0] as Required<FactCitationLike>;
    rows.push({
      series: m[1],
      unit_type: m[2],
      attribute,
      value,
      constraint_kind: kind,
      constraint_value: constraintValue,
      fact_id: factId,
      source_citation: {
        source_id: first.source_id as string,
        chunk_id: first.chunk_id as string,
        quote: first.quote as string,
        citation_count: cites.length,
      },
      state,
    });
  });
  return { rows, refused };
}
