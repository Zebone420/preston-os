import { describe, expect, it } from 'vitest';
import {
  evaluateInstallReadiness,
  READINESS_PREDICATES,
  type InstallReadinessFacts,
} from '../src/lib/business/lifecycle/install-readiness';
import {
  initialReceivingState,
  type ReceivingState,
} from '../src/lib/business/lifecycle/receiving';

const P = '00000000-0000-4000-8000-0000000000aa';

function receivedState(): ReceivingState {
  return {
    ...initialReceivingState(P),
    phase: 'received',
    applied_event_ids: ['e1', 'e2', 'e3'],
    last_event_at: '2026-09-01T10:00:00.000Z',
  };
}

function goodFacts(): InstallReadinessFacts {
  return {
    project_id: P,
    evaluated_at: '2026-09-02T10:00:00.000Z',
    receiving: receivedState(),
    site_access_confirmed: true,
    crew_assignment_state: 'confirmed',
    documents: [
      { id: 'd1', document_type: 'lpc_dob_building', is_current: true },
    ],
    building_approval_required: true,
    approved_measurement_version: 2,
    installing_measurement_version: 2,
    pre_install_payment_received: true,
    client_contact: { name: 'Test Homeowner', phone: '000-000-0000' },
  };
}

describe('evaluateInstallReadiness', () => {
  it('all predicates true => all_ok and empty blocked_by', () => {
    const r = evaluateInstallReadiness(goodFacts());
    expect(r.all_ok).toBe(true);
    expect(r.blocked_by).toEqual([]);
    for (const p of READINESS_PREDICATES) expect(r.predicates[p]).toBe(true);
    expect(r.project_id).toBe(P);
  });

  const cases: Array<[string, (f: InstallReadinessFacts) => void]> = [
    ['all_units_received', (f) => {
      f.receiving = { ...f.receiving, open_exceptions: [{
        kind: 'damage', opened_by_event_id: 'd1', stage: 'reported',
        opened_at: '2026-09-01T11:00:00.000Z',
      }] };
    }],
    ['site_access_confirmed', (f) => { f.site_access_confirmed = false; }],
    ['crew_confirmed', (f) => { f.crew_assignment_state = 'proposed'; }],
    ['building_approval_on_file', (f) => {
      f.documents = [{ id: 'd1', document_type: 'lpc_dob_building',
        is_current: false }];
    }],
    ['final_measure_bound', (f) => { f.installing_measurement_version = 1; }],
    ['payment_condition_for_install', (f) => {
      f.pre_install_payment_received = false;
    }],
    ['client_contact_present_for_scheduling', (f) => {
      f.client_contact = { name: 'Test Homeowner', phone: ' ' };
    }],
  ];

  for (const [predicate, breakIt] of cases) {
    it(`${predicate} false blocks on its own`, () => {
      const f = goodFacts();
      breakIt(f);
      const r = evaluateInstallReadiness(f);
      expect(r.all_ok).toBe(false);
      expect(r.blocked_by).toEqual([predicate]);
      expect(r.predicates[predicate as keyof typeof r.predicates]).toBe(false);
    });
  }

  it('all_units_received is false when units are only delivered', () => {
    const f = goodFacts();
    f.receiving = { ...f.receiving, phase: 'delivered' };
    expect(evaluateInstallReadiness(f).blocked_by).toEqual(['all_units_received']);
  });

  it('building approval may be marked not required for the property', () => {
    const f = goodFacts();
    f.documents = [];
    f.building_approval_required = false;
    expect(evaluateInstallReadiness(f).all_ok).toBe(true);
  });

  it('final measure requires an approved version and exact match', () => {
    const f = goodFacts();
    f.approved_measurement_version = null;
    f.installing_measurement_version = null;
    expect(evaluateInstallReadiness(f).blocked_by).toEqual(['final_measure_bound']);
  });

  it('crew in_progress still counts as confirmed', () => {
    const f = goodFacts();
    f.crew_assignment_state = 'in_progress';
    expect(evaluateInstallReadiness(f).all_ok).toBe(true);
  });

  it('multiple failures list every blocker in predicate order', () => {
    const f = goodFacts();
    f.client_contact = null;
    f.site_access_confirmed = false;
    expect(evaluateInstallReadiness(f).blocked_by).toEqual([
      'site_access_confirmed',
      'client_contact_present_for_scheduling',
    ]);
  });
});
