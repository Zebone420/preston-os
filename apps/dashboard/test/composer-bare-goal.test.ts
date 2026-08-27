// Live ChatGPT-path regression (2026-08-27): clear single-sentence goals
// submitted through preston_submit_goal ("Audit the repository.") composed
// ZERO tasks and rejected ambiguous_request:goal_1_has_no_tasks, so no work
// ever reached a worker. The composer now derives exactly one task from a
// bare single-sentence request - in the owner's own words, through the same
// kind resolution, prohibited scans, and policy classification as every
// other task. Everything genuinely ambiguous, multi-step prose, or explicit
// task-less goals must KEEP rejecting fail-closed.
import { describe, expect, it } from 'vitest';
import { composeRequest } from '../src/lib/ai-os/orchestration/composer';
import { prestonSubmitGoal, type ToolContext } from '../src/lib/preston-control/tools';
import { makeComposerFakeDb } from './composer-fake-db';

function okOf(r: ReturnType<typeof composeRequest>) {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.errors.join(','));
  return r;
}
function errsOf(r: ReturnType<typeof composeRequest>): string[] {
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
}

describe('bare single-sentence goal derives exactly one task', () => {
  it('audit request composes one audit task', () => {
    const p = okOf(composeRequest('Audit the repository.'));
    expect(p.goals).toHaveLength(1);
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[0].tasks[0].kind).toBe('audit');
    expect(p.warnings).toContain('task_derived_from_goal_objective');
  });

  it('repair request composes one repair task', () => {
    const p = okOf(composeRequest('Fix the goal composer.'));
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[0].tasks[0].kind).toBe('repair');
  });

  it('implementation request composes one code task', () => {
    const p = okOf(composeRequest('Implement a health endpoint for the dashboard.'));
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[0].tasks[0].kind).toBe('code');
  });

  it('policy classification still comes only from the policy engine', () => {
    const p = okOf(composeRequest('Fix the goal composer.'));
    const t = p.goals[0].tasks[0];
    expect(typeof t.requires_approval).toBe('boolean');
    expect(t.policy_reason.length).toBeGreaterThan(0);
  });

  it('a trailing constraint sentence is recorded and does not block derivation', () => {
    const p = okOf(composeRequest(
      'Audit the repository. Do not touch production.'));
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.constraints).toHaveLength(1);
  });

  it('the adapter-generated "Priority: high." suffix does not block derivation', () => {
    // preston_submit_goal appends this literal sentence for priority=high.
    const p = okOf(composeRequest('Audit the repository.\n\nPriority: high.'));
    expect(p.goals[0].tasks).toHaveLength(1);
  });
});

describe('ambiguous and multi-step prose keeps rejecting fail-closed', () => {
  it('an unresolvable kind still rejects (never invents work)', () => {
    expect(errsOf(composeRequest('Zorble the frobnicator.')).join(','))
      .toContain('ambiguous_request:task_kind_unresolved');
  });

  it('an explicit goal marker with no tasks still rejects', () => {
    // The owner explicitly asked for a goal and described no tasks - the
    // composer never invents a decomposition (pinned since Phase 7).
    expect(errsOf(composeRequest('Create a goal to improve the dashboard.')))
      .toContain('ambiguous_request:goal_1_has_no_tasks');
  });

  it('multi-step free prose still rejects instead of silently dropping steps', () => {
    // tmode-compose-repro pins the same fact for the 3-step form.
    const errs = errsOf(composeRequest(
      'Audit the repository. Then summarize what you found in a report.'));
    expect(errs.join(',')).toContain('goal_1_has_no_tasks');
  });

  it('prohibited capabilities in a bare sentence still reject', () => {
    expect(errsOf(composeRequest('Audit the credentials.')).join(','))
      .toContain('prohibited:credential_access');
  });
});

describe('end-to-end through preston_submit_goal (the ChatGPT MCP path)', () => {
  const ctxFor = (client: ToolContext['client']): ToolContext => ({
    client, ownerEmail: 'info@preston.nyc', now: '2026-08-27T12:00:00.000Z',
  });

  it('a bare single-sentence goal is accepted, persisted, and dispatchable', async () => {
    const db = makeComposerFakeDb();
    const r = await prestonSubmitGoal(ctxFor(db.client), {
      request: 'Audit the repository.', request_id: 'pc-bare-goal-e2e-1',
    });
    expect(r.status).toBe('accepted');
    expect(r.goals).toHaveLength(1);
    expect(db.rowsOf('master_goals')).toHaveLength(1);
    const jobs = db.rowsOf('goal_jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('audit');
    // Dispatchable: an implementer role with a real adapter, never 'audit'.
    expect(['claude', 'codex']).toContain(jobs[0].assigned_role);
  });

  it('an unresolvable request is rejected and persists NOTHING', async () => {
    const db = makeComposerFakeDb();
    const r = await prestonSubmitGoal(ctxFor(db.client), {
      request: 'Zorble the frobnicator.', request_id: 'pc-bare-goal-e2e-2',
    });
    expect(r.status).toBe('rejected');
    expect((r.errors ?? []).join(',')).toContain('task_kind_unresolved');
    expect(db.rowsOf('master_goals')).toHaveLength(0);
    expect(db.rowsOf('goal_jobs')).toHaveLength(0);
  });
});
