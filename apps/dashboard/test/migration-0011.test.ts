// Static pins for supabase/migrations/0011_phase8_remote_intake.sql.
// The migration is owner-applied; these pins keep its safety-critical
// text properties from drifting in review (same idiom as migration-0010
// tests): definer gateways re-authenticate the token hash, anon gets
// EXECUTE on exactly the two gateway functions and NOTHING on the tables,
// nothing is deletable, every column is bounded by CHECKs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations',
    '0011_phase8_remote_intake.sql'),
  'utf8',
);

describe('migration 0011 - remote intake gateway pins', () => {
  it('tables are RLS-enabled and owner-scoped', () => {
    expect(sql).toContain('alter table remote_intake_config enable row level security');
    expect(sql).toContain('alter table remote_intake_requests enable row level security');
    expect(sql.match(/public\.is_owner\(\)/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('anon has NO table access; only the two definer gateways', () => {
    expect(sql).toContain('revoke all on remote_intake_config from anon');
    expect(sql).toContain('revoke all on remote_intake_requests from anon');
    const anonGrants = sql.match(/grant [^;]*to anon[^;]*;/g) ?? [];
    for (const g of anonGrants) {
      expect(g).toContain('grant execute on function');
    }
    expect(anonGrants.length).toBe(2);
  });

  it('nothing is deletable by the app roles', () => {
    expect(sql).toContain('revoke delete on remote_intake_config from authenticated');
    expect(sql).toContain('revoke delete on remote_intake_requests from authenticated');
    expect(sql).not.toMatch(/grant[^;]*delete/i);
  });

  it('both gateways are SECURITY DEFINER with a pinned search_path', () => {
    const definers = sql.match(/security definer/g) ?? [];
    expect(definers.length).toBe(2);
    const paths = sql.match(/set search_path = public/g) ?? [];
    expect(paths.length).toBe(2);
  });

  it('the token is compared as a sha256 hash and never stored raw', () => {
    expect(sql.match(/digest\(coalesce\(p_token, ''\), 'sha256'\)/g)!.length).toBe(2);
    expect(sql).not.toMatch(/insert[^;]*p_token/is);
    expect(sql).toContain("token_hash text not null default ''");
  });

  it('requests are bounded: id shape, sizes, status set, source set', () => {
    expect(sql).toContain("request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$'");
    expect(sql).toContain('char_length(raw_request) between 1 and 8000');
    expect(sql).toContain("status in ('pending', 'consumed', 'rejected')");
    expect(sql).toContain("source in ('chatgpt', 'phone', 'api')");
  });

  it('the submit gateway enforces backpressure and idempotency', () => {
    expect(sql).toContain('max_pending');
    expect(sql).toContain("'backpressure'");
    expect(sql).toContain('unique_violation');
    expect(sql).toContain("'duplicate'");
  });

  it('the status gateway is bounded in every dimension', () => {
    expect(sql).toContain('limit 20'); // jobs per goal
    expect(sql).toContain('limit 10'); // approvals per goal
    expect(sql).toContain('limit 5'); // goals per request
  });

  it('config is single-row and disabled by default', () => {
    expect(sql).toContain("check (id = 'global')");
    expect(sql).toContain('enabled boolean not null default false');
  });
});
