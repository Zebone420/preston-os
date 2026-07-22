import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  validateMasterGoal,
  validateGoalJob,
  type GoalJob,
  type GoalState,
  type MasterGoal,
} from '../src/lib/ai-os/orchestration/model';
import {
  AGENT_CONTRACTS,
  UNIVERSAL_PROHIBITIONS,
  agentMayProposeRisk,
  auditContracts,
  canAgentPerform,
} from '../src/lib/ai-os/orchestration/agent-contracts';
import {
  evaluatePolicy,
  isAutoRunnable,
} from '../src/lib/ai-os/orchestration/policy';
import {
  actionHash,
  makeApprovalRequest,
  renderApprovalMessage,
  validateApprovalDecision,
  type ApprovalRequest,
} from '../src/lib/ai-os/orchestration/approvals';
import {
  decomposeGoal,
  type TaskSpec,
} from '../src/lib/ai-os/orchestration/decomposition';
import { step } from '../src/lib/ai-os/orchestration/completion-engine';
import {
  makeSimulationAdapter,
  probeRealCapability,
} from '../src/lib/ai-os/orchestration/adapters';
import {
  COORDINATOR_LADDER,
  observeAndReconcile,
} from '../src/lib/ai-os/orchestration/coordinator';

const NOW = '2026-07-22T12:00:00.000Z';
const OWNER = 'owner@preston.nyc';

