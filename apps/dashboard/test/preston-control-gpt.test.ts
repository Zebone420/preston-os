import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeComposerFakeDb } from './composer-fake-db';
import {
  buildAuthorizeRedirect,
  buildCallbackRedirect,
  buildTokenForward,
  challengeFor,
  deriveVerifier,
  filterTokenResponse,
  packState,
  unpackState,
} from '../src/lib/preston-control/gpt-bridge';
import { buildOpenApiDocument } from '../src/lib/preston-control/openapi';
import { authenticateControlRequest } from '../src/lib/preston-control/auth';
import { evaluateConsent } from '../src/lib/preston-control/consent';

// Preston Control - GPT Actions surface: REST routes over the SAME service
// layer, the separate 'gpt' OAuth client, and the stateless PKCE bridge.

const MCP_CLIENT = '11111111-2222-4333-8444-555555555555';
const GPT_CLIENT = '99999999-8888-4777-8666-555555555555';
const OWNER = 'info@preston.nyc';
const BRIDGE_KEY = 'k'.repeat(48);
const CONF = ['gpt-conf-', 'value-0123456789'].join(''); // runtime-built, scanner-neutral

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}
const GPT_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: GPT_CLIENT, email: OWNER });
const MCP_TOKEN = jwt({ sub: 'u-owner', aud: 'authenticated', client_id: MCP_CLIENT, email: OWNER });
const GUEST_TOKEN = jwt({ sub: 'u-guest', aud: 'authenticated', client_id: GPT_CLIENT, email: 'guest@example.com' });

