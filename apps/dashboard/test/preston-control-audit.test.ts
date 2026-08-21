import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import { deriveVerifier, challengeFor } from '../src/lib/preston-control/gpt-bridge';

// Preston Control - FINAL PRE-ACTIVATION AUDIT. Each describe() block maps to
// one owner-requested PASS/FAIL item. Supabase is emulated at the HTTP edge
// (fetch mock for the OAuth token endpoint; createClient mock for PostgREST)
// so every assertion exercises the real route code.

const MCP_CLIENT = '11111111-2222-4333-8444-555555555555';
const GPT_CLIENT = '99999999-8888-4777-8666-555555555555';
const OWNER = 'info@preston.nyc';
const BRIDGE_KEY = 'bridge-key-' + 'q'.repeat(40);
const CONF = ['gpt-conf-', 'value-0123456789'].join('');
const ORIGIN = 'https://preston.test';
const CHATGPT_CB = 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback';
// Sensitive literals that must NEVER surface anywhere observable.
const SUPA_CODE = 'supacode-' + 'S'.repeat(24);
const ACCESS_1 = 'access-' + 'A'.repeat(30);
const REFRESH_1 = 'refresh-' + 'R'.repeat(30);
const ACCESS_2 = 'access2-' + 'B'.repeat(30);
const REFRESH_2 = 'refresh2-' + 'T'.repeat(30);
const SENSITIVE = [SUPA_CODE, ACCESS_1, REFRESH_1, ACCESS_2, REFRESH_2, CONF, BRIDGE_KEY];

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}
const GPT_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: GPT_CLIENT, email: OWNER });
const MCP_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: MCP_CLIENT, email: OWNER });

