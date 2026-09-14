// Static pins for migration 0029 (Lane B document registry). Owner-applied
// only; the SQL text is the contract under test (same style as the
// 0026/0027 suite).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_CLASSES,
  DOCUMENT_TYPES,
  INVENTORY_STATUSES,
  PRIVACY_CLASSES,
  SOURCE_SYSTEMS,
  VERIFICATION_STATUSES,
} from '../src/lib/business/documents/types';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0029_p1b_documents.sql'), 'utf8');
const sql = raw
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

function section(name: string): string {
  const start = sql.indexOf(`create table if not exists public.${name} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(');', start);
  return sql.slice(start, end);
}

// Regex from source fragments so long SQL shapes stay under 100 columns.
const rx = (...parts: string[]) => new RegExp(parts.join(''));
const OWNER_OR_RUNTIME =
  '\\(public\\.is_owner\\(\\) or public\\.is_runtime_service\\(\\)\\)';

function checkList(body: string, column: string): string[] {
  const re = new RegExp(`${column} text[^,]*?check \\(${column} in \\(([^)]*)\\)`);
  const m = re.exec(body);
  expect(m, `check list for ${column}`).not.toBeNull();
  return m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

describe('migration 0029 - hygiene', () => {
  it('is ASCII only with lines under 100 chars', () => {
    for (const [i, line] of raw.split('\n').entries()) {
      expect(line.length, `line ${i + 1}`).toBeLessThan(100);
      expect(/^[\x20-\x7e]*$/.test(line), `line ${i + 1} ascii`).toBe(true);
    }
  });
  it('creates exactly the three lane-B tables and touches nothing else', () => {
    const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)]
      .map((m) => m[1]);
    expect(created).toEqual(['documents', 'project_drive_folders',
      'drive_inventory']);
    for (const t of ['projects', 'artifacts', 'quotes', 'goal_jobs',
      'side_effects', 'business_clients']) {
      expect(sql).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*\\.${t}\\b`, 'i'));
    }
    // Assembled from fragments so this file never trips the RED scanner.
    expect(sql).not.toMatch(new RegExp('dro' + 'p table', 'i'));
    expect(sql).not.toMatch(/bytea/i);
  });
});

describe('migration 0029 - documents', () => {
  const body = section('documents');
  it('has every plan 5.4 column', () => {
    for (const c of ['id uuid primary key', 'project_id uuid references public.projects',
      'client_id uuid references public.business_clients',
      'property_id uuid references public.business_properties',
      'drive_file_id text', 'drive_parent_id text', 'source_system text',
      'source_message_id text', 'document_type text', 'document_subtype text',
      'original_filename text not null', 'canonical_filename text not null',
      'mime_type text not null', 'file_size_bytes bigint not null',
      'version integer not null default 1 check (version >= 1)',
      'is_current boolean not null default false',
      'supersedes_document_id uuid references public.documents (id)',
      'authority_class text not null', 'privacy_class text not null',
      'verification_status text not null', 'approved_use text',
      'source_created_at timestamptz', 'source_modified_at timestamptz',
      'registered_at timestamptz not null default now()',
      'registered_by text not null', "metadata jsonb not null default '{}'"]) {
      expect(body).toContain(c);
    }
    expect(body).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });
  it('CHECK lists match the TypeScript vocabulary exactly', () => {
    expect(checkList(body, 'source_system')).toEqual([...SOURCE_SYSTEMS]);
    expect(checkList(body, 'document_type')).toEqual([...DOCUMENT_TYPES]);
    expect(checkList(body, 'authority_class')).toEqual([...AUTHORITY_CLASSES]);
    expect(checkList(body, 'privacy_class')).toEqual([...PRIVACY_CLASSES]);
    expect(checkList(body, 'verification_status'))
      .toEqual([...VERIFICATION_STATUSES]);
  });
  it('a superseded row can never be current', () => {
    expect(body).toMatch(/check \(not \(is_current and authority_class = 'SUPERSEDED'\)\)/);
  });
  it('unique drive file id, unique version per chain, ONE current per chain', () => {
    expect(sql).toMatch(rx(
      'create unique index if not exists uq_documents_drive_file_id\\s+',
      'on public\\.documents \\(drive_file_id\\)\\s+',
      'where drive_file_id is not null',
    ));
    expect(sql).toMatch(rx(
      'create unique index if not exists uq_documents_project_type_version',
      '\\s+on public\\.documents \\(project_id, document_type,\\s+',
      "coalesce\\(document_subtype, ''\\), version\\)\\s+",
      'where project_id is not null',
    ));
    expect(sql).toMatch(rx(
      'create unique index if not exists uq_documents_current\\s+',
      'on public\\.documents \\(project_id, document_type,\\s+',
      "coalesce\\(document_subtype, ''\\)\\)\\s+",
      'where is_current = true and project_id is not null',
    ));
  });
});

