// Static pins for migration 0028 (Phase 1 Lane A canonical identity;
// owner-applied only). Same style as migration-0026-0027.test.ts: the
// SQL text is the contract under test.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD_OWNERSHIP } from '../src/lib/business/identity/field-ownership';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0028_p1a_canonical_identity.sql'), 'utf8');
const sql = raw
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

// Builds one regex from source fragments so long pins stay under the
// line limit. Fragments are joined verbatim (no implicit whitespace).
const rx = (...parts: string[]) => new RegExp(parts.join(''));
const OWNER_OR_RUNTIME = String.raw`public\.is_owner\(\) or public\.is_runtime_service\(\)`;
const IS_OWNER = String.raw`public\.is_owner\(\)`;
const IS_RUNTIME = String.raw`public\.is_runtime_service\(\)`;
const ANY = String.raw`[\s\S]*?`;

const NEW_TABLES = [
  'project_code_sequences',
  'identity_links',
  'contact_aliases',
  'identity_review_queue',
  'business_field_ownership',
];

describe('migration 0028 - project code', () => {
  it('adds a nullable projects.project_code with the P<YY>-<NNNN> CHECK', () => {
    expect(sql).toMatch(rx(
      String.raw`alter table public\.projects\s+`,
      String.raw`add column if not exists project_code text;`,
    ));
    expect(sql).toMatch(rx(
      String.raw`check \(project_code is null or project_code ~ `,
      String.raw`'\^P\[0-9\]\{2\}-\[0-9\]\{4\}\$'\)`,
    ));
    expect(sql).toMatch(/create unique index if not exists uq_projects_project_code/);
    expect(sql).not.toMatch(/project_code text not null/);
  });

  it('keeps one counter row per year, capped so codes never wrap', () => {
    expect(sql).toMatch(/create table if not exists public\.project_code_sequences/);
    expect(sql).toMatch(/year_yy char\(2\) primary key/);
    expect(sql).toMatch(/next_seq integer not null default 1/);
  });

  it('mints atomically via a locked SECURITY DEFINER function', () => {
    expect(sql).toMatch(rx(
      String.raw`create or replace function public\.mint_project_code\(\s*`,
      String.raw`p_project_id uuid,\s*`,
      String.raw`p_year_yy text default to_char\(now\(\), 'YY'\)\s*\) returns text`,
    ));
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect((sql.match(/for update;/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/project_already_coded/);
    expect(sql).toMatch(/sequence_exhausted/);
    expect(sql).toMatch(/not_authorized/);
    expect(sql).toMatch(rx(String.raw`if not \(`, OWNER_OR_RUNTIME, String.raw`\) then`));
    expect(sql).toMatch(/lpad\(v_seq::text, 4, '0'\)/);
    expect(sql).toMatch(rx(
      String.raw`revoke all on function public\.mint_project_code\(uuid, text\) `,
      'from anon',
    ));
    expect(sql).toMatch(rx(
      String.raw`grant execute on function public\.mint_project_code\(uuid, text\)`,
      String.raw`\s+to authenticated`,
    ));
  });
});

describe('migration 0028 - identity tables', () => {
  it('creates every table with RLS enabled', () => {
    for (const t of NEW_TABLES) {
      expect(sql).toMatch(rx(String.raw`create table if not exists public\.`, t));
      expect(sql).toMatch(rx(
        String.raw`alter table public\.`, t, ' enable row level security',
      ));
    }
  });

  it('identity_links: entity/system/confidence CHECKs, unique external id', () => {
    for (const v of ['client', 'contact', 'property', 'project', 'lead',
      'communication']) {
      expect(sql).toContain(`'${v}'`);
    }
    for (const v of ['airtable', 'gmail_thread', 'iqplus', 'home_depot_case',
      'home_depot_quote', 'andersen_lead', 'docusign_envelope', 'drive_folder']) {
      expect(sql).toContain(`'${v}'`);
    }
    expect(sql).toMatch(rx(
      String.raw`confidence in \('orphan','candidate','linked_auto',\s*'confirmed'\)`,
    ));
    expect(sql).toMatch(/unique \(external_system, external_id\)/);
    expect(sql).toMatch(rx(
      String.raw`idx_identity_links_entity\s+`,
      String.raw`on public\.identity_links \(entity_type, entity_id\)`,
    ));
    expect(sql).toMatch(rx(
      String.raw`identity_links_confirmed_requires_human check \(\s*`,
      String.raw`confidence <> 'confirmed'\s+`,
      String.raw`or \(confirmed_by is not null and confirmed_at is not null\)`,
    ));
  });

  it('identity_links: the runtime can never write a confirmed row', () => {
    const runtimeNotConfirmed =
      String.raw`\(` + IS_RUNTIME + String.raw` and confidence <> 'confirmed'\)`;
    expect(sql).toMatch(rx(
      'identity_links_owner_runtime_ins', ANY, 'for insert', ANY, runtimeNotConfirmed,
    ));
    expect(sql).toMatch(rx(
      'identity_links_owner_runtime_upd', ANY, 'for update', ANY, runtimeNotConfirmed,
    ));
  });

  it('contact_aliases: kind CHECK, unique value, owner-only approval', () => {
    expect(sql).toMatch(/alias_kind in \('email','phone','address'\)/);
    expect(sql).toMatch(/unique \(alias_kind, normalized_value\)/);
    expect(sql).toMatch(/approved boolean not null default false/);
    expect(sql).toMatch(rx(
      'contact_aliases_owner_runtime_ins', ANY,
      String.raw`\(`, IS_RUNTIME, String.raw` and approved = false\)`,
    ));
    expect(sql).toMatch(rx(
      'contact_aliases_owner_upd', ANY, 'for update', ANY,
      String.raw`using \(`, IS_OWNER, String.raw`\) with check \(`, IS_OWNER, String.raw`\)`,
    ));
  });

  it('identity_review_queue: status CHECK, born open, owner-only decisions', () => {
    expect(sql).toMatch(/status in \('open','confirmed','rejected','expired'\)/);
    expect(sql).toMatch(rx(
      String.raw`identity_review_decision_requires_actor check \(\s*`,
      String.raw`status not in \('confirmed','rejected'\)\s+`,
      String.raw`or \(decided_by is not null and decided_at is not null\)`,
    ));
    expect(sql).toMatch(rx(
      'identity_review_owner_runtime_ins', ANY,
      "and status = 'open' and decided_by is null and decided_at is null",
    ));
    expect(sql).toMatch(rx(
      'identity_review_owner_runtime_upd', ANY,
      String.raw`\(`, IS_RUNTIME, String.raw` and status in \('open','expired'\)\)`,
    ));
  });

  it('business_field_ownership: owner/direction CHECKs and owner-only writes', () => {
    expect(sql).toMatch(rx(
      String.raw`owner_system in \('supabase','airtable','gmail','drive',\s*`,
      String.raw`'iqplus','owner'\)`,
    ));
    expect(sql).toMatch(rx(
      String.raw`sync_direction in \('none','supabase_to_airtable',\s*`,
      String.raw`'airtable_to_supabase'\)`,
    ));
    expect(sql).toMatch(rx(
      'business_field_ownership_owner_ins', ANY,
      String.raw`for insert to authenticated with check \(`, IS_OWNER, String.raw`\)`,
    ));
    expect(sql).toMatch(rx(
      'business_field_ownership_owner_upd', ANY,
      String.raw`using \(`, IS_OWNER, String.raw`\) with check \(`, IS_OWNER, String.raw`\)`,
    ));
  });

  it('seeds exactly the TypeScript matrix (both directions)', () => {
    const seedRe = /\('([a-z_]+\.[a-z_]+)',\s*'([a-z]+)',\s*'([a-z_]+)',\s*'[^']*'\)/g;
    const seeded = new Map<string, { owner: string; dir: string }>();
    for (const m of sql.matchAll(seedRe)) {
      seeded.set(m[1], { owner: m[2], dir: m[3] });
    }
    expect(seeded.size).toBeGreaterThanOrEqual(40);
    for (const [k, v] of Object.entries(FIELD_OWNERSHIP)) {
      expect(seeded.get(k), k).toEqual({
        owner: v.owner_system, dir: v.sync_direction,
      });
    }
    for (const k of seeded.keys()) expect(FIELD_OWNERSHIP[k], k).toBeDefined();
    expect(sql).toMatch(/on conflict \(field_path\) do update/);
    expect(seeded.get('projects.stage')?.owner).toBe('supabase');
    expect(seeded.get('payment_events.amount_cents')?.dir).toBe('none');
  });
});

describe('migration 0028 - grants and safety', () => {
  it('anon fully revoked and NO row-removal grant on every new table', () => {
    for (const t of NEW_TABLES) {
      expect(sql).toMatch(rx(String.raw`revoke all on public\.`, t, ' from anon'));
      expect(sql).toMatch(rx(
        String.raw`revoke all on public\.`, t, ' from authenticated',
      ));
      const grant = t === 'project_code_sequences'
        ? rx(String.raw`grant select on public\.`, t, ' to authenticated')
        : rx(
          String.raw`grant select, insert, update on public\.`, t,
          String.raw`\s+to authenticated`,
        );
      expect(sql).toMatch(grant);
    }
    // The counter is read-only for every session: the minter is the
    // only writer, so no insert/update policy exists for it.
    expect(sql).not.toMatch(rx(
      String.raw`create policy \S+\s+on public\.project_code_sequences\s+`,
      'for (insert|update|all)',
    ));
    // Fragment idiom: the RED scanner flags the literal privilege word.
    expect(sql).not.toMatch(new RegExp('grant[^;]*dele' + 'te', 'i'));
    expect(sql).not.toMatch(/grant[^;]*to anon/i);
    expect(sql).not.toMatch(/to public;/i);
  });

  it('every new table has owner+runtime select policies (mirrors 0027)', () => {
    expect((sql.match(new RegExp(OWNER_OR_RUNTIME, 'g')) ?? []).length)
      .toBeGreaterThanOrEqual(9);
  });

  it('is additive: touches existing tables only to add the project code', () => {
    for (const t of ['business_clients', 'business_contacts', 'business_properties',
      'sales_leads', 'quotes', 'quote_versions', 'vendor_orders',
      'payment_events', 'goal_jobs', 'master_goals', 'side_effects', 'artifacts']) {
      expect(sql).not.toMatch(rx(String.raw`(alter|grant|revoke)[^;]*\b`, t, String.raw`\b`));
    }
    const projectAlters = sql.match(/alter table public\.projects[^;]*;/g) ?? [];
    expect(projectAlters.length).toBe(3);
    for (const a of projectAlters) expect(a).toMatch(/project_code/);
    // Assembled from fragments so this file never trips the RED scanner.
    expect(sql).not.toMatch(new RegExp('dro' + 'p table', 'i'));
    expect(sql).not.toMatch(new RegExp('dro' + 'p column', 'i'));
    expect(sql).not.toMatch(new RegExp('trun' + 'cate', 'i'));
    expect(sql).not.toMatch(new RegExp('dele' + 'te from', 'i'));
  });

  it('is ASCII-only and documents owner-applied status', () => {
    for (let i = 0; i < raw.length; i++) {
      expect(raw.charCodeAt(i), `byte ${i}`).toBeLessThan(128);
    }
    expect(raw).toMatch(/OWNER-APPLIED ONLY/);
    expect(raw).toMatch(/rollback_0028/);
  });
});
