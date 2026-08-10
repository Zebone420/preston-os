// Static pins for migration 0012 (SSOT B2 actor registry). Mirrors the
// migration-0005 idiom: the SQL file is data; these tests pin the safety
// properties reviews rely on, so a later edit cannot silently weaken them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations',
    '0012_ssot_actor_registry.sql'),
  'utf8',
);

describe('migration 0012 - actor registry safety pins', () => {
  it('enables RLS and pins owner-only policy', () => {
    expect(sql).toMatch(/alter table actor_registry enable row level security/);
    expect(sql).toMatch(/create policy actor_registry_owner on actor_registry/);
    expect(sql).toMatch(/using \(public\.is_owner\(\)\) with check \(public\.is_owner\(\)\)/);
  });

  it('revokes anon entirely; authenticated gets no delete grant', () => {
    expect(sql).toMatch(/revoke all on actor_registry from anon/);
    expect(sql).toMatch(/revoke delete on actor_registry from authenticated/);
  });

  it('actors are disabled by default with an empty token hash', () => {
    expect(sql).toMatch(/enabled boolean not null default false/);
    expect(sql).toMatch(/token_hash text not null default ''/);
  });

  it('pins the five-actor role set (matches SSOT design section 3)', () => {
    expect(sql).toMatch(
      /\('owner_remote', 'chatgpt', 'claude', 'codex', 'hermes'\)/,
    );
  });

  it('resolver uses extensions.digest, never bare digest (cf62fdb lesson)', () => {
    expect(sql).toMatch(/extensions\.digest\(/);
    // Every digest CALL must be schema-qualified. Comments may mention the
    // bare name (the file documents the lesson), so strip comment lines
    // first, then strip qualified calls, and assert no bare call remains.
    const code = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(code.replace(/extensions\.digest\(/g, '')).not.toMatch(/\bdigest\(/);
  });

  it('resolver is definer-scoped and refuses empty tokens', () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/coalesce\(p_token, ''\) = ''/);
    expect(sql).toMatch(/revoke all on function public\.resolve_ssot_actor\(text\) from public/);
  });
});
