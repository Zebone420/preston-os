// Structural migration-quality lint for 0020 + 0021 (no DB required).
// Catches the failure classes named in the R-2 migration-quality gate:
// duplicated blocks, incomplete CREATE statements, duplicate/stale policy
// names, malformed predicates, missing WITH CHECK, service_role use, and
// accidental broad permissions.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const files = {
  '0020': readFileSync(join(MIG, '0020_runtime_service_identity.sql'), 'utf8'),
  '0021': readFileSync(join(MIG, '0021_decide_audit_failclosed.sql'), 'utf8'),
};

// strip line + block comments so lint reasons about executable SQL only
function code(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

describe.each(Object.entries(files))('migration %s structural lint', (name, raw) => {
  const sql = code(raw);

  it('has balanced parentheses in executable SQL', () => {
    const open = (sql.match(/\(/g) ?? []).length;
    const close = (sql.match(/\)/g) ?? []).length;
    expect(open, `${name} paren balance`).toBe(close);
  });

  it('never uses service_role', () => {
    expect(sql).not.toMatch(/service_role/i);
  });

  it('never GRANTs broad table privileges to anon', () => {
    expect(sql).not.toMatch(/grant[\s\S]{0,60}to anon/i);
  });

  it('every create policy is a complete statement (has USING or WITH CHECK, ends ;)', () => {
    const policies = raw.split(/\bcreate policy\b/i).slice(1);
    for (const p of policies) {
      const stmt = p.slice(0, p.indexOf(';') + 1);
      expect(stmt.endsWith(';'), `${name}: unterminated create policy`).toBe(true);
      expect(
        /\busing\b/i.test(stmt) || /\bwith check\b/i.test(stmt),
        `${name}: policy without using/with check -> ${stmt.slice(0, 60)}`,
      ).toBe(true);
    }
  });

  it('every for-all / for-insert / for-update widening policy carries WITH CHECK', () => {
    // any policy that references is_runtime_service in a write context must
    // constrain the written row (with check), never using-only.
    const writePolicies = raw
      .split(/\bcreate policy\b/i).slice(1)
      .map((p) => p.slice(0, p.indexOf(';') + 1))
      .filter((s) => /for all|for insert|for update/i.test(s) && /is_runtime_service/i.test(s));
    for (const s of writePolicies) {
      expect(/with check/i.test(s), `${name}: write policy missing with check -> ${s.slice(0, 60)}`).toBe(true);
    }
  });

  it('declares no policy name more than once (no duplicate declarations)', () => {
    const names = [...raw.matchAll(/create policy (\w+)/gi)].map((m) => m[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `${name}: duplicate policy names ${dupes.join(',')}`).toHaveLength(0);
  });

  it('pairs every create-policy with a matching drop-policy-if-exists (idempotent re-run)', () => {
    for (const n of [...raw.matchAll(/create policy (\w+)/gi)].map((m) => m[1])) {
      expect(
        new RegExp(`drop policy if exists ${n}\\b`).test(raw),
        `${name}: ${n} created without drop-if-exists guard`,
      ).toBe(true);
    }
  });

  it('every create function is dollar-quoted and closed', () => {
    const fns = raw.split(/\bcreate or replace function\b/i).slice(1);
    for (const f of fns) {
      const tag = f.match(/as (\$[a-z]*\$)/i)?.[1];
      expect(tag, `${name}: function body not dollar-quoted`).toBeTruthy();
      if (tag) {
        const occurrences = f.split(tag).length - 1;
        expect(occurrences % 2, `${name}: unbalanced ${tag}`).toBe(0);
      }
    }
  });

  it('every SECURITY DEFINER function pins search_path', () => {
    const fns = raw.split(/\bcreate or replace function\b/i).slice(1)
      .filter((f) => /security definer/i.test(f.slice(0, 400)));
    for (const f of fns) {
      expect(/set search_path/i.test(f.slice(0, 400)), `${name}: definer without search_path`).toBe(true);
    }
  });
});
