// Runner behavior: determinism, resumability, idempotency, routes,
// bounded retries, and the "never executes anything" property.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PlaybookDeclaration } from '../src/lib/business/runner/playbook';
import {
  createRun,
  runPlaybook,
  runPlaybookStep,
} from '../src/lib/business/runner/runner';
import type { StepContext } from '../src/lib/business/runner/steps';
import {
  CONTRACT_PROCEED_V1,
  FOLLOW_UP_V1,
  ORDER_CYCLE_V1,
} from '../src/lib/business/runner/playbooks';

const NOW = '2026-09-08T12:00:00.000Z';
const PROJECT = '11111111-1111-4111-8111-111111111111';

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    now: NOW,
    project_id: PROJECT,
    stage: 'qualified',
    identity_confidence: 'confirmed',
    predicates: { 'identity.confirmed': true },
    clocks: {},
    events: {},
    data: {},
    ...over,
  };
}

function decl(over: Partial<PlaybookDeclaration> = {}): PlaybookDeclaration {
  return {
    id: 'test.flow',
    version: 1,
    trigger: 'event.test',
    required_data: [],
    allowed_capabilities: ['gmail.message.draft', 'gmail.message.send'],
    predicates: ['identity.confirmed', 'gate.one', 'gate.two'],
    worker_use: { kind: 'none' },
    approvals: {
      'gmail.message.draft': 'INTERNAL',
      'gmail.message.send': 'EXTERNAL',
    },
    evidence_policy: 'every_step',
    retries: { max: 2, backoff_ms: 60_000 },
    exception_routes: { 'gate.one': 'wait', 'gate.two': 'complete' },
    exit_condition: 'test',
    steps: [
      { kind: 'check_identity', args: { predicate: 'identity.confirmed' } },
      { kind: 'check_stage', args: { any_of: ['qualified'] } },
      { kind: 'evaluate_gate', args: { predicate: 'gate.one' } },
      { kind: 'propose_capability', args: { capability_id: 'gmail.message.draft' } },
      { kind: 'wait_for_event', args: { event: 'owner.ok', timeout_hours: 24 } },
      { kind: 'advance_state', args: { to: 'visit_scheduled' } },
    ],
    ...over,
  };
}

function fresh(p: PlaybookDeclaration) {
  return createRun(p, {
    id: '22222222-2222-4222-8222-222222222222',
    project_id: PROJECT,
    trigger_ref: 'evt-1',
    idempotency_key: 'run:test:1',
    now: NOW,
  });
}

describe('runner - deterministic drive, waits, proposals', () => {
  it('drives to the first proposal, emits it once, and waits on its result event', () => {
    const p = decl();
    const c = ctx({ predicates: { 'identity.confirmed': true, 'gate.one': true } });
    const out = runPlaybook(p, fresh(p), c);
    expect(out.transitions).toEqual(['advanced', 'advanced', 'advanced', 'waiting']);
    expect(out.run.state).toBe('waiting');
    expect(out.run.step_cursor).toBe(3);
    expect(out.run.waiting_for).toBe('capability.gmail.message.draft');
    expect(out.proposals).toHaveLength(1);
    const prop = out.proposals[0];
    expect(prop.capability_id).toBe('gmail.message.draft');
    expect(prop.approval_class).toBe('INTERNAL');
    expect(prop.project_id).toBe(PROJECT);
    expect(prop.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prop.idempotency_key).toBe('run:test:1:3');
    // Same inputs -> identical output (determinism).
    const again = runPlaybook(p, fresh(p), c);
    expect(again).toEqual(out);
  });
  it('is idempotent: re-driving the proposing step yields no second proposal/evidence', () => {
    const p = decl();
    const c = ctx({ predicates: { 'identity.confirmed': true, 'gate.one': true } });
    const first = runPlaybook(p, fresh(p), c);
    const evidenceBefore = first.run.evidence.length;
    const replay = runPlaybookStep(p, first.run, c);
    expect(replay.transition).toBe('noop');
    expect(replay.proposal).toBeUndefined();
    expect(replay.run.evidence).toHaveLength(evidenceBefore);
    expect(
      first.run.evidence.filter((e) => e.step_cursor === 3 && e.phase === 'proposed'),
    ).toHaveLength(1);
  });
  it('resumes from step_cursor when the result event arrives, then waits again', () => {
    const p = decl();
    const c1 = ctx({ predicates: { 'identity.confirmed': true, 'gate.one': true } });
    const waiting = runPlaybook(p, fresh(p), c1).run;
    const c2 = ctx({
      now: '2026-09-08T13:00:00.000Z',
      predicates: { 'identity.confirmed': true, 'gate.one': true },
      events: { 'capability.gmail.message.draft': '2026-09-08T12:30:00.000Z' },
    });
    const resumed = runPlaybook(p, waiting, c2);
    expect(resumed.transitions).toEqual(['advanced', 'waiting']);
    expect(resumed.run.step_cursor).toBe(4);
    expect(resumed.run.waiting_for).toBe('owner.ok');
    expect(resumed.run.wait_until).toBe('2026-09-09T13:00:00.000Z');
    // Re-driving while still waiting on the same event is a no-op.
    expect(runPlaybookStep(p, resumed.run, c2).transition).toBe('noop');
    // The event arrives: advance_state runs, run completes with the advance.
    const c3 = ctx({
      ...c2,
      events: { ...c2.events, 'owner.ok': '2026-09-08T14:00:00.000Z' },
    });
    const done = runPlaybook(p, resumed.run, c3);
    expect(done.run.state).toBe('completed');
    expect(done.advances).toEqual([{ to: 'visit_scheduled' }]);
    expect(done.run.completed_at).toBe(c3.now);
    expect(runPlaybookStep(p, done.run, c3).transition).toBe('noop');
  });
  it('a replayed done step only moves the cursor and never duplicates evidence', () => {
    const p = decl();
    const c = ctx({ predicates: { 'identity.confirmed': true, 'gate.one': true } });
    const one = runPlaybookStep(p, fresh(p), c).run;
    const stale = { ...one, step_cursor: 0 };
    const replay = runPlaybookStep(p, stale, c);
    expect(replay.transition).toBe('advanced');
    expect(replay.run.step_cursor).toBe(1);
    expect(replay.run.evidence).toEqual(one.evidence);
  });
});

