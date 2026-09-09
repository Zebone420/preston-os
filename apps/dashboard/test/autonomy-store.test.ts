// Phase 7 graduated autonomy - store adapters against a fake RuntimeClient:
// validated append-only inserts, fail-closed reads, and the CAS on the
// class rung (exactly one of two racing writers wins). No deletes exist.

import { describe, expect, it } from 'vitest';
import type { QueryResult, RuntimeClient } from '../src/lib/ai-os/store';
import {
  acknowledgeAnomaly,
  AUTONOMY_ANOMALIES_TABLE,
  AUTONOMY_CLASSES_TABLE,
  AUTONOMY_GRANTS_TABLE,
  AUTONOMY_OUTCOMES_TABLE,
  insertAnomaly,
  insertGrant,
  insertOutcome,
  listAnomalies,
  listGrants,
  listOutcomes,
  parseClassRow,
  readClass,
  revokeGrant,
  updateClassRung,
  type GrantInput,
} from '../src/lib/business/autonomy/store';

const NOW = '2026-09-08T12:00:00.000Z';
const CLS = 'deterministic_filing';
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

function fakeClient(opts: { failOn?: Set<string> } = {}) {
  const tables = new Map<string, Row[]>();
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const pk = (t: string) => (t === AUTONOMY_CLASSES_TABLE ? 'class_id' : 'id');
  const err = (m: string): QueryResult => ({ data: null, error: { message: m } });
  const down = (t: string) => opts.failOn?.has(t) === true;
  const client: RuntimeClient = {
    from(table: string) {
      return {
        insert(row: Row) {
          return { select() {
            if (down(table)) return Promise.resolve(err('service unavailable'));
            const rows = rowsOf(table); const key = pk(table);
            if (rows.some((r) => r[key] === row[key])) {
              return Promise.resolve(err('duplicate key value violates unique constraint'));
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ [key]: row[key] }], error: null });
          } };
        },
        select() {
          const run = (f: Pred[], n: number) => down(table)
            ? Promise.resolve(err('service unavailable'))
            : Promise.resolve({
              data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n),
              error: null,
            });
          const chain = (f: Pred[]) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) { return run(f, n); } }; },
            limit(n: number) { return run(f, n); },
          });
          return chain([]);
        },
        update(patch: Row) {
          const chain = (f: Pred[]) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() {
              if (down(table)) return Promise.resolve(err('service unavailable'));
              const matched = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({
                data: matched.map((r) => ({ [pk(table)]: r[pk(table)] })), error: null,
              });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, tables, rowsOf };
}

const seedClass: Row = {
  class_id: CLS, description: 'x', kind: 'deterministic',
  approval_class: 'INTERNAL', capability_ids: [], rung: 'SHADOW', max_rung: 'L1_AUTO',
  updated_at: NOW,
};

describe('readClass / parseClassRow', () => {
  it('reads a seeded class and fails closed on malformed rows', async () => {
    const { client, rowsOf } = fakeClient();
    rowsOf(AUTONOMY_CLASSES_TABLE).push({ ...seedClass });
    rowsOf(AUTONOMY_CLASSES_TABLE).push({ ...seedClass, class_id: 'broken', rung: 'AUTONOMOUS' });
    expect((await readClass(client, CLS))?.rung).toBe('SHADOW');
    expect(await readClass(client, 'broken')).toBeUndefined();
    expect(await readClass(client, 'missing')).toBeUndefined();
    expect(await readClass(client, 'bad id!')).toBeUndefined();
    expect(parseClassRow({ ...seedClass, approval_class: 'PUBLIC' })).toBeUndefined();
    expect(parseClassRow({ ...seedClass, capability_ids: [1] })).toBeUndefined();
  });
  it('a read error is undefined (caller treats the class as CODED)', async () => {
    const { client } = fakeClient({ failOn: new Set([AUTONOMY_CLASSES_TABLE]) });
    expect(await readClass(client, CLS)).toBeUndefined();
  });
});

describe('insertGrant', () => {
  const grant = {
    id: 'g-1', class_id: CLS, from_rung: 'SHADOW' as const,
    to_rung: 'OWNER_APPROVED_LIVE' as const, granted_by: 'owner:info@preston.nyc',
    evidence: { n: 10, successes: 10 },
  };
  it('inserts a one-rung owner grant with evidence; duplicates converge', async () => {
    const { client, rowsOf } = fakeClient();
    expect(await insertGrant(client, grant, NOW)).toEqual({ ok: true, id: 'g-1' });
    expect(await insertGrant(client, grant, NOW))
      .toEqual({ ok: true, duplicate: true, id: 'g-1' });
    const rows = rowsOf(AUTONOMY_GRANTS_TABLE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ granted_at: NOW, revoked_at: null, expires_at: null });
  });
  it('refuses multi-rung, down, evidence-less or anonymous grants before the client', async () => {
    const { client, rowsOf } = fakeClient();
    const attempt = async (over: Partial<GrantInput>) =>
      (await insertGrant(client, { ...grant, ...over }, NOW)).error;
    expect(await attempt({ to_rung: 'L1_AUTO' as never })).toBe('grant_not_one_rung_up');
    expect(await attempt({ to_rung: 'DEPLOYED' as never })).toBe('grant_not_one_rung_up');
    expect(await attempt({ evidence: {} })).toBe('missing_evidence');
    expect(await attempt({ granted_by: ' ' })).toBe('missing_granted_by');
    expect(await attempt({ expires_at: 'never' })).toBe('invalid_expires_at');
    expect(rowsOf(AUTONOMY_GRANTS_TABLE)).toHaveLength(0);
  });
  it('a client failure is a refusal', async () => {
    const { client } = fakeClient({ failOn: new Set([AUTONOMY_GRANTS_TABLE]) });
    const r = await insertGrant(client, grant, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/insert failed/);
  });
});

