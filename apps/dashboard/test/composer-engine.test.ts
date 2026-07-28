import { describe, expect, it } from 'vitest';
import {
  MAX_COMPOSED_GOALS,
  MAX_COMPOSED_TASKS,
  MAX_REQUEST_CHARS,
  composeRequest,
  proposalHash,
  type ComposerProposal,
} from '../src/lib/ai-os/orchestration/composer';

// Composer ENGINE tests: deterministic natural-language interpretation into a
// structured, policy-classified proposal. The engine is PURE - these tests
// prove interpretation and validation only; nothing here persists or runs.

const LIFECYCLE_REQUEST =
  'Create a staging-only goal to verify the Phase 7 dashboard status page. ' +
  'Create tasks to inspect the staging status data, generate a ' +
  'simulation-only readiness summary, and attach internal evidence. ' +
  'Do not deploy, send messages, access production, change credentials, ' +
  'perform financial actions, or make external writes.';

function okOf(r: ReturnType<typeof composeRequest>): ComposerProposal {
  if (!r.ok) throw new Error('expected ok, got: ' + r.errors.join(','));
  return r;
}

function errsOf(r: ReturnType<typeof composeRequest>): string[] {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.errors;
}

describe('composer engine - interpretation', () => {
  it('interprets a simple one-goal request', () => {
    const p = okOf(composeRequest(
      'Create a goal to tidy the dashboard docs. Create tasks to inspect the README.'));
    expect(p.goals).toHaveLength(1);
    expect(p.goals[0].title).toBe('Tidy the dashboard docs');
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[0].tasks[0].kind).toBe('audit'); // "inspect" => audit
  });

  it('interprets one goal with multiple tasks (the lifecycle request)', () => {
    const p = okOf(composeRequest(LIFECYCLE_REQUEST));
    expect(p.goals).toHaveLength(1);
    const g = p.goals[0];
    expect(g.title).toBe('Verify the Phase 7 dashboard status page');
    expect(g.tasks.map((t) => t.local_id)).toEqual(['t1', 't2', 't3']);
    expect(g.tasks.map((t) => t.kind)).toEqual(['audit', 'documentation', 'documentation']);
    // all GREEN, none gated, constraints recorded not treated as tasks
    for (const t of g.tasks) {
      expect(t.tier).toBe('GREEN');
      expect(t.requires_approval).toBe(false);
    }
    expect(p.approvals_required).toBe(0);
    expect(p.constraints).toHaveLength(1);
    expect(p.constraints[0]).toMatch(/^Do not deploy/);
  });

  it('interprets multiple goals with their own tasks', () => {
    const p = okOf(composeRequest(
      'Create a goal to audit the dashboard config. Create tasks to inspect the settings. ' +
      'Create a goal to write the findings up. Create tasks to summarize the results.'));
    expect(p.goals).toHaveLength(2);
    expect(p.goals[0].local_id).toBe('g1');
    expect(p.goals[1].local_id).toBe('g2');
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[1].tasks).toHaveLength(1);
    expect(p.goals[1].tasks[0].kind).toBe('documentation');
  });

  it('captures explicit task-number dependencies', () => {
    const p = okOf(composeRequest(
      'Create a goal to check the app. Task 1: inspect the routes. ' +
      'Task 2: summarize the findings after task 1.'));
    const g = p.goals[0];
    expect(g.tasks[0].depends_on_local).toEqual([]);
    expect(g.tasks[1].depends_on_local).toEqual(['t1']);
  });

  it('chains a "then" enumeration item onto the previous task', () => {
    const p = okOf(composeRequest(
      'Create a goal to check the app. Create tasks to inspect the config, then summarize the results.'));
    const g = p.goals[0];
    expect(g.tasks).toHaveLength(2);
    expect(g.tasks[1].depends_on_local).toEqual(['t1']);
  });

  it('rejects a goal without tasks (missing required content)', () => {
    expect(errsOf(composeRequest('Create a goal to improve the dashboard.')))
      .toContain('ambiguous_request:goal_1_has_no_tasks');
  });

  it('rejects an invalid dependency reference', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to check things. Task 1: inspect the config. ' +
      'Task 2: summarize the results after task 9.'));
    expect(errs.some((e) => e.startsWith('invalid_dependency:unknown:t9'))).toBe(true);
  });

  it('rejects duplicate explicit task identifiers', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to check things. Task 1: inspect the config. ' +
      'Task 1: summarize the results.'));
    expect(errs).toContain('duplicate_task_identifier');
  });

  it('rejects an unsupported agent', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to check things. Create tasks to inspect the config using gpt9bot.'));
    expect(errs.some((e) => e.startsWith('unsupported_agent:'))).toBe(true);
  });

  it('rejects a forbidden intake/coordinator role as an implementer', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to check things. Create tasks to inspect the config using hermes.'));
    expect(errs).toContain('unsupported_agent_role:hermes');
  });

  it('honors an explicit codex assignment', () => {
    const p = okOf(composeRequest(
      'Create a goal to improve tests. Create tasks to add a regression test using codex.'));
    expect(p.goals[0].tasks[0].requested_role).toBe('codex');
  });

  it('rejects the audit role for edit work (contract-incapable)', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to improve tests. Create tasks to implement a helper using audit.'));
    expect(errs.some((e) => e.startsWith('unsupported_agent_for_task:audit'))).toBe(true);
  });

  it('rejects an unsupported execution mode', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to check things. Create tasks to inspect the config in live mode.'));
    expect(errs).toContain('unsupported_execution_mode');
  });

  it('rejects a dangerous destructive action', () => {
    const errs = errsOf(composeRequest(
      'Create a goal to clean up. Create tasks to delete the database records.'));
    expect(errs).toContain('prohibited:destructive_action');
  });

  it('rejects an ambiguous request with no goal or tasks', () => {
    const errs = errsOf(composeRequest('Hmm.'));
    expect(errs.some((e) => e.startsWith('ambiguous_request'))).toBe(true);
  });

  it('rejects an empty request', () => {
    expect(errsOf(composeRequest(''))).toEqual(['empty_request']);
    expect(errsOf(composeRequest('   '))).toEqual(['empty_request']);
  });

  it('rejects a non-string request (type confusion)', () => {
    expect(errsOf(composeRequest(42 as unknown as string))).toEqual(['request_type_invalid']);
    expect(errsOf(composeRequest(null))).toEqual(['request_type_invalid']);
  });

  it('rejects a very long request', () => {
    const errs = errsOf(composeRequest('a'.repeat(MAX_REQUEST_CHARS + 1)));
    expect(errs).toEqual(['request_too_long']);
  });

  it('rejects too many tasks in one goal', () => {
    const tasks = Array.from({ length: MAX_COMPOSED_TASKS + 1 },
      (_, i) => `Task ${i + 1}: inspect area ${i + 1}.`).join(' ');
    const errs = errsOf(composeRequest('Create a goal to sweep the app. ' + tasks));
    expect(errs).toContain('too_many_tasks');
  });

  it('rejects too many goals', () => {
    const goals = Array.from({ length: MAX_COMPOSED_GOALS + 1 },
      (_, i) => `Create a goal to check area ${i + 1}. Create tasks to inspect area ${i + 1}.`).join(' ');
    expect(errsOf(composeRequest(goals))).toContain('too_many_goals');
  });

  it('handles special characters and multiline input safely', () => {
    const p = okOf(composeRequest(
      'Create a goal to check the config.\n' +
      '- inspect the <settings> & "quotes" file\n' +
      '- summarize the umlaut file naive-cafe.txt'));
    expect(p.goals[0].tasks).toHaveLength(2);
    expect(p.goals[0].tasks[0].objective).toContain('<settings> & "quotes"');
  });

  it('rejects control characters', () => {
    expect(errsOf(composeRequest('Create a goal to x.' + '\u0007' + ' Create tasks to inspect y.')))
      .toEqual(['control_characters_in_request']);
  });

  it('is deterministic: identical input yields identical proposals and hash', () => {
    const a = okOf(composeRequest(LIFECYCLE_REQUEST));
    const b = okOf(composeRequest(LIFECYCLE_REQUEST));
    expect(a).toEqual(b);
    expect(a.proposal_hash).toBe(b.proposal_hash);
    expect(a.proposal_hash).toBe(proposalHash(a.goals));
    expect(a.proposal_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('different content yields a different hash (content binding)', () => {
    const a = okOf(composeRequest(
      'Create a goal to check A. Create tasks to inspect A.'));
    const b = okOf(composeRequest(
      'Create a goal to check B. Create tasks to inspect B.'));
    expect(a.proposal_hash).not.toBe(b.proposal_hash);
  });

  it('classifies a migration task as gated (policy engine authority)', () => {
    const p = okOf(composeRequest(
      'Create a goal to prepare a schema note. ' +
      'Create tasks to draft a schema migration plan for owner review, and summarize the plan in a local report.'));
    const [mig, doc] = p.goals[0].tasks;
    expect(mig.kind).toBe('migration');
    expect(mig.requires_approval).toBe(true);
    expect(mig.tier).toBe('RED');
    expect(doc.requires_approval).toBe(false);
    expect(p.approvals_required).toBe(1);
  });
});
