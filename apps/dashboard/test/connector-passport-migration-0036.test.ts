import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = join(
  __dirname, '..', '..', '..', 'supabase', 'migrations',
  '0036_m8_connector_passports_m9_soft_launch.sql',
);
const raw = readFileSync(path, 'utf8');
const sql = raw
  .split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

describe('migration 0036 - ConnectorPassport and soft launch', () => {
  it('creates only the two additive contract tables', () => {
    expect(sql).toContain('create table if not exists public.connector_passports');
    expect(sql).toContain('create table if not exists public.soft_launch_assessments');
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b/i);
  });

  it('pins passport environment, mode, health, scope, freshness, and revision fields', () => {
    expect(sql).toContain("environment in ('staging','production')");
    expect(sql).toContain("mode in ('sandbox_only','read_only','read_write')");
    expect(sql).toContain("health in ('ready','degraded','offline','revoked')");
    for (const field of [
      'allowed_capabilities', 'scope_hash', 'observed_at', 'data_as_of',
      'max_age_seconds', 'expires_at', 'evidence_ref', 'revision',
    ]) expect(sql).toContain(field);
  });

  it('makes production readiness structurally impossible', () => {
    expect(sql).toMatch(/production_ready boolean not null default false\s+check \(production_ready = false\)/);
    expect(sql).toContain("'STAGING_READY_OWNER_GATED'");
  });

  it('enables RLS, permits owner/runtime only, and grants no delete', () => {
    for (const table of ['connector_passports', 'soft_launch_assessments']) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${table} from anon;`);
      expect(sql).toContain(`revoke all on public.${table} from authenticated;`);
    }
    expect(sql).toMatch(/public\.is_owner\(\) or public\.is_runtime_service\(\)/);
    expect(sql).not.toMatch(/grant[^;]*delete|to anon|service_role/i);
  });

  it('has no executable or consequential database surface', () => {
    expect(sql).not.toMatch(/create (or replace )?(function|procedure|trigger)/i);
    expect(sql).not.toMatch(/pg_net|http_|placeOrder|refund|charge|sendEnvelope/i);
  });

  it('is ASCII and keeps lines bounded', () => {
    for (const [index, line] of raw.split('\n').entries()) {
      expect(line.length, `line ${index + 1}`).toBeLessThan(100);
      expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(line), `line ${index + 1}`).toBe(true);
    }
  });
});
