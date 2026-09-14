import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  andersenRegistrationForm,
  archivePlan,
  ARCHIVE_REQUIRED_DOCUMENT_TYPES,
  bdfClaimWindow,
  buildCloseoutPackage,
  closeoutDocsPresent,
  completionCertificateDescriptor,
  expectedWarrantyExpiry,
  finalPaymentEligible,
  obligationsDue,
  overdueObligations,
  recordBdfClaim,
  warrantyRegistrationDeadline,
  type FinalPaymentFacts,
} from '../src/lib/business/lifecycle/closeout';
import type { DocumentRef } from '../src/lib/business/lifecycle/types';

const P = '00000000-0000-4000-8000-0000000000aa';

const CERT: DocumentRef = {
  id: 'cert1', document_type: 'closeout',
  document_subtype: 'completion_certificate', is_current: true,
};
const PHOTO: DocumentRef = {
  id: 'ph1', document_type: 'installation_photo', is_current: true,
};

describe('final payment eligibility (flag only)', () => {
  const good: FinalPaymentFacts = {
    install_state: 'punch_closed',
    closeout_docs_present: true,
    open_change_order_count: 0,
    client_signoff_event_present: true,
  };

  it('all inputs present => eligible', () => {
    expect(finalPaymentEligible(good)).toEqual({ eligible: true, missing: [] });
    expect(finalPaymentEligible({ ...good, install_state: 'archived' }).eligible)
      .toBe(true);
  });

  const breaks: Array<[string, Partial<FinalPaymentFacts>, string[]]> = [
    ['not installed', { install_state: 'in_progress' },
      ['installed', 'punch_closed']],
    ['punch still open', { install_state: 'punch_open' }, ['punch_closed']],
    ['closeout docs missing', { closeout_docs_present: false },
      ['closeout_docs_present']],
    ['open change order', { open_change_order_count: 1 },
      ['no_open_change_order']],
    ['change order count not an int', { open_change_order_count: NaN },
      ['no_open_change_order']],
    ['no client sign-off', { client_signoff_event_present: false },
      ['client_signoff_event_present']],
  ];
  for (const [name, patch, missing] of breaks) {
    it(`${name} => not eligible`, () => {
      const r = finalPaymentEligible({ ...good, ...patch });
      expect(r.eligible).toBe(false);
      expect(r.missing).toEqual(missing);
    });
  }

  it('STATIC PIN: the lifecycle directory has no money-movement or ' +
    'outbound identifiers and no network reach', () => {
    const dir = join(__dirname, '..', 'src', 'lib', 'business', 'lifecycle');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const banned = new RegExp(
      '\\b\\w*(' + ['char' + 'ge', 'ref' + 'und', 'pay' + 'out',
        'se' + 'nd', 'stri' + 'pe', 'fet' + 'ch'].join('|') + ')\\w*\\b', 'i');
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8')
        .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
      expect(code, f).not.toMatch(banned);
      expect(code, f).not.toMatch(/https?:\/\//);
      expect(code, f).not.toMatch(/from ['"]\.\.\/(documents|order-chain|identity)/);
    }
  });
});

describe('Andersen warranty registration deadline (+90 days)', () => {
  it('adds 90 calendar days', () => {
    expect(warrantyRegistrationDeadline('2026-09-05')).toBe('2026-12-04');
    expect(warrantyRegistrationDeadline('2026-01-31')).toBe('2026-05-01');
  });
  it('crosses a year boundary and a leap day correctly', () => {
    expect(warrantyRegistrationDeadline('2026-11-15')).toBe('2027-02-13');
    expect(warrantyRegistrationDeadline('2027-12-15')).toBe('2028-03-14');
  });
  it('rejects non-dates', () => {
    expect(() => warrantyRegistrationDeadline('2026-02-30')).toThrow();
    expect(() => warrantyRegistrationDeadline('yesterday')).toThrow();
  });
  it('expected 2-year warranty expiry', () => {
    expect(expectedWarrantyExpiry('2026-09-05')).toBe('2028-09-05');
    expect(expectedWarrantyExpiry('2028-02-29')).toBe('2030-02-28');
  });
});

describe('BDF claim window (+3 months, same calendar year)', () => {
  it('plain +3 months inside the year', () => {
    expect(bdfClaimWindow('2026-03-10')).toEqual({
      opens: '2026-03-10', closes: '2026-06-10', clipped_to_calendar_year: false,
    });
  });
  it('clamps the day when the target month is shorter', () => {
    expect(addMonthsClamped('2026-08-31', 3)).toBe('2026-11-30');
    expect(bdfClaimWindow('2026-08-31').closes).toBe('2026-11-30');
  });
  it('clips to Dec 31 when +3 months would cross into the next year', () => {
    expect(bdfClaimWindow('2026-11-20')).toEqual({
      opens: '2026-11-20', closes: '2026-12-31', clipped_to_calendar_year: true,
    });
    expect(bdfClaimWindow('2026-10-01').closes).toBe('2026-12-31');
    expect(bdfClaimWindow('2026-09-30').closes).toBe('2026-12-30');
  });
  it('rejects non-dates', () => {
    expect(() => bdfClaimWindow('2026-13-01')).toThrow();
  });
});

describe('closeout package + obligations', () => {
  const project = { id: P, install_completed_on: '2026-09-05' };

  it('builds the descriptor from registry refs', () => {
    const pkg = buildCloseoutPackage(project, [CERT, PHOTO,
      { ...PHOTO, id: 'ph0', is_current: false },
      { ...CERT, id: 'cert-old', is_current: false }]);
    expect(pkg.completion_certificate_document_id).toBe('cert1');
    expect(pkg.final_photos_document_ids).toEqual(['ph1']);
    expect(pkg.warranty_registration.andersen_registration_deadline)
      .toBe('2026-12-04');
    expect(pkg.final_payment_eligible).toBe(false);
    expect(pkg.state).toBe('open');
    expect(closeoutDocsPresent(pkg)).toBe(true);
    expect(closeoutDocsPresent(buildCloseoutPackage(project, [PHOTO]))).toBe(false);
    expect(closeoutDocsPresent(buildCloseoutPackage(project, [CERT]))).toBe(false);
  });

  it('no install date => no deadline and registration not applicable', () => {
    const pkg = buildCloseoutPackage({ id: P, install_completed_on: null }, []);
    expect(pkg.warranty_registration.andersen_registration_deadline).toBeNull();
    const ob = obligationsDue('2026-09-08', pkg);
    expect(ob.map((o) => [o.kind, o.status])).toEqual([
      ['andersen_install_registration', 'not_applicable'],
    ]);
  });

  it('registration pending, then overdue after the deadline, then done', () => {
    const pkg = buildCloseoutPackage(project, [CERT, PHOTO]);
    expect(obligationsDue('2026-12-04', pkg)[0].status).toBe('pending');
    expect(obligationsDue('2026-12-05', pkg)[0].status).toBe('overdue');
    expect(overdueObligations('2026-12-05', pkg).map((o) => o.kind))
      .toEqual(['andersen_install_registration']);
    // survey is not applicable until Andersen registration happened
    expect(obligationsDue('2026-12-05', pkg)[1]).toMatchObject({
      kind: 'satisfaction_survey', status: 'not_applicable',
    });
    const registered = buildCloseoutPackage(project, [CERT, PHOTO], {
      warranty_registration: {
        andersen_registration_deadline: '2026-12-04',
        registered_at: '2026-09-20T00:00:00.000Z',
        registration_ref: 'REG-TEST',
      },
    });
    const ob = obligationsDue('2027-03-01', registered);
    expect(ob[0]).toMatchObject({ kind: 'andersen_install_registration',
      status: 'done', ref: 'REG-TEST' });
    expect(ob[1]).toMatchObject({ kind: 'satisfaction_survey', status: 'pending' });
    expect(overdueObligations('2027-03-01', registered)).toEqual([]);
  });

  it('BDF claims: recorded with window, idempotent on invoice_ref, overdue', () => {
    const pkg = buildCloseoutPackage(project, [CERT, PHOTO]);
    const claim = {
      invoice_ref: 'INV-1', invoice_date: '2026-11-20',
      pre_tax_amount_cents: 123456, po_or_job_name: 'PO-TEST',
      iq_quote_number: 'IQ-TEST',
    };
    const r1 = recordBdfClaim(pkg, claim);
    if (!r1.ok) throw new Error(r1.reason);
    expect(r1.package.bdf_claims[0].claim_window_closes).toBe('2026-12-31');
    const r2 = recordBdfClaim(r1.package, claim);
    expect(r2.ok && r2.package.bdf_claims).toHaveLength(1);
    const bdf = obligationsDue('2027-01-01', r1.package)
      .filter((o) => o.kind === 'bdf_claim');
    expect(bdf).toHaveLength(1);
    expect(bdf[0].status).toBe('overdue');
    expect(obligationsDue('2026-12-31', r1.package)
      .find((o) => o.kind === 'bdf_claim')?.status).toBe('pending');
    expect(recordBdfClaim(pkg, { ...claim, invoice_date: 'x' }).ok).toBe(false);
    expect(recordBdfClaim(pkg, { ...claim, pre_tax_amount_cents: -1 }).ok)
      .toBe(false);
    expect(recordBdfClaim(pkg, { ...claim, iq_quote_number: '' }).ok).toBe(false);
  });

  it('Andersen Register Install form lists missing fields', () => {
    const f = andersenRegistrationForm({ job: 'PRJ-TEST', install_date: '2026-09-05' });
    expect(f.complete).toBe(false);
    expect(f.missing_fields).toEqual([
      'homeowner_name', 'homeowner_address', 'series', 'homeowner_phone']);
    expect(f.deadline).toBe('2026-12-04');
    const full = andersenRegistrationForm({
      job: 'PRJ-TEST', homeowner_name: 'Test Homeowner',
      homeowner_address: '1 Test St', series: '400 Series',
      install_date: '2026-09-05', homeowner_phone: '000-000-0000',
    });
    expect(full.complete).toBe(true);
    expect(full.program).toBe('andersen_register_install');
  });
});

describe('completion certificate descriptor', () => {
  it('is pure data for the render capability, registered under the Project ID', () => {
    const d = completionCertificateDescriptor(
      { id: P, project_code: 'PRJ-TEST', client_display_name: 'Test Client',
        property_address: '1 Test St' },
      { install_completed_on: '2026-09-05', series: '400 Series',
        crew_id: 'crew-a', punch_closed_at: '2026-09-07T00:00:00.000Z',
        opening_count: 4 },
    );
    expect(d.register_under_project_id).toBe(P);
    expect(d.document_type).toBe('closeout');
    expect(d.document_subtype).toBe('completion_certificate');
    expect(d.render_capability).toBe('document.render');
    expect(d.fields.warranty_registration_deadline).toBe('2026-12-04');
    expect(d.fields.expected_warranty_expiry).toBe('2028-09-05');
    expect(() => completionCertificateDescriptor(
      { id: P, client_display_name: 'x', property_address: 'y' },
      { install_completed_on: 'soon', series: 's', crew_id: null,
        punch_closed_at: null, opening_count: 0 })).toThrow();
  });
});

describe('archive plan', () => {
  const all: DocumentRef[] = ARCHIVE_REQUIRED_DOCUMENT_TYPES.map((t, i) => ({
    id: `d${i}`, document_type: t, is_current: true,
  }));

  it('is unblocked only when every required type is registered and current', () => {
    const plan = archivePlan({ id: P }, all);
    expect(plan.blocked).toBe(false);
    expect(plan.missing).toEqual([]);
    expect(plan.required).toEqual([...ARCHIVE_REQUIRED_DOCUMENT_TYPES]);
  });

  it('blocks on each missing type and on superseded-only docs', () => {
    for (const t of ARCHIVE_REQUIRED_DOCUMENT_TYPES) {
      const plan = archivePlan({ id: P }, all.filter((d) => d.document_type !== t));
      expect(plan.blocked).toBe(true);
      expect(plan.missing).toEqual([t]);
    }
    const stale = all.map((d) => d.document_type === 'warranty'
      ? { ...d, is_current: false } : d);
    expect(archivePlan({ id: P }, stale).missing).toEqual(['warranty']);
  });

  it('requires the punch document once punch items existed', () => {
    const plan = archivePlan({ id: P }, all, { punch_item_count: 2 });
    expect(plan.missing).toEqual(['punch']);
    const withPunch = archivePlan({ id: P }, [...all,
      { id: 'pu', document_type: 'punch', is_current: true }],
      { punch_item_count: 2 });
    expect(withPunch.blocked).toBe(false);
  });
});
