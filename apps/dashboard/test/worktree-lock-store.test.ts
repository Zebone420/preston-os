import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import {
  acquireWorktreeLock,
  releaseWorktreeLock,
  lockFromRow,
} from '../src/lib/ai-os/orchestration/worktree-lock-store';
import { decideAcquire } from '../src/lib/ai-os/orchestration/worktree-lock';

// Real repository_worktrees schema contract (audit critical #1): the Phase 7
// worktree-lock store persists onto the EXISTING repository_worktrees table
// (0004) plus the 0010 additive fencing columns. These tests pin that the
// store writes ONLY real columns, provides the NOT NULL `path`, and uses a
// status value inside the 0004 CHECK set - never the invalid 'assigned'.

const sql0004 = readFileSync(
  new URL('../../../supabase/migrations/0004_phase3_runtime.sql', import.meta.url),
  'utf8',
);
const sql0010 = readFileSync(
  new URL('../../../supabase/migrations/0010_phase7_orchestration.sql', import.meta.url),
  'utf8',
);
const storeSrc = readFileSync(
  new URL('../src/lib/ai-os/orchestration/worktree-lock-store.ts', import.meta.url),
  'utf8',
);

// Derive the authoritative column set + status CHECK for repository_worktrees.
function repoWorktreeColumns(): { cols: Set<string>; statuses: Set<string> } {
  const create = sql0004.match(/create table if not exists repository_worktrees \(([\s\S]*?)\n\);/);
  if (!create) throw new Error('repository_worktrees CREATE not found in 0004');
  const cols = new Set<string>();
  for (const line of create[1].split('\n')) {
    const m = line.match(/^\s{2}([a-z_]+)\s/); // "  <col> <type>"
    if (m && !['check', 'unique', 'primary', 'foreign', 'constraint'].includes(m[1])) cols.add(m[1]);
  }
  // 0010 additive columns
  for (const m of sql0010.matchAll(/alter table repository_worktrees\s+add column if not exists ([a-z_]+)/g)) {
    cols.add(m[1]);
  }
  const check = create[1].match(/status[\s\S]*?check \(status in \(([^)]*)\)\)/);
  const statuses = new Set<string>();
  if (check) for (const s of check[1].matchAll(/'([a-z_]+)'/g)) statuses.add(s[1]);
  return { cols, statuses };
}