describe('migration 0029 - project_drive_folders', () => {
  const body = section('project_drive_folders');
  it('binds one Drive folder per project', () => {
    expect(body).toContain('project_id uuid primary key references public.projects (id)');
    expect(body).toContain('drive_folder_id text not null');
    expect(body).toContain('folder_name text not null');
    expect(body).toMatch(rx(
      'template_version integer not null default 1\\s+',
      'check \\(template_version >= 1\\)',
    ));
    expect(body).toContain("subfolders jsonb not null default '{}'");
    expect(body).toContain('created_at timestamptz not null default now()');
    expect(body).toContain('created_by text not null');
    expect(sql).toMatch(rx(
      'create unique index if not exists uq_project_drive_folders_folder_id',
      '\\s+on public\\.project_drive_folders \\(drive_folder_id\\)',
    ));
  });
});

describe('migration 0029 - drive_inventory', () => {
  const body = section('drive_inventory');
  it('has the inventory columns and status set', () => {
    for (const c of ['drive_file_id text not null', 'name text not null',
      'mime_type text', 'parent_id text', 'path text', 'size_bytes bigint',
      'modified_at timestamptz', "classification jsonb not null default '{}'",
      'inventory_run_id text not null', 'created_at timestamptz not null']) {
      expect(body).toContain(c);
    }
    expect(body).toMatch(rx(
      'sha256 text check \\(sha256 is null or ',
      "sha256 ~ '\\^\\[0-9a-f\\]\\{64\\}\\$'\\)",
    ));
    expect(checkList(body, 'status')).toEqual([...INVENTORY_STATUSES]);
    expect(sql).toMatch(rx(
      'create unique index if not exists uq_drive_inventory_drive_file_id',
      '\\s+on public\\.drive_inventory \\(drive_file_id\\)',
    ));
  });
});

describe('migration 0029 - RLS and grants', () => {
  const TABLES = ['documents', 'project_drive_folders', 'drive_inventory'];
  it('enables RLS on all three tables', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
  });
  it('owner + runtime select/insert on all three; update policies', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(rx(
        `${t}_owner_runtime_sel[\\s\\S]*?for select to authenticated\\s+`,
        'using ', OWNER_OR_RUNTIME,
      ));
      expect(sql).toMatch(rx(
        `${t}_owner_runtime_ins[\\s\\S]*?for insert to authenticated\\s+`,
        'with check ', OWNER_OR_RUNTIME,
      ));
    }
    for (const t of ['documents', 'drive_inventory']) {
      expect(sql).toMatch(rx(
        `${t}_owner_runtime_upd[\\s\\S]*?for update to authenticated\\s+`,
        'using ', OWNER_OR_RUNTIME, '\\s+with check ', OWNER_OR_RUNTIME,
      ));
    }
    expect(sql).toMatch(rx(
      'project_drive_folders_owner_upd[\\s\\S]*?',
      'for update to authenticated\\s+',
      'using \\(public\\.is_owner\\(\\)\\) with check \\(public\\.is_owner\\(\\)\\)',
    ));
  });
  it('anon fully revoked; NO delete grant anywhere; grants are select/insert/update only', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`revoke all on public.${t} from anon`);
      expect(sql).toContain(`revoke all on public.${t} from authenticated`);
      expect(sql).toMatch(new RegExp(
        `grant select, insert, update on public\\.${t}\\s+to authenticated`));
    }
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/grant[^;]*to anon/i);
    expect(sql).not.toMatch(/grant all/i);
    expect(sql).not.toMatch(/service_role/i);
  });
});
