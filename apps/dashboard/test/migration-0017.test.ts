// Static pins for 0017_environment_production.sql (P2 DB layer).
// Owner-applied; these tests pin the file's safety-relevant shape.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  __dirname, '..', '..', '..',
  'supabase', 'migrations', '0017_environment_production.sql',
), 'utf8');

describe('migration 0017 static pins', () => {
  it('widens exactly the three 0010 environment CHECKs to the two-value allowlist', () => {
    for (const c of [
      'master_goals_environment_check',
      'agent_contracts_environment_scope_check',
      'orchestration_approvals_environment_check',
    ]) {
      expect(sql).toContain(c);
    }
    const widened = sql.match(/in \('staging', 'production'\)/g) ?? [];
    expect(widened.length).toBeGreaterThanOrEqual(4); // 3 checks + runtime_deployment
  });

  it('never touches the execution/simulation pins or business tables', () => {
    const code = sql.split('\n')
      .filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/executed/);
    expect(code).not.toMatch(/simulation_only/);
    expect(code).not.toMatch(/quote_|business_|payment_/);
  });

  it('runtime_deployment is owner-only, anon-zero, single-row, no delete', () => {
    expect(sql).toContain("check (id = 'self')");
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on runtime_deployment from anon');
    expect(sql).toContain('revoke delete on runtime_deployment from authenticated');
  });

  it('read_ssot_status keeps the 0013 projection and only re-sources environment', () => {
    expect(sql).toContain("coalesce(v_env, 'staging')");
    expect(sql).toContain("'schema', 'preston-ssot-status/1'");
    expect(sql).toContain('resolve_ssot_actor'); // single auth path preserved
    expect(sql).toContain(
      'grant execute on function public.read_ssot_status(text)');
    // The forbidden fail-closed return survives verbatim.
    expect(sql).toContain("jsonb_build_object('ok', false, 'status', 'forbidden')");
  });
});
