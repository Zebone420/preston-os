// 0021 - fail-closed in-transaction audit for decide_orchestration_approval.
// A real decision must land exactly one append-only access_events row,
// atomically, for ANY caller. Static file-level contract pins; live
// behaviour verified by the owner after applying to staging then prod.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = readFileSync(join(MIG, '0021_decide_audit_failclosed.sql'), 'utf8');

describe('migration 0021 - decide audit fail-closed', () => {
  it('re-creates decide_orchestration_approval with the same signature', () => {
    expect(sql).toMatch(
      /function public\.decide_orchestration_approval\(\s*p_approval_id text,\s*p_outcome text,\s*p_nonce text\s*\)/,
    );
  });

  it('keeps SECURITY DEFINER + pinned search_path + auth gate', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain("raise exception 'owner_required'");
    expect(sql).toContain('if not public.is_owner() then');
  });

  it('preserves the one-time-nonce / pending-only / real-clock invariants', () => {
    expect(sql).toContain("raise exception 'not_pending'");
    expect(sql).toContain("raise exception 'already_decided'");
    expect(sql).toContain("raise exception 'expired'");
    expect(sql).toContain('v_now := clock_timestamp()');
    expect(sql).toContain('for update');
  });

  it('writes exactly one access_events audit row per decision', () => {
    const inserts = sql.match(/insert into access_events/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(sql).toMatch(/insert into access_events \(system, event, actor, environment, detail\)/);
    expect(sql).toContain("'orchestration-approval'");
  });

  it('the audit is INSIDE the function transaction (atomic / fail-closed)', () => {
    const body = sql.slice(sql.indexOf('as $fn$'), sql.indexOf('$fn$;', sql.indexOf('as $fn$') + 5));
    const upd = body.indexOf('update public.orchestration_approvals');
    const ins = body.indexOf('insert into access_events');
    const ret = body.indexOf('return query');
    expect(upd).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(upd); // audit after the decision update
    expect(ret).toBeGreaterThan(ins); // and before returning
  });

  it('records attribution (auth.uid + is_owner) without leaking the nonce', () => {
    expect(sql).toContain('auth.uid()::text');
    expect(sql).toContain("'is_owner', public.is_owner()");
    expect(sql).toContain("'nonce_prefix', left(p_nonce, 5)");
    // never the full nonce as a value
    expect(sql).not.toMatch(/'nonce',\s*p_nonce\b/);
  });

  it('keeps execute revoked from public/anon, granted to authenticated', () => {
    expect(sql).toContain('revoke all on function public.decide_orchestration_approval(text, text, text)\n  from public');
    expect(sql).toContain('from anon');
    expect(sql).toContain('grant execute on function public.decide_orchestration_approval(text, text, text)\n  to authenticated');
  });
});
