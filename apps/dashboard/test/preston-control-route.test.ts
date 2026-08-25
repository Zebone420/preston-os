import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeComposerFakeDb } from './composer-fake-db';
import { TOOL_NAMES } from '../src/lib/preston-control/server';

// Preston Control /mcp route - wiring + END-TO-END through a real MCP client.
// The Supabase client factory is mocked so the route's ONLY external call
// (createClient -> auth.getUser / rpc / from) lands on the shared composer
// fake DB. Everything else (header gates, OAuth 401 discovery hint, stateless
// Streamable HTTP transport, tool catalogue, annotations, structured results)
// is the real code path a ChatGPT connector exercises.

const CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const OWNER = 'info@preston.nyc';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}
const OWNER_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: CLIENT_ID, email: OWNER });
const GUEST_TOKEN = jwt({ sub: 'u-guest', aud: 'authenticated', client_id: CLIENT_ID, email: 'guest@example.com' });
const RUNTIME_TOKEN = jwt({ sub: 'u-rt', aud: 'authenticated', client_id: CLIENT_ID, email: 'runtime@service.preston' });

// One shared fake DB per test; createClient(token) returns a view over it
// whose auth.getUser / is_owner answer according to the token.
let db: ReturnType<typeof makeComposerFakeDb>;
const users: Record<string, { id: string; email: string; owner: boolean }> = {
  [OWNER_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [GUEST_TOKEN]: { id: 'u-guest', email: 'guest@example.com', owner: false },
  [RUNTIME_TOKEN]: { id: 'u-rt', email: 'runtime@service.preston', owner: false },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { global: { headers: { Authorization: string } } }) => {
    const token = opts.global.headers.Authorization.replace('Bearer ', '');
    const u = users[token];
    return {
      auth: { getUser: async (t: string) => (users[t] ? { data: { user: { id: users[t].id, email: users[t].email } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
      from: (t: string) => db.client.from(t),
      rpc: (fn: string, args: Record<string, unknown>) => {
        if (fn === 'is_owner') return Promise.resolve({ data: Boolean(u?.owner), error: null });
        if (fn === 'decide_orchestration_approval') {
          if (!u?.owner) return Promise.resolve({ data: null, error: { message: 'owner_required' } });
          const row = db.rowsOf('orchestration_approvals').find((r) => r.approval_id === args.p_approval_id);
          if (!row) return Promise.resolve({ data: null, error: { message: 'approval_not_found' } });
          // Real RPC order (0021): status gate before nonce, so a decided row
          // replays as not_pending. Staging-proven 2026-08-25.
          if (row.status !== 'pending') return Promise.resolve({ data: null, error: { message: 'not_pending' } });
          if (row.nonce) return Promise.resolve({ data: null, error: { message: 'already_decided' } });
          row.status = args.p_outcome; row.nonce = args.p_nonce;
          return Promise.resolve({ data: [row], error: null });
        }
        return db.client.rpc(fn, args);
      },
    };
  },
}));

const ENV_ON = {
  PRESTON_CONTROL_ENABLED: 'true',
  PRESTON_CONTROL_OAUTH_CLIENT_ID: CLIENT_ID,
  SUPABASE_RUNTIME_ENV: 'staging',
  OWNER_EMAIL_ALLOWLIST: OWNER,
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-placeholder',
};
const ENV_KEYS = [...Object.keys(ENV_ON), 'PRESTON_CONTROL_PUBLIC_ORIGIN'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  db = makeComposerFakeDb();
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV_ON);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

async function route() {
  return import('../src/app/mcp/route');
}

function post(body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return new Request('https://preston.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'content-length': String(Buffer.byteLength(text)),
      ...headers,
    },
    body: text,
  });
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

// A real MCP client whose fetch is the route handler itself.
async function connect(token: string) {
  const { POST } = await route();
  const transport = new StreamableHTTPClientTransport(new URL('https://preston.test/mcp'), {
    requestInit: { headers: { authorization: 'Bearer ' + token } },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = await req.text();
      const h = new Headers(req.headers);
      h.set('content-length', String(Buffer.byteLength(body)));
      return POST(new Request(req.url, { method: req.method, headers: h, body }));
    },
  });
  const client = new Client({ name: 'test-chatgpt', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

describe('/mcp route gates', () => {
  it('disabled -> 503 and no tool surface', async () => {
    delete process.env.PRESTON_CONTROL_ENABLED;
    const { POST } = await route();
    const res = await POST(post(INIT, { authorization: 'Bearer ' + OWNER_TOKEN }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, status: 'disabled' });
  });

  it('oversize / missing content-length -> 413 before auth', async () => {
    const { POST } = await route();
    const big = post(INIT, { authorization: 'Bearer ' + OWNER_TOKEN, 'content-length': String(1024 * 1024) });
    expect((await POST(big)).status).toBe(413);
  });

  it('no auth -> 401 + WWW-Authenticate resource_metadata (OAuth discovery hint)', async () => {
    const { POST } = await route();
    const res = await POST(post(INIT));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://preston.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('expired/forged token -> 401; non-owner -> 403; runtime service identity -> 403', async () => {
    const { POST } = await route();
    expect((await POST(post(INIT, { authorization: 'Bearer ' + jwt({ sub: 'x', aud: 'authenticated', client_id: CLIENT_ID }) }))).status).toBe(401);
    const guest = await POST(post(INIT, { authorization: 'Bearer ' + GUEST_TOKEN }));
    expect(guest.status).toBe(403);
    expect(await guest.json()).toMatchObject({ status: 'not_owner' });
    const rt = await POST(post(INIT, { authorization: 'Bearer ' + RUNTIME_TOKEN }));
    expect(rt.status).toBe(403);
  });

  it('production/staging mismatch: wrong SUPABASE_RUNTIME_ENV -> 503 unconfigured', async () => {
    process.env.SUPABASE_RUNTIME_ENV = 'development';
    const { POST } = await route();
    const res = await POST(post(INIT, { authorization: 'Bearer ' + OWNER_TOKEN }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'unconfigured' });
  });

  it('GET/DELETE are not a session surface (stateless)', async () => {
    const { GET, DELETE } = await route();
    expect((await GET(new Request('https://preston.test/mcp'))).status).toBe(401);
    expect((await GET(new Request('https://preston.test/mcp', { headers: { authorization: 'Bearer ' + OWNER_TOKEN } }))).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });
});

describe('/mcp end-to-end through a real MCP client', () => {
  it('lists exactly the six tools with accurate annotations', async () => {
    const client = await connect(OWNER_TOKEN);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of ['preston_status', 'preston_get_goal', 'preston_list_approvals', 'preston_get_evidence']) {
      expect(by[n].annotations?.readOnlyHint, n).toBe(true);
      expect(by[n].annotations?.destructiveHint, n).toBe(false);
    }
    expect(by['preston_submit_goal'].annotations?.readOnlyHint).toBe(false);
    expect(by['preston_submit_goal'].annotations?.idempotentHint).toBe(true);
    expect(by['preston_decide_approval'].annotations?.readOnlyHint).toBe(false);
    expect(by['preston_decide_approval'].annotations?.destructiveHint).toBe(true);
    expect(by['preston_decide_approval'].annotations?.idempotentHint).toBe(false);
    await client.close();
  });

  it('Test A/B/C/D: status -> harmless goal -> gated goal -> list -> owner approval', async () => {
    const client = await connect(OWNER_TOKEN);

    const status = await client.callTool({ name: 'preston_status', arguments: {} });
    const s = status.structuredContent as Record<string, unknown>;
    expect(s.posture).toBe('operating');
    expect((s.summary as Record<string, number>).total_goals).toBe(0);

    const harmless = await client.callTool({ name: 'preston_submit_goal', arguments: {
      request: 'Create a staging-only goal to document the golden baseline. Create tasks to summarize the golden baseline in a local report, and attach internal evidence. Do not deploy, send messages, access production, change credentials, perform financial actions, or make external writes.',
      request_id: 'pc-e2e-harmless-1',
    } });
    const h = harmless.structuredContent as Record<string, unknown>;
    expect(h.status).toBe('accepted');
    expect((h.goals as unknown[]).length).toBeGreaterThan(0);
    const goalId = (h.goals as Array<{ goal_id: string }>)[0].goal_id;

    const again = await client.callTool({ name: 'preston_submit_goal', arguments: { request: 'Create a staging-only goal to document the golden baseline. Create tasks to summarize the golden baseline in a local report, and attach internal evidence. Do not deploy, send messages, access production, change credentials, perform financial actions, or make external writes.', request_id: 'pc-e2e-harmless-1' } });
    expect((again.structuredContent as Record<string, unknown>).status).toBe('duplicate');

    const got = await client.callTool({ name: 'preston_get_goal', arguments: { goal_id: goalId } });
    expect((got.structuredContent as Record<string, unknown>).found).toBe(true);

    const gated = await client.callTool({ name: 'preston_submit_goal', arguments: {
      request: 'Create a staging-only goal to prepare the Phase 7 schema evidence. Create tasks to draft a schema migration plan for owner review, and summarize the plan in a local report.',
      request_id: 'pc-e2e-gated-1',
    } });
    const g = gated.structuredContent as Record<string, unknown>;
    expect(g.status).toBe('accepted');
    expect(g.approvals_required as number).toBeGreaterThan(0);

    const list = await client.callTool({ name: 'preston_list_approvals', arguments: {} });
    const approvals = (list.structuredContent as { approvals: Array<Record<string, unknown>> }).approvals;
    expect(approvals.length).toBe(g.approvals_required);
    expect(JSON.stringify(list)).not.toContain('nonce');
    const approvalId = String(approvals[0].approval_id);

    const decided = await client.callTool({ name: 'preston_decide_approval', arguments: { approval_id: approvalId, outcome: 'approved', owner_confirmation: `Approve ${approvalId}` } });
    const d = decided.structuredContent as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d.decided_by).toBe(OWNER);
    const row = db.rowsOf('orchestration_approvals').find((r) => r.approval_id === approvalId)!;
    expect(row.status).toBe('approved');
    expect(String(row.nonce)).toMatch(/^pc-/);

    const twice = await client.callTool({ name: 'preston_decide_approval', arguments: { approval_id: approvalId, outcome: 'approved', owner_confirmation: `Approve ${approvalId}` } });
    expect((twice.structuredContent as Record<string, unknown>).error).toBe('not_pending');

    const ev = await client.callTool({ name: 'preston_get_evidence', arguments: { goal_id: goalId } });
    expect((ev.structuredContent as Record<string, unknown>).ok).toBe(true);
    await client.close();
  });

  it('malformed tool arguments are rejected by the schema, not executed', async () => {
    const client = await connect(OWNER_TOKEN);
    const bad = await client.callTool({ name: 'preston_get_goal', arguments: { goal_id: 'not-a-uuid-at-all' } });
    expect(bad.isError).toBe(true);
    const bad2 = await client.callTool({ name: 'preston_decide_approval', arguments: { approval_id: 'apr-valid-id-123', outcome: 'maybe' } });
    expect(bad2.isError).toBe(true);
    const bad3 = await client.callTool({ name: 'preston_submit_goal', arguments: { request: 'x'.repeat(4001) } });
    expect(bad3.isError).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(0);
    await client.close();
  });

  it('Test E: a non-owner cannot even initialize (no safe-read carve-out in v1)', async () => {
    await expect(connect(GUEST_TOKEN)).rejects.toThrow();
    await expect(connect(RUNTIME_TOKEN)).rejects.toThrow();
  });
});

describe('repo wiring', () => {
  it('proxy matcher excludes /mcp and /.well-known/ while keeping existing exclusions', () => {
    const proxy = readFileSync(join(__dirname, '..', 'src', 'proxy.ts'), 'utf8');
    const m = proxy.match(/matcher: \['([^']+)'\]/)!;
    expect(m[1]).toContain('mcp$');
    expect(m[1]).toContain('well-known');
    for (const p of ['api/health', 'api/os/chatgpt', 'api/os/remote', 'api/os/ssot']) expect(m[1]).toContain(p);
    // And the matcher regex really skips both paths.
    const re = new RegExp('^' + m[1].replace(/\\\\/g, '\\') + '$');
    expect(re.test('/mcp')).toBe(false);
    expect(re.test('/.well-known/oauth-protected-resource/mcp')).toBe(false);
    expect(re.test('/mcpx')).toBe(true);
    expect(re.test('/oauth/consent')).toBe(true);
  });

  it('env.template lists the Preston Control names and no values', () => {
    const tpl = readFileSync(join(__dirname, '..', '..', '..', 'env.template'), 'utf8');
    for (const n of ['PRESTON_CONTROL_ENABLED=', 'PRESTON_CONTROL_OAUTH_CLIENT_ID=', 'PRESTON_CONTROL_PUBLIC_ORIGIN=']) {
      expect(tpl).toContain('\n' + n + '\n');
    }
  });

  it('well-known metadata route is 404 when disabled and serves RFC 9728 JSON when enabled', async () => {
    const mod = await import('../src/app/.well-known/oauth-protected-resource/mcp/route');
    const ok = await mod.GET(new Request('https://preston.test/.well-known/oauth-protected-resource/mcp'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ resource: 'https://preston.test/mcp', authorization_servers: ['https://proj.supabase.co/auth/v1'] });
    delete process.env.PRESTON_CONTROL_ENABLED;
    expect((await mod.GET(new Request('https://preston.test/.well-known/oauth-protected-resource/mcp'))).status).toBe(404);
  });

  it('Preston runtime does not import the MCP adapter (outage isolation)', () => {
    const root = join(__dirname, '..', 'src');
    const files = ['lib/ai-os/orchestration/driver.ts', 'lib/ai-os/orchestration/coordinator.ts', 'lib/ai-os/orchestration/remote-intake.ts', 'lib/ai-os/hermes-service.ts'];
    for (const f of files) {
      expect(readFileSync(join(root, f), 'utf8')).not.toContain('preston-control');
    }
    // And the adapter never reaches for shell, service role, or raw SQL.
    for (const f of ['lib/preston-control/auth.ts', 'lib/preston-control/tools.ts', 'lib/preston-control/server.ts', 'app/mcp/route.ts']) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src).not.toMatch(/child_process|execSync|spawn\(|SERVICE_KEY|service_role|SUPABASE_STAGING_SERVICE_KEY/);
    }
  });
});
