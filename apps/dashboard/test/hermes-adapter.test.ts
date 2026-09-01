import { describe, expect, it } from 'vitest';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';
import type { OwnerContext } from '../src/lib/ai-os/owner-context';
import type { ToolContext } from '../src/lib/preston-control/tools';
import {
  getPrestonArtifact,
  getPrestonEvidence,
  getPrestonGoal,
  getPrestonJob,
  getPrestonStatus,
  hermesToolContext,
  listPrestonApprovals,
  pollPrestonEvents,
} from '../src/lib/hermes/adapter';
import { makeComposerFakeDb } from './composer-fake-db';

// Hermes Supervisor Dashboard v0 - adapter behavior. The adapter is a
// thin delegation onto the sealed Preston Control tool layer; these tests
// prove (1) the delegation is faithful, (2) the WHOLE adapter surface is
// read-only against a recording client (zero inserts/updates/rpc), and
// (3) fail-closed results pass through unchanged (UNKNOWN handling
// happens in the view models, never by inventing data here).

const NOW = '2026-08-31T12:00:00.000Z';
const T0 = '2026-08-31T10:00:00.000Z';
const GOAL_ID = '11111111-2222-4333-8444-555555555555';
const JOB_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

interface Mutation {
  kind: 'insert' | 'update' | 'rpc';
  target: string;
}

// Wrap the shared fake client so every mutating call is recorded. Reads
// pass through untouched.
function recordingClient(base: ComposerClient) {
  const mutations: Mutation[] = [];
  const client = {
    from(table: string) {
      const real = base.from(table) as Record<string, unknown>;
      return {
        ...real,
        insert(row: Record<string, unknown>) {
          mutations.push({ kind: 'insert', target: table });
          return (real.insert as (r: unknown) => unknown)(row);
        },
        update(patch: Record<string, unknown>) {
          mutations.push({ kind: 'update', target: table });
          return (real.update as (p: unknown) => unknown)(patch);
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      mutations.push({ kind: 'rpc', target: fn });
      return base.rpc(fn, args);
    },
  } as unknown as ComposerClient;
  return { client, mutations };
}

function seededDb() {
  const fake = makeComposerFakeDb();
  fake.rowsOf('master_goals').push({
    id: GOAL_ID, title: 'Drill goal', objective: 'obj', status: 'running',
    source: 'owner', requested_by: 'info@preston.nyc',
    environment: 'staging', correlation_id: 'corr-1',
    simulation_only: true, iteration: 0, created_at: T0, updated_at: T0,
  });
  fake.rowsOf('goal_jobs').push({
    id: JOB_ID, goal_id: GOAL_ID, kind: 'audit', title: 'Drill job',
    objective: 'obj', status: 'completed', risk_class: 'GREEN',
    assigned_role: 'claude', attempts: 1, requires_approval: false,
    approval_id: null, correlation_id: 'corr-1',
    evidence_refs: ['note:done'], failure_reason: null,
    created_at: T0, updated_at: T0, run_id: null,
    run_lease_expires_at: null,
  });
  return fake;
}

function ctxFor(client: ComposerClient): ToolContext {
  return { client, ownerEmail: 'info@preston.nyc', now: NOW };
}

describe('hermesToolContext', () => {
  it('binds the owner session client and email', () => {
    const fake = seededDb();
    const owner = {
      ownerEmail: 'info@preston.nyc',
      client: fake.client,
      audit: fake.client,
    } as unknown as OwnerContext;
    const tctx = hermesToolContext(owner, NOW);
    expect(tctx.ownerEmail).toBe('info@preston.nyc');
    expect(tctx.now).toBe(NOW);
    expect(tctx.client).toBe(fake.client);
  });
});

describe('adapter delegation is faithful and read-only', () => {
  it('getPrestonStatus reports the platform status without any write', async () => {
    const fake = seededDb();
    const rec = recordingClient(fake.client);
    const out = await getPrestonStatus(ctxFor(rec.client));
    expect(out.environment).toBeDefined();
    expect(out.controls.execution_enabled).toBe(false);
    expect(out.summary.total_goals).toBe(1);
    expect(out.recent_goals[0].goal_id).toBe(GOAL_ID);
    expect(rec.mutations).toEqual([]);
  });

  it('getPrestonGoal returns the goal graph without any write', async () => {
    const fake = seededDb();
    const rec = recordingClient(fake.client);
    const out = await getPrestonGoal(ctxFor(rec.client), GOAL_ID);
    expect(out.found).toBe(true);
    if (out.found) {
      expect(out.goal.goal_id).toBe(GOAL_ID);
      expect(out.jobs).toHaveLength(1);
      expect(out.job_status_counts['completed']).toBe(1);
      expect(out.evidence_refs).toEqual([
        { job_id: JOB_ID, ref: 'note:done' },
      ]);
    }
    expect(rec.mutations).toEqual([]);
  });

  it('getPrestonJob returns the job + reports without any write', async () => {
    const fake = seededDb();
    const rec = recordingClient(fake.client);
    const out = await getPrestonJob(ctxFor(rec.client), JOB_ID);
    expect(out.found).toBe(true);
    if (out.found) {
      expect(out.job.job_id).toBe(JOB_ID);
      expect(out.run.active).toBe(false);
      expect(out.result_reports).toEqual([]);
    }
    expect(rec.mutations).toEqual([]);
  });

  it('listPrestonApprovals + evidence + events + artifact are write-free', async () => {
    const fake = seededDb();
    const rec = recordingClient(fake.client);
    const ctx = ctxFor(rec.client);

    const approvals = await listPrestonApprovals(ctx);
    expect(approvals.read_ok).toBe(true);
    expect(approvals.approvals).toEqual([]);

    const evidence = await getPrestonEvidence(ctx, { goal_id: GOAL_ID });
    expect(evidence.ok).toBe(true);

    const events = await pollPrestonEvents(ctx, {});
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events.some((e) => e.job_id === JOB_ID)).toBe(true);
      expect(events.window.migration_applied).toBe(true);
    }

    const artifact = await getPrestonArtifact(
      ctx,
      'art-' + 'a'.repeat(32),
    );
    expect(artifact.found).toBe(false);
    if (!artifact.found) expect(artifact.error).toBe('not_found');

    expect(rec.mutations).toEqual([]);
  });

  it('an invalid cursor passes through as cursor_invalid, never an empty feed', async () => {
    const fake = seededDb();
    const rec = recordingClient(fake.client);
    const out = await pollPrestonEvents(ctxFor(rec.client), {
      cursor: 'garbage-cursor-123',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('cursor_invalid');
    expect(rec.mutations).toEqual([]);
  });

  it('fail-closed tool errors pass through unchanged', async () => {
    const fake = seededDb();
    const out = await getPrestonGoal(ctxFor(fake.client), 'not-a-uuid');
    expect(out.found).toBe(false);
    if (!out.found) expect(out.error).toBe('goal_id_invalid');
    const art = await getPrestonArtifact(ctxFor(fake.client), 'nope');
    expect(art.found).toBe(false);
    if (!art.found) expect(art.error).toBe('artifact_id_invalid');
  });
});
