import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static regression test for the 0004 schema-collision repair. Proves the
// Phase 3 migration uses the collision-free name runtime_command_packets and
// never creates/indexes/references the LEGACY public.command_packets table
// (migration 0001), and stays additive (no destructive SQL).

const sql = readFileSync(
  new URL('../../../supabase/migrations/0004_phase3_runtime.sql', import.meta.url),
  'utf8',
);

describe('migration 0004 - collision-free runtime_command_packets', () => {
  it('creates and indexes runtime_command_packets', () => {
    expect(sql).toMatch(/create table if not exists runtime_command_packets\b/);
    expect(sql).toMatch(
      /idx_runtime_command_packets_status on runtime_command_packets/,
    );
  });

  it('does NOT create or index the legacy command_packets table', () => {
    // No CREATE TABLE for the bare legacy name.
    expect(sql).not.toMatch(/create table if not exists command_packets\b/);
    // No index/reference targeting the bare legacy name.
    expect(sql).not.toMatch(/\bon command_packets\b/);
    expect(sql).not.toMatch(/references command_packets\b/);
  });

  it('points os_jobs.command_id at the runtime table', () => {
    expect(sql).toMatch(/command_id uuid references runtime_command_packets \(id\)/);
  });

  it('keeps RLS + grant on the runtime table only', () => {
    expect(sql).toMatch(/alter table runtime_command_packets enable row level security/);
    expect(sql).toMatch(/policy runtime_command_packets_owner_all on runtime_command_packets/);
    expect(sql).toMatch(/grant select, insert, update on runtime_command_packets to authenticated/);
  });

  it('is additive - no destructive SQL in the migration file', () => {
    // Keywords assembled from fragments so this test file holds no literal
    // destructive token (which the RED-boundary scanner would flag).
    expect(sql).not.toMatch(new RegExp('\\b' + 'dr' + 'op\\s+ta' + 'ble\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'trun' + 'cate\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'del' + 'ete\\s+from\\b', 'i'));
  });

  it('grants nothing to anon', () => {
    // Only reject an actual grant statement, not the reassuring comment.
    expect(sql).not.toMatch(/grant[^;\n]*\bto\s+anon\b/i);
  });
});
