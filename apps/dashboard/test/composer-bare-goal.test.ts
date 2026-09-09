// Live ChatGPT-path regression (2026-08-27): clear single-sentence goals
// submitted through preston_submit_goal ("Audit the repository.") composed
// ZERO tasks and rejected ambiguous_request:goal_1_has_no_tasks, so no work
// ever reached a worker. The composer now derives exactly one task from a
// bare single-sentence request - in the owner's own words, through the same
// kind resolution, prohibited scans, and policy classification as every
// other task. Since the 2026-09-08 P0 defect E repair, multi-step prose
// composes one task per sentence (nothing invented, nothing dropped);
// genuinely ambiguous requests and explicit task-less goals KEEP rejecting.
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

  it('fix request composes one CODE task (owner-approved 2026-08-28 remap)', () => {
    // Fix/repair verbs previously minted kind 'repair', which the Level-1
    // real adapters exclude by design - the live kind_not_eligible
    // dead-letter path. Repository fix work is code work.
    const p = okOf(composeRequest('Fix the goal composer.'));
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[0].tasks[0].kind).toBe('code');
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

  it('multi-step free prose composes one task per sentence (P0 defect E repair, 2026-09-08)', () => {
    // Formerly rejected goal_1_has_no_tasks: the second sentence only became
    // an unparsed_sentence warning. Derivation now attaches the owner's own
    // sentences as tasks, in order - it invents nothing and drops nothing.
    // The opening sentence of an implicit goal is its first step, so the
    // leading "Then" chains onto it. tmode-compose-repro pins the 3-step
    // form with explicit roles.
    const p = okOf(composeRequest(
      'Audit the repository. Then summarize what you found in a report.'));
    expect(p.goals).toHaveLength(1);
    const tasks = p.goals[0].tasks;
    expect(tasks.map((t) => t.kind)).toEqual(['audit', 'documentation']);
    expect(tasks[0].objective).toBe('Audit the repository.');
    expect(tasks[1].objective).toBe('summarize what you found in a report.');
    expect(tasks[1].depends_on_local).toEqual(['t1']);
    expect(p.warnings).toContain('tasks_derived_from_prose:1');
    expect(p.warnings).toContain('task_derived_from_goal_objective');
    expect(p.warnings.some((w) => w.startsWith('unparsed_sentence:'))).toBe(false);
  });

  it('an unresolvable sentence rejects the WHOLE request, naming the task (no partial shape)', () => {
    const errs = errsOf(composeRequest(
      'Audit the repository. Then zorble the frobnicator.'));
    expect(errs.join(',')).toContain('ambiguous_request:task_kind_unresolved:t2');
  });

  it('a prohibited capability in a later sentence rejects the request', () => {
    const errs = errsOf(composeRequest(
      'Audit the repository. Then update the production credentials.'));
    expect(errs.join(',')).toContain('prohibited:production_access');
    expect(errs.join(',')).toContain('prohibited:credential_access');
  });

  it('an explicit goal followed by prose sentences composes those sentences as its tasks', () => {
    const p = okOf(composeRequest(
      'Create a goal to harden the scheduler. Audit the dispatcher. ' +
      'Then add a regression test for the selection window.'));
    expect(p.goals).toHaveLength(1);
    expect(p.goals[0].objective).toBe('harden the scheduler.');
    expect(p.goals[0].tasks.map((t) => t.kind)).toEqual(['audit', 'test']);
    expect(p.goals[0].tasks[1].depends_on_local).toEqual(['t1']);
    expect(p.warnings).toContain('tasks_derived_from_prose:2');
    // The explicit goal statement is NOT itself a task.
    expect(p.warnings).not.toContain('task_derived_from_goal_objective');
  });

  it('with two explicit goals, prose sentences attach to the CURRENT (latest) goal', () => {
    const p = okOf(composeRequest(
      'Create a goal to harden the scheduler. Audit the dispatcher. ' +
      'Create a goal to tidy the docs. Summarize the runbooks.'));
    expect(p.goals).toHaveLength(2);
    expect(p.goals[0].tasks.map((t) => t.objective)).toEqual(['Audit the dispatcher.']);
    expect(p.goals[1].tasks.map((t) => t.objective)).toEqual(['Summarize the runbooks.']);
  });

  it('a malformed task marker still rejects rather than being guessed', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to tidy notes. Create an extra-numbered task to summarize the notes.'));
    expect(errs.join(',')).toContain('ambiguous_request:task_sentence_unparsed');
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
