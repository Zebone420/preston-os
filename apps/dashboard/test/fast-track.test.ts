// Fast-track master goal - regression pins for Phases A/B/D/E/H/J.
// A1 central outcome authority; A2 unknown-kind fail-closed; B structured
// result contract; D1 bounded parallel run execution; E routing table;
// H attention notifications (dedup, bounded, inert-unless-configured);
// J span-level redaction.

import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  classifyFailure,
  isSupportedKind,
} from '../src/lib/ai-os/orchestration/outcomes';
import { step } from '../src/lib/ai-os/orchestration/completion-engine';
import {
  driveGoal,
  driverStep,
  type RealJobExecutor,
} from '../src/lib/ai-os/orchestration/driver';
import {
  insertGoalJob,
  insertMasterGoal,
} from '../src/lib/ai-os/orchestration/store';
import {
  decomposeGoal,
  type TaskSpec,
} from '../src/lib/ai-os/orchestration/decomposition';
import {
  DEFAULT_BUDGET,
  type GoalJob,
  type GoalState,
  type MasterGoal,
} from '../src/lib/ai-os/orchestration/model';
import {
  parseStructuredResult,
  structuredResultPromptClause,
  BEGIN_MARKER,
  END_MARKER,
} from '../src/lib/ai-os/structured-result';
import {
  buildClaudeArgs,
  buildLevel1Prompt,
  extractResultParts,
} from '../src/lib/ai-os/real-claude-adapter';
import { buildCodexArgs } from '../src/lib/ai-os/real-codex-adapter';
import { routeModel } from '../src/lib/ai-os/orchestration/routing';
import { notifyAttentionOnce } from '../src/lib/ai-os/notifications';
import { redactSecretSpans, looksSecret } from '../src/lib/preston-control/tools';
import { clearGateRpc } from './_clear-gate-rpc';

const NOW = '2026-08-26T12:00:00.000Z';

// --- shared fake DB (same idiom as orchestration-driver.test.ts) ------------

