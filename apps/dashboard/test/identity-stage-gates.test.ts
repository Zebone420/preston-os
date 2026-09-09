// Phase 1 Lane A - project stage/gate model pins. Calendar facts used
// below: 2026-09-03 Thu, 2026-09-04 Fri, 2026-09-07 Mon, 2026-09-08 Tue,
// 2026-09-09 Wed.

import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  businessDaysBetween,
  canAdvance,
  earliestFinalMeasureDate,
  evaluateGate,
  isBusinessDay,
  nextStage,
  PROJECT_STAGES,
  STAGE_GATES,
  type ProjectFacts,
  type ProjectStage,
} from '../src/lib/business/identity/stage-gates';

function fullFacts(): ProjectFacts {
  return {
    now: '2026-09-30T12:00:00Z',
    lead_created: true,
    qualified: true,
    site_visit_scheduled_at: '2026-08-10T14:00:00Z',
    measured_at: '2026-08-10T15:00:00Z',
    quote_approved: true,
    proposal_sent_at: '2026-08-12T09:00:00Z',
    proposal_accepted_at: '2026-08-20T09:00:00Z',
    contract: {
      provider_verified: true,
      signed_at: '2026-09-04T16:00:00Z', // Friday
      document_hash: 'sha256:contract',
    },
    deposit: { received: true, amount_cents: 500000, required_cents: 500000 },
    final_measure: {
      recorded_at: '2026-09-09T10:00:00Z', // Wednesday = +3 business days
      approved: true,
      hash: 'sha256:measure-v2',
    },
    building_approval: 'approved',
    lpc: 'not_required',
    dob: 'approved',
    po: { hash: 'sha256:po', bound_measure_hash: 'sha256:measure-v2' },
    order: { placed: true, order_number: 'W123456', received: true },
    install: {
      scheduled_at: '2026-09-25T08:00:00Z',
      completed_at: '2026-09-26T17:00:00Z',
      punch_open_count: 0,
    },
    final_payment_received: true,
    closeout_docs_complete: true,
  };
}

const failing = (stage: ProjectStage, mutate: (f: ProjectFacts) => void) => {
  const f = fullFacts();
  mutate(f);
  return evaluateGate(stage, f);
};

describe('business-day math (weekends only; holidays out of scope)', () => {
  it('knows weekdays from weekends', () => {
    expect(isBusinessDay('2026-09-04')).toBe(true); // Fri
    expect(isBusinessDay('2026-09-05')).toBe(false); // Sat
    expect(isBusinessDay('2026-09-06')).toBe(false); // Sun
    expect(isBusinessDay('2026-09-07')).toBe(true); // Mon
  });

  it('adds business days across a weekend', () => {
    expect(addBusinessDays('2026-09-04', 1)).toBe('2026-09-07');
    expect(addBusinessDays('2026-09-04', 3)).toBe('2026-09-09');
    expect(addBusinessDays('2026-09-03', 3)).toBe('2026-09-08');
    expect(addBusinessDays('2026-09-05', 1)).toBe('2026-09-07'); // from Sat
    expect(addBusinessDays('2026-09-07', 0)).toBe('2026-09-07');
    expect(() => addBusinessDays('2026-09-07', -1)).toThrow(RangeError);
  });

  it('counts business days between dates', () => {
    expect(businessDaysBetween('2026-09-04', '2026-09-09')).toBe(3);
    expect(businessDaysBetween('2026-09-04', '2026-09-07')).toBe(1);
    expect(businessDaysBetween('2026-09-04', '2026-09-04')).toBe(0);
    expect(businessDaysBetween('2026-09-09', '2026-09-04')).toBe(0);
  });

  it('computes the earliest final-measure date from the signing date', () => {
    expect(earliestFinalMeasureDate('2026-09-04T23:59:00Z')).toBe('2026-09-09');
    expect(earliestFinalMeasureDate('2026-09-03T00:00:00Z')).toBe('2026-09-08');
    expect(earliestFinalMeasureDate('not a date')).toBeNull();
  });
});