// Extract the keys + status literal the store's acquire `patch` writes.
function storePatch(): { keys: string[]; status: string } {
  const block = storeSrc.match(/const patch = \{([\s\S]*?)\};/);
  if (!block) throw new Error('patch object not found in store');
  const keys = [...block[1].matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  const status = block[1].match(/status:\s*'([a-z_]+)'/)?.[1] ?? '';
  return { keys, status };
}

describe('worktree-lock store - real repository_worktrees schema contract (#1)', () => {
  it('writes only columns that exist on repository_worktrees', () => {
    const { cols } = repoWorktreeColumns();
    const { keys } = storePatch();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(cols.has(k), `column "${k}" not in repository_worktrees`).toBe(true);
  });
  it('provides the NOT NULL path column', () => {
    // path is `text not null` in 0004 - omitting it makes every insert fail.
    expect(sql0004).toMatch(/\n\s*path text not null,/);
    expect(storePatch().keys).toContain('path');
  });
  it('uses a status inside the 0004 CHECK set and never the invalid "assigned"', () => {
    const { statuses } = repoWorktreeColumns();
    const { status } = storePatch();
    expect(statuses.has(status), `status "${status}" not in CHECK`).toBe(true);
    expect(status).toBe('in_use');
    expect(statuses.has('assigned')).toBe(false); // 'assigned' was never valid
    expect(storeSrc).not.toMatch(/status:\s*'assigned'/);
  });
  it('persists the durable fencing columns added in 0010', () => {
    const { keys } = storePatch();
    for (const c of ['fence', 'allowed_paths', 'lease_expires_at']) expect(keys).toContain(c);
  });
});

// ---- behavioral round-trip against a fake enforcing PK + eq() CAS ----------
function makeFakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rowsOf = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            const rows = rowsOf(table);
            if (row.id !== undefined && rows.some((r) => r.id === row.id)) {
              return Promise.resolve({ data: null, error: { message: 'duplicate key' } });
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ id: row.id }], error: null });
          } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((fn) => fn(r))).slice(0, n), error: null }); } }; },
            limit(n: number) { return Promise.resolve({ data: rowsOf(table).filter((r) => f.every((fn) => fn(r))).slice(0, n), error: null }); },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() {
              const matched = rowsOf(table).filter((r) => f.every((fn) => fn(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf };
}

const NOW = '2026-07-22T12:00:00.000Z';
function input(over: Record<string, unknown> = {}) {
  return {
    worktree_id: 'wt-job-0001', repo: 'preston-os', job_id: 'job-0001',
    owner: 'claude', token: 'tok-00000001', base_commit: 'abc1234',
    branch: 'wt/job-0001', allowed_paths: ['apps/dashboard/src/'],
    now: NOW, tree_dirty: false, branch_exists: false,
    ...over,
  };
}

describe('worktree-lock store - acquire/release/fence behavior (#1/#11)', () => {
  it('acquires: writes in_use + path + persisted fence/allowed_paths/lease', async () => {
    const db = makeFakeDb();
    const r = await acquireWorktreeLock(db.client, input());
    expect(r.ok).toBe(true);
    const row = db.rowsOf('repository_worktrees')[0];
    expect(row.status).toBe('in_use');
    expect(row.path).toBe('/srv/worktrees/wt-job-0001');
    expect(row.fence).toBe(1);
    expect(row.allowed_paths).toEqual(['apps/dashboard/src/']);
    expect(typeof row.lease_expires_at).toBe('string');
    expect(String(row.lease_expires_at).length).toBeGreaterThan(0);
  });

  it('release: sets unassigned and clears the lock_id, fenced on the holder', async () => {
    const db = makeFakeDb();
    const r = await acquireWorktreeLock(db.client, input());
    if (!r.ok) throw new Error('acquire');
    const rel = await releaseWorktreeLock(db.client, 'wt-job-0001', r.lock.token, r.lock.fence, NOW);
    expect(rel.ok).toBe(true);
    const row = db.rowsOf('repository_worktrees')[0];
    expect(row.status).toBe('unassigned');
    expect(row.lock_id).toBe('');
    // a wrong-fence release does not match the row
    const bad = await releaseWorktreeLock(db.client, 'wt-job-0001', r.lock.token, 999, NOW);
    expect(bad.ok).toBe(false);
  });

  it('stale takeover bumps the fence; revived holder is fenced out on release', async () => {
    const db = makeFakeDb();
    const first = await acquireWorktreeLock(db.client, input());
    if (!first.ok) throw new Error('first');
    // force the persisted lease to be already expired, then a new owner takes over
    db.rowsOf('repository_worktrees')[0].lease_expires_at = '2026-07-22T11:00:00.000Z';
    const takeover = await acquireWorktreeLock(db.client, input({ owner: 'codex', token: 'tok-00000002' }));
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) throw new Error('takeover');
    expect(takeover.lock.fence).toBe(2);
    // the revived original holder (fence 1) can no longer release
    const revived = await releaseWorktreeLock(db.client, 'wt-job-0001', 'tok-00000001', 1, NOW);
    expect(revived.ok).toBe(false);
  });

  it('release/reacquire keeps the fence monotonic and defeats ABA', async () => {
    const db = makeFakeDb();
    // gen 1
    const a1 = await acquireWorktreeLock(db.client, input());
    if (!a1.ok) throw new Error('a1');
    expect(a1.lock.fence).toBe(1);
    const rel1 = await releaseWorktreeLock(db.client, 'wt-job-0001', a1.lock.token, a1.lock.fence, NOW);
    expect(rel1.ok).toBe(true);
    // reacquire with the SAME token: fence must INCREASE, not reset to 1
    const a2 = await acquireWorktreeLock(db.client, input());
    if (!a2.ok) throw new Error('a2');
    expect(a2.lock.fence).toBe(2);
    expect(db.rowsOf('repository_worktrees')[0].fence).toBe(2);
    // ABA: the ORIGINAL holder (same token, old fence 1) must NOT be able to
    // release the new generation-2 lock.
    const abaRelease = await releaseWorktreeLock(db.client, 'wt-job-0001', a1.lock.token, 1, NOW);
    expect(abaRelease.ok).toBe(false);
    // and the real gen-2 holder can release
    const rel2 = await releaseWorktreeLock(db.client, 'wt-job-0001', a2.lock.token, 2, NOW);
    expect(rel2.ok).toBe(true);
    // a third cycle stays monotonic (3), never recurs a prior generation
    const a3 = await acquireWorktreeLock(db.client, input());
    if (!a3.ok) throw new Error('a3');
    expect(a3.lock.fence).toBe(3);
  });

  it('release preserves the fence column and expires the lease', async () => {
    const db = makeFakeDb();
    const a = await acquireWorktreeLock(db.client, input());
    if (!a.ok) throw new Error('a');
    await releaseWorktreeLock(db.client, 'wt-job-0001', a.lock.token, a.lock.fence, NOW);
    const row = db.rowsOf('repository_worktrees')[0];
    expect(row.fence).toBe(1); // NOT reset - kept for the next generation
    expect(row.lock_id).toBe('');
    expect(row.lease_expires_at).toBe(NOW); // lease expired so the slot is free
  });

  it('migrated row (fence column lags encoded lock_id) cannot recur a generation', async () => {
    const db = makeFakeDb();
    // A legacy/migrated stale row: lock_id encodes generation 5, but the 0010
    // fence column defaulted to 0. A takeover must land at 6, never 1.
    db.rowsOf('repository_worktrees').push({
      id: 'wt-job-0001', repo: 'preston-os', job_id: 'job-0001', agent: 'claude',
      path: '/srv/worktrees/wt-job-0001', base_commit: 'abc1234',
      target_branch: 'wt/job-0001', lock_id: 'tok-00000001#5', fence: 0,
      status: 'in_use', lease_expires_at: '2026-07-22T11:00:00.000Z', // expired
      updated_at: NOW,
    });
    const takeover = await acquireWorktreeLock(db.client, input({ owner: 'codex', token: 'tok-00000002' }));
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) throw new Error('takeover');
    expect(takeover.lock.fence).toBe(6); // max(0,5)+1, not 1
    expect(db.rowsOf('repository_worktrees')[0].fence).toBe(6);
  });

  it('lockFromRow reconstructs the binding from the PERSISTED columns (#11)', async () => {
    const db = makeFakeDb();
    const r = await acquireWorktreeLock(db.client, input());
    if (!r.ok) throw new Error('acquire');
    const row = db.rowsOf('repository_worktrees')[0];
    // pass a DIFFERENT fallback to prove the persisted column wins
    const lock = lockFromRow(row, ['SHOULD-NOT-BE-USED/']);
    expect(lock).not.toBeNull();
    expect(lock!.allowed_paths).toEqual(['apps/dashboard/src/']);
    expect(lock!.fence).toBe(1);
    expect(lock!.base_commit).toBe('abc1234');
    expect(lock!.branch).toBe('wt/job-0001');
  });
});

describe('worktree-lock TTL validation (#18)', () => {
  const MAX_TTL = 6 * 60 * 60 * 1000;
  it('rejects zero, negative, non-finite, and excessive TTLs', () => {
    for (const ttlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TTL + 1]) {
      const r = decideAcquire({ ...input(), existing: null, ttlMs });
      expect(r.ok, `ttlMs=${ttlMs} should be rejected`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('ttl_invalid');
    }
  });
  it('accepts a valid TTL and an omitted TTL (default)', () => {
    expect(decideAcquire({ ...input(), existing: null, ttlMs: 60_000 }).ok).toBe(true);
    expect(decideAcquire({ ...input(), existing: null, ttlMs: MAX_TTL }).ok).toBe(true);
    expect(decideAcquire({ ...input(), existing: null }).ok).toBe(true); // default
  });
});
