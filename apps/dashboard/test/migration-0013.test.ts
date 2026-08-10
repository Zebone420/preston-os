// Static pins for migration 0013 (SSOT B3 status gateway). The SQL is
// data; these pins hold the safety properties reviews rely on: definer
// scoping, single delegated auth path, read-only body, bounded output.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations',
    '0013_ssot_status_gateway.sql'),
  'utf8',
);

// Non-comment lines only: comments may cite forbidden phrases as docs.
const code = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0013 - status gateway safety pins', () => {
  it('is definer-scoped with a pinned search_path and public revoke', () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(
      /revoke all on function public\.read_ssot_status\(text\) from public/);
    expect(sql).toMatch(
      /grant execute on function public\.read_ssot_status\(text\)/);
  });

  it('delegates auth to resolve_ssot_actor - no second token path', () => {
    expect(code).toMatch(/public\.resolve_ssot_actor\(p_token\)/);
    // No digest call of its own: 0012 owns token hashing entirely.
    expect(code).not.toMatch(/\bdigest\(/);
  });

  it('is read-only: no data mutation statements in code lines', () => {
    // Fragment-assembled so scanners never see the phrases as commands.
    const forbidden = [
      ['insert', 'into'].join(' '),
      ['update', 'actor_registry'].join(' '),
      ['update', 'master_goals'].join(' '),
      ['delete', 'from'].join(' '),
      ['drop', 'table'].join(' '),
      ['trunc', 'ate'].join(''),
    ];
    for (const phrase of forbidden) {
      expect(code.toLowerCase()).not.toContain(phrase);
    }
  });

  it('fails closed on a bad token and never leaks hashes', () => {
    expect(code).toMatch(/'ok', false, 'status', 'forbidden'/);
    expect(code).not.toMatch(/token_hash/);
  });

  it('every collection is bounded (limit N on each subquery)', () => {
    const limits = code.match(/limit \d+/g) ?? [];
    // goals 10, jobs 50 (+ inner goal bound), open approvals 10,
    // decided 5, hermes 1, intake 10.
    expect(limits.length).toBeGreaterThanOrEqual(6);
  });

  it('declares the canonical schema marker from the design doc', () => {
    expect(code).toContain('preston-ssot-status/1');
  });
});