function makeFakeDb(controls?: Record<string, unknown>) {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push(controls ?? {
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const pk = (t: string) => (t === 'orchestration_approvals' ? 'approval_id' : 'id');
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row[key] ?? 'x' }], error: null });
          } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() {
              const matched = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({ data: matched.map((r) => ({ id: r[pk(table)] })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  (client as unknown as { rpc?: unknown }).rpc = clearGateRpc(rowsOf);
  return { client, rowsOf };
}

function goal(id = 'goal-00000001'): MasterGoal {
  return {
    id, title: 'g', objective: 'o', source: 'chatgpt',
    requested_by: 'owner@preston.nyc', status: 'decomposed', environment: 'staging',
    budget: DEFAULT_BUDGET, correlation_id: 'corr-0001', simulation_only: true,
    created_at: NOW, updated_at: NOW,
  };
}

const lockCtx = {
  base_commit: 'abc1234',
  allowed_paths: ['apps/dashboard/src/'],
  token: (jobId: string) => `tok-${jobId}`,
};

function stateOf(jobs: Partial<GoalJob>[]): GoalState {
  const g = goal();
  return {
    goal: g,
    iteration: 1,
    started_at: NOW,
    jobs: jobs.map((p, i) => ({
      id: `job-000000-${i}`, goal_id: g.id, kind: 'code', title: 't', objective: 'o',
      risk_class: 'GREEN', assigned_role: 'claude', depends_on: [], status: 'ready',
      attempts: 0, requires_approval: false, approval_id: null, runtime_job_id: null,
      correlation_id: `c-${i}`, evidence_refs: [], failure_reason: null,
      created_at: NOW, updated_at: NOW, ...p,
    } as GoalJob)),
  };
}

// --- A1: central outcome authority ------------------------------------------

describe('A1. classifyFailure - the single retry-vs-terminal authority', () => {
  it('deterministic contract refusals are TERMINAL', () => {
    for (const r of [
      'real_required:provider_not_claude',
      'real_required:provider_not_codex',
      'real_required:kind_not_eligible',
      'real_required:risk_exceeds_allowed',
      'real_required:approval_expired_at_execution',
      'unsupported_kind:unknown',
    ]) {
      expect(classifyFailure(r).outcome_class, r).toBe('TERMINAL');
    }
  });

  it('transient process/provider/lease faults are RETRYABLE', () => {
    for (const r of [
      'timeout', 'exit_1', 'killed', 'output_limit_exceeded',
      'real_executor_threw', 'path_violation',
      'real_required:provision_failed', 'real_required:spawn_failed:x',
      'real_required:lease_expired', 'real_required:adapter_refused',
    ]) {
      expect(classifyFailure(r).outcome_class, r).toBe('RETRYABLE');
    }
  });

  it('unknown/absent reasons degrade to bounded retry (fail-open to prior behavior)', () => {
    expect(classifyFailure(null).outcome_class).toBe('RETRYABLE');
    expect(classifyFailure('never_seen_before').outcome_class).toBe('RETRYABLE');
    expect(classifyFailure('real_required:brand_new_reason').outcome_class).toBe('RETRYABLE');
  });

  it('engine: a TERMINAL failure dead-letters on attempt 1 (no retry storm)', () => {
    const s = step(stateOf([{
      status: 'failed', attempts: 1,
      failure_reason: 'real_required:provider_not_claude',
    }]), Date.parse(NOW));
    expect(s.actions).toEqual([{
      type: 'dead_letter', job_id: 'job-000000-0',
      reason: 'terminal:real_required:provider_not_claude',
    }]);
  });

  it('engine: a RETRYABLE failure inside budget retries as before', () => {
    const s = step(stateOf([{ status: 'failed', attempts: 1, failure_reason: 'exit_1' }]),
      Date.parse(NOW));
    expect(s.actions).toEqual([{ type: 'retry', job_id: 'job-000000-0' }]);
  });

  it('engine: retry budget still caps RETRYABLE failures', () => {
    const s = step(stateOf([{ status: 'failed', attempts: 5, failure_reason: 'exit_1' }]),
      Date.parse(NOW));
    expect(s.actions[0].type).toBe('dead_letter');
  });
});

// --- A2: unknown kind fails closed ------------------------------------------

describe('A2. unknown/unsupported kind fails closed', () => {
  it('isSupportedKind excludes unknown', () => {
    expect(isSupportedKind('documentation')).toBe(true);
    expect(isSupportedKind('unknown')).toBe(false);
    expect(isSupportedKind('zorble')).toBe(false);
  });

  it('engine: an unknown-kind job dead-letters immediately with a readable reason', () => {
    const s = step(stateOf([{ kind: 'unknown', status: 'ready' }]), Date.parse(NOW));
    expect(s.actions).toEqual([{
      type: 'dead_letter', job_id: 'job-000000-0', reason: 'unsupported_kind:unknown',
    }]);
  });

  it('driver: an unknown-kind goal terminalizes honestly with zero attempts', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    const d = decomposeGoal(goal(), [
      { local_id: 'u', kind: 'unknown', title: 'mystery', objective: 'unclassifiable work', depends_on_local: [] } as TaskSpec,
    ], (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);
    let t = Date.parse(NOW);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, () => [], lockCtx);
    expect(r.reason).toBe('failed'); // goal failed via dead-lettered job
    const row = db.rowsOf('goal_jobs')[0];
    expect(row.status).toBe('dead_lettered');
    expect(row.attempts).toBe(0); // never executed, never consumed attempts
    expect(String(row.failure_reason)).toContain('unsupported_kind');
  });
});

// --- G2: retry keeps prior failure context ----------------------------------

describe('G2. retried jobs keep the prior failure_reason for worker context', () => {
  it('driver retry preserves failure_reason on the requeued row', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    const d = decomposeGoal(goal(), [
      { local_id: 'a', kind: 'code', title: 'impl', objective: 'add helper', depends_on_local: [] },
    ], (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);
    // Force a failed row with a retryable reason.
    Object.assign(db.rowsOf('goal_jobs')[0], { status: 'failed', attempts: 1, failure_reason: 'exit_1' });
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW), () => [], lockCtx);
    expect(r.halted).toBe(false);
    const row = db.rowsOf('goal_jobs')[0];
    expect(row.status).toBe('ready');
    expect(row.failure_reason).toBe('exit_1'); // kept, not nulled
  });

  it('the retry context reaches the worker prompt', () => {
    const prompt = buildLevel1Prompt({
      job: stateOf([{ attempts: 2, failure_reason: 'path_violation', evidence_refs: ['real-audit:x'] }]).jobs[0],
      config: { executable: '/bin/claude', baseCommit: 'abc1234', allowedPaths: ['apps/'], worktreesRoot: '/srv/worktrees' },
    });
    expect(prompt).toContain('PREVIOUS ATTEMPT');
    expect(prompt).toContain('path_violation');
    expect(prompt).toContain('WORKER_CONTEXT.md');
    expect(prompt).toContain(BEGIN_MARKER);
  });
});