describe('runner - exception routes and bounded retries', () => {
  it('blocks on an unconfirmed identity (default route) and stays blocked', () => {
    const p = decl();
    const c = ctx({ predicates: { 'identity.confirmed': false } });
    const out = runPlaybook(p, fresh(p), c);
    expect(out.run.state).toBe('blocked');
    expect(out.run.last_error).toBe('identity.confirmed');
    expect(runPlaybookStep(p, out.run, c).transition).toBe('noop');
  });
  it('blocks on a stage mismatch', () => {
    const p = decl();
    const out = runPlaybook(p, fresh(p), ctx({ stage: 'measured' }));
    expect(out.run.state).toBe('blocked');
    expect(out.run.last_error).toBe('stage.any_of.qualified');
  });
  it('wait route: retries with backoff, then blocks after retries.max', () => {
    const p = decl();
    const c = ctx({ predicates: { 'identity.confirmed': true, 'gate.one': false } });
    const r1 = runPlaybook(p, fresh(p), c);
    expect(r1.run.state).toBe('waiting');
    expect(r1.run.waiting_for).toBe('retry:gate.one');
    expect(r1.run.wait_until).toBe('2026-09-08T12:01:00.000Z');
    // Before the backoff elapses the same failure is a no-op.
    expect(runPlaybookStep(p, r1.run, c).transition).toBe('noop');
    const later = (min: number) =>
      ctx({ ...c, now: new Date(Date.parse(NOW) + min * 60_000).toISOString() });
    const r2 = runPlaybookStep(p, r1.run, later(2));
    expect(r2.transition).toBe('waiting');
    expect(r2.run.evidence.filter((e) => e.phase === 'retry')).toHaveLength(2);
    const r3 = runPlaybookStep(p, r2.run, later(10));
    expect(r3.transition).toBe('blocked');
    expect(r3.run.last_error).toBe('retries_exhausted:gate.one');
  });
  it('complete route: a failed predicate can end the run cleanly', () => {
    const p = decl({
      steps: [{ kind: 'evaluate_gate', args: { predicate: 'gate.two' } }],
    });
    const out = runPlaybook(p, fresh(p), ctx({ predicates: { 'gate.two': false } }));
    expect(out.run.state).toBe('completed');
    expect(out.run.last_error).toBeNull();
    expect(out.run.evidence.at(-1)?.detail).toEqual({ predicate: 'gate.two', route: 'complete' });
  });
  it('wait_for_event timeout routes to block by default', () => {
    const p = decl({
      steps: [{ kind: 'wait_for_event', args: { event: 'never', timeout_hours: 1 } }],
    });
    const w = runPlaybook(p, fresh(p), ctx()).run;
    expect(w.state).toBe('waiting');
    const late = ctx({
      now: '2026-09-08T14:00:00.000Z',
      events: { 'wait_started.never': NOW },
    });
    const out = runPlaybookStep(p, w, late);
    expect(out.transition).toBe('blocked');
    expect(out.run.last_error).toBe('event.never.timeout');
  });
  it('check_clock waits until next_due_at and continues when due', () => {
    const p = FOLLOW_UP_V1;
    const armed = ctx({
      clocks: { proposal: { state: 'armed', next_due_at: '2026-09-10T12:00:00.000Z' } },
    });
    const w = runPlaybook(p, fresh(p), armed);
    expect(w.run.state).toBe('waiting');
    expect(w.run.waiting_for).toBe('clock.proposal');
    expect(w.run.wait_until).toBe('2026-09-10T12:00:00.000Z');
    const due = ctx({
      now: '2026-09-10T12:00:00.000Z',
      clocks: { proposal: { state: 'due', next_due_at: null } },
      predicates: { 'identity.confirmed': true, 'inbound.reply_absent': true },
    });
    const d = runPlaybook(p, w.run, due);
    expect(d.proposals.map((x) => x.capability_id)).toEqual(['gmail.message.draft']);
  });
  it('a run/playbook mismatch fails closed', () => {
    const p = decl();
    const out = runPlaybookStep(decl({ version: 2 }), fresh(p), ctx());
    expect(out.transition).toBe('failed');
    expect(out.run.last_error).toBe('playbook_mismatch');
  });
  it('a proposal for a capability outside the allow-list blocks at runtime', () => {
    const p = decl({
      steps: [{ kind: 'propose_capability', args: { capability_id: 'vendor.order.place' } }],
    });
    const out = runPlaybook(p, fresh(p), ctx());
    expect(out.run.state).toBe('blocked');
    expect(out.proposals).toHaveLength(0);
    expect(out.run.last_error).toBe('capability.not_allowed');
  });
});