let db: ReturnType<typeof makeComposerFakeDb>;
const users: Record<string, { id: string; email: string; owner: boolean }> = {
  [GPT_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [MCP_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
};
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_u: string, _k: string, opts: { global: { headers: { Authorization: string } } }) => {
    const token = opts.global.headers.Authorization.replace('Bearer ', '');
    const u = users[token];
    return {
      auth: { getUser: async (t: string) => (users[t] ? { data: { user: { id: users[t].id, email: users[t].email } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
      from: (t: string) => db.client.from(t),
      rpc: (fn: string, args: Record<string, unknown>) => {
        if (fn === 'is_owner') return Promise.resolve({ data: Boolean(u?.owner), error: null });
        return db.client.rpc(fn, args);
      },
    };
  },
}));

const ENV_ON: Record<string, string> = {
  PRESTON_CONTROL_ENABLED: 'true',
  PRESTON_CONTROL_OAUTH_CLIENT_ID: MCP_CLIENT,
  PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID: GPT_CLIENT,
  PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET: CONF,
  PRESTON_CONTROL_GPT_BRIDGE_KEY: BRIDGE_KEY,
  SUPABASE_RUNTIME_ENV: 'staging',
  OWNER_EMAIL_ALLOWLIST: OWNER,
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-placeholder',
};
const ENV_KEYS = [...Object.keys(ENV_ON), 'PRESTON_CONTROL_PUBLIC_ORIGIN'];
const saved: Record<string, string | undefined> = {};
const consoleSpy = { log: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] };
beforeEach(() => {
  db = makeComposerFakeDb();
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV_ON);
  consoleSpy.log = []; consoleSpy.error = []; consoleSpy.warn = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { consoleSpy.log.push(a); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { consoleSpy.error.push(a); });
  vi.spyOn(console, 'warn').mockImplementation((...a) => { consoleSpy.warn.push(a); });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function form(body: Record<string, string>, headers: Record<string, string> = {}) {
  const s = new URLSearchParams(body).toString();
  return new Request(`${ORIGIN}/oauth/gpt/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(s)), ...headers },
    body: s,
  });
}
function assertNoSensitive(text: string) {
  for (const s of SENSITIVE) expect(text, `leaked: ${s.slice(0, 10)}…`).not.toContain(s);
}
function allConsoleText() {
  return JSON.stringify([consoleSpy.log, consoleSpy.error, consoleSpy.warn]);
}

// Emulated Supabase token endpoint: single-use codes bound to the verifier;
// rotating refresh tokens (old one invalid after use) - the documented
// Supabase behaviour ("may be rotated upon use ... always update").
function mockSupabaseToken(state: { codes: Map<string, string>; refresh: Map<string, number> }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    expect(url).toBe('https://proj.supabase.co/auth/v1/oauth/token');
    const p = new URLSearchParams(String(init?.body ?? ''));
    if (p.get('client_id') !== GPT_CLIENT || p.get('client_secret') !== CONF) {
      return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    }
    if (p.get('grant_type') === 'authorization_code') {
      const expectedVerifier = state.codes.get(p.get('code') ?? '');
      if (!expectedVerifier) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'code used or unknown' }), { status: 400 });
      if (p.get('code_verifier') !== expectedVerifier) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'pkce' }), { status: 400 });
      state.codes.delete(p.get('code')!); // single use
      state.refresh.set(REFRESH_1, 1);
      return new Response(JSON.stringify({ access_token: ACCESS_1, refresh_token: REFRESH_1, expires_in: 3600, token_type: 'bearer', id_token: 'idt-' + 'I'.repeat(20), user: { email: OWNER } }), { status: 200 });
    }
    if (p.get('grant_type') === 'refresh_token') {
      const rt = p.get('refresh_token') ?? '';
      if (!state.refresh.has(rt)) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token revoked' }), { status: 400 });
      state.refresh.delete(rt); // rotation: old token dies
      state.refresh.set(REFRESH_2, 1);
      return new Response(JSON.stringify({ access_token: ACCESS_2, refresh_token: REFRESH_2, expires_in: 3600, token_type: 'bearer' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), { status: 400 });
  });
}

describe('AUDIT 3 - exact redirect chain ChatGPT -> bridge -> Supabase -> bridge -> ChatGPT', () => {
  it('authorize 302 carries PKCE + signed state; Supabase callback 302 returns composite code to the EXACT ChatGPT callback with ChatGPT state', async () => {
    const authorize = await import('../src/app/oauth/gpt/authorize/route');
    const callback = await import('../src/app/oauth/gpt/callback/route');
    // Hop 1: ChatGPT -> bridge
    const r1 = await authorize.GET(new Request(`${ORIGIN}/oauth/gpt/authorize?response_type=code&client_id=${GPT_CLIENT}&redirect_uri=${encodeURIComponent(CHATGPT_CB)}&scope=email&state=cg-state-XYZ`));
    expect(r1.status).toBe(302);
    const hop2 = new URL(r1.headers.get('location')!);
    // Hop 2: bridge -> Supabase authorize (owner consents at /oauth/consent)
    expect(hop2.origin + hop2.pathname).toBe('https://proj.supabase.co/auth/v1/oauth/authorize');
    expect(hop2.searchParams.get('response_type')).toBe('code');
    expect(hop2.searchParams.get('client_id')).toBe(GPT_CLIENT);
    expect(hop2.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/oauth/gpt/callback`);
    expect(hop2.searchParams.get('code_challenge_method')).toBe('S256');
    expect(hop2.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hop2.searchParams.get('scope')).toBe('email');
    const bridgeState = hop2.searchParams.get('state')!;
    expect(bridgeState).not.toContain('cg-state-XYZ'); // opaque, signed
    // Hop 3: Supabase -> bridge callback (code + our state)
    const r3 = await callback.GET(new Request(`${ORIGIN}/oauth/gpt/callback?code=${SUPA_CODE}&state=${encodeURIComponent(bridgeState)}`));
    expect(r3.status).toBe(302);
    const hop4 = new URL(r3.headers.get('location')!);
    // Hop 4: bridge -> ChatGPT callback
    expect(hop4.origin + hop4.pathname).toBe(CHATGPT_CB);
    expect(hop4.searchParams.get('state')).toBe('cg-state-XYZ');
    expect(hop4.searchParams.get('code')).toMatch(new RegExp(`^${SUPA_CODE}\\.[A-Za-z0-9_-]{43}$`));
    // The composite's nonce must reproduce the challenge Supabase saw.
    const nonce = hop4.searchParams.get('code')!.split('.')[1];
    expect(challengeFor(deriveVerifier(ENV_ON, nonce))).toBe(hop2.searchParams.get('code_challenge'));
  });

  it('a callback whose state was issued for another ChatGPT redirect or another key is refused (no redirect at all)', async () => {
    const callback = await import('../src/app/oauth/gpt/callback/route');
    const { packState } = await import('../src/lib/preston-control/gpt-bridge');
    const foreign = packState({ ...ENV_ON, PRESTON_CONTROL_GPT_BRIDGE_KEY: 'z'.repeat(48) }, { nonce: 'n'.repeat(43), chatgptRedirect: CHATGPT_CB, chatgptState: 's' });
    const r = await callback.GET(new Request(`${ORIGIN}/oauth/gpt/callback?code=${SUPA_CODE}&state=${encodeURIComponent(foreign)}`));
    expect(r.status).toBe(400);
    expect(r.headers.get('location')).toBeNull();
  });
});