// --- B: structured result contract ------------------------------------------

describe('B. structured result contract', () => {
  const block = (json: string) => `prose before\n${BEGIN_MARKER}\n${json}\n${END_MARKER}\ntrailing`;

  it('valid full block parses (code result with commit)', () => {
    const p = parseStructuredResult(block(JSON.stringify({
      schema_version: 1, summary: 'did the thing',
      files_touched: ['a.ts'], tests_run: ['vitest'], tests_passed: ['vitest'],
      tests_failed: [], commit_sha: 'abc1234', artifacts: [], limitations: ['none'],
      recommended_next_action: 'ship it',
    })));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.commit_sha).toBe('abc1234');
      expect(p.value.files_touched).toEqual(['a.ts']);
    }
  });

  it('no-code result parses (empty lists, null commit)', () => {
    const p = parseStructuredResult(block(JSON.stringify({
      schema_version: 1, summary: 'wrote a note',
    })));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.commit_sha).toBeNull();
      expect(p.value.files_touched).toEqual([]);
    }
  });

  it('malformed JSON never fabricates structured output', () => {
    const p = parseStructuredResult(block('{not json'));
    expect(p).toEqual({ ok: false, error: 'structured_block_not_json' });
  });

  it('missing block / wrong version / bad commit are typed errors', () => {
    expect(parseStructuredResult('just prose').ok).toBe(false);
    expect(parseStructuredResult(block('{"schema_version":2,"summary":"x"}'))).toEqual({ ok: false, error: 'unsupported_schema_version' });
    expect(parseStructuredResult(block('{"schema_version":1,"summary":"x","commit_sha":"zzz"}'))).toEqual({ ok: false, error: 'commit_sha_invalid' });
  });

  it('secret-shaped values inside fields are span-redacted', () => {
    const p = parseStructuredResult(block(JSON.stringify({
      schema_version: 1, summary: 'used api_key: sk-abcdef123456789 in test env',
      limitations: ['token=verysecretvalue1 not rotated'],
    })));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.summary).not.toContain('sk-abcdef123456789');
      expect(p.value.limitations[0]).not.toContain('verysecretvalue1');
    }
  });

  it('extractResultParts: parses the block from the CLI wrapper and strips it from the excerpt', () => {
    const inner = 'The work is done.\n' + BEGIN_MARKER +
      '\n{"schema_version":1,"summary":"done","tests_failed":["t1"]}\n' + END_MARKER;
    const parts = extractResultParts(JSON.stringify({ result: inner }));
    expect(parts.structured?.summary).toBe('done');
    expect(parts.structured?.tests_failed).toEqual(['t1']); // partial failure representable
    expect(parts.excerpt).toContain('The work is done.');
    expect(parts.excerpt ?? '').not.toContain(BEGIN_MARKER);
    expect(parts.structured_error).toBeNull();
  });

  it('extractResultParts: absent block -> structured null + typed reason (no fabrication)', () => {
    const parts = extractResultParts(JSON.stringify({ result: 'plain answer' }));
    expect(parts.structured).toBeNull();
    expect(parts.structured_error).toBe('no_structured_block');
    expect(parts.excerpt).toBe('plain answer');
  });

  it('the prompt clause names the contract', () => {
    const c = structuredResultPromptClause();
    expect(c).toContain(BEGIN_MARKER);
    expect(c).toContain('schema_version');
  });
});

