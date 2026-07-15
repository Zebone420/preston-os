import { describe, expect, it } from 'vitest';
import type { AuditSink } from '../src/lib/audit';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  readStatus,
  requestControl,
  submitCommandProposal,
  type ControlPlaneDeps,
  type SubmitInput,
} from '../src/lib/ai-os/controlplane';

const NOW = '2026-07-14T12:00:00.000Z';
const OWNER_ENV = { OWNER_EMAIL_ALLOWLIST: 'info@preston.nyc' };

interface AuditCall {
  action: string;
  action_class?: string;
}

function deps(writeResult: QueryResult, controlsRow?: Record<string, unknown>): {
  deps: ControlPlaneDeps;
  inserts: Record<string, unknown>[];
  audits: AuditCall[];
} {
  const inserts: Record<string, unknown>[] = [];
  const audits: AuditCall[] = [];
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (table !== 'audit_log') inserts.push(row);
          return { select: async () => writeResult };
        },
        select() {
          return {
            eq() {
              return { limit: async () => ({ data: controlsRow ? [controlsRow] : [], error: null }) };
            },
            order() {
              return { limit: async () => writeResult };
            },
            limit: async () => ({ data: controlsRow ? [controlsRow] : [], error: null }),
          };
        },
        update() {
          return { eq: () => ({ select: async () => writeResult, eq: () => ({ select: async () => writeResult }) }) };
        },
      };
    },
  };
  // Audit sink captures the row's action.
  const audit: AuditSink = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          audits.push({ action: String(row['action']), action_class: String(row['action_class']) });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { deps: { client, audit, env: OWNER_ENV, now: NOW }, inserts, audits };
}

const baseInput = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  ownerEmail: 'info@preston.nyc', source: 'chatgpt', requested_action: 'read status',
  target_project: 'preston-os', target_repository: 'preston-os', correlation_id: 'corr',
  idempotency_key: 'idem-1', commandId: 'cmd-1', ...over,
});

describe('control-plane - submit command proposal', () => {
  it('denies a non-owner', async () => {
    const { deps: d } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput({ ownerEmail: 'attacker@x.com' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('denied');
  });

  it('accepts an owner proposal, writes it, and audits it', async () => {
    const { deps: d, inserts, audits } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('proposed');
    expect(inserts[0].execution_eligible).toBe(false); // default-deny persisted
    expect(audits.some((a) => a.action === 'command_proposed')).toBe(true);
  });

  it('rejects a production target and audits the rejection', async () => {
    const { deps: d, inserts, audits } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput({ target_project: 'preston-production' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('production_rejected');
    expect(inserts.length).toBe(0); // nothing written to the command table
    expect(audits.some((a) => a.action.includes('production_target'))).toBe(true);
  });

  it('rejects a production requested_action even with a benign target', async () => {
    const { deps: d, inserts } = deps({ data: [{ id: 'cmd-1' }], error: null });
    const r = await submitCommandProposal(d, baseInput({ requested_action: 'deploy to production' }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('production_rejected');
    expect(inserts.length).toBe(0);
  });
});

describe('control-plane - owner controls', () => {
  it('denies pause/resume/stop for a non-owner', async () => {
    const { deps: d } = deps({ data: [{ id: 'global' }], error: null });
    expect((await requestControl(d, 'attacker@x.com', 'stop')).ok).toBe(false);
  });

  it('applies stop (owner_stop + paused) with an audit entry', async () => {
    const { deps: d, audits } = deps({ data: [{ id: 'global' }], error: null });
    const r = await requestControl(d, 'info@preston.nyc', 'stop');
    expect(r.ok).toBe(true);
    expect(audits.some((a) => a.action === 'control:stop')).toBe(true);
  });

  it('readStatus fails closed to fully-stopped when no controls row', async () => {
    const { deps: d } = deps({ data: [], error: null });
    const s = await readStatus(d);
    expect(s.execution_enabled).toBe(false);
    expect(s.hermes_mode).toBe('disabled');
    expect(s.remote_runner_enabled).toBe(false);
  });
});