describe('insertOutcome / insertAnomaly', () => {
  it('records an outcome (append-only) and validates its shape', async () => {
    const { client, rowsOf } = fakeClient();
    const o = { id: 'o-1', class_id: CLS, capability_id: 'preston.echo.read_test',
      outcome: 'success' as const, mode_at_time: 'SHADOW' as const };
    expect(await insertOutcome(client, o, NOW)).toEqual({ ok: true, id: 'o-1' });
    expect(rowsOf(AUTONOMY_OUTCOMES_TABLE)[0])
      .toMatchObject({ recorded_at: NOW, side_effect_id: null });
    const bad1 = await insertOutcome(client, { ...o, id: 'o-2', outcome: 'meh' as never }, NOW);
    expect(bad1.error).toBe('invalid_outcome');
    const bad2 = await insertOutcome(client, { ...o, id: 'o-3', mode_at_time: 'X' as never }, NOW);
    expect(bad2.error).toBe('invalid_mode_at_time');
  });
  it('records an anomaly with mandatory evidence and optional demoted_to', async () => {
    const { client, rowsOf } = fakeClient();
    const a = { id: 'a-1', class_id: CLS, severity: 'critical' as const,
      kind: 'duplicate_side_effect' as const, evidence: { side_effect_id: 'se-1' },
      demoted_to: 'OWNER_APPROVED_LIVE' as const };
    expect(await insertAnomaly(client, a, NOW)).toEqual({ ok: true, id: 'a-1' });
    expect(rowsOf(AUTONOMY_ANOMALIES_TABLE)[0]).toMatchObject({
      detected_at: NOW, acknowledged_by: null, demoted_to: 'OWNER_APPROVED_LIVE',
    });
    const bad1 = await insertAnomaly(client, { ...a, id: 'a-2', evidence: {} }, NOW);
    expect(bad1.error).toBe('missing_evidence');
    const bad2 = await insertAnomaly(client, { ...a, id: 'a-3', kind: 'oops' as never }, NOW);
    expect(bad2.error).toBe('invalid_kind');
  });
});

describe('list reads', () => {
  it('listGrants drops malformed rows; listAnomalies fails closed on any', async () => {
    const { client, rowsOf } = fakeClient();
    await insertGrant(client, { id: 'g-1', class_id: 'c', from_rung: 'CODED', to_rung: 'TESTED',
      granted_by: 'owner', evidence: { ok: true } }, NOW);
    rowsOf(AUTONOMY_GRANTS_TABLE).push({ id: 'g-bad', class_id: 'c', from_rung: 'CODED' });
    expect((await listGrants(client, 'c'))?.map((g) => g.id)).toEqual(['g-1']);
    await insertAnomaly(client, { id: 'a-1', class_id: 'c', severity: 'minor', kind: 'other',
      evidence: { note: 'x' } }, NOW);
    expect((await listAnomalies(client, 'c'))?.map((a) => a.id)).toEqual(['a-1']);
    rowsOf(AUTONOMY_ANOMALIES_TABLE).push({ id: 'a-bad', class_id: 'c', severity: 'huge' });
    expect(await listAnomalies(client, 'c')).toBeUndefined();
  });
  it('listOutcomes filters by class and returns undefined on a read error', async () => {
    const { client } = fakeClient();
    await insertOutcome(client, { id: 'o-1', class_id: 'c', capability_id: 'x.y.z',
      outcome: 'success', mode_at_time: 'SHADOW' }, NOW);
    await insertOutcome(client, { id: 'o-2', class_id: 'd', capability_id: 'x.y.z',
      outcome: 'success', mode_at_time: 'SHADOW' }, NOW);
    expect((await listOutcomes(client, 'c'))?.map((o) => o.id)).toEqual(['o-1']);
    const { client: down } = fakeClient({ failOn: new Set([AUTONOMY_OUTCOMES_TABLE]) });
    expect(await listOutcomes(down, 'c')).toBeUndefined();
  });
});