describe('runner - STEP_UP endings and no execution', () => {
  const allTrue = (p: PlaybookDeclaration) =>
    Object.fromEntries(p.predicates.map((n) => [n, true]));
  it('contract.proceed ends WAITING on a STEP_UP proposal; never advances a state', () => {
    const p = CONTRACT_PROCEED_V1;
    const c = ctx({
      stage: 'accepted',
      predicates: allTrue(p),
      events: {
        'capability.contract.package.render': NOW,
        'owner.approval.contract_package': NOW,
      },
    });
    const out = runPlaybook(p, fresh(p), c);
    expect(out.run.state).toBe('waiting');
    expect(out.run.step_cursor).toBe(p.steps.length - 1);
    expect(out.proposals.at(-1)?.capability_id).toBe('docusign.envelope.send');
    expect(out.proposals.at(-1)?.approval_class).toBe('STEP_UP');
    expect(out.advances).toEqual([]);
    expect(runPlaybookStep(p, out.run, c).transition).toBe('noop');
  });
  it('order.cycle ends WAITING on vendor.order.place STEP_UP; never sets ordered', () => {
    const p = ORDER_CYCLE_V1;
    const c = ctx({
      stage: 'order_ready',
      predicates: allTrue(p),
      events: { 'capability.po.document.render': NOW, 'owner.approval.po': NOW },
    });
    const out = runPlaybook(p, fresh(p), c);
    expect(out.run.state).toBe('waiting');
    expect(out.proposals.at(-1)).toMatchObject({
      capability_id: 'vendor.order.place', approval_class: 'STEP_UP', project_id: PROJECT,
    });
    expect(out.advances).toEqual([]);
    expect(out.run.evidence.some((e) => e.step === 'advance_state')).toBe(false);
  });
  it('order.cycle blocks when order_eligibility is false', () => {
    const p = ORDER_CYCLE_V1;
    const out = runPlaybook(p, fresh(p), ctx({
      stage: 'order_ready',
      predicates: { ...allTrue(p), order_eligibility: false },
    }));
    expect(out.run.state).toBe('blocked');
    expect(out.run.last_error).toBe('order_eligibility');
    expect(out.proposals).toHaveLength(0);
  });
  it('propose_capability never calls anything: spies on every context function', () => {
    const spy = vi.fn();
    const p = decl({
      steps: [{ kind: 'propose_capability', args: { capability_id: 'gmail.message.send' } }],
    });
    const trapped = new Proxy(
      { execute: spy, send: spy, fetch: spy },
      { get: (t, k) => (k in t ? spy : undefined) },
    );
    const c = ctx({ data: { executor: trapped, adapter: trapped } });
    const out = runPlaybook(p, fresh(p), c);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].approval_class).toBe('EXTERNAL');
    expect(spy).not.toHaveBeenCalled();
    // Static pin: the runner modules import nothing that can execute.
    const dir = join(__dirname, '..', 'src', 'lib', 'business', 'runner');
    for (const f of ['runner.ts', 'steps.ts', 'playbook.ts']) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/capabilities\/executor|dryrun-adapter|fetch\(|googleapis/);
      expect(src).not.toMatch(/from '\.\.\/(identity|comms|knowledge|documents|order-chain)/);
    }
  });
});
