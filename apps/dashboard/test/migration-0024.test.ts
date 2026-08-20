// 0024 - submit_goal_decomposition admits the runtime-service identity.
// Live go-live defect (prod tick disp-133272, 2026-08-20): after the C-3
// re-seed to the non-owner runtime@service.preston session, the first
// intake was rejected "persist_failed:owner_required" because 0020 widened
// the TABLE policies but the SECURITY INVOKER RPC kept an is_owner()-only
// guard. 0024 re-creates the 0018 body with exactly one delta: the guard
// becomes (is_owner() or is_runtime_service()). These static pins keep
// the body otherwise identical to 0018 and the least-privilege lines intact.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql24 = readFileSync(join(MIG, '0024_submit_goal_runtime_service.sql'), 'utf8');
const sql18 = readFileSync(join(MIG, '0018_submit_goal_deployment_env.sql'), 'utf8');

// Function body = everything from "create or replace function" onward.
const body = (s: string): string => s.slice(s.indexOf('create or replace function'));

describe('migration 0024 - runtime-service guard in submit_goal_decomposition', () => {
  it('guard admits owner OR runtime service, nothing else', () => {
    expect(body(sql24)).toMatch(/if not \(public\.is_owner\(\) or public\.is_runtime_service\(\)\) then\s+raise exception 'owner_required'/);
    expect(body(sql24)).not.toMatch(/if not public\.is_owner\(\) then/);
  });

  it('body is byte-identical to 0018 except the single guard line', () => {
    const a = body(sql18).split('\n');
    const b = body(sql24).split('\n');
    expect(b.length).toBe(a.length);
    const diffs = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
    expect(diffs.length).toBe(1);
    expect(a[diffs[0] as number]).toBe('  if not public.is_owner() then');
  });

  it('keeps SECURITY INVOKER (RLS still governs the inserts) and search_path', () => {
    expect(sql24).toMatch(/security invoker/);
    expect(sql24).not.toMatch(/security definer/);
    expect(sql24).toMatch(/set search_path = public, pg_temp/);
  });

  it('keeps the grant surface unchanged (anon revoked, authenticated exec)', () => {
    expect(sql24).toMatch(/revoke all on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s+from anon/);
    expect(sql24).toMatch(/grant execute on function public\.submit_goal_decomposition\(jsonb, jsonb, jsonb\)\s+to authenticated/);
  });

  it('does not touch the decide RPC or system_controls', () => {
    expect(body(sql24)).not.toMatch(/decide_orchestration_approval/);
    expect(body(sql24)).not.toMatch(/system_controls/);
  });
});
