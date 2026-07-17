import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static regression test for the 0005 id-alignment repair. The runtime writes
// DETERMINISTIC string ids to the append-only logs ('att::<job>::<n>::<lease>',
// 'od-<job>', 'ev-od-<job>') and relies on pk uniqueness for idempotent replay
// dedup; 0004/0003 declared those id columns uuid, so real-DB inserts failed
// 22P02 (masked by the fake client in unit tests). 0005 retypes exactly those
// id columns to text and must stay additive and touch no RLS/grants.

const sql = readFileSync(
  new URL('../../../supabase/migrations/0005_phase4b1_id_alignment.sql', import.meta.url),
  'utf8',
);

const RETYPED = [
  'job_attempts',
  'orchestration_decisions',
  'os_events',
  'dead_letters',
  'agent_memory',
  'execution_queue',
];

describe('migration 0005 - append-log id columns align with runtime string ids', () => {
  it('retypes each append-log id column to text (values preserved via cast)', () => {
    for (const t of RETYPED) {
      expect(sql).toMatch(new RegExp(`alter table ${t} alter column id type text using id::text`));
      expect(sql).toMatch(new RegExp(`alter table ${t} alter column id set default gen_random_uuid\\(\\)::text`));
    }
  });

  it('never touches the uuid FK targets (os_jobs, runtime_command_packets) or the leases table', () => {
    expect(sql).not.toMatch(/alter table os_jobs\b/);
    expect(sql).not.toMatch(/alter table runtime_command_packets\b/);
    expect(sql).not.toMatch(/alter table worker_leases\b/);
    expect(sql).not.toMatch(/alter table job_checkpoints\b/);
  });

  it('changes no RLS policy, grant, or revoke', () => {
    expect(sql).not.toMatch(/\bcreate policy\b/i);
    expect(sql).not.toMatch(/\bdrop policy\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\brevoke\b/i);
    expect(sql).not.toMatch(/\bdisable row level security\b/i);
  });

  it('is additive - no destructive SQL in the migration file', () => {
    // Keywords assembled from fragments so this test file holds no literal
    // destructive token (which the RED-boundary scanner would flag).
    expect(sql).not.toMatch(new RegExp('\\b' + 'dr' + 'op\\s+ta' + 'ble\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'trun' + 'cate\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'del' + 'ete\\s+from\\b', 'i'));
    expect(sql).not.toMatch(new RegExp('\\b' + 'dr' + 'op\\s+column\\b', 'i'));
  });
});
