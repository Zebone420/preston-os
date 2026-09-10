import { describe, expect, it } from 'vitest';
import {
  approveMeasurement,
  buildChangeOrder,
  canScheduleFinalMeasure,
  compareMeasurements,
  earliestFinalMeasureDate,
  estimateDimensionsCannotFeedPo,
  measurementSha256,
  newMeasurementVersion,
  submitMeasurement,
  supersedeMeasurement,
  type FinalMeasurement,
} from '../src/lib/business/order-chain/final-measure';
import {
  AGENT,
  approvedMeasurement,
  CONTRACT_ID,
  OPENINGS,
  OWNER,
  PROJECT_ID,
  RUNTIME,
  SIGNED_AT,
} from './order-chain-fixtures';

function draft(over: Record<string, unknown> = {}): FinalMeasurement {
  const r = newMeasurementVersion({
    project_id: PROJECT_ID,
    contract_id: CONTRACT_ID,
    measured_at: '2026-09-10T15:00:00.000Z',
    measured_by: 'field-tech-1',
    signed_at: SIGNED_AT,
    openings: OPENINGS,
    ...over,
  });
  if (!r.ok) throw new Error(`draft failed: ${r.reason}`);
  return { ...r.measurement, id: '44444444-4444-4444-8444-444444444444' };
}

describe('final measure - 3 business day rule (weekends only)', () => {
  // 2026-09-04 is a Friday.
  it('Friday signing -> earliest Wednesday, same time of day', () => {
    expect(earliestFinalMeasureDate('2026-09-04T10:00:00.000Z'))
      .toBe('2026-09-09T10:00:00.000Z');
  });
  it('Saturday signing -> Mon, Tue, Wed -> Wednesday', () => {
    expect(earliestFinalMeasureDate('2026-09-05T10:00:00.000Z'))
      .toBe('2026-09-09T10:00:00.000Z');
  });
  it('Monday signing -> Thursday (no weekend crossed)', () => {
    expect(earliestFinalMeasureDate('2026-09-07T10:00:00.000Z'))
      .toBe('2026-09-10T10:00:00.000Z');
  });
  it('Wednesday signing crosses the weekend -> Monday', () => {
    expect(earliestFinalMeasureDate('2026-09-09T10:00:00.000Z'))
      .toBe('2026-09-14T10:00:00.000Z');
  });
  it('blocks a proposed date before the earliest, allows on or after', () => {
    const signed = '2026-09-04T10:00:00.000Z';
    expect(canScheduleFinalMeasure('2026-09-08T10:00:00.000Z', signed)).toEqual({
      ok: false,
      reason: 'too_early',
      earliest: '2026-09-09T10:00:00.000Z',
    });
    expect(canScheduleFinalMeasure('2026-09-09T09:59:59.000Z', signed).ok).toBe(false);
    expect(canScheduleFinalMeasure('2026-09-09T10:00:00.000Z', signed).ok).toBe(true);
    expect(canScheduleFinalMeasure('2026-10-01T10:00:00.000Z', signed).ok).toBe(true);
  });
  it('fails closed on unparseable timestamps', () => {
    expect(earliestFinalMeasureDate('not-a-date')).toBeNull();
    expect(canScheduleFinalMeasure('2026-09-09T10:00:00.000Z', 'nope').ok).toBe(false);
    expect(canScheduleFinalMeasure('nope', '2026-09-04T10:00:00.000Z').ok).toBe(false);
  });
});