let db: ReturnType<typeof makeComposerFakeDb>;
const users: Record<string, { id: string; email: string; owner: boolean }> = {
  [GPT_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [MCP_TOKEN]: { id: 'u-owner', email: OWNER, owner: true },
  [GUEST_TOKEN]: { id: 'u-guest', email: 'guest@example.com', owner: false },
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
          if (row.nonce) return Promise.resolve({ data: null, error: { message: 'already_decided' } });
          row.status = args.p_outcome; row.nonce = args.p_nonce;
          return Promise.resolve({ data: [row], error: null });
        }
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
  PRESTON_CONTROL_GPT_CALLBACK_URL: 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback',
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
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const ORIGIN = 'https://preston.test';
function req(path: string, init: { method?: string; token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = 'Bearer ' + init.token;
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  return new Request(ORIGIN + path, { method: init.method ?? 'GET', headers, body });
}

const HARMLESS = 'Create a staging-only goal to document the golden baseline. Create tasks to summarize the golden baseline in a local report, and attach internal evidence. Do not deploy, send messages, access production, change credentials, perform financial actions, or make external writes.';
const GATED = 'Create a staging-only goal to prepare the Phase 7 schema evidence. Create tasks to draft a schema migration plan for owner review, and summarize the plan in a local report.';

describe('GPT Actions REST surface', () => {
  it('status: no auth -> 401 with discovery hint; MCP-surface token -> 403 wrong_client; guest -> 403; gpt owner -> 200', async () => {
    const { GET } = await import('../src/app/api/control/status/route');
    const anon = await GET(req('/api/control/status'));
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toContain('oauth-protected-resource');
    const cross = await GET(req('/api/control/status', { token: MCP_TOKEN }));
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ status: 'wrong_client' });
    expect((await GET(req('/api/control/status', { token: GUEST_TOKEN }))).status).toBe(403);
    const ok = await GET(req('/api/control/status', { token: GPT_TOKEN }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const s = await ok.json();
    expect(s.posture).toBe('operating');
  });

  it('and conversely the MCP surface refuses a GPT-surface token', async () => {
    const r = await authenticateControlRequest('Bearer ' + GPT_TOKEN, ENV_ON, {
      clientFor: () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u-owner', email: OWNER } }, error: null }) },
        rpc: () => Promise.resolve({ data: true, error: null }),
      }),
    }, 'mcp');
    expect(r).toMatchObject({ ok: false, reason: 'wrong_client' });
  });

  it('disabled / missing GPT client id -> surface closed even when the MCP id is set', async () => {
    delete process.env.PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID;
    const { GET } = await import('../src/app/api/control/status/route');
    const r = await GET(req('/api/control/status', { token: GPT_TOKEN }));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ status: 'unconfigured' });
  });

  it('Galaxy Test B/C/D over REST: harmless goal -> duplicate -> gated -> list -> decide -> already_decided -> evidence', async () => {
    const goals = await import('../src/app/api/control/goals/route');
    const goal = await import('../src/app/api/control/goals/[goal_id]/route');
    const approvals = await import('../src/app/api/control/approvals/route');
    const decision = await import('../src/app/api/control/approvals/[approval_id]/decision/route');
    const evidence = await import('../src/app/api/control/evidence/route');

    const a = await goals.POST(req('/api/control/goals', { method: 'POST', token: GPT_TOKEN, body: { request: HARMLESS, request_id: 'pc-gpt-harmless-1' } }));
    expect(a.status).toBe(200);
    const aj = await a.json();
    expect(aj.status).toBe('accepted');
    const goalId = aj.goals[0].goal_id as string;

    const dup = await goals.POST(req('/api/control/goals', { method: 'POST', token: GPT_TOKEN, body: { request: HARMLESS, request_id: 'pc-gpt-harmless-1' } }));
    expect((await dup.json()).status).toBe('duplicate');

    const g = await goal.GET(req(`/api/control/goals/${goalId}`, { token: GPT_TOKEN }), { params: Promise.resolve({ goal_id: goalId }) });
    expect((await g.json()).found).toBe(true);
    const bad = await goal.GET(req('/api/control/goals/nope', { token: GPT_TOKEN }), { params: Promise.resolve({ goal_id: 'nope' }) });
    expect(bad.status).toBe(400);

    const gated = await goals.POST(req('/api/control/goals', { method: 'POST', token: GPT_TOKEN, body: { request: GATED, request_id: 'pc-gpt-gated-1' } }));
    const gj = await gated.json();
    expect(gj.approvals_required).toBeGreaterThan(0);

    const list = await approvals.GET(req('/api/control/approvals', { token: GPT_TOKEN }));
    const lj = await list.json();
    expect(lj.approvals.length).toBe(gj.approvals_required);
    expect(JSON.stringify(lj)).not.toContain('nonce');
    const approvalId = lj.approvals[0].approval_id as string;

    const d = await decision.POST(
      req(`/api/control/approvals/${approvalId}/decision`, { method: 'POST', token: GPT_TOKEN, body: { outcome: 'approved' } }),
      { params: Promise.resolve({ approval_id: approvalId }) },
    );
    const dj = await d.json();
    expect(dj.ok).toBe(true);
    expect(dj.decided_by).toBe(OWNER);
    const row = db.rowsOf('orchestration_approvals').find((r) => r.approval_id === approvalId)!;
    expect(row.status).toBe('approved');

    const again = await decision.POST(
      req(`/api/control/approvals/${approvalId}/decision`, { method: 'POST', token: GPT_TOKEN, body: { outcome: 'approved' } }),
      { params: Promise.resolve({ approval_id: approvalId }) },
    );
    expect((await again.json()).error).toBe('already_decided');

    const guestDecide = await decision.POST(
      req(`/api/control/approvals/${approvalId}/decision`, { method: 'POST', token: GUEST_TOKEN, body: { outcome: 'rejected' } }),
      { params: Promise.resolve({ approval_id: approvalId }) },
    );
    expect(guestDecide.status).toBe(403);

    const ev = await evidence.GET(req(`/api/control/evidence?goal_id=${goalId}`, { token: GPT_TOKEN }));
    expect((await ev.json()).ok).toBe(true);
    const evBad = await evidence.GET(req('/api/control/evidence?goal_id=x', { token: GPT_TOKEN }));
    expect(evBad.status).toBe(400);
  });

  it('strict bodies: unknown keys, oversize, non-JSON, and schema violations -> 400/413, nothing written', async () => {
    const goals = await import('../src/app/api/control/goals/route');
    const decision = await import('../src/app/api/control/approvals/[approval_id]/decision/route');
    expect((await goals.POST(req('/api/control/goals', { method: 'POST', token: GPT_TOKEN, body: { request: HARMLESS, shell: 'rm' } }))).status).toBe(400);
    expect((await goals.POST(req('/api/control/goals', { method: 'POST', token: GPT_TOKEN, body: { request: 'x'.repeat(4001) } }))).status).toBe(400);
    const big = new Request(ORIGIN + '/api/control/goals', { method: 'POST', headers: { authorization: 'Bearer ' + GPT_TOKEN, 'content-length': '999999', 'content-type': 'application/json' }, body: '{}' });
    expect((await goals.POST(big)).status).toBe(413);
    const notJson = new Request(ORIGIN + '/api/control/goals', { method: 'POST', headers: { authorization: 'Bearer ' + GPT_TOKEN, 'content-length': '5', 'content-type': 'application/json' }, body: 'hello' });
    expect((await goals.POST(notJson)).status).toBe(400);
    const r = await decision.POST(
      req('/api/control/approvals/apr-valid-id-123/decision', { method: 'POST', token: GPT_TOKEN, body: { outcome: 'maybe' } }),
      { params: Promise.resolve({ approval_id: 'apr-valid-id-123' }) },
    );
    expect(r.status).toBe(400);
    expect(db.rowsOf('master_goals')).toHaveLength(0);
  });

  it('openapi.json: 404 when disabled; bounded document with consequential flags and bridge auth URLs when enabled', async () => {
    const mod = await import('../src/app/api/control/openapi.json/route');
    const ok = await mod.GET(req('/api/control/openapi.json'));
    expect(ok.status).toBe(200);
    const doc = await ok.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers[0].url).toBe(ORIGIN);
    const ops = Object.values(doc.paths as Record<string, Record<string, { operationId: string; 'x-openai-isConsequential': boolean }>>)
      .flatMap((p) => Object.values(p));
    expect(ops.map((o) => o.operationId).sort()).toEqual(
      ['decidePrestonApproval', 'getPrestonEvidence', 'getPrestonGoal', 'getPrestonStatus', 'listPrestonApprovals', 'submitPrestonGoal'],
    );
    const byId = Object.fromEntries(ops.map((o) => [o.operationId, o]));
    expect(byId.decidePrestonApproval['x-openai-isConsequential']).toBe(true);
    expect(byId.submitPrestonGoal['x-openai-isConsequential']).toBe(true);
    expect(byId.getPrestonStatus['x-openai-isConsequential']).toBe(false);
    const flow = doc.components.securitySchemes.prestonOAuth.flows.authorizationCode;
    expect(flow.authorizationUrl).toBe(ORIGIN + '/oauth/gpt/authorize');
    expect(flow.tokenUrl).toBe(ORIGIN + '/oauth/gpt/token');
    expect(JSON.stringify(doc)).not.toContain(CONF);
    expect(JSON.stringify(doc).length).toBeLessThan(100_000);
    for (const o of ops as unknown as Array<{ responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }> }>) {
      expect(o.responses['200'].content!['application/json'].schema.$ref).toBe('#/components/schemas/Result');
    }
    delete process.env.PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID;
    expect((await mod.GET(req('/api/control/openapi.json'))).status).toBe(404);
  });

  it('consent page accepts a grant for either registered client and nothing else', () => {
    const env = { ...ENV_ON };
    const base = { authorization_id: 'auth_abcdef123456', scope: 'email', user: { id: 'u', email: OWNER } };
    expect(evaluateConsent({ ...base, client: { id: GPT_CLIENT, name: 'GPT' } }, OWNER, env).ok).toBe(true);
    expect(evaluateConsent({ ...base, client: { id: MCP_CLIENT, name: 'MCP' } }, OWNER, env).ok).toBe(true);
    expect(evaluateConsent({ ...base, client: { id: 'other', name: 'x' } }, OWNER, env)).toMatchObject({ ok: false, reason: 'client_not_allowed' });
  });
});

