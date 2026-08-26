import { describe, expect, it } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import { composeRequest } from '../src/lib/ai-os/orchestration/composer';
import { confirmComposedRequest } from '../src/lib/ai-os/orchestration/composer-persist';
import { checkRealJobContract } from '../src/lib/ai-os/real-claude-adapter';
import type { GoalJob } from '../src/lib/ai-os/orchestration/model';

// Bounded-execution routing regression suite (prod drill goal
// 6b5d32c5-e9e7-48ca-a2ac-7f37a9a09e20, 2026-08-26):
//  - kind=audit kept the adapter-less 'audit' ROLE, so the strict-real
//    executor refused provider_not_claude -> 3 attempts -> dead-letter.
//  - planning/preparation wording matched no kind lexicon entry, fell to
//    'unknown', and the Level-1 adapters exclude unknown by design ->
//    kind_not_eligible -> dead-letter.
// The fix is routing/classification ONLY: role-less audit-kind jobs route
// to claude (which holds the audit capability; explicit codex honored),
// and planning/preparation vocabulary deterministically classifies as
// 'recommendation'. Every adapter gate, risk ceiling, approval gate, and
// prohibition stays exactly as before - pinned below.

const OWNER = 'info@preston.nyc';
const NOW = '2026-08-20T12:00:00.000Z';
const LATER = '2026-08-20T13:00:00.000Z';
const NOW_MS = Date.parse(NOW);

async function persistedJobs(request: string, requestId: string) {
  const db = makeComposerFakeDb();
  const composed = composeRequest(request);
  expect(composed.ok, JSON.stringify(composed)).toBe(true);
  if (!composed.ok) throw new Error('unreachable');
  const out = await confirmComposedRequest(db.client, {
    ownerEmail: OWNER, rawRequest: request, requestKey: requestId,
    presentedHash: composed.proposal_hash, now: NOW,
  });
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return db.rowsOf('goal_jobs') as unknown as GoalJob[];
}

// Claim-image job the driver would hand a real executor (leased, fenced).
function claimImage(row: GoalJob, over?: Partial<GoalJob>): GoalJob {
  return {
    ...row,
    status: 'in_progress', run_id: `${row.id}:run-1`,
    run_lease_expires_at: LATER, ...over,
  };
}

function contract(job: GoalJob) {
  return checkRealJobContract({
    job,
    ownerIdentity: OWNER,
    goalEnvironment: 'staging',
    goalSimulationOnly: true,
    runId: `${job.id}:run-1`,
    nowMs: NOW_MS,
  });
}

describe('1+2. harmless audit routes to an eligible claude real path', () => {
  it('role-less audit-kind task persists with assigned_role claude and satisfies the real contract', async () => {
    const jobs = await persistedJobs(
      'Create one task to audit the runtime safety posture in a simulation-only note.',
      'pc-route-audit-1');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('audit');
    expect(jobs[0].assigned_role).toBe('claude');
    expect(jobs[0].requires_approval).toBe(false);
    const c = contract(claimImage(jobs[0]));
    expect(c).toEqual({ ok: true });
  });

  it('an explicit codex request on an audit task is still honored', async () => {
    const jobs = await persistedJobs(
      'Create one task to audit the drill evidence using codex.',
      'pc-route-audit-2');
    expect(jobs[0].kind).toBe('audit');
    expect(jobs[0].assigned_role).toBe('codex');
  });
});

describe('2. planning/preparation classifies deterministically as recommendation', () => {
  it('plan wording -> recommendation, claude, no approval', async () => {
    const jobs = await persistedJobs(
      'Create one task to plan the rollout steps for the next teamwork drill.',
      'pc-route-plan-1');
    expect(jobs[0].kind).toBe('recommendation');
    expect(jobs[0].assigned_role).toBe('claude');
    expect(jobs[0].requires_approval).toBe(false);
    expect(contract(claimImage(jobs[0]))).toEqual({ ok: true });
  });

  it('prepare/outline wording -> recommendation', async () => {
    const jobs = await persistedJobs(
      'Create one task to prepare an outline for the drill retrospective.',
      'pc-route-plan-2');
    expect(jobs[0].kind).toBe('recommendation');
  });

  it('a migration plan still classifies as migration (lexicon order unchanged) and stays approval-gated', async () => {
    const jobs = await persistedJobs(
      'Create one task to draft a schema migration plan for owner review.',
      'pc-route-plan-3');
    expect(jobs[0].kind).toBe('migration');
    expect(jobs[0].requires_approval).toBe(true);
  });
});

