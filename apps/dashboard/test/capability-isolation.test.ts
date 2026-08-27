// Power-station performance/isolation pins (master goal sections 3/16/21):
// the capability + artifact + ledger subsystems are DORMANT EQUIPMENT on
// every provider-free path. An idle orchestrate-once tick and a provider-
// free driven tick touch ZERO capability/artifact/ledger tables and read
// zero credentials; the dryrun drill command is env-gated fail-closed; and
// the new notification source stays inert without the Telegram env.

import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import { EXIT, runDispatcher, parseArgs } from '../src/os-runtime/dispatcher';
import { notifyAttentionOnce } from '../src/lib/ai-os/notifications';

const NOW = '2026-08-27T12:00:00.000Z';

const FORBIDDEN_IDLE_TABLES = new Set(['side_effects', 'artifacts']);

// Table-access recording fake: empty goal tables => idle tick.
function makeRecordingDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const touched: string[] = [];
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  rowsOf('system_controls').push({
    id: 'global', execution_enabled: false, owner_stop: false, paused: false,
    hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
  });
  const client: RuntimeClient = {
    from(table: string) {
      touched.push(table);
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table);
            const key = table === 'side_effects' ? 'side_effect_id' : 'id';
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key unique constraint' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row.id ?? 'x' }], error: null });
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
        update() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq() { return chain(f); }, lte() { return chain(f); }, gt() { return chain(f); },
            select() { return Promise.resolve({ data: [], error: null }); },
          });
          return chain([]);
        },
      };
    },
  };
  (client as unknown as { rpc: unknown }).rpc =
    () => Promise.resolve({ data: null, error: { message: 'none' } });
  return { client, rowsOf, touched };
}

const IDLE_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://vcqtlmlaxxankxyezlul.supabase.co',
  SUPABASE_RUNTIME_KEY: 'anon-key-placeholder-value',
  SUPABASE_RUNTIME_ENV: 'staging',
  ORCH_BASE_COMMIT: 'abc1234abc1234abc1234abc1234abc1234abc12',
  ORCH_ALLOWED_PATHS: 'apps/dashboard/,docs/',
};

describe('idle-path dormancy (G2/section 21)', () => {
  it('an IDLE orchestrate-once tick touches no capability/artifact/ledger table', async () => {
    const db = makeRecordingDb();
    const res = await runDispatcher({
      command: 'orchestrate-once', client: db.client, env: IDLE_ENV,
      now: NOW, correlationId: 'iso-1', log: () => {},
    });
    expect(res.exitCode).toBe(EXIT.ok);
    expect(res.summary.idle).toBe(true);
    for (const t of db.touched) {
      expect(FORBIDDEN_IDLE_TABLES.has(t)).toBe(false);
    }
    // and the idle read set stays the C1 fast path (controls + goal probes)
    const distinct = new Set(db.touched);
    expect(distinct.has('master_goals')).toBe(true);
    expect(distinct.size).toBeLessThanOrEqual(4);
  });

  it('capability-dryrun is fail-closed without its env gate (exit 78, zero DB)', async () => {
    const db = makeRecordingDb();
    const res = await runDispatcher({
      command: 'capability-dryrun', client: db.client, env: IDLE_ENV,
      now: NOW, correlationId: 'iso-2', log: () => {},
      dryrun: { scenario: 'success', key: null },
    });
    expect(res.exitCode).toBe(EXIT.config);
    expect(db.touched.length).toBe(0);
  });

  it('parseArgs surfaces the dryrun scenario/key flags', () => {
    const p = parseArgs(['node', 'bin.js', 'capability-dryrun',
      '--scenario', 'duplicate', '--key', 'drill-1']);
    expect(p.command).toBe('capability-dryrun');
    expect(p.dryrun).toEqual({ scenario: 'duplicate', key: 'drill-1' });
  });

  it('the enabled dryrun drill exercises the spine end to end', async () => {
    const db = makeRecordingDb();
    const res = await runDispatcher({
      command: 'capability-dryrun', client: db.client,
      env: { ...IDLE_ENV, ORCH_CAPABILITY_DRYRUN_ENABLED: 'true' },
      now: NOW, correlationId: 'iso-3', log: () => {},
      dryrun: { scenario: 'duplicate', key: 'iso-key-1' },
    });
    expect(res.exitCode).toBe(EXIT.ok);
    expect(res.summary.same_row).toBe(true);
    expect(db.rowsOf('side_effects').length).toBe(1);
  });

  it('the notifier (with its new artifact source) stays fully inert unconfigured', async () => {
    const db = makeRecordingDb();
    const r = await notifyAttentionOnce(db.client, {}, NOW, async () => {
      throw new Error('must never send');
    });
    expect(r.configured).toBe(false);
    expect(db.touched.length).toBe(0);
  });

  it('an artifact_unrecorded event notifies the owner once (dedup durable)', async () => {
    const db = makeRecordingDb();
    db.rowsOf('os_events').push({
      id: 'ev-artifacts-job-x-run-x', type: 'ArtifactRecorded',
      payload: { condition: 'artifact_unrecorded', job_id: 'job-x', goal_id: 'goal-x' },
      created_at: NOW,
    });
    const env = {
      TELEGRAM_BOT_TOKEN: 't0k3n-value-here', TELEGRAM_OWNER_CHAT_ID: '5',
    };
    const sends: string[] = [];
    const r1 = await notifyAttentionOnce(db.client, env, NOW,
      async (t) => { sends.push(t); return { sent: true, reason: 'ok' }; });
    expect(r1.sent).toBe(1);
    expect(sends[0]).toContain('artifact UNRECORDED');
    expect(sends[0]).toContain('job-x');
    const r2 = await notifyAttentionOnce(db.client, env, NOW,
      async (t) => { sends.push(t); return { sent: true, reason: 'ok' }; });
    expect(r2.sent).toBe(0);
    expect(r2.deduped).toBe(1);
  });
});
