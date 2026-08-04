import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  isMigrationAbsentError,
  loadOrchestrationReadModel,
} from '../src/lib/ai-os/orchestration/read-model';

// Gate D staging defect (2026-08-04): a missing-COLUMN error was relabeled
// "migration 0010 not applied" by a bare /does not exist/ match, hiding a
// real code/schema mismatch behind a benign-looking message.
describe('isMigrationAbsentError - table absence only', () => {
  it('matches table-level absence', () => {
    expect(isMigrationAbsentError('relation "master_goals" does not exist')).toBe(true);
    expect(isMigrationAbsentError("Could not find the table 'public.master_goals' in the schema cache")).toBe(true);
    expect(isMigrationAbsentError('ERROR: 42P01: undefined table')).toBe(true);
  });
  it('does NOT match a missing column (real defect must surface)', () => {
    expect(isMigrationAbsentError('column orchestration_approvals.id does not exist')).toBe(false);
    expect(isMigrationAbsentError('column goal_jobs.bogus does not exist')).toBe(false);
  });
});

const NOW = '2026-07-22T12:00:00.000Z';

// Fake client whose reads can be scripted to succeed, be empty, or error with
// a "does not exist" (migration-absent) message.
function makeClient(mode: 'data' | 'empty' | 'absent' | 'error') {
  const goals = [
    { id: 'goal-00000001', title: 'g1', status: 'running', simulation_only: true, created_at: NOW },
  ];
  const jobs = [
    { id: 'job-00000001', goal_id: 'goal-00000001', title: 'j1', status: 'completed' },
    { id: 'job-00000002', goal_id: 'goal-00000001', title: 'j2', status: 'failed', failure_reason: 'boom' },
    { id: 'job-00000003', goal_id: 'goal-00000001', title: 'j3', status: 'dead_lettered', failure_reason: 'gave up' },
  ];
  const approvals = [{ approval_id: 'apr-1', risk_class: 'RED', action: 'x', status: 'pending', created_at: NOW }];
  const result = (rows: Record<string, unknown>[]) => {
    if (mode === 'absent') return Promise.resolve({ data: null, error: { message: 'relation "master_goals" does not exist' } });
    if (mode === 'error') return Promise.resolve({ data: null, error: { message: 'permission denied' } });
    if (mode === 'empty') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: rows, error: null });
  };
  const client: RuntimeClient = {
    from(table: string) {
      const rows = table === 'master_goals' ? goals : table === 'goal_jobs' ? jobs : table === 'orchestration_approvals' ? approvals : [];
      return {
        insert() { return { select() { return Promise.resolve({ data: [{ id: 'x' }], error: null }); } }; },
        select() {
          const chain = () => ({ eq() { return chain(); }, order() { return { limit() { return result(rows); } }; }, limit() { return result(rows); } });
          return chain();
        },
        update() {
          // Full UpdateEqChain shape (eq/lte/gt recursion + select), matching
          // the store's guard-chain contract - the read model never updates,
          // so every branch resolves to an empty write result.
          const chain = () => ({
            eq() { return chain(); },
            lte() { return chain(); },
            gt() { return chain(); },
            select() { return Promise.resolve({ data: [], error: null }); },
          });
          return { eq() { return chain(); } };
        },
      };
    },
  };
  return client;
}

describe('orchestration read model - bounded, fail-closed', () => {
  it('reports migration_absent when 0010 is not applied (not an error)', async () => {
    const rm = await loadOrchestrationReadModel(makeClient('absent'));
    expect(rm.applied).toBe(false);
    expect(rm.goals.state).toBe('migration_absent');
    expect(rm.summary.total_goals).toBe(0);
  });

  it('reports empty cleanly when tables exist but have no rows', async () => {
    const rm = await loadOrchestrationReadModel(makeClient('empty'));
    expect(rm.applied).toBe(true);
    expect(rm.goals.state).toBe('empty');
  });

  it('aggregates goals/jobs/failures/dead-letters when data exists', async () => {
    const rm = await loadOrchestrationReadModel(makeClient('data'));
    expect(rm.applied).toBe(true);
    expect(rm.summary.total_goals).toBe(1);
    expect(rm.summary.running_goals).toBe(1);
    expect(rm.summary.failed_jobs).toBe(1);
    expect(rm.summary.dead_lettered_jobs).toBe(1);
    expect(rm.dead_letters.rows[0].failure_reason).toBe('gave up');
  });

  it('surfaces a non-migration read error without throwing', async () => {
    const rm = await loadOrchestrationReadModel(makeClient('error'));
    expect(rm.goals.state).toBe('error');
    expect(rm.applied).toBe(true); // not migration-absent; a real error
  });
});