describe('3. code behavior unchanged', () => {
  it('implement wording -> code, claude, contract-eligible', async () => {
    const jobs = await persistedJobs(
      'Create one task to implement a small helper function in the dashboard.',
      'pc-route-code-1');
    expect(jobs[0].kind).toBe('code');
    expect(jobs[0].assigned_role).toBe('claude');
    expect(contract(claimImage(jobs[0]))).toEqual({ ok: true });
  });
});

describe('4. genuinely ambiguous work stays fail-closed', () => {
  it('lexicon miss -> kind unknown; the real adapter still refuses kind_not_eligible', async () => {
    const jobs = await persistedJobs(
      'Create one task to zorble the frobnicator gently.',
      'pc-route-unknown-1');
    expect(jobs[0].kind).toBe('unknown');
    const c = contract(claimImage(jobs[0]));
    expect(c).toEqual({ ok: false, reason: 'kind_not_eligible' });
  });
});

describe('5-9. gated and prohibited classes remain exactly as before', () => {
  it('migration kind is adapter-ineligible at Level 1 even when leased', async () => {
    const jobs = await persistedJobs(
      'Create one task to draft a schema migration plan for owner review.',
      'pc-route-mig-1');
    const c = contract(claimImage(jobs[0]));
    expect(c).toEqual({ ok: false, reason: 'kind_not_eligible' });
  });

  it('production-targeting text is rejected outright', () => {
    const composed = composeRequest(
      'Create one task to update the production database contents.');
    expect(composed.ok).toBe(false);
    if (!composed.ok) {
      expect(composed.errors.join(' ')).toContain('prohibited:');
    }
  });

  it('external send text is rejected outright', () => {
    const composed = composeRequest(
      'Create one task to send the summary email to the client.');
    expect(composed.ok).toBe(false);
  });

  it('destructive command text is rejected outright', () => {
    const composed = composeRequest(
      'Create one task to delete all customer records from the database.');
    expect(composed.ok).toBe(false);
    if (!composed.ok) {
      expect(composed.errors.join(' ')).toContain('prohibited:destructive_action');
    }
  });

  it('airtable write stays blocked: RED mobile-gate (approval-required) AND an adapter-ineligible kind', async () => {
    // Not composer-rejected outright, but doubly blocked: the mobile-gate
    // classifies airtable_write as RED/approval-required, and it never
    // classifies into an eligible implementer kind, so it can never
    // real-execute even if an owner approval were somehow granted.
    const jobs = await persistedJobs(
      'Create one task to airtable-write the drill results into the base.',
      'pc-route-airtable-1');
    expect(jobs[0].requires_approval).toBe(true);
    expect(jobs[0].kind).not.toBe('code');
    const c = contract(claimImage(jobs[0]));
    expect(c.ok).toBe(false);
  });
});

describe('10. provider/risk mismatches still fail closed at the contract', () => {
  it('audit ROLE (adapter-less) is still refused by the claude contract', async () => {
    const jobs = await persistedJobs(
      'Create one task to audit the runtime safety posture in a simulation-only note.',
      'pc-route-prov-1');
    const c = contract(claimImage(jobs[0], { assigned_role: 'audit' }));
    expect(c).toEqual({ ok: false, reason: 'provider_not_claude' });
  });

  it('RED risk is refused regardless of kind/role', async () => {
    const jobs = await persistedJobs(
      'Create one task to audit the runtime safety posture in a simulation-only note.',
      'pc-route-risk-1');
    const c = contract(claimImage(jobs[0], { risk_class: 'RED' }));
    expect(c).toEqual({ ok: false, reason: 'risk_exceeds_allowed' });
  });
});
