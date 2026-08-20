// 0022 - DB-enforced approval gate. A gated job cannot hold a runnable status
// (CHECK), the runtime cannot UPDATE requires_approval (column revoke), and the
// gate clears ONLY via a SECURITY DEFINER RPC that verifies a genuine owner
// approval scoped to the job. Static contract pins; live behaviour is the
// staging matrix.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = readFileSync(join(MIG, '0022_approval_gate_db_enforced.sql'), 'utf8');

describe('migration 0022 - DB-enforced approval gate', () => {
  it('adds the gated-not-runnable CHECK (idempotent)', () => {
    expect(sql).toContain('goal_jobs_gate_not_runnable');
    expect(sql).toMatch(/check \(not \(requires_approval = true\s*and status in \('ready','assigned','in_progress'\)\)\)/);
    expect(sql).toContain("where conname = 'goal_jobs_gate_not_runnable'");
  });

  it('does NOT add a RED-must-gate CHECK (would break approved RED jobs - review R3)', () => {
    expect(sql).not.toContain('goal_jobs_red_must_gate');
    expect(sql).not.toMatch(/risk_class in \('RED','BLACK'\) and requires_approval = false/);
  });

  it('revokes table UPDATE and re-grants UPDATE excluding requires_approval AND the action fields', () => {
    expect(sql).toMatch(/revoke update on public\.goal_jobs from authenticated/);
    const grant = sql.slice(sql.indexOf('grant update ('));
    const cols = grant.slice(0, grant.indexOf(')')).replace('grant update (', '');
    // gate flag + action-defining fields must NOT be runtime-updatable
    for (const c of ['requires_approval', 'kind', 'objective', 'title', 'risk_class']) {
      expect(cols, `grant must exclude ${c}`).not.toMatch(new RegExp(`\\b${c}\\b`));
    }
    // sanity: the columns the runtime does update ARE present
    for (const c of ['status', 'attempts', 'approval_id', 'run_id', 'evidence_refs', 'executed', 'assigned_role']) {
      expect(cols, `grant missing ${c}`).toMatch(new RegExp(`\\b${c}\\b`));
    }
  });

  it('defines clear_approval_gate as SECURITY DEFINER with pinned search_path', () => {
    expect(sql).toMatch(/function public\.clear_approval_gate\(/);
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  it('clear_approval_gate is caller-gated to runtime-service or owner', () => {
    expect(sql).toMatch(/if not \(public\.is_runtime_service\(\) or public\.is_owner\(\)\) then\s*raise exception 'forbidden'/);
  });

  it('clear_approval_gate verifies approved + job/goal scope before clearing', () => {
    expect(sql).toMatch(/v_appr\.status <> 'approved'[\s\S]*'not_approved'/);
    expect(sql).toMatch(/v_appr\.job_id is distinct from v_job\.id[\s\S]*'scope_mismatch'/);
    // final clear is CAS-guarded on still-gated + from_status
    expect(sql).toMatch(/set requires_approval = false,\s*status = 'ready'[\s\S]*where id = v_job\.id[\s\S]*and requires_approval = true/);
  });

  it('clear_approval_gate CAS-binds every action field (no field-swap)', () => {
    for (const f of ['approval_id', 'goal_id', 'kind', 'objective', 'title', 'risk_class', 'assigned_role']) {
      expect(sql, `CAS missing ${f}`).toMatch(new RegExp(`p_${f}`));
    }
  });

  it('execute is revoked from public/anon and granted only to authenticated', () => {
    expect(sql).toMatch(/revoke all on function public\.clear_approval_gate\([\s\S]*?\) from public/);
    expect(sql).toMatch(/from anon/);
    expect(sql).toMatch(/grant execute on function public\.clear_approval_gate\([\s\S]*?\) to authenticated/);
  });

  it('does NOT re-grant UPDATE(requires_approval) anywhere', () => {
    expect(sql).not.toMatch(/grant update \([^)]*requires_approval/);
  });

  it('never uses service_role', () => {
    expect(sql).not.toMatch(/service_role/i);
  });
});