// --- E: routing table --------------------------------------------------------

describe('E. explicit routing table', () => {
  it('no env -> CLI default (null model), auditable reason', () => {
    expect(routeModel('documentation', {})).toEqual({ model: null, reason: 'cli_default:v1', version: 1 });
  });

  it('kind-specific env wins; default env falls back; invalid ignored', () => {
    expect(routeModel('documentation', { ORCH_MODEL_DOCUMENTATION: 'claude-haiku-4-5' }).model).toBe('claude-haiku-4-5');
    expect(routeModel('code', { ORCH_MODEL_DEFAULT: 'claude-sonnet-5' })).toEqual({ model: 'claude-sonnet-5', reason: 'table:v1:default', version: 1 });
    expect(routeModel('audit', { ORCH_MODEL_AUDIT: 'bad model name!!' }).model).toBeNull();
  });

  it('args builders keep the fixed shape and only append the routed model', () => {
    expect(buildClaudeArgs('P')).toEqual(['-p', 'P', '--output-format', 'json']);
    expect(buildClaudeArgs('P', 'm-1')).toEqual(['-p', 'P', '--output-format', 'json', '--model', 'm-1']);
    expect(buildCodexArgs('P')).toEqual(['exec', '--json', 'P']);
    expect(buildCodexArgs('P', 'm-2')).toEqual(['exec', '--json', '--model', 'm-2', 'P']);
  });
});

// --- D1: bounded parallel run execution -------------------------------------