describe('final measure - versioning and approval', () => {
  it('creates version 1 as a draft with a canonical sha256', () => {
    const m = draft();
    expect(m.version).toBe(1);
    expect(m.status).toBe('draft');
    expect(m.source).toBe('final_measure');
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.openings.map((o) => o.opening_id)).toEqual(['W1', 'W2']);
    // Order-independent hash: reversed input gives the same digest.
    const reversed = draft({ openings: [...OPENINGS].reverse() });
    expect(reversed.sha256).toBe(m.sha256);
    // Notes do not change the digest; sizes do.
    const noted = draft({ openings: OPENINGS.map((o) => ({ ...o, notes: 'x' })) });
    expect(noted.sha256).toBe(m.sha256);
    const resized = draft({
      openings: [OPENINGS[0], { ...OPENINGS[1], width_in: 36.0625 }],
    });
    expect(resized.sha256).not.toBe(m.sha256);
  });

  it('next version increments and links supersedes_id', () => {
    const v1 = draft();
    const v2 = draft({ previous: v1 });
    expect(v2.version).toBe(2);
    expect(v2.supersedes_id).toBe(v1.id);
    const bad = newMeasurementVersion({
      project_id: '55555555-5555-4555-8555-555555555555',
      contract_id: CONTRACT_ID,
      measured_at: '2026-09-10T15:00:00.000Z',
      measured_by: 't',
      signed_at: SIGNED_AT,
      openings: OPENINGS,
      previous: v1,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('previous_binding_mismatch');
  });

  it('validates openings strictly (ids, 1/16 inch sizes, unit types)', () => {
    const cases: unknown[] = [
      [],
      [{ opening_id: 'W1', width_in: 0, height_in: 60, unit_type: 'DH' }],
      [{ opening_id: 'W1', width_in: 35.51, height_in: 60, unit_type: 'DH' }],
      [{ opening_id: 'W1', width_in: 35.5, height_in: 60, unit_type: '' }],
      [
        { opening_id: 'W1', width_in: 35.5, height_in: 60, unit_type: 'DH' },
        { opening_id: 'W1', width_in: 35.5, height_in: 60, unit_type: 'DH' },
      ],
    ];
    for (const openings of cases) {
      const r = newMeasurementVersion({
        project_id: PROJECT_ID,
        contract_id: CONTRACT_ID,
        measured_at: '2026-09-10T15:00:00.000Z',
        measured_by: 't',
        signed_at: SIGNED_AT,
        openings,
      });
      expect(r.ok).toBe(false);
    }
  });

  it('approval requires submitted status and a HUMAN actor', () => {
    const d = draft();
    expect(approveMeasurement(d, OWNER, '2026-09-11T09:00:00.000Z', SIGNED_AT).ok)
      .toBe(false);
    const s = submitMeasurement(d);
    expect(s.ok && s.measurement.status).toBe('submitted');
    if (!s.ok) return;
    for (const actor of [RUNTIME, AGENT, { kind: 'human', id: ' ' } as const]) {
      const r = approveMeasurement(
        s.measurement, actor, '2026-09-11T09:00:00.000Z', SIGNED_AT);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('human_actor_required');
    }
    const ok = approveMeasurement(
      s.measurement, OWNER, '2026-09-11T09:00:00.000Z', SIGNED_AT);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.measurement.status).toBe('approved');
    expect(ok.measurement.approved_by).toBe('owner-1');
    expect(ok.measurement.approved_at).toBe('2026-09-11T09:00:00.000Z');
  });

  it('a tampered measurement (sha drift) cannot be submitted or approved', () => {
    const d = draft();
    const tampered = {
      ...d,
      openings: [{ ...d.openings[0], width_in: 40 }, d.openings[1]],
    };
    expect(submitMeasurement(tampered).ok).toBe(false);
    expect(
      approveMeasurement({ ...tampered, status: 'submitted' }, OWNER,
        '2026-09-11T09:00:00.000Z', SIGNED_AT).ok,
    ).toBe(false);
    expect(measurementSha256(tampered)).not.toBe(d.sha256);
    const retimed = { ...d, measured_at: '2026-09-20T15:00:00.000Z' };
    // Keep the legacy digest stable for existing persisted measurements.
    // Persistence approval separately CAS-binds measured_at/measured_by.
    expect(measurementSha256(retimed)).toBe(d.sha256);
  });

  it('an estimate can be stored and submitted but never approved', () => {
    const est = draft({ source: 'estimate' });
    const s = submitMeasurement(est);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const r = approveMeasurement(
      s.measurement, OWNER, '2026-09-11T09:00:00.000Z', SIGNED_AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('estimate_source_refused');
  });

  it('refuses creation and approval before the three-business-day boundary', () => {
    const early = newMeasurementVersion({
      project_id: PROJECT_ID, contract_id: CONTRACT_ID,
      measured_at: '2026-09-08T10:00:00.000Z', measured_by: 'field-tech-1',
      signed_at: SIGNED_AT, openings: OPENINGS,
    });
    expect(early).toMatchObject({ ok: false, reason: 'measurement_timing_too_early' });

    const submitted = submitMeasurement(draft());
    if (!submitted.ok) throw new Error('fixture');
    const wrongSigning = approveMeasurement(
      submitted.measurement, OWNER, '2026-09-11T09:00:00.000Z',
      '2026-09-09T10:00:00.000Z');
    expect(wrongSigning).toMatchObject({
      ok: false, reason: 'measurement_timing_too_early',
    });
  });

  it('supersede is one-way', () => {
    const s = supersedeMeasurement(approvedMeasurement());
    expect(s.ok && s.measurement.status).toBe('superseded');
    if (s.ok) expect(supersedeMeasurement(s.measurement).ok).toBe(false);
  });
});

describe('final measure - estimate/intake dimensions cannot feed a PO', () => {
  it('accepts only an approved final_measure measurement', () => {
    expect(estimateDimensionsCannotFeedPo(approvedMeasurement())).toEqual({ ok: true });
  });
  it.each([
    ['missing', null, 'measurement_missing'],
    ['draft', draft(), 'measurement_not_approved'],
    ['submitted', { ...draft(), status: 'submitted' }, 'measurement_not_approved'],
    ['superseded', { ...approvedMeasurement(), status: 'superseded' },
      'measurement_not_approved'],
    ['estimate source', { ...approvedMeasurement(), source: 'estimate' },
      'estimate_source_refused'],
    ['intake source', { ...approvedMeasurement(), source: 'intake' },
      'estimate_source_refused'],
    ['approved without approver', { ...approvedMeasurement(), approved_by: null },
      'approval_incomplete'],
    ['approved with sha drift', { ...approvedMeasurement(), sha256: 'a'.repeat(64) },
      'sha256_mismatch'],
  ])('%s => refused', (_label, m, reason) => {
    const r = estimateDimensionsCannotFeedPo(m as FinalMeasurement | null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });
});

describe('final measure - comparison and change orders', () => {
  it('identical measurements need no change order', () => {
    const d = compareMeasurements(draft(), draft());
    expect(d.change_order_required).toBe(false);
    expect(d.reasons).toEqual([]);
    expect(buildChangeOrder(draft(), draft())).toBeNull();
  });

  it('a 1/16 inch size difference is a size_change requiring a change order', () => {
    const v1 = draft();
    const v2 = draft({
      previous: v1,
      openings: [OPENINGS[0], { ...OPENINGS[1], height_in: 60.3125 }],
    });
    const d = compareMeasurements(v1, v2);
    expect(d.change_order_required).toBe(true);
    expect(d.reasons).toEqual(['size_change']);
    expect(d.size_changes).toEqual([
      { opening_id: 'W2', field: 'height_in', from: 60.25, to: 60.3125 },
    ]);
    const co = buildChangeOrder(v1, v2);
    expect(co).not.toBeNull();
    expect(co?.reason).toBe('size_change');
    expect(co?.state).toBe('proposed');
    expect(co?.from_measurement_id).toBe(v1.id);
    expect(co?.project_id).toBe(PROJECT_ID);
  });

  it('unit type change is a configuration_change; added opening is scope_change', () => {
    const v1 = draft();
    const v2 = draft({
      previous: v1,
      openings: [
        { ...OPENINGS[0], unit_type: 'CA' },
        OPENINGS[1],
        { opening_id: 'W3', width_in: 24, height_in: 36, unit_type: 'AW' },
      ],
    });
    const d = compareMeasurements(v1, v2);
    expect(d.reasons).toEqual(['configuration_change', 'scope_change']);
    expect(d.added_openings).toEqual(['W3']);
    expect(buildChangeOrder(v1, v2)?.reason).toBe('scope_change');
  });

  it('notes never trigger a change order', () => {
    const v1 = draft();
    const v2 = draft({ openings: OPENINGS.map((o) => ({ ...o, notes: 'recheck' })) });
    expect(compareMeasurements(v1, v2).change_order_required).toBe(false);
  });
});