describe('AUDIT 1 - token endpoint: authorization_code, refresh_token, Supabase refresh rotation', () => {
  it('code exchange -> tokens (id_token/user stripped); refresh -> ROTATED tokens; old refresh token then refused', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    const nonce = 'n'.repeat(43);
    const state = { codes: new Map([[SUPA_CODE, deriveVerifier(ENV_ON, nonce)]]), refresh: new Map<string, number>() };
    mockSupabaseToken(state);

    const r1 = await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF, redirect_uri: CHATGPT_CB }));
    expect(r1.status).toBe(200);
    expect(r1.headers.get('cache-control')).toBe('no-store');
    const j1 = await r1.json();
    expect(j1).toEqual({ access_token: ACCESS_1, token_type: 'bearer', refresh_token: REFRESH_1, expires_in: 3600 });
    expect(JSON.stringify(j1)).not.toContain('idt-');

    const r2 = await token.POST(form({ grant_type: 'refresh_token', refresh_token: REFRESH_1, client_id: GPT_CLIENT, client_secret: CONF }));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.access_token).toBe(ACCESS_2);
    expect(j2.refresh_token).toBe(REFRESH_2); // rotated value passed through so ChatGPT stores it

    const r3 = await token.POST(form({ grant_type: 'refresh_token', refresh_token: REFRESH_1, client_id: GPT_CLIENT, client_secret: CONF }));
    expect(r3.status).toBe(400);
    const j3 = await r3.json();
    expect(j3).toEqual({ error: 'invalid_grant' }); // tag only, no description echoed
    const r4 = await token.POST(form({ grant_type: 'refresh_token', refresh_token: REFRESH_2, client_id: GPT_CLIENT, client_secret: CONF }));
    expect(r4.status).toBe(200);
  });

  it('upstream outage -> 503 temporarily_unavailable; upstream non-JSON -> invalid_grant', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNRESET'));
    const r = await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: GPT_CLIENT, client_secret: CONF }));
    expect(r.status).toBe(503);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    const r2 = await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: GPT_CLIENT, client_secret: CONF }));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: 'invalid_grant' });
  });
});

