// 0019 - read_ssot_status per-read audit (ChatGPT live SSOT read gate).
// Design section 7 (docs/PRESTON_CENTRAL_SSOT_DESIGN_v1.md line 121):
// every SSOT read gateway call must land one access_events/audit row.
// The shipped 0013->0017 function wrote none. 0019 adds one append-only
// access_events INSERT per SUCCESSFUL, actor-bound read. These static
// pins keep the audit write (and the read-only invariants) from
// regressing in a future re-create. NOTE: this is a file-level contract
// test; live behaviour is verified by the owner after applying 0019.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql = readFileSync(join(MIG, '0019_ssot_read_audit.sql'), 'utf8');

describe('migration 0019 - per-read audit in read_ssot_status', () => {
  it('re-creates read_ssot_status with the same (text) signature', () => {
    expect(sql).toMatch(/function public\.read_ssot_status\(\s*p_token text\s*\)/);
  });

  it('stays SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public');
  });

  it('keeps the single auth path through resolve_ssot_actor', () => {
    expect(sql).toContain('public.resolve_ssot_actor(p_token)');
    expect(sql).toMatch(/'ok', false, 'status', 'forbidden'/);
  });

  it('inserts exactly one access_events audit row on a successful read', () => {
    const inserts = sql.match(/insert into access_events/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(sql).toMatch(/insert into access_events \(system, event, actor, environment, detail\)/);
  });

  it('audits with system ssot-read and event used, actor-bound', () => {
    expect(sql).toContain("'ssot-read', 'used'");
    expect(sql).toContain("v_actor->>'actor_id'");
    expect(sql).toContain("coalesce(v_env, 'staging')");
  });

  it('does NOT audit pre-auth forbidden calls (anon-flood guard)', () => {
    // the forbidden early-return must precede the only INSERT
    const idxForbidden = sql.indexOf("'status', 'forbidden'");
    const idxInsert = sql.indexOf('insert into access_events');
    expect(idxForbidden).toBeGreaterThan(-1);
    expect(idxInsert).toBeGreaterThan(idxForbidden);
  });

  it('never returns token hashes or writes business tables', () => {
    expect(sql).not.toContain('token_hash');
    // the only write is the audit insert; no UPDATE/DELETE of any table
    expect(sql).not.toMatch(/\bupdate\s+master_goals\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('preserves the deployment-environment report from 0017', () => {
    expect(sql).toContain("'environment', coalesce(v_env, 'staging')");
    expect(sql).toMatch(/select environment into v_env\s+from runtime_deployment where id = 'self'/);
  });
});