describe('D1. bounded parallel run execution', () => {
  async function seedTwoIndependent(db: ReturnType<typeof makeFakeDb>) {
    await insertMasterGoal(db.client, goal());
    const d = decomposeGoal(goal(), [
      { local_id: 'a', kind: 'documentation', title: 'doc a', objective: 'write note a', depends_on_local: [] },
      { local_id: 'b', kind: 'documentation', title: 'doc b', objective: 'write note b', depends_on_local: [] },
    ], (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);
  }

  it('two independent jobs run CONCURRENTLY in one step (maxParallel 2), one lease and one result each', async () => {
    const db = makeFakeDb();
    await seedTwoIndependent(db);
    let inFlight = 0; let peak = 0;
    const seen: string[] = [];
    const executor: RealJobExecutor = async ({ job, runId }) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20)); // real overlap window
      inFlight--;
      seen.push(`${job.id}:${runId}`);
      return {
        outcome: 'completed', executed: true,
        evidence_refs: [`real:x:${job.id}`], failure_reason: null,
        summary: 'ok', report: { result_excerpt: 'done', files_changed: [] },
      };
    };
    let n = 0;
    const r = await driverStep(db.client, 'goal-00000001', Date.parse(NOW), () => [],
      lockCtx, () => `run-${n++}`, executor, 2);
    expect(r.halted).toBe(false);
    expect(peak).toBe(2); // genuinely concurrent
    const jobs = db.rowsOf('goal_jobs');
    expect(jobs.every((j) => j.status === 'completed')).toBe(true);
    expect(jobs.every((j) => j.attempts === 1)).toBe(true);
    // No duplicate execution and distinct run ids per job.
    expect(seen.length).toBe(2);
    expect(new Set(seen.map((s) => s.split(':')[0])).size).toBe(2);
    // One result event per job.
    const results = db.rowsOf('os_events').filter((e) => String(e.id).startsWith('ev-result-'));
    expect(results.length).toBe(2);
  });

  it('maxParallel 1 preserves strictly sequential execution', async () => {
    const db = makeFakeDb();
    await seedTwoIndependent(db);
    let inFlight = 0; let peak = 0;
    const executor: RealJobExecutor = async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return {
        outcome: 'completed', executed: true, evidence_refs: ['real:x'],
        failure_reason: null, summary: 'ok',
      };
    };
    let n = 0;
    await driverStep(db.client, 'goal-00000001', Date.parse(NOW), () => [],
      lockCtx, () => `run-${n++}`, executor, 1);
    expect(peak).toBe(1);
  });

  it('one failure + one success under concurrency persist independently', async () => {
    const db = makeFakeDb();
    await seedTwoIndependent(db);
    const executor: RealJobExecutor = async ({ job }) => ({
      outcome: job.id.endsWith('a') ? 'completed' : 'failed',
      executed: job.id.endsWith('a'),
      evidence_refs: [`real:x:${job.id}`],
      failure_reason: job.id.endsWith('a') ? null : 'exit_1',
      summary: 'mixed',
    });
    let n = 0;
    await driverStep(db.client, 'goal-00000001', Date.parse(NOW), () => [],
      lockCtx, () => `run-${n++}`, executor, 2);
    const byId = new Map(db.rowsOf('goal_jobs').map((j) => [j.id, j]));
    expect(byId.get('job-0000-a')?.status).toBe('completed');
    expect(byId.get('job-0000-b')?.status).toBe('failed');
    expect(byId.get('job-0000-b')?.failure_reason).toBe('exit_1');
  });

  it('dependency-constrained jobs never run in the same batch as their prerequisite', async () => {
    const db = makeFakeDb();
    await insertMasterGoal(db.client, goal());
    const d = decomposeGoal(goal(), [
      { local_id: 'a', kind: 'documentation', title: 'first', objective: 'write base note', depends_on_local: [] },
      { local_id: 'b', kind: 'documentation', title: 'second', objective: 'extend the note', depends_on_local: ['a'] },
    ], (l) => `job-0000-${l}`, NOW);
    if (!d.ok) throw new Error('decompose');
    for (const j of d.jobs) await insertGoalJob(db.client, j);
    const order: string[] = [];
    const executor: RealJobExecutor = async ({ job }) => {
      order.push(job.id);
      return {
        outcome: 'completed', executed: true, evidence_refs: [`real:${job.id}`],
        failure_reason: null, summary: 'ok',
      };
    };
    let t = Date.parse(NOW); let n = 0;
    const depends = (id: string) => (id === 'job-0000-b' ? ['job-0000-a'] : []);
    const r = await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100,
      depends, lockCtx, () => `run-${n++}`, executor, 2);
    expect(r.reason).toBe('completed');
    expect(order).toEqual(['job-0000-a', 'job-0000-b']);
  });

  it('replaying the drive is idempotent (completed jobs stay completed, no re-execution)', async () => {
    const db = makeFakeDb();
    await seedTwoIndependent(db);
    let calls = 0;
    const executor: RealJobExecutor = async ({ job }) => {
      calls++;
      return {
        outcome: 'completed', executed: true, evidence_refs: [`real:${job.id}`],
        failure_reason: null, summary: 'ok',
      };
    };
    let t = Date.parse(NOW); let n = 0;
    await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, () => [], lockCtx, () => `run-${n++}`, executor, 2);
    const callsAfterFirst = calls;
    await driveGoal(db.client, 'goal-00000001', () => (t += 1000), 100, () => [], lockCtx, () => `run-${n++}`, executor, 2);
    expect(calls).toBe(callsAfterFirst); // nothing re-executed
  });
});

// --- H: attention notifications ---------------------------------------------