describe('updateClassRung - CAS on the current rung', () => {
  it('promotes one rung when the observed rung still holds', async () => {
    const { client, rowsOf } = fakeClient();
    rowsOf(AUTONOMY_CLASSES_TABLE).push({ ...seedClass });
    const r = await updateClassRung(client, CLS, 'SHADOW', 'OWNER_APPROVED_LIVE', NOW);
    expect(r).toEqual({ ok: true, id: CLS });
    expect(rowsOf(AUTONOMY_CLASSES_TABLE)[0])
      .toMatchObject({ rung: 'OWNER_APPROVED_LIVE', updated_at: NOW });
  });
  it('exactly one of two racing writers wins; the loser is refused, not forced', async () => {
    const { client, rowsOf } = fakeClient();
    rowsOf(AUTONOMY_CLASSES_TABLE).push({ ...seedClass });
    const a = await updateClassRung(client, CLS, 'SHADOW', 'OWNER_APPROVED_LIVE', NOW);
    const b = await updateClassRung(client, CLS, 'SHADOW', 'OWNER_APPROVED_LIVE', NOW);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, error: 'rung_changed_elsewhere' });
    expect(rowsOf(AUTONOMY_CLASSES_TABLE)[0].rung).toBe('OWNER_APPROVED_LIVE');
  });
  it('demotion may skip rungs down; promotion may not skip up', async () => {
    const { client, rowsOf } = fakeClient();
    rowsOf(AUTONOMY_CLASSES_TABLE).push({ ...seedClass, rung: 'L1_AUTO' });
    const OAL = 'OWNER_APPROVED_LIVE';
    expect((await updateClassRung(client, CLS, 'L1_AUTO', OAL, NOW)).ok).toBe(true);
    expect((await updateClassRung(client, CLS, OAL, 'L1_AUTO', NOW)).error)
      .toBe('promotion_not_one_rung');
    expect((await updateClassRung(client, CLS, OAL, OAL, NOW)).error).toBe('rung_unchanged');
    expect((await updateClassRung(client, CLS, OAL, 'GOD' as never, NOW)).error)
      .toBe('invalid_rung');
  });
  it('a missing class is a lost CAS', async () => {
    const { client } = fakeClient();
    const r = await updateClassRung(client, 'ghost', 'CODED', 'TESTED', NOW);
    expect(r).toEqual({ ok: false, error: 'rung_changed_elsewhere' });
  });
});

describe('acknowledgeAnomaly / revokeGrant', () => {
  it('acknowledges once; a repeat is an idempotent duplicate', async () => {
    const { client, rowsOf } = fakeClient();
    await insertAnomaly(client, { id: 'a-1', class_id: 'c', severity: 'critical',
      kind: 'kill_switch', evidence: { trip: 1 }, demoted_to: 'SHADOW' }, NOW);
    expect(await acknowledgeAnomaly(client, 'a-1', 'owner', NOW)).toEqual({ ok: true, id: 'a-1' });
    expect(rowsOf(AUTONOMY_ANOMALIES_TABLE)[0])
      .toMatchObject({ acknowledged_by: 'owner', acknowledged_at: NOW });
    expect(await acknowledgeAnomaly(client, 'a-1', 'someone-else', NOW))
      .toEqual({ ok: true, duplicate: true, id: 'a-1' });
    expect(rowsOf(AUTONOMY_ANOMALIES_TABLE)[0].acknowledged_by).toBe('owner');
    expect((await acknowledgeAnomaly(client, 'nope', 'owner', NOW)).error)
      .toBe('anomaly_not_found');
    expect((await acknowledgeAnomaly(client, 'a-1', '', NOW)).error).toBe('missing_actor');
  });
  it('revokes a grant once with a reason', async () => {
    const { client, rowsOf } = fakeClient();
    await insertGrant(client, { id: 'g-1', class_id: 'c', from_rung: 'CODED', to_rung: 'TESTED',
      granted_by: 'owner', evidence: { ok: true } }, NOW);
    expect(await revokeGrant(client, 'g-1', 'owner changed mind', NOW))
      .toEqual({ ok: true, id: 'g-1' });
    expect(rowsOf(AUTONOMY_GRANTS_TABLE)[0])
      .toMatchObject({ revoked_at: NOW, revoked_reason: 'owner changed mind' });
    expect(await revokeGrant(client, 'g-1', 'again', NOW))
      .toEqual({ ok: true, duplicate: true, id: 'g-1' });
    expect((await revokeGrant(client, 'g-1', ' ', NOW)).error).toBe('missing_reason');
    expect((await revokeGrant(client, 'g-9', 'x', NOW)).error).toBe('grant_not_found');
  });
});

describe('no delete path exists', () => {
  it('the store module exports no delete/remove/purge adapter', async () => {
    const mod = await import('../src/lib/business/autonomy/store');
    for (const name of Object.keys(mod)) {
      expect(name).not.toMatch(/dele|remove|purge|drop/i);
    }
  });
});
