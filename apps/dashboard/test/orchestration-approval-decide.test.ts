import { describe, expect, it, vi } from 'vitest';

// Dashboard decision path for Phase-7 orchestration approvals. The server
// action is a thin, fail-closed convenience over the ONE decision path -
// the owner-only RPC decide_orchestration_approval (migration 0010). These
// tests prove the action's boundary behavior: owner re-check, input
// validation, fresh one-time nonce per attempt, safe error-tag surfacing,
// and that the action NEVER touches the approvals table directly.

const resolveOwnerMock = vi.fn();

vi.mock('@/lib/ai-os/owner-context', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/ai-os/owner-context')>();
  return { ...real, resolveOwner: () => resolveOwnerMock() };
});

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error('NEXT_REDIRECT:' + url);
  },
}));

import { decideOrchestrationApproval } from '../src/app/os/orchestration/actions';

const OWNER = 'info@preston.nyc';

interface RpcCall { fn: string; args: Record<string, unknown> }

function makeRpcClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: RpcCall[] = [];
  const client = {
    from() { throw new Error('table access not expected - decisions go through the RPC only'); },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function run(formData: FormData): Promise<string> {
  try {
    await decideOrchestrationApproval(formData);
    throw new Error('expected redirect');
  } catch (e) {
    return decodeURIComponent(String((e as Error).message));
  }
}

describe('decideOrchestrationApproval - boundary behavior', () => {
  it('refuses a non-owner (public POST boundary)', async () => {
    resolveOwnerMock.mockResolvedValue(null);
    const msg = await run(fd({ approval_id: 'apr-000000000001', outcome: 'approved' }));
    expect(msg).toContain('msg=denied');
  });

  it('rejects an invalid outcome and an invalid approval id before any RPC', async () => {
    const { client, calls } = makeRpcClient({ data: null, error: null });
    resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client, audit: {} });
    const badOutcome = await run(fd({ approval_id: 'apr-000000000001', outcome: 'expired' }));
    expect(badOutcome).toContain('invalid input');
    const badId = await run(fd({ approval_id: 'x', outcome: 'approved' }));
    expect(badId).toContain('invalid input');
    expect(calls).toHaveLength(0);
  });

  it('approves through the RPC with a fresh dash- nonce', async () => {
    const { client, calls } = makeRpcClient({ data: [{ status: 'approved' }], error: null });
    resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client, audit: {} });
    const msg = await run(fd({ approval_id: 'apr-000000000001', outcome: 'approved' }));
    expect(msg).toContain('approval approved: apr-000000000001');
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('decide_orchestration_approval');
    expect(calls[0].args.p_approval_id).toBe('apr-000000000001');
    expect(calls[0].args.p_outcome).toBe('approved');
    expect(String(calls[0].args.p_nonce)).toMatch(/^dash-[0-9a-f-]{36}$/);
  });

  it('mints a DIFFERENT nonce per attempt (one-time semantics upstream)', async () => {
    const { client, calls } = makeRpcClient({ data: [{ status: 'approved' }], error: null });
    resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client, audit: {} });
    await run(fd({ approval_id: 'apr-000000000001', outcome: 'approved' }));
    await run(fd({ approval_id: 'apr-000000000001', outcome: 'approved' }));
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_nonce).not.toBe(calls[1].args.p_nonce);
  });

  it('surfaces RPC refusals as safe tags (not_pending, expired, owner_required)', async () => {
    for (const tag of ['not_pending', 'expired', 'owner_required', 'already_decided']) {
      const { client } = makeRpcClient({ data: null, error: { message: `ERROR: ${tag}` } });
      resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client, audit: {} });
      const msg = await run(fd({ approval_id: 'apr-000000000001', outcome: 'rejected' }));
      expect(msg).toContain('approval decision refused: ' + tag);
    }
  });

  it('an unknown RPC error is masked to decide_failed (no internals leaked)', async () => {
    const { client } = makeRpcClient({
      data: null,
      error: { message: 'connection refused at 10.0.0.5:5432 password=?' },
    });
    resolveOwnerMock.mockResolvedValue({ ownerEmail: OWNER, client, audit: {} });
    const msg = await run(fd({ approval_id: 'apr-000000000001', outcome: 'approved' }));
    expect(msg).toContain('approval decision refused: decide_failed');
    expect(msg).not.toContain('10.0.0.5');
  });

  it('page contract: decision forms render for pending approvals only, via the action', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const page = readFileSync(
      join(__dirname, '../src/app/os/orchestration/page.tsx'), 'utf8');
    expect(page).toContain('decideOrchestrationApproval');
    expect(page).toContain("s(a, 'status') === 'pending'");
    expect(page).toContain('name="outcome" value="approved"');
    expect(page).toContain('name="outcome" value="rejected"');
    expect(page).toContain('aria-label={`Approve ${s(a, \'approval_id\')}`}');
    expect(page).toContain('aria-label={`Reject ${s(a, \'approval_id\')}`}');
  });
});
