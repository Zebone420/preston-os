// Live prod defect regression (2026-08-28, owner-approved remap): the
// Business Setup Wizard repository-classification repair goal dead-lettered
// every job TERMINAL real_required:kind_not_eligible because the composer's
// kind lexicon minted kind 'repair' from ordinary fix/repair/remediate
// language, and the Level-1 real adapters exclude 'repair' BY DESIGN
// ('repair' = self-modification of failing runtime state). Repository fix
// work is bounded worktree edit work: kind 'code'.
//
// These pins prove the remap end-to-end AND that nothing was weakened:
// adapter eligible sets untouched, risk/approval text classification
// untouched, migration still excluded, unknown still rejected, and
// kind_not_eligible still classifies TERMINAL when legitimately emitted.

import { describe, expect, it } from 'vitest';
import { composeRequest } from '../src/lib/ai-os/orchestration/composer';
import { classifyJob } from '../src/lib/ai-os/orchestration/policy';
import { classifyFailure } from '../src/lib/ai-os/orchestration/outcomes';
import {
  checkRealJobContract,
  REAL_CLAUDE_ELIGIBLE_KINDS,
} from '../src/lib/ai-os/real-claude-adapter';
import {
  checkRealCodexJobContract,
  REAL_CODEX_ELIGIBLE_KINDS,
} from '../src/lib/ai-os/real-codex-adapter';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

const NOW = '2026-08-28T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const LATER = '2026-08-28T12:30:00.000Z';

function okOf(r: ReturnType<typeof composeRequest>) {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.errors.join(','));
  return r;
}
function errsOf(r: ReturnType<typeof composeRequest>): string[] {
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
}

function leasedJob(over?: Partial<GoalJob>): GoalJob {
  return {
    id: 'job-remap-0001', goal_id: 'goal-remap-0001', kind: 'code',
    title: 'fix classification', objective: 'repair the classification path',
    risk_class: 'GREEN', assigned_role: 'claude', depends_on: [],
    status: 'in_progress', attempts: 0, requires_approval: false,
    approval_id: null, runtime_job_id: null, correlation_id: 'corr-remap',
    evidence_refs: [], failure_reason: null,
    run_id: 'job-remap-0001:run-1', run_lease_expires_at: LATER,
    created_at: NOW, updated_at: NOW, ...over,
  };
}

describe('fix/repair/remediate language composes kind CODE (the remap)', () => {
  const FIX_REQUESTS = [
    'Fix the goal composer.',
    'Repair the repository classification lexicon.',
    'Remediate the failing import path.',
  ];

  it.each(FIX_REQUESTS)('%s -> one code task', (req) => {
    const p = okOf(composeRequest(req));
    expect(p.goals).toHaveLength(1);
    expect(p.goals[0].tasks).toHaveLength(1);
    expect(p.goals[0].tasks[0].kind).toBe('code');
  });

  it('the composed kind is eligible for BOTH real adapters (the live gap closed)', () => {
    const kind = okOf(composeRequest('Repair the wizard classification.'))
      .goals[0].tasks[0].kind;
    expect(REAL_CLAUDE_ELIGIBLE_KINDS.has(kind)).toBe(true);
    expect(REAL_CODEX_ELIGIBLE_KINDS.has(kind)).toBe(true);
  });

  it('a leased job with the composed kind PASSES the claude contract kind gate', () => {
    const kind = okOf(composeRequest('Fix the wizard repository classification.'))
      .goals[0].tasks[0].kind;
    const r = checkRealJobContract({
      job: leasedJob({ kind }), ownerIdentity: 'owner@preston.nyc',
      goalEnvironment: 'staging', goalSimulationOnly: true,
      runId: 'job-remap-0001:run-1', nowMs: NOW_MS,
    });
    expect(r).toEqual({ ok: true }); // pre-remap: kind_not_eligible
  });

  it('the codex contract kind gate also passes for the composed kind', () => {
    const kind = okOf(composeRequest('Fix the wizard repository classification.'))
      .goals[0].tasks[0].kind;
    const r = checkRealCodexJobContract({
      job: leasedJob({ kind, assigned_role: 'codex' }),
      ownerIdentity: 'owner@preston.nyc', goalEnvironment: 'staging',
      goalSimulationOnly: true, runId: 'job-remap-0001:run-1', nowMs: NOW_MS,
    });
    expect(r).toEqual({ ok: true });
  });
});

