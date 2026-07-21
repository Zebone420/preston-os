import { afterEach, describe, expect, it } from 'vitest';
import type { AuditSink } from '../src/lib/audit';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import { POST, processChatGptIntake } from '../src/app/api/os/chatgpt/route';

// Preston AI OS - ChatGPT intake route tests (Phase 5J).
//
// Two layers, matching the route's own seam:
//  1. POST() end-to-end for the HEADER-ONLY fail-closed gates (disabled,
//     unconfigured, oversized, wrong token, malformed JSON) - these all
//     return BEFORE the route ever calls getServerSupabase(), so they are
//     exercised with a plain Request-like stub (same idiom as
//     telegram-route.test.ts) and no Supabase env is set.
//  2. processChatGptIntake() directly for the DB-touching business logic
//     (correlation/idempotency shape, owner-identity match, production
//     screening, secret rejection, insert + idempotent dedup, audit) - via
//     an in-memory fake RuntimeClient/AuditSink (same stub style as
//     controlplane.test.ts's `deps()`), since a real getServerSupabase()
//     client would attempt a live network call outside a Next.js request.

const ENV_KEYS = [
  'CHATGPT_INTAKE_ENABLED', 'CHATGPT_INTAKE_TOKEN', 'CHATGPT_OWNER_IDENTITY', 'SUPABASE_RUNTIME_ENV',
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
// Deliberately never set in this file: NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY - keeping them unset makes getServerSupabase()
// return null immediately (setup mode), so any request that clears the
// header-only gates below still resolves deterministically to 503
// 'unconfigured' with no network attempt, instead of hanging or dialing out.

const TOKEN = 's3cr3t-chatgpt-token';
const OWNER = 'info@preston.nyc';

function enableIntake() {
  process.env['CHATGPT_INTAKE_ENABLED'] = 'true';
  process.env['CHATGPT_INTAKE_TOKEN'] = TOKEN;
  process.env['CHATGPT_OWNER_IDENTITY'] = OWNER;
  process.env['SUPABASE_RUNTIME_ENV'] = 'staging';
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function req(body: unknown, opts: { token?: string; contentLength?: number } = {}): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const token = opts.token ?? TOKEN;
  return {
    headers: new Headers({
      'content-length': String(opts.contentLength ?? raw.length),
      authorization: 'Bearer ' + token,
    }),
    json: async () => JSON.parse(raw) as unknown,
  } as unknown as Request;
}

function chatGptBody(over: Record<string, unknown> = {}) {
  return {
    owner_identity: OWNER,
    correlation_id: 'corr-abc12345',
    idempotency_key: 'idem-abc12345',
    command: {
      requested_action: 'read status',
      target_project: 'preston-os',
      target_repository: 'preston-os',
    },
    ...over,
  };
}

describe('POST /api/os/chatgpt - header-only fail-closed gates', () => {
  it('is disabled by default (503, no processing)', async () => {
    delete process.env['CHATGPT_INTAKE_ENABLED'];
    const res = await POST(req(chatGptBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('disabled');
  });

  it('is unconfigured when CHATGPT_INTAKE_TOKEN is missing', async () => {
    process.env['CHATGPT_INTAKE_ENABLED'] = 'true';
    delete process.env['CHATGPT_INTAKE_TOKEN'];
    process.env['CHATGPT_OWNER_IDENTITY'] = OWNER;
    process.env['SUPABASE_RUNTIME_ENV'] = 'staging';
    const res = await POST(req(chatGptBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });

  it('is unconfigured when CHATGPT_OWNER_IDENTITY is missing', async () => {
    process.env['CHATGPT_INTAKE_ENABLED'] = 'true';
    process.env['CHATGPT_INTAKE_TOKEN'] = TOKEN;
    delete process.env['CHATGPT_OWNER_IDENTITY'];
    process.env['SUPABASE_RUNTIME_ENV'] = 'staging';
    const res = await POST(req(chatGptBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });

  it('is unconfigured (fail-closed) when SUPABASE_RUNTIME_ENV is not staging', async () => {
    process.env['CHATGPT_INTAKE_ENABLED'] = 'true';
    process.env['CHATGPT_INTAKE_TOKEN'] = TOKEN;
    process.env['CHATGPT_OWNER_IDENTITY'] = OWNER;
    process.env['SUPABASE_RUNTIME_ENV'] = 'production';
    const res = await POST(req(chatGptBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });

  it('rejects an oversized Content-Length BEFORE reading the body (413)', async () => {
    enableIntake();
    const res = await POST(req(chatGptBody(), { contentLength: 999_999 }));
    expect(res.status).toBe(413);
    expect((await res.json()).status).toBe('too_large');
  });

  it('rejects a wrong bearer token (401, constant-time path) and never echoes the token', async () => {
    enableIntake();
    const res = await POST(req(chatGptBody(), { token: 'wrong-token' }));
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('wrong-token');
  });

  it('rejects a missing Authorization header (401)', async () => {
    enableIntake();
    const bare = {
      headers: new Headers({ 'content-length': String(JSON.stringify(chatGptBody()).length) }),
      json: async () => chatGptBody(),
    } as unknown as Request;
    const res = await POST(bare);
    expect(res.status).toBe(401);
  });

  it('rejects malformed JSON (400) once bounded + authenticated', async () => {
    enableIntake();
    const res = await POST(req('{not json', {}));
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe('bad_request');
  });

  it('falls back to 503 unconfigured (setup mode) past the header gates when no Supabase env is set', async () => {
    enableIntake();
    const res = await POST(req(chatGptBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unconfigured');
  });
});

// --- processChatGptIntake: DB-touching business logic -----------------------

const NOW = '2026-07-21T12:00:00.000Z';
const ENV = { CHATGPT_OWNER_IDENTITY: OWNER };
const ACTIVE_CONTROLS = {
  execution_enabled: true, owner_stop: false, paused: false,
  hermes_mode: 'dispatch_eligible', remote_runner_enabled: true, updated_at: NOW,
};

interface AuditCall {
  action: string;
  action_class?: string;
}

function fakeDeps(
  controlsRow: Record<string, unknown> | undefined,
  writeResult: QueryResult,
): { client: RuntimeClient; audit: AuditSink; inserts: Record<string, unknown>[]; audits: AuditCall[] } {
  const inserts: Record<string, unknown>[] = [];
  const audits: AuditCall[] = [];
  const client: RuntimeClient = {
    from(table: string) {
      const readRows = async (): Promise<QueryResult> => ({
        data: controlsRow ? [controlsRow] : [],
        error: null,
      });
      return {
        insert(row: Record<string, unknown>) {
          if (table !== 'audit_log') inserts.push(row);
          return { select: async () => writeResult };
        },
        select() {
          type EqNode = { limit: typeof readRows; eq: () => EqNode; order: () => { limit: typeof readRows } };
          const eqNode: EqNode = { limit: readRows, eq: () => eqNode, order: () => ({ limit: readRows }) };
          return { eq: () => eqNode, order: () => ({ limit: readRows }), limit: readRows };
        },
        update() {
          type Node = { select: () => Promise<QueryResult>; eq: () => Node; lte: () => Node; gt: () => Node };
          const node: Node = { select: async () => writeResult, eq: () => node, lte: () => node, gt: () => node };
          return node;
        },
      };
    },
  };
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
  return { client, audit, inserts, audits };
}

const okWrite: QueryResult = { data: [{ id: 'pkt-1' }], error: null };
const dupWrite: QueryResult = { data: null, error: { message: 'duplicate key value violates unique constraint' } };

describe('processChatGptIntake - correlation/idempotency shape', () => {
  it('rejects a missing correlation_id', async () => {
    const { client, audit } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const r = await processChatGptIntake(chatGptBody({ correlation_id: '' }), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(400);
    expect(r.json['status']).toBe('invalid');
  });

  it('rejects a too-short idempotency_key', async () => {
    const { client, audit } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const r = await processChatGptIntake(chatGptBody({ idempotency_key: 'short' }), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(400);
    expect(r.json['status']).toBe('invalid');
  });

  it('rejects an idempotency_key with disallowed characters', async () => {
    const { client, audit } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const r = await processChatGptIntake(chatGptBody({ idempotency_key: 'has spaces!!' }), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(400);
    expect(r.json['status']).toBe('invalid');
  });
});

describe('processChatGptIntake - owner identity', () => {
  it('rejects a non-owner identity (403) before any DB write', async () => {
    const { client, audit, inserts } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const r = await processChatGptIntake(chatGptBody({ owner_identity: 'attacker@evil.com' }), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(403);
    expect(r.json['status']).toBe('denied');
    expect(inserts.length).toBe(0);
  });

  it('accepts a case/whitespace-insensitive owner identity match', async () => {
    const { client, audit } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const r = await processChatGptIntake(chatGptBody({ owner_identity: '  INFO@PRESTON.NYC  ' }), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(200);
    expect(r.json['ok']).toBe(true);
  });
});

describe('processChatGptIntake - runtime halt state', () => {
  it('reports stopped (503) when the runtime is halted', async () => {
    const halted = { ...ACTIVE_CONTROLS, execution_enabled: false };
    const { client, audit } = fakeDeps(halted, okWrite);
    const r = await processChatGptIntake(chatGptBody(), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(503);
    expect(r.json['status']).toBe('stopped');
  });

  it('reports paused (200, ok:false) when the runtime is paused', async () => {
    const paused = { ...ACTIVE_CONTROLS, paused: true };
    const { client, audit } = fakeDeps(paused, okWrite);
    const r = await processChatGptIntake(chatGptBody(), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(200);
    expect(r.json['ok']).toBe(false);
    expect(r.json['status']).toBe('paused');
  });
});

describe('processChatGptIntake - production + secret screening', () => {
  it('rejects a production-marked target and audits it RED', async () => {
    const { client, audit, inserts, audits } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const body = chatGptBody({ command: { requested_action: 'read status', target_project: 'preston-production', target_repository: 'preston-os' } });
    const r = await processChatGptIntake(body, ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(400);
    expect(r.json['status']).toBe('production_rejected');
    expect(inserts.length).toBe(0);
    expect(audits.some((a) => a.action.includes('production_target') && a.action_class === 'RED')).toBe(true);
  });

  it('rejects a secret-bearing requested_action', async () => {
    const { client, audit, inserts } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const body = chatGptBody({ command: { requested_action: 'read status api_key=xyz', target_project: 'preston-os', target_repository: 'preston-os' } });
    const r = await processChatGptIntake(body, ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(400);
    expect(r.json['status']).toBe('invalid');
    expect(inserts.length).toBe(0);
  });
});

describe('processChatGptIntake - happy path + idempotency', () => {
  it('creates a default-deny proposal, forces approval_required, and audits it', async () => {
    const { client, audit, inserts, audits } = fakeDeps(ACTIVE_CONTROLS, okWrite);
    const r = await processChatGptIntake(chatGptBody(), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(200);
    expect(r.json['ok']).toBe(true);
    expect(r.json['status']).toBe('proposed');
    expect(r.json['duplicate']).toBe(false);
    expect(r.json['packet_id']).toBeTruthy();
    expect(r.json['correlation_id']).toBe('corr-abc12345');
    expect(inserts[0]['approval_required']).toBe(true); // forced, regardless of classifyRisk
    expect(inserts[0]['execution_eligible']).toBe(false);
    expect(audits.some((a) => a.action === 'command_proposed')).toBe(true);
    // No token or secret is ever present in the JSON response.
    expect(JSON.stringify(r.json)).not.toContain(TOKEN);
  });

  it('returns duplicate:true on a replayed idempotency_key without a second logical write', async () => {
    const { client, audit } = fakeDeps(ACTIVE_CONTROLS, dupWrite);
    const r = await processChatGptIntake(chatGptBody(), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(200);
    expect(r.json['ok']).toBe(true);
    expect(r.json['status']).toBe('duplicate');
    expect(r.json['duplicate']).toBe(true);
  });

  it('never passes a raw DB error through on write failure', async () => {
    const failWrite: QueryResult = { data: null, error: { message: 'relation "runtime_command_packets" does not exist: internal detail' } };
    const { client, audit } = fakeDeps(ACTIVE_CONTROLS, failWrite);
    const r = await processChatGptIntake(chatGptBody(), ENV, NOW, { client, audit });
    expect(r.httpStatus).toBe(400);
    expect(r.json['status']).toBe('write_failed');
    expect(JSON.stringify(r.json)).not.toContain('relation "runtime_command_packets"');
  });
});
