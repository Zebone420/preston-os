// Static pins for migration 0030 (owner-applied only): Knowledge Fabric
// tables, CHECKs, RLS, no anon grant, no delete grant, restricted seeds.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0030_p1c_knowledge_fabric.sql'), 'utf8');
const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const TABLES = ['knowledge_domains', 'knowledge_sources', 'knowledge_chunks',
  'knowledge_facts', 'knowledge_eval_set'];

const OWNER_OR_RUNTIME = 'public.is_owner() or public.is_runtime_service()';

// Literal SQL fragments joined by any whitespace, regex-escaped.
function re(...parts: string[]): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(parts.map(esc).join('\\s+'));
}

describe('migration 0030 - knowledge fabric', () => {
  it('creates the five tables', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
    }
  });

  it('seeds all twelve domains with restricted and project-scoped flags', () => {
    for (const d of ['ANDERSEN_OFFICIAL', 'LPC_OFFICIAL', 'LPC_PRECEDENT', 'PRESTON_SOP',
      'TEMPLATE_LIBRARY', 'FIELD_OPERATIONS', 'PRICING_POLICY', 'ARCHITECTURE_HISTORY']) {
      expect(sql).toMatch(new RegExp(`\\('${d}', false, false,`));
    }
    expect(sql).toMatch(/\('PROJECT_DOCUMENT', false, true,/);
    for (const d of ['FINANCE_RESTRICTED', 'HR_RESTRICTED', 'INSURANCE_RESTRICTED']) {
      expect(sql).toMatch(new RegExp(`\\('${d}', true, false,`));
    }
    expect(sql).toMatch(/on conflict \(domain\) do nothing/);
  });

  it('sources: registry ref without FK, domain FK, sha256 CHECK, unique (sha256, domain)', () => {
    expect(sql).toMatch(/document_id uuid not null,/);
    expect(sql).not.toMatch(/document_id uuid[^,]*references/);
    expect(sql).toMatch(/domain text not null references public\.knowledge_domains \(domain\)/);
    expect(sql).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).toMatch(re(
      'create unique index if not exists uq_knowledge_sources_sha_domain',
      'on public.knowledge_sources (sha256, domain)',
    ));
    for (const c of ['OFFICIAL_CURRENT', 'OWNER_RULED_CURRENT', 'INTERNAL_APPROVED',
      'PROJECT_RECORD', 'CLIENT_EXECUTED', 'THIRD_PARTY_REFERENCE', 'HISTORICAL',
      'SUPERSEDED']) {
      expect(sql).toContain(`'${c}'`);
    }
    expect(sql).toMatch(/domain <> 'PROJECT_DOCUMENT' or project_id is not null/);
    expect(sql).toMatch(/superseded_by is null or is_current = false/);
  });

  it('chunks: FK to sources, unique (source_id, chunk_index), bounds', () => {
    expect(sql).toMatch(/source_id uuid not null references public\.knowledge_sources \(id\)/);
    expect(sql).toMatch(
      /uq_knowledge_chunks_source_index\s+on public\.knowledge_chunks \(source_id, chunk_index\)/,
    );
    expect(sql).toMatch(/char_end integer not null check \(char_end >= char_start\)/);
    expect(sql).toMatch(/heading_path text\[\] not null default '\{\}'/);
  });

  it('facts: criticality + state CHECKs, citations array, human-gated columns', () => {
    for (const c of ['informational', 'quote_critical', 'order_critical',
      'compliance_critical']) {
      expect(sql).toContain(`'${c}'`);
    }
    for (const s of ['EXTRACTED_CANDIDATE', 'VERIFIED', 'AUTHORIZED_FOR_USE', 'REJECTED',
      'SUPERSEDED']) {
      expect(sql).toContain(`'${s}'`);
    }
    expect(sql).toMatch(/citations jsonb not null,/);
    expect(sql).toMatch(
      /jsonb_typeof\(citations\) = 'array' and jsonb_array_length\(citations\) >= 1/,
    );
    expect(sql).toMatch(
      /state not in \('VERIFIED','AUTHORIZED_FOR_USE'\) or verified_by is not null/,
    );
    expect(sql).toMatch(/state <> 'AUTHORIZED_FOR_USE' or authorized_by is not null/);
    expect(sql).toMatch(/state text not null default 'EXTRACTED_CANDIDATE'/);
  });

  it('eval set: question, expected answer, expected citation ids, curator', () => {
    expect(sql).toMatch(/expected_citation_source_ids uuid\[\] not null default '\{\}'/);
    expect(sql).toMatch(/curated_by text not null/);
  });

  it('RLS on every table; owner + runtime select/insert; owner-only update', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(re(
        `${t}_owner_runtime_sel on public.${t}`,
        'for select to authenticated',
        `using (${OWNER_OR_RUNTIME})`,
      ));
    }
    for (const t of ['knowledge_sources', 'knowledge_chunks', 'knowledge_facts']) {
      expect(sql).toMatch(re(
        `${t}_owner_runtime_ins on public.${t}`,
        'for insert to authenticated',
        `with check (${OWNER_OR_RUNTIME})`,
      ));
    }
    for (const t of ['knowledge_sources', 'knowledge_facts', 'knowledge_eval_set']) {
      expect(sql).toMatch(re(
        `${t}_owner_upd on public.${t}`,
        'for update to authenticated',
        'using (public.is_owner()) with check (public.is_owner())',
      ));
    }
    // The eval set is owner-curated: runtime never inserts it. Chunks are
    // immutable (no update policy) and domains are seed-only.
    expect(sql).toMatch(re(
      'knowledge_eval_set_owner_ins on public.knowledge_eval_set',
      'for insert to authenticated',
      'with check (public.is_owner())',
    ));
    expect(sql).not.toMatch(/knowledge_eval_set_owner_runtime_ins/);
    expect(sql).not.toMatch(/knowledge_chunks_owner_upd|knowledge_domains_owner_ins/);
  });

  it('anon fully revoked, no delete grant, domains read-only', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from anon`));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from authenticated`));
      expect(sql).not.toMatch(new RegExp(`grant[^;]*to anon`, 'i'));
    }
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).toMatch(/grant select on public\.knowledge_domains to authenticated/);
    expect(sql).toMatch(/grant select, insert on public\.knowledge_chunks to authenticated/);
    expect(sql).toMatch(
      /grant select, insert, update on public\.knowledge_sources to authenticated/,
    );
    expect(sql).toMatch(
      /grant select, insert, update on public\.knowledge_facts to authenticated/,
    );
  });

  it('never touches other tables, stays ASCII, lines under 100 chars', () => {
    for (const t of ['documents', 'goal_jobs', 'master_goals', 'quotes', 'artifacts']) {
      expect(sql).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*public\\.${t}\\b`, 'i'));
    }
    expect(sql).not.toMatch(/bytea|vector\(|embedding/i);
    for (const line of raw.split('\n')) {
      expect(line.length, line).toBeLessThan(100);
      expect(/^[\x20-\x7E]*$/.test(line), line).toBe(true);
    }
  });
});
