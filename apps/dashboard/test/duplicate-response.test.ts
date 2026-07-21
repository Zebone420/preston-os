import { describe, expect, it } from 'vitest';
import type { AuditSink } from '../src/lib/audit';
import { normalizeCommand } from '../src/lib/ai-os/commands';
import { createCommandProposal } from '../src/lib/ai-os/controlplane';
import { processChatGptIntake } from '../src/app/api/os/chatgpt/route';
import {
  insertCommandPacket,
  type QueryResult,
  type RuntimeClient,
} from '../src/lib/ai-os/store';

// Phase 5 defect #1 regression: a DUPLICATE command intake (same
// idempotency_key, fresh route-generated command id) must answer with the
// AUTHORITATIVE stored runtime_command_packets row id - never the attempted
// packet's id, which matches no stored row. Locks in:
//   store:        unique violation -> read existing row back by
//                 idempotency_key (then id), return ITS id; if unresolvable,
//                 return duplicate WITHOUT an id (absent beats wrong).
//   controlplane: createCommandProposal surfaces that id with code 'duplicate'.
//   chatgpt route: packet_id is the authoritative id on duplicate, or null -
//                 NEVER this request's attempted id. Exactly one insert is
//                 attempted (no second row).

const NOW = '2026-07-21T12:00:00.000Z';
const STORED_ID = '11111111-1111-4111-8111-111111111111'; // authoritative row
const FRESH_ID = '22222222-2222-4222-8222-222222222222'; // replay's attempted id

const DUP_ERROR = { message: 'duplicate key value violates unique constraint "runtime_command_packets_idempotency_key_key"' };

interface LookupScript {
  // Scripted result per select filter column ('idempotency_key' | 'id').
  [col: string]: QueryResult;
}

// Fake RuntimeClient: insert always reports a unique violation; select
// answers from `lookups` keyed by the LAST .eq() column used. Captures every
// insert row and every select filter for assertions.
function dupClient(lookups: LookupScript, controlsRow?: Record<string, unknown>) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const selects: Array<{ table: string; col: string; val: unknown }> = [];
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return { select: async () => ({ data: null, error: DUP_ERROR }) };
        },
        select() {
          let lastCol = '';
          const resolve = async (): Promise<QueryResult> => {
            if (table === 'system_controls') {
              return { data: controlsRow ? [controlsRow] : [], error: null };
            }
            return lookups[lastCol] ?? { data: [], error: null };
          };
          type EqNode = {
            limit: () => Promise<QueryResult>;
            eq: (col: string, val: unknown) => EqNode;
            order: () => { limit: () => Promise<QueryResult> };
          };
          const eqNode: EqNode = {
            limit: resolve,
            eq(col: string, val: unknown) {
              lastCol = col;
              selects.push({ table, col, val });
              return eqNode;
            },
            order: () => ({ limit: resolve }),
          };
          return {
            eq: (col: string, val: unknown) => eqNode.eq(col, val),
            order: () => ({ limit: resolve }),
            limit: resolve,
          };
        },
        update() {
          type Node = { select: () => Promise<QueryResult>; eq: () => Node; lte: () => Node; gt: () => Node };
          const node: Node = {
            select: async () => ({ data: [], error: null }),
            eq: () => node, lte: () => node, gt: () => node,
          };
          return node;
        },
      };
    },
  };
  return { client, inserts, selects };
}

const nullAudit: AuditSink = {
  from() {
    return { insert: () => Promise.resolve({ error: null }) };
  },
} as unknown as AuditSink;

function replayPacket() {
  return normalizeCommand({
    id: FRESH_ID, actor: 'info@preston.nyc', source: 'chatgpt',
    requested_action: 'read status', target_project: 'preston-os',
    target_repository: 'preston-os', correlation_id: 'corr-abc12345',
    idempotency_key: 'idem-abc12345', now: NOW,
  });
}