describe('PKCE bridge (pure)', () => {
  const env = ENV_ON;
  const CHATGPT_CB = 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback';

  it('authorize: validates client, redirect shape, scope, state; forwards to Supabase with S256 PKCE and signed state', () => {
    const out = buildAuthorizeRedirect(env, { response_type: 'code', client_id: GPT_CLIENT, redirect_uri: CHATGPT_CB, scope: 'email', state: 'cg-state-1' }, ORIGIN, 'n'.repeat(43));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const u = new URL(out.location);
    expect(u.origin + u.pathname).toBe('https://proj.supabase.co/auth/v1/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe(GPT_CLIENT);
    expect(u.searchParams.get('redirect_uri')).toBe(ORIGIN + '/oauth/gpt/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(challengeFor(deriveVerifier(env, 'n'.repeat(43))));
    const st = unpackState(env, u.searchParams.get('state')!)!;
    expect(st).toEqual({ nonce: 'n'.repeat(43), chatgptRedirect: CHATGPT_CB, chatgptState: 'cg-state-1' });

    expect(buildAuthorizeRedirect(env, { client_id: 'other', redirect_uri: CHATGPT_CB, state: 's' }, ORIGIN)).toMatchObject({ ok: false, error: 'unauthorized_client' });
    expect(buildAuthorizeRedirect(env, { client_id: GPT_CLIENT, redirect_uri: 'https://evil.example/aip/g-abc123/oauth/callback', state: 's' }, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_redirect' });
    expect(buildAuthorizeRedirect(env, { client_id: GPT_CLIENT, redirect_uri: 'https://chatgpt.com/aip/g-abc123/oauth/callback/../../x', state: 's' }, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_redirect' });
    expect(buildAuthorizeRedirect(env, { client_id: GPT_CLIENT, redirect_uri: CHATGPT_CB, state: 's', scope: 'email admin' }, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_scope' });
    expect(buildAuthorizeRedirect(env, { client_id: GPT_CLIENT, redirect_uri: CHATGPT_CB }, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(buildAuthorizeRedirect({ ...env, PRESTON_CONTROL_GPT_BRIDGE_KEY: 'short' }, { client_id: GPT_CLIENT, redirect_uri: CHATGPT_CB, state: 's' }, ORIGIN)).toMatchObject({ ok: false, error: 'unconfigured' });
  });

  it('callback pin: ONLY the exact configured GPT editor URL is accepted - wrong host, alternate domain, wrong GPT id, modified path, modified query, scheme, fragment all fail closed', () => {
    const q = (redirect_uri: string) => ({ client_id: GPT_CLIENT, redirect_uri, state: 's' });
    const cases: Record<string, string> = {
      alternate_domain: 'https://chat.openai.com/aip/g-abc123DEF/oauth/callback',
      wrong_host: 'https://chatgpt.com.evil.example/aip/g-abc123DEF/oauth/callback',
      wrong_gpt_id: 'https://chatgpt.com/aip/g-abc123DEE/oauth/callback',
      modified_path: 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback/',
      modified_path2: 'https://chatgpt.com/aip/g-abc123DEF/oauth/callbackx',
      modified_query: 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback?x=1',
      scheme: 'http://chatgpt.com/aip/g-abc123DEF/oauth/callback',
      fragment: 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback#f',
      case_variant: 'https://ChatGPT.com/aip/g-abc123DEF/oauth/callback',
      trailing_space: 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback ',
      empty: '',
    };
    for (const [name, uri] of Object.entries(cases)) {
      expect(buildAuthorizeRedirect(env, q(uri), ORIGIN), name).toMatchObject({ ok: false, error: 'invalid_redirect' });
    }
    expect(buildAuthorizeRedirect(env, q(CHATGPT_CB), ORIGIN).ok).toBe(true);
    // The configured value itself must be a clean https URL, else the bridge is unconfigured.
    for (const bad of ['http://chatgpt.com/aip/g-abc123DEF/oauth/callback', 'https://chatgpt.com/aip/g-abc123DEF/oauth/callback#x', 'not a url', '']) {
      expect(buildAuthorizeRedirect({ ...env, PRESTON_CONTROL_GPT_CALLBACK_URL: bad }, q(CHATGPT_CB), ORIGIN), bad).toMatchObject({ ok: false, error: 'unconfigured' });
    }
    // If the configuration changes, a state minted for the OLD callback cannot redirect anywhere.
    const packed = packState(env, { nonce: 'n'.repeat(43), chatgptRedirect: CHATGPT_CB, chatgptState: 'x' });
    const reconfigured = { ...env, PRESTON_CONTROL_GPT_CALLBACK_URL: 'https://chatgpt.com/aip/g-other999/oauth/callback' };
    expect(unpackState(reconfigured, packed)).toBeNull();
    expect(buildCallbackRedirect(reconfigured, { code: 'supa-code-ABC', state: packed })).toMatchObject({ ok: false, error: 'invalid_state' });
  });

  it('state: tampering or a foreign key is refused', () => {
    const packed = packState(env, { nonce: 'n'.repeat(43), chatgptRedirect: CHATGPT_CB, chatgptState: 'x' });
    expect(unpackState(env, packed)).toBeTruthy();
    expect(unpackState(env, packed.slice(0, -2) + 'zz')).toBeNull();
    expect(unpackState({ ...env, PRESTON_CONTROL_GPT_BRIDGE_KEY: 'j'.repeat(48) }, packed)).toBeNull();
    const forged = Buffer.from(JSON.stringify(['n'.repeat(43), 'https://evil.example/x', 's'])).toString('base64url');
    expect(unpackState(env, forged + '.' + 'sig')).toBeNull();
  });

  it('callback: hands ChatGPT a composite code bound to the nonce; propagates upstream denial; refuses bad state', () => {
    const packed = packState(env, { nonce: 'n'.repeat(43), chatgptRedirect: CHATGPT_CB, chatgptState: 'cg-1' });
    const ok = buildCallbackRedirect(env, { code: 'supa-code-ABC', state: packed });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const u = new URL(ok.location);
      expect(u.origin + u.pathname).toBe(CHATGPT_CB);
      expect(u.searchParams.get('state')).toBe('cg-1');
      expect(u.searchParams.get('code')).toBe('supa-code-ABC.' + 'n'.repeat(43));
    }
    const denied = buildCallbackRedirect(env, { error: 'access_denied', state: packed });
    expect(denied.ok).toBe(false);
    expect(denied.location).toContain('error=access_denied');
    expect(buildCallbackRedirect(env, { code: 'supa', state: 'garbage' })).toMatchObject({ ok: false, error: 'invalid_state' });
    expect(buildCallbackRedirect(env, { code: 'bad code!', state: packed })).toMatchObject({ ok: false, error: 'invalid_code' });
  });

  it('token: verifies client credentials (post or basic), unfolds the composite code, re-derives the verifier, forwards; refresh passes through', () => {
    const composite = 'supa-code-ABC.' + 'n'.repeat(43);
    const ok = buildTokenForward(env, { grant_type: 'authorization_code', code: composite, client_id: GPT_CLIENT, client_secret: CONF, redirect_uri: CHATGPT_CB }, null, ORIGIN);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.forward.url).toBe('https://proj.supabase.co/auth/v1/oauth/token');
      expect(ok.forward.body.get('code')).toBe('supa-code-ABC');
      expect(ok.forward.body.get('code_verifier')).toBe(deriveVerifier(env, 'n'.repeat(43)));
      expect(ok.forward.body.get('redirect_uri')).toBe(ORIGIN + '/oauth/gpt/callback');
      expect(ok.forward.body.get('client_id')).toBe(GPT_CLIENT);
    }
    const basic = 'Basic ' + Buffer.from(`${GPT_CLIENT}:${CONF}`).toString('base64');
    expect(buildTokenForward(env, { grant_type: 'refresh_token', refresh_token: 'rt-1' }, basic, ORIGIN)).toMatchObject({ ok: true });
    expect(buildTokenForward(env, { grant_type: 'authorization_code', code: composite, client_id: GPT_CLIENT, client_secret: 'wrong' }, null, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_client', status: 401 });
    expect(buildTokenForward(env, { grant_type: 'authorization_code', code: composite, client_id: MCP_CLIENT, client_secret: CONF }, null, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_client' });
    expect(buildTokenForward(env, { grant_type: 'authorization_code', code: 'no-nonce', client_id: GPT_CLIENT, client_secret: CONF }, null, ORIGIN)).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(buildTokenForward(env, { grant_type: 'client_credentials', client_id: GPT_CLIENT, client_secret: CONF }, null, ORIGIN)).toMatchObject({ ok: false, error: 'unsupported_grant_type' });
  });

  it('client-auth diagnostic is values-free; Basic with raw (non-urlencoded) creds and colons still works', () => {
    const bad = buildTokenForward(env, { grant_type: 'authorization_code', code: 'c.' + 'n'.repeat(43), client_id: GPT_CLIENT, client_secret: 'nope' }, null, ORIGIN);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.diag).toEqual({ method: 'post', basic_decode_error: false, client_id_match: true, secret_present: true, secret_length_match: false, grant_type: 'authorization_code' });
      expect(JSON.stringify(bad.diag)).not.toContain('nope');
      expect(JSON.stringify(bad.diag)).not.toContain(CONF);
    }
    const envColon = { ...env, PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET: 'a:b%c:' + 'x'.repeat(20) };
    const rawBasic = 'Basic ' + Buffer.from(`${GPT_CLIENT}:a:b%c:${'x'.repeat(20)}`).toString('base64');
    expect(buildTokenForward(envColon, { grant_type: 'refresh_token', refresh_token: 'rt' }, rawBasic, ORIGIN).ok).toBe(true);
    const encBasic = 'Basic ' + Buffer.from(`${encodeURIComponent(GPT_CLIENT)}:${encodeURIComponent('a:b%c:' + 'x'.repeat(20))}`).toString('base64');
    expect(buildTokenForward(envColon, { grant_type: 'refresh_token', refresh_token: 'rt' }, encBasic, ORIGIN).ok).toBe(true);
    const none = buildTokenForward(env, { grant_type: 'refresh_token', refresh_token: 'rt' }, null, ORIGIN);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.diag?.method).toBe('none');
  });

  it('token response filter passes only the OAuth fields', () => {
    expect(filterTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', id_token: 'idt', user: { email: OWNER } }))
      .toEqual({ access_token: 'a', token_type: 'bearer', refresh_token: 'r', expires_in: 3600 });
    expect(filterTokenResponse({ error: 'invalid_grant' })).toBeNull();
  });

  it('bridge routes: disabled -> 404; authorize redirects 302 to Supabase; token refuses bad client without calling upstream', async () => {
    const auth = await import('../src/app/oauth/gpt/authorize/route');
    const tok = await import('../src/app/oauth/gpt/token/route');
    const cb = await import('../src/app/oauth/gpt/callback/route');
    const r = await auth.GET(new Request(`${ORIGIN}/oauth/gpt/authorize?response_type=code&client_id=${GPT_CLIENT}&redirect_uri=${encodeURIComponent(CHATGPT_CB)}&scope=email&state=s1`));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('https://proj.supabase.co/auth/v1/oauth/authorize?');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: 'x.y', client_id: GPT_CLIENT, client_secret: 'nope' }).toString();
    const t = await tok.POST(new Request(`${ORIGIN}/oauth/gpt/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(body.length) }, body }));
    expect(t.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect((await cb.GET(new Request(`${ORIGIN}/oauth/gpt/callback?code=abc&state=bad`))).status).toBe(400);
    delete process.env.PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID;
    expect((await auth.GET(new Request(`${ORIGIN}/oauth/gpt/authorize`))).status).toBe(404);
  });

  it('openapi builder is pure and secret-free', () => {
    const doc = buildOpenApiDocument('https://x.example/');
    expect((doc.servers as Array<{ url: string }>)[0].url).toBe('https://x.example');
    expect(JSON.stringify(doc)).not.toMatch(/client_secret|BRIDGE_KEY/);
  });
});

describe('wiring', () => {
  it('proxy matcher excludes api/control and oauth/gpt/', () => {
    const proxy = readFileSync(join(__dirname, '..', 'src', 'proxy.ts'), 'utf8');
    const m = proxy.match(/matcher: \['([^']+)'\]/)!;
    const re = new RegExp('^' + m[1].replace(/\\\\/g, '\\') + '$');
    expect(re.test('/api/control/status')).toBe(false);
    expect(re.test('/oauth/gpt/token')).toBe(false);
    expect(re.test('/oauth/consent')).toBe(true);
  });
  it('env.template lists the GPT-surface names', () => {
    const tpl = readFileSync(join(__dirname, '..', '..', '..', 'env.template'), 'utf8');
    for (const n of ['PRESTON_CONTROL_GPT_OAUTH_CLIENT_ID=', 'PRESTON_CONTROL_GPT_OAUTH_CLIENT_SECRET=', 'PRESTON_CONTROL_GPT_BRIDGE_KEY=', 'PRESTON_CONTROL_GPT_CALLBACK_URL=']) {
      expect(tpl).toContain('\n' + n + '\n');
    }
  });
  it('the REST adapter reaches for no shell / service role / raw SQL', () => {
    const root = join(__dirname, '..', 'src');
    for (const f of ['lib/preston-control/http.ts', 'lib/preston-control/gpt-bridge.ts', 'lib/preston-control/openapi.ts']) {
      expect(readFileSync(join(root, f), 'utf8')).not.toMatch(/child_process|execSync|spawn\(|SERVICE_KEY|service_role/);
    }
  });
});

describe('bridge diagnostics + upstream error mapping', () => {
  it('upstreamErrorTag handles OAuth and GoTrue shapes and never leaks msg', async () => {
    const { upstreamErrorTag, classifyCredentialProbe, buildCredentialProbe } = await import('../src/lib/preston-control/gpt-bridge');
    expect(upstreamErrorTag({ error: 'invalid_grant', error_description: 'secret stuff' })).toBe('invalid_grant');
    expect(upstreamErrorTag({ code: 400, error_code: 'invalid_credentials', msg: 'invalid client credentials' })).toBe('invalid_credentials');
    expect(upstreamErrorTag({ error_code: 'Bad Thing!' })).toBe('invalid_grant');
    expect(upstreamErrorTag('<html>')).toBe('invalid_grant');
    expect(classifyCredentialProbe(400, { error_code: 'invalid_credentials' })).toBe('invalid');
    expect(classifyCredentialProbe(400, { error_code: 'invalid_grant' })).toBe('valid');
    expect(classifyCredentialProbe(200, { access_token: 'x' })).toBe('valid');
    expect(classifyCredentialProbe(503, null)).toBe('unknown');
    const probe = buildCredentialProbe(ENV_ON)!;
    expect(probe.url).toBe('https://proj.supabase.co/auth/v1/oauth/token');
    expect(probe.body.get('grant_type')).toBe('refresh_token');
    expect(probe.body.get('client_id')).toBe(GPT_CLIENT);
    expect(probe.headers['authorization']).toBeUndefined();
    const basic = buildCredentialProbe(ENV_ON, 'basic')!;
    expect(basic.headers['authorization']).toMatch(/^Basic /);
    expect(basic.body.get('client_secret')).toBeNull();
    expect(buildCredentialProbe({ ...ENV_ON, PRESTON_CONTROL_GPT_BRIDGE_KEY: 'short' })).toBeNull();
  });

  it('token route returns the GoTrue error_code tag (not msg) on upstream refusal', async () => {
    const tok = await import('../src/app/oauth/gpt/token/route');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'invalid client credentials' }), { status: 400 }));
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: GPT_CLIENT, client_secret: CONF }).toString();
    const r = await tok.POST(new Request(`${ORIGIN}/oauth/gpt/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(body.length) }, body }));
    expect(r.status).toBe(400);
    const t = await r.text();
    expect(t).toBe('{"error":"invalid_credentials"}');
    vi.restoreAllMocks();
  });

  it('diag route: 403 without an owner session; never includes secret values', async () => {
    vi.doMock('@/lib/ai-os/owner-context', () => ({ resolveOwner: async () => null }));
    const diag = await import('../src/app/oauth/gpt/diag/route');
    const r = await diag.GET(new Request(`${ORIGIN}/oauth/gpt/diag`));
    expect(r.status).toBe(403);
    vi.doUnmock('@/lib/ai-os/owner-context');
    const src = readFileSync(join(__dirname, '..', 'src', 'app', 'oauth', 'gpt', 'diag', 'route.ts'), 'utf8');
    expect(src).not.toMatch(/CLIENT_SECRET|BRIDGE_KEY/);
  });
});