describe('H. attention notifications (dedup, bounded, inert-unless-configured)', () => {
  const TG_ENV = {
    TELEGRAM_BOT_TOKEN: 't0k3n-value-here',
    TELEGRAM_OWNER_CHAT_ID: '12345',
    DISABLE_ALL_AI_WRITES: 'false',
  };

  function sendRecorder() {
    const sends: string[] = [];
    const impl = async (text: string) => { sends.push(text); return { sent: true, reason: 'ok' }; };
    return { sends, impl };
  }

  it('fully inert without the Telegram env (no reads, no sends, no ledger rows)', async () => {
    const db = makeFakeDb();
    const r = await notifyAttentionOnce(db.client, {}, NOW, async () => {
      throw new Error('must never be called');
    });
    expect(r).toEqual({ configured: false, candidates: 0, sent: 0, deduped: 0, errors: [] });
    expect(db.rowsOf('os_events').length).toBe(0);
  });

  it('notifies a dead-lettered job ONCE - the second tick dedups durably', async () => {
    const db = makeFakeDb();
    db.rowsOf('goal_jobs').push({
      id: 'job-dead-0001', goal_id: 'goal-00000001', kind: 'audit',
      status: 'dead_lettered', failure_reason: 'terminal:real_required:kind_not_eligible',
      updated_at: NOW,
    });
    const f1 = sendRecorder();
    const r1 = await notifyAttentionOnce(db.client, TG_ENV, NOW, f1.impl);
    expect(r1.configured).toBe(true);
    expect(r1.sent).toBe(1);
    expect(f1.sends[0]).toContain('job-dead-0001');
    const f2 = sendRecorder();
    const r2 = await notifyAttentionOnce(db.client, TG_ENV, NOW, f2.impl);
    expect(r2.sent).toBe(0);
    expect(r2.deduped).toBe(1);
    expect(f2.sends.length).toBe(0);
  });

  it('bounded: never more than 5 sends per tick', async () => {
    const db = makeFakeDb();
    for (let i = 0; i < 8; i++) {
      db.rowsOf('goal_jobs').push({
        id: `job-dead-${i}`, goal_id: 'g', kind: 'code',
        status: 'dead_lettered', failure_reason: 'x', updated_at: NOW,
      });
    }
    const f = sendRecorder();
    const r = await notifyAttentionOnce(db.client, TG_ENV, NOW, f.impl);
    expect(r.sent).toBe(5);
  });

  it('a pending approval notifies with its id and no secret text', async () => {
    const db = makeFakeDb();
    db.rowsOf('orchestration_approvals').push({
      approval_id: 'apr-00000000000000000001', id: 'apr-00000000000000000001',
      status: 'pending', action: 'apply schema migration plan', risk_class: 'YELLOW',
      expires_at: '2026-08-27T12:00:00.000Z', created_at: NOW,
    });
    const f = sendRecorder();
    const r = await notifyAttentionOnce(db.client, TG_ENV, NOW, f.impl);
    expect(r.sent).toBe(1);
    expect(f.sends[0]).toContain('apr-00000000000000000001');
    expect(f.sends[0]).toContain('approval required');
  });
});

// --- J: span-level redaction -------------------------------------------------

describe('J. span-level redaction (secret spans out, useful text stays)', () => {
  it('redacts API keys, JWTs, PATs, assignments, PEM, ssh keys as SPANS', () => {
    const t = redactSecretSpans(
      'used sk-abc12345678901234 and eyJhbGciOiJIUzI1NiIs.cGF5bG9hZA.SflKxwRJSMeKKF2QT4 ' +
      'plus ghp_1234567890abcdef and password: hunter2secret and api_key=abcd1234efgh');
    expect(t).not.toContain('sk-abc12345678901234');
    expect(t).not.toContain('SflKxwRJSMeKKF2QT4');
    expect(t).not.toContain('hunter2secret');
    expect(t).not.toContain('abcd1234efgh');
    expect(t).toContain('used');
    expect(t).toContain('[redacted]');
  });

  it('normal code, filenames, and secret-WORD prose survive', () => {
    const prose = 'the refresh_token rotation flow updates the store file at ' +
      'src/os-runtime/supabase-runtime.ts; tests cover token expiry paths';
    expect(looksSecret(prose)).toBe(true); // the old detector fires on the words...
    const t = redactSecretSpans(prose);
    expect(t).toBe(prose); // ...but span redaction keeps ALL of it readable
  });

  it('bearer/oauth/env-secret assignments lose only their values', () => {
    const t = redactSecretSpans('set BEARER=abc.def.ghi123 and SUPABASE_SECRET: shhh-value-1');
    expect(t).not.toContain('abc.def.ghi123');
    expect(t).not.toContain('shhh-value-1');
    expect(t).toContain('set');
  });
});
