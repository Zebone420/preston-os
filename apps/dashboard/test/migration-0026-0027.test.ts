// Static pins for the power-station foundation migrations (owner-applied
// only): 0026 side-effect ledger, 0027 artifact metadata. Same style as the
// other migration suites - the SQL text is the contract under test.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const stripped = (name: string) =>
  readFileSync(join(MIG, name), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const se = stripped('0026_side_effect_ledger.sql');
const art = stripped('0027_artifacts.sql');

describe('migration 0026 - side-effect ledger', () => {
  it('creates the table with the lifecycle status set and error taxonomy', () => {
    expect(se).toMatch(/create table if not exists public\.side_effects/);
    for (const s of ['proposed', 'refused', 'authorized', 'executing',
      'succeeded', 'failed', 'uncertain']) {
      expect(se).toContain(`'${s}'`);
    }
    expect(se).toMatch(/error_type is null or\s+error_type in \('terminal','retryable','uncertain'\)/);
  });
  it('enforces the idempotency spine (unique key) and bounded attempts', () => {
    expect(se).toMatch(/create unique index if not exists uq_side_effects_idempotency_key/);
    expect(se).toMatch(/attempt_count >= 0 and attempt_count <= 10/);
  });
  it('RLS: owner or runtime service; anon fully revoked; NO delete grant', () => {
    expect(se).toMatch(/enable row level security/);
    expect((se.match(/public\.is_owner\(\) or public\.is_runtime_service\(\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
    expect(se).toMatch(/revoke all on public\.side_effects from anon/);
    expect(se).toMatch(/grant select, insert, update on public\.side_effects to authenticated/);
    expect(se).not.toMatch(/grant[^;]*delete/i);
  });
  it('binds every row to an environment and never weakens existing objects', () => {
    expect(se).toMatch(/environment in \('staging','production'\)/);
    for (const t of ['goal_jobs', 'master_goals', 'system_controls',
      'orchestration_approvals']) {
      expect(se).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*${t}`, 'i'));
    }
  });
});

describe('migration 0027 - artifact metadata', () => {
  it('creates the metadata table with integrity + provenance columns', () => {
    expect(art).toMatch(/create table if not exists public\.artifacts/);
    expect(art).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    for (const c of ['goal_id', 'job_id', 'run_id', 'object_path',
      'size_bytes', 'retention_state', 'classification']) {
      expect(art).toContain(c);
    }
  });
  it('one row per object path; no binary columns', () => {
    expect(art).toMatch(/create unique index if not exists uq_artifacts_object_path/);
    expect(art).not.toMatch(/bytea/i);
  });
  it('RLS: owner+runtime read/insert, owner-only update, anon revoked, no delete', () => {
    expect(art).toMatch(/artifacts_owner_runtime_sel[\s\S]*?for select[\s\S]*?is_runtime_service/);
    expect(art).toMatch(/artifacts_owner_runtime_ins[\s\S]*?for insert[\s\S]*?is_runtime_service/);
    expect(art).toMatch(/artifacts_owner_upd[\s\S]*?for update[\s\S]*?is_owner\(\)\) with check \(public\.is_owner\(\)/);
    expect(art).toMatch(/revoke all on public\.artifacts from anon/);
    expect(art).not.toMatch(/grant[^;]*delete/i);
  });
});
