// T-mode live defect regression (2026-08-18, prod goal c049c964).
// Two facts this file pins:
//  1. The canonical T-mode team-goal TEXT composes into exactly the
//     plan -> implement -> review chain with every role EXPLICIT (the
//     free-prose "Then write... using codex" form parses to zero tasks
//     and must keep being rejected, not silently mis-shaped).
//  2. buildJobs honors the explicit role on an audit-kind task: the
//     audit ROLE has no real adapter, so an owner-routed review job
//     must persist as claude (or codex), never 'audit'. Live failure
//     signature was real_required:provider_not_claude x3 -> goal failed.
import { describe, expect, it } from 'vitest';
import { composeRequest } from '../src/lib/ai-os/orchestration/composer';
import { buildJobs } from '../src/lib/ai-os/orchestration/composer-persist';
import { DEFAULT_BUDGET } from '../src/lib/ai-os/orchestration/model';
import type { MasterGoal } from '../src/lib/ai-os/orchestration/model';

const TMODE_TEXT =
  'Task 1: propose a short plan for the teamwork drill note using claude. ' +
  'Task 2: write the teamwork drill note after task 1 using codex. ' +
  'Task 3: review the teamwork drill note after task 2 using claude.';

const PROSE_TEXT =
  'Propose a short plan for the teamwork drill note using claude. ' +
  'Then write the teamwork drill note using codex. ' +
  'Then review the teamwork drill note using claude.';

function goal(): MasterGoal {
  return {
    id: 'goal-tmode-0001', title: 'tmode', objective: 'tmode drill',
    source: 'dashboard', requested_by: 'owner@test', status: 'decomposed',
    environment: 'staging', budget: DEFAULT_BUDGET,
    correlation_id: 'corr-tmode-0001', simulation_only: true,
    created_at: '2026-08-18T00:00:00.000Z',
    updated_at: '2026-08-18T00:00:00.000Z',
  };
}

describe('t-mode team goal composition + role mapping (live regression)', () => {
  it('rejects the free-prose form instead of mis-shaping it', () => {
    const r = composeRequest(PROSE_TEXT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(',')).toContain('has_no_tasks');
  });

  it('composes Task-labelled text into the explicit 3-role chain', () => {
    const r = composeRequest(TMODE_TEXT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tasks = r.goals.flatMap((g) => g.tasks);
    expect(tasks).toHaveLength(3);
    // t1 classifies as documentation ('note' precedes 'propos' in the
    // kind lexicon) - acceptable: T-mode mandates roles, not kinds, for
    // the plan step; the review step MUST be audit kind (asserted).
    expect(tasks.map((t) => t.kind)).toEqual(
      ['documentation', 'documentation', 'audit']);
    expect(tasks.map((t) => t.requested_role)).toEqual(
      ['claude', 'codex', 'claude']);
    expect(tasks[1].depends_on_local).toEqual(['t1']);
    expect(tasks[2].depends_on_local).toEqual(['t2']);
  });

  it('buildJobs persists explicit roles - review NEVER lands on audit', () => {
    const r = composeRequest(TMODE_TEXT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const built = buildJobs(goal(), r.goals[0], 'req-tmode-0001',
      '2026-08-18T00:00:00.000Z');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.jobs.map((j) => j.assigned_role)).toEqual(
      ['claude', 'codex', 'claude']);
  });

  it('a role-less audit task still defaults to the audit role', () => {
    const r = composeRequest('Task 1: review the drill note.');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const built = buildJobs(goal(), r.goals[0], 'req-tmode-0002',
      '2026-08-18T00:00:00.000Z');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.jobs[0].kind).toBe('audit');
    expect(built.jobs[0].assigned_role).toBe('audit');
  });
});