function goal(overrides: Partial<MasterGoal> = {}): MasterGoal {
  return {
    id: 'goal-00000001',
    title: 'Test goal',
    objective: 'Do a bounded thing',
    source: 'chatgpt',
    requested_by: 'owner@preston.nyc',
    status: 'proposed',
    environment: 'staging',
    budget: DEFAULT_BUDGET,
    correlation_id: 'corr-goal-0001',
    simulation_only: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe('model validation - fail closed', () => {
  it('accepts a valid staging goal', () => {
    expect(validateMasterGoal(goal())).toEqual([]);
  });
  it('rejects non-staging environment and non-simulation', () => {
    expect(validateMasterGoal(goal({ environment: 'production' as never })))
      .toContain('environment_must_be_staging');
    expect(validateMasterGoal(goal({ simulation_only: false as never })))
      .toContain('simulation_only_must_be_true');
  });
  it('rejects self-dependency in a job', () => {
    const j: GoalJob = {
      id: 'job-00000001', goal_id: 'goal-00000001', kind: 'code',
      title: 't', objective: 'o', risk_class: 'YELLOW', assigned_role: 'claude',
      depends_on: ['job-00000001'], status: 'pending', attempts: 0,
      requires_approval: false, approval_id: null, runtime_job_id: null,
      correlation_id: 'corr-x-0001', evidence_refs: [], failure_reason: null,
      created_at: NOW, updated_at: NOW,
    };
    expect(validateGoalJob(j)).toContain('self_dependency');
  });
});

// ---------------------------------------------------------------------------
describe('agent contracts - default deny, no self-approval', () => {
  it('no contract can approve and none claims a universal prohibition', () => {
    expect(auditContracts()).toEqual([]);
    for (const c of Object.values(AGENT_CONTRACTS)) {
      expect(c.can_approve).toBe(false);
      expect(c.network_scope).toBe('none');
      expect(c.environment_scope).toBe('staging');
    }
  });
  it('denies capabilities not granted and all universal prohibitions', () => {
    expect(canAgentPerform('hermes', 'edit_repo')).toBe(false);
    expect(canAgentPerform('chatgpt', 'local_commit')).toBe(false);
    expect(canAgentPerform('claude', 'edit_repo')).toBe(true);
    for (const p of UNIVERSAL_PROHIBITIONS) {
      // even if some contract listed it, the checker denies it
      expect(canAgentPerform('claude', p as never)).toBe(false);
    }
  });
  it('unknown agent is denied everything', () => {
    expect(canAgentPerform('nobody' as never, 'read_repo')).toBe(false);
    expect(agentMayProposeRisk('nobody' as never, 'GREEN')).toBe(false);
  });
  it('caps proposable risk to the contract ceiling', () => {
    expect(agentMayProposeRisk('claude', 'YELLOW')).toBe(true);
    expect(agentMayProposeRisk('claude', 'RED')).toBe(false);
    expect(agentMayProposeRisk('hermes', 'YELLOW')).toBe(false);
    expect(agentMayProposeRisk('hermes', 'GREEN')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('policy engine - default deny, mobile gates, fail closed', () => {
  it('GREEN read is auto-runnable within ceiling', () => {
    const d = evaluatePolicy({ action: 'read the repo status', agent: 'claude', environment: 'staging' });
    expect(d.tier).toBe('GREEN');
    expect(d.requires_approval).toBe(false);
    expect(isAutoRunnable({ action: 'read the repo status', agent: 'claude', environment: 'staging' })).toBe(true);
  });
  it('RED actions require approval and a mobile gate', () => {
    for (const a of ['deploy to production', 'rotate the credential', 'send email to client', 'apply migration', 'push to master']) {
      const d = evaluatePolicy({ action: a, agent: 'claude', environment: 'staging' });
      expect(d.tier).toBe('RED');
      expect(d.requires_approval).toBe(true);
      expect(d.mobile_gate).toBe(true);
    }
  });
  it('non-staging environment fails closed to RED', () => {
    const d = evaluatePolicy({ action: 'read status', agent: 'claude', environment: 'production' });
    expect(d.tier).toBe('RED');
    expect(d.allowed_for_agent).toBe(false);
  });
  it('empty action fails closed', () => {
    const d = evaluatePolicy({ action: '', agent: 'claude', environment: 'staging' });
    expect(d.tier).toBe('RED');
    expect(d.reason).toBe('empty_action');
  });
});

// ---------------------------------------------------------------------------
describe('approval router - one-time, scoped, replay-protected', () => {
  const base = {
    approval_id: 'apr-00000001',
    action: 'apply staging migration 0010',
    affected_resource: 'preston-os-staging',
    reason: 'orchestration data model',
    risk_class: 'RED' as const,
    evidence_refs: ['ev-1'],
    expected_effect: 'creates orchestration tables',
    rollback_plan: 'owner drops the new tables',
    owner_identity: 'owner@preston.nyc',
    now: NOW,
  };

  function req(): ApprovalRequest {
    const r = makeApprovalRequest(base);
    if (!r.ok) throw new Error(r.errors.join(','));
    return r.request;
  }

  it('rejects secrets in an approval message', () => {
    // The word "secret" alone trips the detector; no secret-shaped literal is
    // needed (and none is written here, so the repo scanner stays clean).
    const r = makeApprovalRequest({ ...base, reason: 'this reason mentions a secret in prose' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('secret_in_approval');
  });

  it('approves only the owner, with the exact hash, once, unexpired', () => {
    const request = req();
    const good = validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve',
      decided_by: 'owner@preston.nyc', decided_at: NOW, nonce: 'n1',
      presented_hash: request.action_hash,
    }, new Set());
    expect(good.ok).toBe(true);
    expect(good.status).toBe('approved');
  });

  it('rejects a non-owner actor (and self-approval)', () => {
    const request = req();
    const notOwner = validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve',
      decided_by: 'claude', decided_at: NOW, nonce: 'n1',
      presented_hash: request.action_hash,
    }, new Set());
    expect(notOwner.ok).toBe(false);
    expect(notOwner.reason).toBe('actor_not_owner');

    const selfApprove = validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve',
      decided_by: 'owner@preston.nyc', decided_at: NOW, nonce: 'n1',
      presented_hash: request.action_hash,
    }, new Set(), 'owner@preston.nyc');
    expect(selfApprove.ok).toBe(false);
    expect(selfApprove.reason).toBe('self_approval_denied');
  });

  it('rejects wrong hash, replayed nonce, and expiry', () => {
    const request = req();
    expect(validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve',
      decided_by: 'owner@preston.nyc', decided_at: NOW, nonce: 'n1',
      presented_hash: 'deadbeef',
    }, new Set()).reason).toBe('hash_mismatch');

    expect(validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve',
      decided_by: 'owner@preston.nyc', decided_at: NOW, nonce: 'used',
      presented_hash: request.action_hash,
    }, new Set(['used'])).reason).toBe('nonce_replay');

    expect(validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve',
      decided_by: 'owner@preston.nyc',
      decided_at: '2026-07-22T13:00:00.000Z', nonce: 'n2',
      presented_hash: request.action_hash,
    }, new Set()).status).toBe('expired');
  });

  it('hash binds action+resource+env; message carries no secret', () => {
    const request = req();
    expect(request.action_hash).toBe(actionHash(base.action, base.affected_resource, 'staging'));
    expect(request.action_hash).not.toBe(actionHash('other action', base.affected_resource, 'staging'));
    const msg = renderApprovalMessage(request);
    expect(msg).toContain('approve / reject / more_info');
    expect(msg).not.toMatch(/password|api_key|secret/i);
  });

  // --- audit-repair regressions ------------------------------------------
  it('rejects unparseable/reversed/pre-creation decision timestamps (fail closed)', () => {
    const request = req();
    // unparseable decided_at no longer slips through (was NaN > x === false)
    expect(validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve', decided_by: OWNER,
      decided_at: 'not-a-date', nonce: 'z1', presented_hash: request.action_hash,
    }, new Set()).reason).toBe('timestamp_invalid');
    // decision before the request was created
    expect(validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve', decided_by: OWNER,
      decided_at: '2026-07-22T11:59:00.000Z', nonce: 'z2', presented_hash: request.action_hash,
    }, new Set()).reason).toBe('decided_before_created');
    // exactly at expiry is expired (>= boundary)
    expect(validateApprovalDecision(request, {
      approval_id: 'apr-00000001', outcome: 'approve', decided_by: OWNER,
      decided_at: request.expires_at, nonce: 'z3', presented_hash: request.action_hash,
    }, new Set()).status).toBe('expired');
  });

  it('makeApprovalRequest fails closed on non-string/invalid now (no throw)', () => {
    const bad = makeApprovalRequest({ ...base, now: 'garbage' });
    expect(bad.ok).toBe(false);
    const badType = makeApprovalRequest({ ...base, action: 123 as never });
    expect(badType.ok).toBe(false);
  });
});

