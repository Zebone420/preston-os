// 0025 - runtime service may SELECT the runtime_deployment row.
// Found by the 0024 production proof (2026-08-20): submit_goal_decomposition
// is SECURITY INVOKER and reads runtime_deployment under the caller's RLS;
// 0017's policy is owner-only, so the non-owner runtime saw no row and the
// 0018 fallback stamped 'staging' on production goals. 0025 adds ONE
// SELECT-only policy for is_runtime_service(). These pins keep it that narrow.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = readFileSync(join(MIG, '0025_runtime_deployment_service_read.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('migration 0025 - runtime_deployment runtime SELECT policy', () => {
  it('creates exactly one policy, SELECT-only, runtime-service predicate', () => {
    expect(code).toMatch(/create policy runtime_deployment_runtime_read on public\.runtime_deployment\s+for select using \(public\.is_runtime_service\(\)\);/);
    expect((code.match(/create policy/g) ?? []).length).toBe(1);
  });

  it('grants no write path and leaves the owner policy alone', () => {
    expect(code).not.toMatch(/for all|for insert|for update|for delete|with check/);
    expect(code).not.toMatch(/runtime_deployment_owner/);
    expect(code).not.toMatch(/grant |revoke /);
  });

  it('touches no function, definer, controls, or approval authority', () => {
    expect(code).not.toMatch(/function|security definer|system_controls|decide_orchestration_approval|goal_jobs/);
  });
});