describe('stage order', () => {
  it('has the 18 stages in order with lead first and closed last', () => {
    expect(PROJECT_STAGES).toHaveLength(18);
    expect(PROJECT_STAGES[0]).toBe('lead');
    expect(PROJECT_STAGES.at(-1)).toBe('closed');
    expect(nextStage('contract_signed')).toBe('deposit_received');
    expect(nextStage('closed')).toBeNull();
    for (const s of PROJECT_STAGES) expect(STAGE_GATES[s]).toBeDefined();
  });

  it('every gate passes on the complete fact set', () => {
    for (const s of PROJECT_STAGES) {
      expect(evaluateGate(s, fullFacts())).toEqual({
        ok: true, stage: s, failed_predicates: [],
      });
    }
  });

  it('refuses unknown stages', () => {
    const v = evaluateGate('shipped' as ProjectStage, fullFacts());
    expect(v.ok).toBe(false);
    expect(v.failed_predicates).toEqual(['unknown_stage']);
  });
});

describe('blocking predicates per gate', () => {
  it('early sales gates', () => {
    expect(failing('qualified', (f) => { f.qualified = false; }).failed_predicates)
      .toEqual(['qualified']);
    expect(failing('visit_scheduled', (f) => { f.site_visit_scheduled_at = null; })
      .failed_predicates).toEqual(['site_visit_scheduled']);
    expect(failing('measured', (f) => { f.measured_at = ''; }).failed_predicates)
      .toEqual(['measured']);
    expect(failing('quoted', (f) => { f.quote_approved = false; })
      .failed_predicates).toEqual(['quote_approved']);
    expect(failing('proposal_sent', (f) => { f.proposal_sent_at = null; })
      .failed_predicates).toEqual(['proposal_sent']);
    expect(failing('accepted', (f) => { f.proposal_accepted_at = null; })
      .failed_predicates).toEqual(['proposal_accepted']);
  });

  it('contract_signed requires a PROVIDER-verified signature + hash', () => {
    expect(failing('contract_signed', (f) => {
      f.contract.provider_verified = false;
    }).failed_predicates).toEqual(['contract_provider_verified']);
    expect(failing('contract_signed', (f) => { f.contract.signed_at = null; })
      .failed_predicates).toEqual(['contract_signed_at']);
    expect(failing('contract_signed', (f) => { f.contract.document_hash = ''; })
      .failed_predicates).toEqual(['contract_document_hash']);
  });

  it('deposit_received binds amount to the required deposit', () => {
    expect(failing('deposit_received', (f) => { f.deposit.received = false; })
      .failed_predicates).toEqual(['deposit_received']);
    expect(failing('deposit_received', (f) => { f.deposit.amount_cents = 499999; })
      .failed_predicates).toEqual(['deposit_amount_covers_required']);
    expect(failing('deposit_received', (f) => { f.deposit.required_cents = 0; })
      .failed_predicates).toEqual(['deposit_required_known']);
  });

  it('final_measured enforces the 3-business-day rule around a weekend', () => {
    // Signed Friday 09-04: Mon 09-07 (1), Tue 09-08 (2), Wed 09-09 (3).
    for (const tooEarly of ['2026-09-04T18:00:00Z', '2026-09-05T10:00:00Z',
      '2026-09-07T10:00:00Z', '2026-09-08T23:59:00Z']) {
      const v = failing('final_measured', (f) => {
        f.final_measure.recorded_at = tooEarly;
      });
      expect(v.ok).toBe(false);
      expect(v.failed_predicates).toEqual(['final_measure_after_3_business_days']);
    }
    for (const okDate of ['2026-09-09T00:00:00Z', '2026-09-10T09:00:00Z']) {
      expect(failing('final_measured', (f) => {
        f.final_measure.recorded_at = okDate;
      }).ok).toBe(true);
    }
    // Signed Thursday 09-03: earliest is Tuesday 09-08.
    expect(failing('final_measured', (f) => {
      f.contract.signed_at = '2026-09-03T09:00:00Z';
      f.final_measure.recorded_at = '2026-09-07T09:00:00Z';
    }).failed_predicates).toEqual(['final_measure_after_3_business_days']);
    expect(failing('final_measured', (f) => {
      f.contract.signed_at = '2026-09-03T09:00:00Z';
      f.final_measure.recorded_at = '2026-09-08T09:00:00Z';
    }).ok).toBe(true);
    expect(failing('final_measured', (f) => { f.final_measure.recorded_at = null; })
      .failed_predicates).toEqual([
      'final_measure_recorded', 'final_measure_after_3_business_days',
    ]);
    // No signature -> the rule cannot even be evaluated -> blocked.
    const unsigned = failing('final_measured', (f) => {
      f.contract.signed_at = null;
    });
    expect(unsigned.failed_predicates).toContain('contract_signed_at');
    expect(unsigned.failed_predicates)
      .toContain('final_measure_after_3_business_days');
  });

  it('order_ready blocks on every compliance and binding predicate', () => {
    const cases: Array<[string, (f: ProjectFacts) => void]> = [
      ['contract_provider_verified', (f) => { f.contract.provider_verified = false; }],
      ['payment_condition', (f) => { f.deposit.received = false; }],
      ['payment_condition', (f) => { f.deposit.amount_cents = 1; }],
      ['final_measure_approved', (f) => { f.final_measure.approved = false; }],
      ['building_condition', (f) => { f.building_approval = 'pending'; }],
      ['lpc_condition', (f) => { f.lpc = 'pending'; }],
      ['dob_condition', (f) => { f.dob = 'pending'; }],
      ['po_hash_bound_to_final_measure', (f) => { f.po.hash = null; }],
      ['po_hash_bound_to_final_measure', (f) => {
        f.po.bound_measure_hash = 'sha256:measure-v1'; // stale estimate sizes
      }],
    ];
    for (const [name, mutate] of cases) {
      const v = failing('order_ready', mutate);
      expect(v.ok).toBe(false);
      expect(v.failed_predicates).toContain(name);
    }
    // Changing the final measure hash without re-binding the PO blocks.
    const v = failing('order_ready', (f) => { f.final_measure.hash = 'sha256:v3'; });
    expect(v.failed_predicates).toEqual(['po_hash_bound_to_final_measure']);
    // Missing final measure blocks order_ready AND ordered (no PO before
    // final measure).
    const noMeasure = failing('ordered', (f) => {
      f.final_measure = { recorded_at: null, approved: false, hash: null };
    });
    expect(noMeasure.ok).toBe(false);
    expect(noMeasure.failed_predicates).toContain('final_measure_recorded');
    expect(noMeasure.failed_predicates).toContain('po_hash_bound_to_final_measure');
  });

  it('ordered / received / install / closeout gates', () => {
    expect(failing('ordered', (f) => { f.order.placed = false; })
      .failed_predicates).toEqual(['order_placed']);
    expect(failing('ordered', (f) => { f.order.order_number = null; })
      .failed_predicates).toEqual(['order_number']);
    expect(failing('received', (f) => { f.order.received = false; })
      .failed_predicates).toEqual(['order_received']);
    expect(failing('install_scheduled', (f) => { f.install.scheduled_at = null; })
      .failed_predicates).toEqual(['install_scheduled']);
    expect(failing('installed', (f) => { f.install.completed_at = null; })
      .failed_predicates).toEqual(['install_completed']);
    expect(failing('punch', (f) => { f.install.completed_at = null; })
      .failed_predicates).toEqual(['install_completed']);
    expect(failing('closed_out', (f) => { f.install.punch_open_count = 2; })
      .failed_predicates).toEqual(['punch_resolved']);
    expect(failing('closed_out', (f) => { f.final_payment_received = false; })
      .failed_predicates).toEqual(['final_payment_received']);
    expect(failing('closed', (f) => { f.closeout_docs_complete = false; })
      .failed_predicates).toEqual(['closeout_docs_complete']);
  });

  it('reports every failed predicate, not just the first', () => {
    const v = failing('order_ready', (f) => {
      f.lpc = 'pending';
      f.dob = 'pending';
      f.deposit.received = false;
    });
    expect(v.failed_predicates).toEqual([
      'payment_condition', 'lpc_condition', 'dob_condition',
    ]);
  });
});

describe('canAdvance', () => {
  it('allows only the immediate next stage when its gate passes', () => {
    expect(canAdvance('contract_signed', 'deposit_received', fullFacts()).ok)
      .toBe(true);
    const skip = canAdvance('contract_signed', 'order_ready', fullFacts());
    expect(skip.ok).toBe(false);
    expect(skip.failed_predicates).toEqual(['not_the_next_stage']);
    const back = canAdvance('ordered', 'order_ready', fullFacts());
    expect(back.ok).toBe(false);
    const f = fullFacts();
    f.lpc = 'pending';
    const blocked = canAdvance('final_measured', 'order_ready', f);
    expect(blocked.ok).toBe(false);
    expect(blocked.failed_predicates).toEqual(['lpc_condition']);
    expect(blocked.from).toBe('final_measured');
    expect(blocked.to).toBe('order_ready');
  });
});
