import { describe, expect, it } from 'vitest';
import {
  intakeCommand,
  type CommandEnvelope,
} from '../src/lib/ai-os/orchestration/goal-intake';
import {
  decomposeGoal,
  type TaskSpec,
} from '../src/lib/ai-os/orchestration/decomposition';
import {
  runGoalSimulation,
  HOLD_ORACLE,
} from '../src/lib/ai-os/orchestration/orchestrator-sim';
import type { GoalState, MasterGoal } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-07-22T12:00:00.000Z';
const OWNER = 'owner@preston.nyc';
const ALLOW = new Set([OWNER]);

function envelope(over: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    owner_identity: OWNER, source: 'chatgpt', command_type: 'submit_master_goal',
    correlation_id: 'corr-goal-0001', nonce: 'nonce-1',
    issued_at: NOW, expires_at: '2026-07-22T12:10:00.000Z',
    title: 'Add a small module', objective: 'implement a bounded helper and test it',
    ...over,
  };
}

describe('goal intake - fail closed', () => {
  it('accepts an allowlisted-owner submit and builds a staging goal', () => {
    const r = intakeCommand({ envelope: envelope(), ownerAllowlist: ALLOW, seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'goal') {
      expect(r.goal.environment).toBe('staging');
      expect(r.goal.simulation_only).toBe(true);
      expect(r.goal.requested_by).toBe(OWNER);
    }
  });
  it('rejects non-allowlisted owner, replayed nonce, expiry, and secrets', () => {
    expect(intakeCommand({ envelope: envelope({ owner_identity: 'intruder' }), ownerAllowlist: ALLOW, seenNonces: new Set(), goalId: 'g1', now: NOW }).ok).toBe(false);
    expect(intakeCommand({ envelope: envelope(), ownerAllowlist: ALLOW, seenNonces: new Set(['nonce-1']), goalId: 'g1', now: NOW }).ok).toBe(false);
    expect(intakeCommand({ envelope: envelope({ expires_at: '2026-07-22T11:00:00.000Z' }), ownerAllowlist: ALLOW, seenNonces: new Set(), goalId: 'g1', now: NOW }).ok).toBe(false);
    const sec = intakeCommand({ envelope: envelope({ objective: 'store the secret value' }), ownerAllowlist: ALLOW, seenNonces: new Set(), goalId: 'g1', now: NOW });
    expect(sec.ok).toBe(false);
  });
  it('passes control commands through structurally', () => {
    const r = intakeCommand({ envelope: envelope({ command_type: 'owner_stop' }), ownerAllowlist: ALLOW, seenNonces: new Set(), goalId: 'g1', now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('control');
  });
});

function stateFromGoal(goal: MasterGoal, specs: TaskSpec[]): GoalState {
  const d = decomposeGoal(goal, specs, (l) => `job-${l}`, NOW);
  if (!d.ok) throw new Error('decompose failed: ' + d.errors.join(','));
  return { goal: { ...goal, status: 'decomposed' }, jobs: d.jobs, iteration: 0, started_at: NOW };
}

describe('end-to-end simulation driver', () => {
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'impl', objective: 'add helper', depends_on_local: [] },
    { local_id: 'b', kind: 'test', title: 'test', objective: 'test helper', depends_on_local: ['a'] },
    { local_id: 'c', kind: 'audit', title: 'audit', objective: 'review helper', depends_on_local: ['b'] },
  ];
  function goal(): MasterGoal {
    const r = intakeCommand({ envelope: envelope(), ownerAllowlist: ALLOW, seenNonces: new Set(), goalId: 'goal-00000001', now: NOW });
    if (!r.ok || r.kind !== 'goal') throw new Error('intake failed');
    return r.goal;
  }

  it('drives a full GREEN goal to completed with zero execution/sends', () => {
    const state = stateFromGoal(goal(), specs);
    let t = Date.parse(NOW);
    const out = runGoalSimulation(state, () => (t += 1000), {});
    expect(out.final_status).toBe('completed');
    expect(out.any_executed).toBe(false);
    expect(out.any_sent).toBe(false);
    expect(out.jobs.every((j) => j.status === 'completed')).toBe(true);
    // every adapter result was simulated, never executed
    for (const e of out.transcript) {
      for (const r of e.adapter_results) {
        expect(r.executed).toBe(false);
        expect(r.simulated).toBe(true);
      }
    }
  });

  it('holds a gated (RED) job forever without self-approving', () => {
    const gatedSpecs: TaskSpec[] = [
      { local_id: 'a', kind: 'migration', title: 'apply', objective: 'deploy to production database', depends_on_local: [] },
    ];
    const state = stateFromGoal(goal(), gatedSpecs);
    // the RED job requires approval; HOLD oracle never approves
    let t = Date.parse(NOW);
    const out = runGoalSimulation(state, () => (t += 1000), { approvalOracle: HOLD_ORACLE, maxSteps: 20 });
    expect(out.final_status).toBe('blocked');
    expect(out.jobs[0].status).toBe('awaiting_approval');
  });

  it('proceeds a gated job only after an explicit owner approve', () => {
    const gatedSpecs: TaskSpec[] = [
      { local_id: 'a', kind: 'migration', title: 'apply', objective: 'deploy to production database', depends_on_local: [] },
    ];
    const state = stateFromGoal(goal(), gatedSpecs);
    let t = Date.parse(NOW);
    const out = runGoalSimulation(state, () => (t += 1000), { approvalOracle: () => 'approve' });
    expect(out.final_status).toBe('completed');
    expect(out.jobs[0].status).toBe('completed');
  });

  it('cancels a gated job on owner reject', () => {
    const gatedSpecs: TaskSpec[] = [
      { local_id: 'a', kind: 'migration', title: 'apply', objective: 'deploy to production database', depends_on_local: [] },
    ];
    const state = stateFromGoal(goal(), gatedSpecs);
    let t = Date.parse(NOW);
    const out = runGoalSimulation(state, () => (t += 1000), { approvalOracle: () => 'reject', maxSteps: 20 });
    expect(out.jobs[0].status).toBe('cancelled');
    expect(out.final_status === 'cancelled' || out.final_status === 'completed').toBe(true);
  });
});
