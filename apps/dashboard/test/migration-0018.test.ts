// 0018 - submit_goal_decomposition deployment-environment stamp.
// Live P2 defect (prod tick disp-92809): the 0010 function inserted
// master_goals.environment as the literal 'staging', so every composed
// goal in the production DB violated the dispatcher's deployment-
// equality invariant and the run refused (fail-closed). 0018 re-creates
// the function stamping coalesce(v_env, 'staging') from
// runtime_deployment ('self', 0017). These static pins keep the fix
// from regressing in a future re-create of the function.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = readFileSync(join(MIG, '0018_submit_goal_deployment_env.sql'), 'utf8');

describe('migration 0018 - deployment env stamp in submit_goal_decomposition', () => {
  it('re-creates the same function signature (jsonb, jsonb, jsonb)', () => {
    expect(sql).toMatch(/function public\.submit_goal_decomposition\(\s*p_goal jsonb,\s*p_jobs jsonb,\s*p_deps jsonb\s*\)/);
  });

  it('reads the deployment environment from runtime_deployment self', () => {
    expect(sql).toMatch(/select environment into v_env\s+from public\.runtime_deployment where id = 'self'/);
  });

  it('stamps the goal environment from the deployment row, staging fallback', () => {
    expect(sql).toContain("coalesce(v_env, 'staging'),");
  });

  it('no longer inserts the bare literal staging environment value', () => {
    // The 0010 defect line was exactly "     'staging'," in the values
    // list. 0018 must not carry any bare-literal environment value.
    expect(sql).not.toMatch(/^\s+'staging',$/m);
  });

  it('keeps SECURITY INVOKER and the fixed search_path', () => {
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/set search_path = public, pg_temp/);
  });

  it('keeps the grant surface unchanged (anon revoked, authenticated exec)', () => {
    expect(sql).toMatch(/revoke all on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s+from anon/);
    expect(sql).toMatch(/grant execute on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s+to authenticated/);
  });

  it('keeps the simulation pin: goals insert simulation_only true, jobs executed false', () => {
    expect(sql).toMatch(/v_corr,\s+true,\s+0\)/);
    expect(sql).toMatch(/'\[\]'::jsonb\),\s+false\)/);
  });
});