describe('crypto action binding (activation-grade)', () => {
  const env = {
    approval_id: 'apr-1', action: 'apply migration', affected_resource: 'staging-db',
    environment: 'staging' as const, owner_identity: OWNER, risk_class: 'RED',
    created_at: NOW, expires_at: '2026-07-22T12:15:00.000Z',
  };
  it('produces a 256-bit hex digest and verifies round-trip', async () => {
    const { canonicalActionHash, verifyActionHash } = await import(
      '../src/lib/ai-os/orchestration/crypto-binding'
    );
    const h = canonicalActionHash(env);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyActionHash(env, h)).toBe(true);
    expect(verifyActionHash({ ...env, action: 'apply OTHER migration' }, h)).toBe(false);
    expect(verifyActionHash(env, 'deadbeef')).toBe(false);
  });
  it('is field-order independent (canonical)', async () => {
    const { canonicalActionHash } = await import('../src/lib/ai-os/orchestration/crypto-binding');
    expect(canonicalActionHash(env)).toBe(canonicalActionHash({ ...env }));
  });
});

describe('model - source and wall-clock validation', () => {
  it('rejects an invalid goal source', () => {
    expect(validateMasterGoal(goal({ source: 'evil' as never }))).toContain('source_invalid');
  });
  it('rejects an over-large wall-clock budget', () => {
    const g = goal({ budget: { ...DEFAULT_BUDGET, max_wall_ms: 48 * 60 * 60 * 1000 } });
    expect(validateMasterGoal(g)).toContain('max_wall_ms_too_large');
  });
});

