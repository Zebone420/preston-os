// Static pins for migration 0014 (SSOT B4 actor stamping). Pins the
// non-activating contract: legacy global-token behavior preserved,
// per-actor leg delegated to the 0012 resolver, attribution stamped,
// nothing weakened.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations',
    '0014_ssot_actor_stamping.sql'),
  'utf8',
);

const code = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0014 - actor stamping safety pins', () => {
  it('adds actor_id additively (nullable, if-not-exists)', () => {
    expect(code).toMatch(
      /add column if not exists actor_id text/);
  });

  it('keeps the legacy global-token leg with qualified digest', () => {
    expect(code).toMatch(/extensions\.digest\(coalesce\(p_token, ''\), 'sha256'\)/);
    // Exactly one digest call: the per-actor leg must NOT hash on its
    // own - it goes through resolve_ssot_actor (single auth path).
    const calls = code.match(/extensions\.digest\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(code.replace(/extensions\.digest\(/g, '')).not.toMatch(/\bdigest\(/);
  });

  it('delegates the per-actor leg to resolve_ssot_actor', () => {
    expect(code).toMatch(/public\.resolve_ssot_actor\(p_token\)/);
  });

  it('fails closed when neither leg authenticates', () => {
    expect(code).toMatch(
      /if not v_global_ok and v_actor_id is null then/);
    expect(code).toMatch(/'ok', false, 'status', 'forbidden'/);
  });

  it('preserves 0011 guards: backpressure, idempotency, bounds', () => {
    expect(code).toMatch(/'status', 'backpressure'/);
    expect(code).toMatch(/when unique_violation then/);
    expect(code).toMatch(/'status', 'duplicate'/);
    expect(code).toMatch(/char_length\(p_raw_request\) > 8000/);
    expect(code).toMatch(/'invalid_request_id'/);
  });

  it('stamps actor_id on the stored row and echoes it back', () => {
    expect(code).toMatch(/raw_request, actor_id\)/);
    expect(code).toMatch(/p_raw_request, v_actor_id\)/);
    expect(code).toMatch(/'request_id', p_request_id,\s*\n\s*'actor_id', v_actor_id/);
  });

  it('mutates nothing beyond the additive column + fn replace', () => {
    const forbidden = [
      ['delete', 'from'].join(' '),
      ['drop', 'table'].join(' '),
      ['drop', 'policy'].join(' '),
      ['trunc', 'ate'].join(''),
      'revoke select',
      ['alter', 'policy'].join(' '),
    ];
    for (const phrase of forbidden) {
      expect(code.toLowerCase()).not.toContain(phrase);
    }
  });
});