describe('AUDIT 4 - token-endpoint authentication method ChatGPT uses', () => {
  // OpenAI docs show client_id/client_secret in the POST body ("Default (POST
  // request)"); the editor also offers "Basic authorization header". Both must
  // work; both are forwarded to Supabase as client_secret_post.
  it('Default (POST body) credentials accepted', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    const spy = mockSupabaseToken({ codes: new Map(), refresh: new Map([['rt-1', 1]]) });
    const r = await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: GPT_CLIENT, client_secret: CONF }));
    expect(r.status).toBe(200);
    const sent = new URLSearchParams(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(sent.get('client_secret')).toBe(CONF);
    expect((spy.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('authorization');
  });
  it('Basic authorization header credentials accepted (and form-less JSON body tolerated)', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    mockSupabaseToken({ codes: new Map(), refresh: new Map([['rt-1', 1]]) });
    const basic = 'Basic ' + Buffer.from(`${encodeURIComponent(GPT_CLIENT)}:${encodeURIComponent(CONF)}`).toString('base64');
    const r = await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt-1' }, { authorization: basic }));
    expect(r.status).toBe(200);
    const body = JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: GPT_CLIENT, client_secret: CONF });
    mockSupabaseToken({ codes: new Map(), refresh: new Map([['rt-1', 1]]) });
    const r2 = await token.POST(new Request(`${ORIGIN}/oauth/gpt/token`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(body.length) }, body }));
    expect(r2.status).toBe(200);
  });
  it('wrong/missing client credentials (either method) -> 401 invalid_client, upstream never called', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: GPT_CLIENT, client_secret: CONF + 'x' }))).status).toBe(401);
    expect((await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: MCP_CLIENT, client_secret: CONF }))).status).toBe(401);
    expect((await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt' }))).status).toBe(401);
    const badBasic = 'Basic ' + Buffer.from(`${GPT_CLIENT}:nope`).toString('base64');
    expect((await token.POST(form({ grant_type: 'refresh_token', refresh_token: 'rt' }, { authorization: badBasic }))).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AUDIT 2 - replay and tampering of state / nonce / PKCE / composite code', () => {
  it('composite code replay is refused upstream (single-use), a swapped nonce fails PKCE, a tampered code/nonce fails shape', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    const nonce = 'n'.repeat(43);
    const other = 'm'.repeat(43);
    const state = { codes: new Map([[SUPA_CODE, deriveVerifier(ENV_ON, nonce)]]), refresh: new Map<string, number>() };
    const spy = mockSupabaseToken(state);
    // nonce swapped -> different verifier -> upstream PKCE failure, code still unconsumed
    const swapped = await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${other}`, client_id: GPT_CLIENT, client_secret: CONF }));
    expect(swapped.status).toBe(400);
    expect(state.codes.has(SUPA_CODE)).toBe(true);
    // genuine exchange
    expect((await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF }))).status).toBe(200);
    // replay of the same composite code
    const replay = await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: 'invalid_grant' });
    // shape tampering never reaches upstream
    const before = spy.mock.calls.length;
    expect((await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}x`, client_id: GPT_CLIENT, client_secret: CONF }))).status).toBe(400);
    expect((await token.POST(form({ grant_type: 'authorization_code', code: `bad code!.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF }))).status).toBe(400);
    expect((await token.POST(form({ grant_type: 'authorization_code', code: SUPA_CODE, client_id: GPT_CLIENT, client_secret: CONF }))).status).toBe(400);
    expect(spy.mock.calls.length).toBe(before);
  });

  it('state replay across a second authorize yields a DIFFERENT nonce/challenge each time; a state from one flow cannot complete another', async () => {
    const authorize = await import('../src/app/oauth/gpt/authorize/route');
    const url = `${ORIGIN}/oauth/gpt/authorize?client_id=${GPT_CLIENT}&redirect_uri=${encodeURIComponent(CHATGPT_CB)}&state=s`;
    const a = new URL((await authorize.GET(new Request(url))).headers.get('location')!);
    const b = new URL((await authorize.GET(new Request(url))).headers.get('location')!);
    expect(a.searchParams.get('code_challenge')).not.toBe(b.searchParams.get('code_challenge'));
    expect(a.searchParams.get('state')).not.toBe(b.searchParams.get('state'));
    const { unpackState } = await import('../src/lib/preston-control/gpt-bridge');
    const sa = unpackState(ENV_ON, a.searchParams.get('state')!)!;
    const sb = unpackState(ENV_ON, b.searchParams.get('state')!)!;
    expect(sa.nonce).not.toBe(sb.nonce);
    // Mixing: the challenge from flow A only matches verifier(nonce A).
    expect(challengeFor(deriveVerifier(ENV_ON, sb.nonce))).not.toBe(a.searchParams.get('code_challenge'));
  });
});

describe('AUDIT 5 - no token / code / secret / key in logs, audit rows, evidence, errors or tool output', () => {
  it('token, callback and REST error paths + console output contain no sensitive literal', async () => {
    const token = await import('../src/app/oauth/gpt/token/route');
    const callback = await import('../src/app/oauth/gpt/callback/route');
    const nonce = 'n'.repeat(43);
    mockSupabaseToken({ codes: new Map([[SUPA_CODE, deriveVerifier(ENV_ON, nonce)]]), refresh: new Map() });
    const responses: string[] = [];
    responses.push(await (await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF + 'x' }))).text());
    responses.push(await (await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF }))).text()); // success: contains tokens BY DESIGN (to ChatGPT only)
    responses.push(await (await token.POST(form({ grant_type: 'authorization_code', code: `${SUPA_CODE}.${nonce}`, client_id: GPT_CLIENT, client_secret: CONF }))).text()); // replay error
    responses.push(await (await token.POST(form({ grant_type: 'refresh_token', refresh_token: REFRESH_1 + 'bad', client_id: GPT_CLIENT, client_secret: CONF }))).text());
    responses.push(await (await callback.GET(new Request(`${ORIGIN}/oauth/gpt/callback?code=${SUPA_CODE}&state=tampered`))).text());
    // Every ERROR body is sensitive-free; only the one success body carries tokens (that is the OAuth response itself).
    assertNoSensitive(responses[0]); assertNoSensitive(responses[2]); assertNoSensitive(responses[3]); assertNoSensitive(responses[4]);
    expect(responses[1]).toContain(ACCESS_1);
    assertNoSensitive(allConsoleText());
  });

  it('REST + MCP tool outputs, audit rows and the fake DB never receive the bearer or bridge material', async () => {
    const status = await import('../src/app/api/control/status/route');
    const goals = await import('../src/app/api/control/goals/route');
    const r = await status.GET(new Request(`${ORIGIN}/api/control/status`, { headers: { authorization: 'Bearer ' + GPT_TOKEN } }));
    const body = JSON.stringify({ request: 'Create a staging-only goal to document the golden baseline. Create tasks to summarize the golden baseline in a local report. Do not deploy, send messages, access production, change credentials, perform financial actions, or make external writes.', request_id: 'pc-audit-1' });
    const g = await goals.POST(new Request(`${ORIGIN}/api/control/goals`, { method: 'POST', headers: { authorization: 'Bearer ' + GPT_TOKEN, 'content-type': 'application/json', 'content-length': String(body.length) }, body }));
    const texts = [await r.text(), await g.text(), JSON.stringify([...['master_goals', 'goal_jobs', 'orchestration_approvals', 'audit_log'].map((t) => db.rowsOf(t))]), allConsoleText()];
    for (const t of texts) {
      expect(t).not.toContain(GPT_TOKEN);
      expect(t).not.toContain(MCP_TOKEN);
      assertNoSensitive(t);
    }
    // Invalid-input responses echo the PATH of the failing field, never the value.
    const bad = JSON.stringify({ request: 'x', request_id: 'SECRETVALUE-' + 'Z'.repeat(20) + '!' });
    const b = await goals.POST(new Request(`${ORIGIN}/api/control/goals`, { method: 'POST', headers: { authorization: 'Bearer ' + GPT_TOKEN, 'content-type': 'application/json', 'content-length': String(bad.length) }, body: bad }));
    expect(b.status).toBe(400);
    expect(await b.text()).not.toContain('SECRETVALUE');
  });

  it('source audit: adapter + bridge code never logs, and the consent audit row stores only an 8-char authorization_id prefix', () => {
    const root = join(__dirname, '..', 'src');
    const files = ['lib/preston-control', 'app/mcp', 'app/api/control', 'app/oauth'];
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const dir of files) {
      for (const f of walk(join(root, dir))) {
        const src = readFileSync(f, 'utf8');
        expect(src, f).not.toMatch(/console\.(log|info|debug|warn|error)\(/);
      }
    }
    const consent = readFileSync(join(root, 'app/oauth/consent/actions.ts'), 'utf8');
    expect(consent).toContain('authorization_id_prefix: id.slice(0, 8)');
    expect(consent).not.toMatch(/access_token|refresh_token/);
  });
});

describe('AUDIT 6 - surface isolation: client A (MCP) cannot call REST; client B (GPT) cannot call MCP', () => {
  it('REST routes refuse the MCP token; /mcp refuses the GPT token; both with wrong_client, no tool runs', async () => {
    const routes = [
      (await import('../src/app/api/control/status/route')).GET,
      (await import('../src/app/api/control/approvals/route')).GET,
      (await import('../src/app/api/control/evidence/route')).GET,
    ];
    for (const GET of routes) {
      const r = await GET(new Request(`${ORIGIN}/api/control/x?goal_id=00000000-0000-4000-8000-000000000000`, { headers: { authorization: 'Bearer ' + MCP_TOKEN } }));
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ status: 'wrong_client' });
    }
    const mcp = await import('../src/app/mcp/route');
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    const r = await mcp.POST(new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { authorization: 'Bearer ' + GPT_TOKEN, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': String(init.length) }, body: init }));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ status: 'wrong_client' });
    // And the bridge refuses client A's id outright.
    const authorize = await import('../src/app/oauth/gpt/authorize/route');
    expect((await authorize.GET(new Request(`${ORIGIN}/oauth/gpt/authorize?client_id=${MCP_CLIENT}&redirect_uri=${encodeURIComponent(CHATGPT_CB)}&state=s`))).status).toBe(400);
  });
});

describe('AUDIT 7 - PRESTON_CONTROL_ENABLED=false closes every surface; runtime untouched', () => {
  it('all eleven Preston Control routes answer 503/404 with valid owner tokens when the flag is false', async () => {
    process.env.PRESTON_CONTROL_ENABLED = 'false';
    const h = (t: string) => ({ authorization: 'Bearer ' + t });
    const results: number[] = [];
    const mcp = await import('../src/app/mcp/route');
    const init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    results.push((await mcp.POST(new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { ...h(MCP_TOKEN), 'content-length': String(init.length) }, body: init }))).status);
    results.push((await mcp.GET(new Request(`${ORIGIN}/mcp`, { headers: h(MCP_TOKEN) }))).status);
    results.push((await (await import('../src/app/.well-known/oauth-protected-resource/route')).GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`))).status);
    results.push((await (await import('../src/app/.well-known/oauth-protected-resource/mcp/route')).GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`))).status);
    results.push((await (await import('../src/app/api/control/status/route')).GET(new Request(`${ORIGIN}/api/control/status`, { headers: h(GPT_TOKEN) }))).status);
    results.push((await (await import('../src/app/api/control/approvals/route')).GET(new Request(`${ORIGIN}/api/control/approvals`, { headers: h(GPT_TOKEN) }))).status);
    results.push((await (await import('../src/app/api/control/evidence/route')).GET(new Request(`${ORIGIN}/api/control/evidence`, { headers: h(GPT_TOKEN) }))).status);
    const body = '{"request":"x"}';
    results.push((await (await import('../src/app/api/control/goals/route')).POST(new Request(`${ORIGIN}/api/control/goals`, { method: 'POST', headers: { ...h(GPT_TOKEN), 'content-length': String(body.length) }, body }))).status);
    results.push((await (await import('../src/app/api/control/goals/[goal_id]/route')).GET(new Request(`${ORIGIN}/api/control/goals/x`, { headers: h(GPT_TOKEN) }), { params: Promise.resolve({ goal_id: '00000000-0000-4000-8000-000000000000' }) })).status);
    results.push((await (await import('../src/app/api/control/approvals/[approval_id]/decision/route')).POST(new Request(`${ORIGIN}/api/control/approvals/a/decision`, { method: 'POST', headers: { ...h(GPT_TOKEN), 'content-length': '2' }, body: '{}' }), { params: Promise.resolve({ approval_id: 'apr-valid-id-123' }) })).status);
    results.push((await (await import('../src/app/api/control/openapi.json/route')).GET(new Request(`${ORIGIN}/api/control/openapi.json`))).status);
    results.push((await (await import('../src/app/oauth/gpt/authorize/route')).GET(new Request(`${ORIGIN}/oauth/gpt/authorize?client_id=${GPT_CLIENT}&redirect_uri=${encodeURIComponent(CHATGPT_CB)}&state=s`))).status);
    results.push((await (await import('../src/app/oauth/gpt/callback/route')).GET(new Request(`${ORIGIN}/oauth/gpt/callback?code=a&state=b`))).status);
    results.push((await (await import('../src/app/oauth/gpt/token/route')).POST(form({ grant_type: 'refresh_token', refresh_token: 'r', client_id: GPT_CLIENT, client_secret: CONF }))).status);
    expect(results.every((s) => s === 503 || s === 404), JSON.stringify(results)).toBe(true);
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });

  it('the Preston runtime/orchestrator has no dependency on Preston Control (static import graph)', () => {
    const root = join(__dirname, '..', 'src');
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const runtimeFiles = [...walk(join(root, 'os-runtime')), ...walk(join(root, 'lib', 'ai-os'))];
    expect(runtimeFiles.length).toBeGreaterThan(20);
    for (const f of runtimeFiles) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/preston-control|PRESTON_CONTROL_/);
    }
    // And no existing control-plane route reads the flag either.
    for (const f of walk(join(root, 'app', 'api', 'os'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/PRESTON_CONTROL_/);
    }
  });
});