// ---------------------------------------------------------------------------
describe('decomposition - deterministic, cycle-safe, capability-checked', () => {
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'implement', objective: 'add module', depends_on_local: [] },
    { local_id: 'b', kind: 'test', title: 'test it', objective: 'unit tests', depends_on_local: ['a'] },
    { local_id: 'c', kind: 'audit', title: 'review', objective: 'audit the change', depends_on_local: ['a', 'b'] },
    { local_id: 'd', kind: 'documentation', title: 'document', objective: 'update docs', depends_on_local: ['c'] },
  ];
  const ids = (l: string) => `job-0000000${l}`;

  it('produces a topologically ordered job set', () => {
    const r = decomposeGoal(goal(), specs, ids, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const order = r.jobs.map((j) => j.id);
      expect(order).toEqual(['job-0000000a', 'job-0000000b', 'job-0000000c', 'job-0000000d']);
      // b depends on a's minted id
      expect(r.jobs[1].depends_on).toEqual(['job-0000000a']);
      // audit job assigned to the audit role
      expect(r.jobs[2].assigned_role).toBe('audit');
    }
  });

  it('is deterministic across repeated runs', () => {
    const a = decomposeGoal(goal(), specs, ids, NOW);
    const b = decomposeGoal(goal(), specs, ids, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('rejects a dependency cycle and dangling deps (fail closed)', () => {
    const cyclic: TaskSpec[] = [
      { local_id: 'x', kind: 'code', title: 'x', objective: '', depends_on_local: ['y'] },
      { local_id: 'y', kind: 'code', title: 'y', objective: '', depends_on_local: ['x'] },
    ];
    expect(decomposeGoal(goal(), cyclic, ids, NOW).ok).toBe(false);
    const dangling: TaskSpec[] = [
      { local_id: 'x', kind: 'code', title: 'x', objective: '', depends_on_local: ['missing'] },
    ];
    expect(decomposeGoal(goal(), dangling, ids, NOW).ok).toBe(false);
  });

  it('rejects over-budget decomposition size', () => {
    const many: TaskSpec[] = Array.from({ length: 5 }, (_, i) => ({
      local_id: `t${i}`, kind: 'code' as const, title: `t${i}`, objective: '', depends_on_local: [],
    }));
    const r = decomposeGoal(goal({ budget: { ...DEFAULT_BUDGET, max_jobs: 3 } }), many, ids, NOW);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
function runFullGoal(jobsOverride?: (jobs: GoalJob[]) => void): GoalState {
  const specs: TaskSpec[] = [
    { local_id: 'a', kind: 'code', title: 'impl', objective: 'add x', depends_on_local: [] },
    { local_id: 'b', kind: 'test', title: 'test', objective: 'test x', depends_on_local: ['a'] },
  ];
  const r = decomposeGoal(goal(), specs, (l) => `job-0000000${l}`, NOW);
  if (!r.ok) throw new Error('decompose failed');
  if (jobsOverride) jobsOverride(r.jobs);
  return { goal: { ...goal(), status: 'decomposed' }, jobs: r.jobs, iteration: 0, started_at: NOW };
}

describe('completion engine - bounded, fail-closed, deterministic', () => {
  it('drives a simple goal to completion via simulation adapters', () => {
    const state = runFullGoal();
    const adapter = makeSimulationAdapter('claude');
    let nowMs = Date.parse(NOW);
    let guard = 0;
    while (guard++ < 50) {
      const s = step(state, nowMs);
      if (s.done) {
        expect(s.status).toBe('completed');
        break;
      }
      for (const act of s.actions) {
        const job = state.jobs.find((j) => j.id === (act as { job_id?: string }).job_id);
        if (!job) continue;
        if (act.type === 'assign') job.status = 'assigned';
        else if (act.type === 'run') {
          const res = adapter.runJob(job, new Date(nowMs).toISOString());
          expect(res.executed).toBe(false);
          expect(res.simulated).toBe(true);
          job.status = res.outcome === 'completed' ? 'completed' : 'failed';
          job.evidence_refs.push(...res.evidence_refs);
        }
      }
      state.iteration++;
      nowMs += 1000;
    }
    expect(state.jobs.every((j) => j.status === 'completed')).toBe(true);
    expect(guard).toBeLessThan(50);
  });

  it('requests approval and blocks (never self-approves) for a gated job', () => {
    const state = runFullGoal((jobs) => { jobs[0].requires_approval = true; });
    const s = step(state, Date.parse(NOW));
    expect(s.actions.some((a) => a.type === 'request_approval')).toBe(true);
    expect(s.status).toBe('blocked');
    expect(s.done).toBe(false);
  });

  it('dead-letters a job past its retry budget', () => {
    const state = runFullGoal((jobs) => {
      jobs[0].status = 'failed';
      jobs[0].attempts = DEFAULT_BUDGET.max_job_retries + 1;
      jobs[0].failure_reason = 'persistent';
    });
    const s = step(state, Date.parse(NOW));
    expect(s.actions.some((a) => a.type === 'dead_letter')).toBe(true);
  });

  it('escalates and stops at the iteration cap', () => {
    const state = runFullGoal();
    state.iteration = DEFAULT_BUDGET.max_iterations;
    const s = step(state, Date.parse(NOW));
    expect(s.done).toBe(true);
    expect(s.status).toBe('dead_lettered');
    expect(s.reason).toBe('max_iterations');
  });

  it('stops at the wall-clock deadline', () => {
    const state = runFullGoal();
    const s = step(state, Date.parse(NOW) + DEFAULT_BUDGET.max_wall_ms + 1);
    expect(s.done).toBe(true);
    expect(s.reason).toBe('deadline_exceeded');
  });

  it('treats an in-flight job as running, never dead-letters it (audit F2)', () => {
    const state = runFullGoal((jobs) => {
      jobs[0].status = 'completed';
      jobs[1].status = 'in_progress'; // adapter owns it this iteration
    });
    const s = step(state, Date.parse(NOW));
    expect(s.done).toBe(false);
    expect(s.status).toBe('running');
    expect(s.reason).toBe('jobs_in_flight');
  });
});

// ---------------------------------------------------------------------------
describe('adapters - simulation only, real capability fails closed', () => {
  it('simulation adapter never executes and honors write scope', () => {
    const state = runFullGoal();
    const claude = makeSimulationAdapter('claude');
    const res = claude.runJob(state.jobs[0], NOW);
    expect(res.executed).toBe(false);
    expect(res.simulated).toBe(true);
    expect(res.outcome).toBe('completed');

    const hermes = makeSimulationAdapter('hermes'); // write_scope none
    const refused = hermes.runJob(state.jobs[0], NOW);
    expect(refused.outcome).toBe('failed');
    expect(refused.failure_reason).toBe('write_scope_violation');
  });
  it('real capability is unavailable until an activation gate', () => {
    expect(probeRealCapability('claude')).toBe('unavailable');
    expect(probeRealCapability('codex')).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
describe('coordinator - observe/reconcile, never approves or executes', () => {
  it('summarizes and escalates in observe_only without retry intents', () => {
    const state = runFullGoal((jobs) => { jobs[0].status = 'failed'; jobs[0].attempts = 1; });
    const rep = observeAndReconcile('observe_only', state, Date.parse(NOW));
    expect(rep.can_approve).toBe(false);
    expect(rep.can_execute).toBe(false);
    expect(rep.intents.some((i) => i.type === 'summarize')).toBe(true);
    expect(rep.intents.some((i) => i.type === 'request_retry')).toBe(false);
  });
  it('requests bounded retries in coordinator_simulation', () => {
    const state = runFullGoal((jobs) => { jobs[0].status = 'failed'; jobs[0].attempts = 1; });
    const rep = observeAndReconcile('coordinator_simulation', state, Date.parse(NOW));
    expect(rep.intents.some((i) => i.type === 'request_retry')).toBe(true);
    expect(rep.can_approve).toBe(false);
  });
  it('ladder order is fixed', () => {
    expect(COORDINATOR_LADDER[0]).toBe('observe_only');
    expect(COORDINATOR_LADDER[1]).toBe('coordinator_simulation');
    expect(COORDINATOR_LADDER.at(-1)).toBe('production_candidate');
  });
});