describe('store.insertCommandPacket - duplicate returns the authoritative stored id', () => {
  it('resolves the existing row by idempotency_key and returns ITS id, not the attempted id', async () => {
    const { client, inserts, selects } = dupClient({
      idempotency_key: { data: [{ id: STORED_ID }], error: null },
    });
    const r = await insertCommandPacket(client, replayPacket());
    expect(r).toMatchObject({ ok: true, duplicate: true, id: STORED_ID });
    expect(r.id).not.toBe(FRESH_ID);
    expect(inserts.length).toBe(1); // one attempt; no second row is ever written
    expect(selects[0]).toMatchObject({ col: 'idempotency_key', val: 'idem-abc12345' });
  });

  it('falls back to an id-keyed lookup for a primary-key collision', async () => {
    const { client } = dupClient({
      idempotency_key: { data: [], error: null },
      id: { data: [{ id: FRESH_ID }], error: null },
    });
    const r = await insertCommandPacket(client, replayPacket());
    expect(r).toMatchObject({ ok: true, duplicate: true, id: FRESH_ID });
  });

  it('returns duplicate WITHOUT an id when no lookup resolves (never a fabricated id)', async () => {
    const { client } = dupClient({
      idempotency_key: { data: null, error: { message: 'read failed' } },
      id: { data: [], error: null },
    });
    const r = await insertCommandPacket(client, replayPacket());
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    expect(r.id).toBeUndefined();
  });
});

describe('controlplane.createCommandProposal - duplicate surfaces the authoritative id', () => {
  it('returns code=duplicate with the stored row id', async () => {
    const { client } = dupClient({
      idempotency_key: { data: [{ id: STORED_ID }], error: null },
    });
    const r = await createCommandProposal(
      { client, audit: nullAudit },
      replayPacket(),
      { actor: 'info@preston.nyc' },
    );
    expect(r.ok).toBe(true);
    expect(r.code).toBe('duplicate');
    expect(r.id).toBe(STORED_ID);
  });
});

describe('chatgpt intake - duplicate packet_id is authoritative or null, never the attempted id', () => {
  const ENV = { CHATGPT_OWNER_IDENTITY: 'info@preston.nyc' };
  // intakeChatGpt treats !execution_enabled as halted, so the duplicate path
  // is only reachable with an active-controls row (same as chatgpt-route tests).
  const ACTIVE_CONTROLS = {
    execution_enabled: true, owner_stop: false, paused: false,
    hermes_mode: 'dispatch_eligible', remote_runner_enabled: true, updated_at: NOW,
  };
  const body = {
    owner_identity: 'info@preston.nyc',
    correlation_id: 'corr-abc12345',
    idempotency_key: 'idem-abc12345',
    command: {
      requested_action: 'read status',
      target_project: 'preston-os',
      target_repository: 'preston-os',
    },
  };

  it('returns the stored row id as packet_id on a replay', async () => {
    const { client, inserts } = dupClient(
      { idempotency_key: { data: [{ id: STORED_ID }], error: null } },
      ACTIVE_CONTROLS,
    );
    const r = await processChatGptIntake(body, ENV, NOW, { client, audit: nullAudit });
    expect(r.httpStatus).toBe(200);
    expect(r.json['duplicate']).toBe(true);
    expect(r.json['packet_id']).toBe(STORED_ID);
    // exactly one command-packet insert attempt (the audit sink is separate)
    expect(inserts.filter((i) => i.table === 'runtime_command_packets').length).toBe(1);
  });

  it('returns packet_id=null when the authoritative id cannot be resolved', async () => {
    const { client } = dupClient(
      { idempotency_key: { data: [], error: null }, id: { data: [], error: null } },
      ACTIVE_CONTROLS,
    );
    const r = await processChatGptIntake(body, ENV, NOW, { client, audit: nullAudit });
    expect(r.httpStatus).toBe(200);
    expect(r.json['duplicate']).toBe(true);
    expect(r.json['packet_id']).toBeNull();
  });
});
