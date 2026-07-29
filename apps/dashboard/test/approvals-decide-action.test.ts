import { afterEach, describe, expect, it, vi } from 'vitest';

// Gate-3 approvals decision path. A Server Action is a PUBLIC POST entry
// point: the proxy gate is path-based (and `/login` is deliberately
// reachable while unauthenticated), so a Next-Action POST can be aimed at a
// path the gate allows. The owner boundary therefore has to be enforced
// INSIDE the action, and it has to fail closed on every axis. The store
// (decideApprovalRow) holds no identity logic by design - it trusts its
// caller for actor and only validates untrusted input - so this action is
// the only place the owner check exists. These tests pin that boundary,
// mirroring the sibling orchestration suite's idiom.

const getServerSupabaseMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: () => getServerSupabaseMock(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error('NEXT_REDIRECT:' + url);
  },
}));

import { decideApproval } from '../src/app/approvals/actions';

const OWNER = 'info@preston.nyc';
const ID = '11111111-2222-4333-8444-555555555555';

interface Recorded {
  updates: Record<string, unknown>[];
  eqs: Array<[string, string]>;
  audits: Record<string, unknown>[];
}

// Supabase double: an auth surface plus the approvals/audit table shape the
// store drives. `denyTables` proves ORDERING - if the owner gate ever moved
// below a DB call, the throwing table surface fails the test loudly.
function makeSupabase(opts: {
  user: { email?: string } | null;
  updateResult?: { data: unknown; error: { message: string } | null };
  denyTables?: boolean;
}) {
  const rec: Recorded = { updates: [], eqs: [], audits: [] };
  const updateResult = opts.updateResult ?? { data: [{ id: ID }], error: null };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user }, error: null }),
    },
    from(table: string) {
      if (opts.denyTables) {
        throw new Error('table access not expected before the owner gate passes');
      }
      return {
        update(patch: Record<string, unknown>) {
          rec.updates.push(patch);
          const node = {
            eq(col: string, val: string) {
              rec.eqs.push([col, val]);
              return node;
            },
            select: async () => updateResult,
          };
          return node;
        },
        insert(row: Record<string, unknown>) {
          if (table === 'audit_log') rec.audits.push(row);
          return { select: async () => ({ data: [{ id: 'a1' }], error: null }) };
        },
      };
    },
  };
  return { client, rec };
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function run(formData: FormData): Promise<string> {
  try {
    await decideApproval(formData);
    throw new Error('expected redirect');
  } catch (e) {
    return decodeURIComponent(String((e as Error).message));
  }
}

const valid = () => fd({ approval_id: ID, decision: 'approved' });

afterEach(() => {
  vi.unstubAllEnvs();
  getServerSupabaseMock.mockReset();
});

describe('decideApproval - owner boundary is enforced in the action', () => {
  it('setup mode (no client) records nothing', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    getServerSupabaseMock.mockResolvedValue(null);
    expect(await run(valid())).toContain('msg=setup_mode');
  });

  it('unauthenticated POST is denied before any table access', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client, rec } = makeSupabase({ user: null, denyTables: true });
    getServerSupabaseMock.mockResolvedValue(client);
    expect(await run(valid())).toContain('msg=denied');
    expect(rec.updates).toHaveLength(0);
  });

  it('authenticated NON-OWNER is denied before any table access', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client, rec } = makeSupabase({
      user: { email: 'intruder@example.com' },
      denyTables: true,
    });
    getServerSupabaseMock.mockResolvedValue(client);
    expect(await run(valid())).toContain('msg=denied');
    expect(rec.updates).toHaveLength(0);
  });

  it('empty allowlist denies everyone, including the usual owner', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', '');
    const { client } = makeSupabase({ user: { email: OWNER }, denyTables: true });
    getServerSupabaseMock.mockResolvedValue(client);
    expect(await run(valid())).toContain('msg=denied');
  });

  it('a session with no email is denied (identity comes from the session only)', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client } = makeSupabase({ user: {}, denyTables: true });
    getServerSupabaseMock.mockResolvedValue(client);
    expect(await run(valid())).toContain('msg=denied');
  });

  it('a spoofed owner in the form body cannot grant authority', async () => {
    // The action reads identity from supabase.auth.getUser() only; the POST
    // body carries no identity input, so planting one changes nothing.
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client, rec } = makeSupabase({
      user: { email: 'intruder@example.com' },
      denyTables: true,
    });
    getServerSupabaseMock.mockResolvedValue(client);
    const msg = await run(fd({
      approval_id: ID, decision: 'approved',
      owner_email: OWNER, actor: OWNER, user: OWNER,
    }));
    expect(msg).toContain('msg=denied');
    expect(rec.updates).toHaveLength(0);
  });
});

describe('decideApproval - input validation and the recorded decision', () => {
  it('rejects a non-whitelisted decision before touching the store', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client, rec } = makeSupabase({ user: { email: OWNER } });
    getServerSupabaseMock.mockResolvedValue(client);
    for (const bad of ['executed', 'approve', '', 'APPROVED']) {
      expect(await run(fd({ approval_id: ID, decision: bad }))).toContain('msg=invalid');
    }
    expect(rec.updates).toHaveLength(0);
  });

  it('rejects a malformed approval id without writing', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client, rec } = makeSupabase({ user: { email: OWNER } });
    getServerSupabaseMock.mockResolvedValue(client);
    expect(await run(fd({ approval_id: 'x', decision: 'approved' })))
      .toContain('msg=invalid_id');
    expect(rec.updates).toHaveLength(0);
  });

  it('owner decision is CAS-guarded to a pending row and never self-confirms', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', ` ${OWNER.toUpperCase()} `); // trimmed/lowercased
    const { client, rec } = makeSupabase({ user: { email: OWNER } });
    getServerSupabaseMock.mockResolvedValue(client);

    expect(await run(valid())).toContain('msg=decided');

    expect(rec.updates[0]).toMatchObject({
      decision: 'approved',
      explicit_confirmation: false, // a one-click UI decision is never RED confirmation
    });
    expect(rec.eqs).toEqual([['id', ID], ['decision', 'pending']]);
    expect(rec.audits).toHaveLength(1);
    expect(rec.audits[0]).toMatchObject({
      action: 'approval_decision:approved',
      production_touched: false,
      write_actions_performed: false,
    });
  });

  it('a replayed decision on an already-decided row changes nothing', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const { client, rec } = makeSupabase({
      user: { email: OWNER },
      updateResult: { data: [], error: null }, // CAS matched no pending row
    });
    getServerSupabaseMock.mockResolvedValue(client);
    expect(await run(valid())).toContain('msg=not_pending');
    expect(rec.audits).toHaveLength(0); // no audit for a decision that did not land
  });

  it('a write failure surfaces a code, never the raw DB error text', async () => {
    vi.stubEnv('OWNER_EMAIL_ALLOWLIST', OWNER);
    const secret = 'postgres://user:hunter2@db.internal:5432';
    const { client } = makeSupabase({
      user: { email: OWNER },
      updateResult: { data: null, error: { message: 'connection to ' + secret + ' failed' } },
    });
    getServerSupabaseMock.mockResolvedValue(client);
    const msg = await run(valid());
    expect(msg).toContain('msg=write_failed');
    expect(msg).not.toContain('hunter2');
    expect(msg).not.toContain('db.internal');
  });
});