describe('nothing weakened by the remap', () => {
  it('adapter eligible sets are UNCHANGED: repair/migration/unknown still refused', () => {
    for (const set of [REAL_CLAUDE_ELIGIBLE_KINDS, REAL_CODEX_ELIGIBLE_KINDS]) {
      expect(set.has('repair')).toBe(false);
      expect(set.has('migration')).toBe(false);
      expect(set.has('unknown')).toBe(false);
    }
    expect(checkRealJobContract({
      job: leasedJob({ kind: 'repair' }), ownerIdentity: 'owner@preston.nyc',
      goalEnvironment: 'staging', goalSimulationOnly: true,
      runId: 'job-remap-0001:run-1', nowMs: NOW_MS,
    })).toEqual({ ok: false, reason: 'kind_not_eligible' });
  });

  it('kind_not_eligible still classifies TERMINAL when legitimately emitted', () => {
    expect(classifyFailure('real_required:kind_not_eligible')).toEqual({
      outcome_class: 'TERMINAL',
      reason: 'terminal:real_required:kind_not_eligible',
    });
  });

  it('the kind LABEL is risk-neutral: policy decides from the objective text', () => {
    for (const objective of [
      'repair the classification lexicon in the composer',
      'fix the deploy script for the dashboard', // deploy = mobile-gate word
    ]) {
      const asRepair = classifyJob('repair', objective);
      const asCode = classifyJob('code', objective);
      expect(asCode).toEqual(asRepair); // identical decision either label
    }
  });

  it('dangerous wording in a fix request still gates: deploy -> approval required', () => {
    const p = okOf(composeRequest('Fix the deploy script for the dashboard.'));
    const t = p.goals[0].tasks[0];
    expect(t.kind).toBe('code');
    expect(t.requires_approval).toBe(true); // mobile-gate marker, RED tier
  });

  it('production wording in a fix request is still REJECTED outright (prohibited)', () => {
    expect(errsOf(composeRequest('Fix the production database config.')).join(','))
      .toContain('prohibited:production_access');
  });

  it('migration handling is unchanged: composes as migration, approval-gated, adapter-ineligible', () => {
    const p = okOf(composeRequest('Migrate the schema for the wizard tables.'));
    const t = p.goals[0].tasks[0];
    expect(t.kind).toBe('migration');
    expect(t.requires_approval).toBe(true); // /\bmigrat/ mobile-gate marker
    expect(REAL_CLAUDE_ELIGIBLE_KINDS.has('migration')).toBe(false);
  });

  it('true unknown work is still rejected fail-closed, never composed', () => {
    expect(errsOf(composeRequest('Zorble the frobnicator.')).join(','))
      .toContain('ambiguous_request:task_kind_unresolved');
  });
});

describe('setup/branch wording - CURRENT behavior pinned (separate work unit)', () => {
  // The same live wizard goal also carries setup/branch phrasing. Today that
  // wording resolves to NO kind and the request is rejected fail-closed at
  // submission (visible to ChatGPT immediately; rephrasing with an edit verb
  // like "implement" composes fine). Mapping bare setup/configure/branch
  // words to an executable kind is deliberately NOT part of this owner-
  // approved remap: those words have plausible non-repository readings, so
  // widening them is a separate reviewed work unit. These pins document the
  // gap and will fail loudly if the behavior drifts silently.
  it('"Set up the wizard branch." is rejected task_kind_unresolved (unchanged)', () => {
    expect(errsOf(composeRequest('Set up the wizard branch.')).join(','))
      .toContain('ambiguous_request:task_kind_unresolved');
  });

  it('"Implement the wizard setup branch." composes as code (existing verb path)', () => {
    const p = okOf(composeRequest('Implement the wizard setup branch.'));
    expect(p.goals[0].tasks[0].kind).toBe('code');
  });
});
