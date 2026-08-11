// Static safety pins for 0015_anon_table_revoke_sweep.sql (final
// pre-production audit hardening). The sweep must strip anon TABLE and
// SEQUENCE privileges - and MUST NOT touch function EXECUTE grants
// (the 0011/0013 SECURITY DEFINER gateways depend on anon EXECUTE as
// the remote auth path) or the authenticated role (owner-identity
// runtime path).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  '../../supabase/migrations/0015_anon_table_revoke_sweep.sql', 'utf8');
const code = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

describe('migration 0015 - anon table revoke sweep safety pins', () => {
  it('revokes anon TABLE privileges across public via a pg_tables loop', () => {
    expect(code).toMatch(/from pg_tables where schemaname = 'public'/);
    expect(code).toMatch(/revoke all on table %I\.%I from anon/);
  });

  it('revokes anon SEQUENCE privileges and hardens default privileges', () => {
    expect(code).toMatch(/revoke all on all sequences in schema public from anon/);
    expect(code).toMatch(/alter default privileges in schema public revoke all on tables from anon/);
    expect(code).toMatch(/alter default privileges in schema public revoke all on sequences from anon/);
  });

  it('NEVER touches function grants (gateway auth path) or authenticated', () => {
    expect(code).not.toMatch(/functions?\s+in\s+schema/i);
    expect(code).not.toMatch(/revoke[^;]*execute/i);
    expect(code).not.toMatch(/from authenticated/);
  });

  it('adds no grants and mutates nothing beyond privileges', () => {
    expect(code).not.toMatch(/^\s*grant\s/im);
    expect(code).not.toMatch(/\b(create|alter)\s+table\b/i);
    expect(code).not.toMatch(/\bpolicy\b/i);
  });
});
