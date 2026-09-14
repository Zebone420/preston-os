// Phase 6 - closeout package, final-payment ELIGIBILITY, Andersen
// program obligations, completion certificate descriptor, archive plan.
//
// Mirrors public.closeout_packages (migration 0035). Everything here is
// pure data: finalPaymentEligible returns a FLAG only (there is no path
// from this module to any money rail); descriptors are inputs to the
// render + document-registration capabilities; obligations are a list
// the owner reads. Dates are YYYY-MM-DD, UTC-anchored.
//
// Andersen program facts (owner supplied, 2026-09):
// - Register Install within 90 days of the install date (form: job,
//   homeowner name/address, series, install date, homeowner phone).
//   Andersen then emails a 2-year install warranty + satisfaction survey
//   to the homeowner.
// - BDF (business development funds) are earned by uploading Andersen
//   invoices (pre-tax amount, PO/job name, IQ+ quote number) within
//   3 months of the invoice date, in the current calendar year.

import { installStateAtLeast } from './install-state';
import {
  isIsoDate,
  type CloseoutState,
  type DocumentRef,
  type InstallState,
} from './types';

export const ANDERSEN_REGISTRATION_WINDOW_DAYS = 90;
export const ANDERSEN_INSTALL_WARRANTY_YEARS = 2;
export const BDF_CLAIM_WINDOW_MONTHS = 3;

export const COMPLETION_CERTIFICATE_DOCUMENT_TYPE = 'closeout';
export const COMPLETION_CERTIFICATE_SUBTYPE = 'completion_certificate';
export const FINAL_PHOTO_DOCUMENT_TYPE = 'installation_photo';

// Document types that must be registered under the Project ID before a
// project may be archived (plan section 5: field/closeout artifacts all
// register under Project ID).
export const ARCHIVE_REQUIRED_DOCUMENT_TYPES = [
  'contract',
  'purchase_order',
  'delivery',
  'installation_photo',
  'closeout',
  'warranty',
] as const;

// --- date math ------------------------------------------------------------

function toUtc(date: string): Date {
  return new Date(date + 'T00:00:00.000Z');
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

// Month arithmetic with day clamping (Aug 31 + 3 months = Nov 30).
export function addMonthsClamped(date: string, months: number): string {
  const d = toUtc(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return fromUtc(new Date(Date.UTC(targetYear, targetMonth, day)));
}

export function warrantyRegistrationDeadline(installDate: string): string {
  if (!isIsoDate(installDate)) throw new Error('installDate must be YYYY-MM-DD');
  return addDays(installDate, ANDERSEN_REGISTRATION_WINDOW_DAYS);
}

export function expectedWarrantyExpiry(installDate: string): string {
  if (!isIsoDate(installDate)) throw new Error('installDate must be YYYY-MM-DD');
  return addMonthsClamped(installDate, ANDERSEN_INSTALL_WARRANTY_YEARS * 12);
}

export interface BdfClaimWindow {
  opens: string;
  closes: string;
  clipped_to_calendar_year: boolean;
}

// +3 months, never past Dec 31 of the invoice's own calendar year.
export function bdfClaimWindow(invoiceDate: string): BdfClaimWindow {
  if (!isIsoDate(invoiceDate)) throw new Error('invoiceDate must be YYYY-MM-DD');
  const natural = addMonthsClamped(invoiceDate, BDF_CLAIM_WINDOW_MONTHS);
  const yearEnd = invoiceDate.slice(0, 4) + '-12-31';
  const clipped = natural > yearEnd;
  return {
    opens: invoiceDate,
    closes: clipped ? yearEnd : natural,
    clipped_to_calendar_year: clipped,
  };
}

// --- package ----------------------------------------------------------------

export interface WarrantyRegistration {
  andersen_registration_deadline: string | null;
  registered_at: string | null;
  registration_ref: string | null;
}

export interface BdfClaim {
  invoice_ref: string;
  invoice_date: string;
  pre_tax_amount_cents: number;
  po_or_job_name: string;
  iq_quote_number: string;
  claim_window_closes: string;
  submitted_at: string | null;
}

export interface ReviewSurvey {
  requested_at: string | null;
  response: string | null;
}

export interface CloseoutPackage {
  project_id: string;
  completion_certificate_document_id: string | null;
  final_photos_document_ids: string[];
  warranty_registration: WarrantyRegistration;
  bdf_claims: BdfClaim[];
  review_survey: ReviewSurvey;
  final_payment_eligible: boolean;
  final_payment_evaluated_at: string | null;
  archived_at: string | null;
  state: CloseoutState;
}

export interface CloseoutProjectInput {
  id: string;
  install_completed_on: string | null; // YYYY-MM-DD
}

export function buildCloseoutPackage(
  project: CloseoutProjectInput,
  docs: DocumentRef[],
  existing: Partial<CloseoutPackage> = {},
): CloseoutPackage {
  const cert = docs.find(
    (d) =>
      d.is_current &&
      d.document_type === COMPLETION_CERTIFICATE_DOCUMENT_TYPE &&
      d.document_subtype === COMPLETION_CERTIFICATE_SUBTYPE,
  );
  const photos = docs
    .filter((d) => d.is_current && d.document_type === FINAL_PHOTO_DOCUMENT_TYPE)
    .map((d) => d.id);
  const deadline =
    project.install_completed_on && isIsoDate(project.install_completed_on)
      ? warrantyRegistrationDeadline(project.install_completed_on)
      : null;
  return {
    project_id: project.id,
    completion_certificate_document_id: cert ? cert.id : null,
    final_photos_document_ids: photos,
    warranty_registration: {
      andersen_registration_deadline: deadline,
      registered_at: existing.warranty_registration?.registered_at ?? null,
      registration_ref: existing.warranty_registration?.registration_ref ?? null,
    },
    bdf_claims: existing.bdf_claims ?? [],
    review_survey: existing.review_survey ?? { requested_at: null, response: null },
    final_payment_eligible: false,
    final_payment_evaluated_at: null,
    archived_at: existing.archived_at ?? null,
    state: existing.state ?? 'open',
  };
}

export function closeoutDocsPresent(pkg: CloseoutPackage): boolean {
  return (
    pkg.completion_certificate_document_id !== null &&
    pkg.final_photos_document_ids.length >= 1
  );
}

export function recordBdfClaim(
  pkg: CloseoutPackage,
  claim: Omit<BdfClaim, 'claim_window_closes' | 'submitted_at'>,
): { ok: true; package: CloseoutPackage } | { ok: false; reason: string } {
  if (!isIsoDate(claim.invoice_date)) {
    return { ok: false, reason: 'invoice_date must be YYYY-MM-DD' };
  }
  if (
    !Number.isSafeInteger(claim.pre_tax_amount_cents) ||
    claim.pre_tax_amount_cents < 0
  ) {
    return { ok: false, reason: 'pre_tax_amount_cents must be a non-negative int' };
  }
  for (const k of ['invoice_ref', 'po_or_job_name', 'iq_quote_number'] as const) {
    if (typeof claim[k] !== 'string' || claim[k].trim().length === 0) {
      return { ok: false, reason: `${k} required` };
    }
  }
  if (pkg.bdf_claims.some((c) => c.invoice_ref === claim.invoice_ref)) {
    return { ok: true, package: pkg };
  }
  const window = bdfClaimWindow(claim.invoice_date);
  return {
    ok: true,
    package: {
      ...pkg,
      bdf_claims: [
        ...pkg.bdf_claims,
        { ...claim, claim_window_closes: window.closes, submitted_at: null },
      ],
    },
  };
}

// --- final payment ELIGIBILITY (flag only) ---------------------------------

export interface FinalPaymentFacts {
  install_state: InstallState;
  closeout_docs_present: boolean;
  open_change_order_count: number;
  client_signoff_event_present: boolean;
}

export interface FinalPaymentEligibility {
  eligible: boolean;
  missing: string[];
}

export function finalPaymentEligible(
  facts: FinalPaymentFacts,
): FinalPaymentEligibility {
  const missing: string[] = [];
  if (!installStateAtLeast(facts.install_state, 'installed')) {
    missing.push('installed');
  }
  if (!installStateAtLeast(facts.install_state, 'punch_closed')) {
    missing.push('punch_closed');
  }
  if (!facts.closeout_docs_present) missing.push('closeout_docs_present');
  if (
    !Number.isInteger(facts.open_change_order_count) ||
    facts.open_change_order_count !== 0
  ) {
    missing.push('no_open_change_order');
  }
  if (facts.client_signoff_event_present !== true) {
    missing.push('client_signoff_event_present');
  }
  return { eligible: missing.length === 0, missing };
}

// --- Andersen program obligations ------------------------------------------

export type ObligationKind =
  | 'andersen_install_registration'
  | 'bdf_claim'
  | 'satisfaction_survey';

export type ObligationStatus =
  | 'pending'
  | 'overdue'
  | 'done'
  | 'not_applicable';

export interface Obligation {
  kind: ObligationKind;
  ref: string | null;
  due_on: string | null;
  status: ObligationStatus;
  detail: string;
}

export function obligationsDue(now: string, pkg: CloseoutPackage): Obligation[] {
  if (!isIsoDate(now)) throw new Error('now must be YYYY-MM-DD');
  const out: Obligation[] = [];
  const w = pkg.warranty_registration;
  if (w.registered_at) {
    out.push({
      kind: 'andersen_install_registration',
      ref: w.registration_ref,
      due_on: w.andersen_registration_deadline,
      status: 'done',
      detail: 'Andersen Register Install recorded',
    });
    out.push({
      kind: 'satisfaction_survey',
      ref: null,
      due_on: null,
      status: pkg.review_survey.response ? 'done' : 'pending',
      detail:
        'Andersen emails the 2-year warranty + satisfaction survey ' +
        'to the homeowner after registration',
    });
  } else if (w.andersen_registration_deadline) {
    const overdue = now > w.andersen_registration_deadline;
    out.push({
      kind: 'andersen_install_registration',
      ref: null,
      due_on: w.andersen_registration_deadline,
      status: overdue ? 'overdue' : 'pending',
      detail: `register install within ${ANDERSEN_REGISTRATION_WINDOW_DAYS} days`,
    });
    out.push({
      kind: 'satisfaction_survey',
      ref: null,
      due_on: null,
      status: 'not_applicable',
      detail: 'survey follows Andersen registration',
    });
  } else {
    out.push({
      kind: 'andersen_install_registration',
      ref: null,
      due_on: null,
      status: 'not_applicable',
      detail: 'install date not recorded',
    });
  }
  for (const c of pkg.bdf_claims) {
    const overdue = !c.submitted_at && now > c.claim_window_closes;
    out.push({
      kind: 'bdf_claim',
      ref: c.invoice_ref,
      due_on: c.claim_window_closes,
      status: c.submitted_at ? 'done' : overdue ? 'overdue' : 'pending',
      detail: `upload Andersen invoice ${c.invoice_ref} for BDF`,
    });
  }
  return out;
}

export function overdueObligations(now: string, pkg: CloseoutPackage) {
  return obligationsDue(now, pkg).filter((o) => o.status === 'overdue');
}

// --- Andersen Register Install form (descriptor, owner fills + submits) -----

export interface AndersenRegistrationFields {
  job: string;
  homeowner_name: string;
  homeowner_address: string;
  series: string;
  install_date: string;
  homeowner_phone: string;
}

export interface AndersenRegistrationForm {
  program: 'andersen_register_install';
  deadline: string | null;
  fields: AndersenRegistrationFields;
  missing_fields: (keyof AndersenRegistrationFields)[];
  complete: boolean;
}

export function andersenRegistrationForm(
  fields: Partial<AndersenRegistrationFields>,
): AndersenRegistrationForm {
  const keys: (keyof AndersenRegistrationFields)[] = [
    'job',
    'homeowner_name',
    'homeowner_address',
    'series',
    'install_date',
    'homeowner_phone',
  ];
  const filled = {} as AndersenRegistrationFields;
  const missing: (keyof AndersenRegistrationFields)[] = [];
  for (const k of keys) {
    const v = fields[k];
    const ok =
      typeof v === 'string' &&
      v.trim().length > 0 &&
      (k !== 'install_date' || isIsoDate(v));
    filled[k] = ok ? v.trim() : '';
    if (!ok) missing.push(k);
  }
  return {
    program: 'andersen_register_install',
    deadline: isIsoDate(filled.install_date)
      ? warrantyRegistrationDeadline(filled.install_date)
      : null,
    fields: filled,
    missing_fields: missing,
    complete: missing.length === 0,
  };
}

// --- completion certificate descriptor (render capability input) -----------

export interface CompletionCertificateProject {
  id: string;
  project_code?: string | null;
  client_display_name: string;
  property_address: string;
}

export interface CompletionCertificateInstall {
  install_completed_on: string; // YYYY-MM-DD
  series: string;
  crew_id: string | null;
  punch_closed_at: string | null;
  opening_count: number;
}

export interface CompletionCertificateDescriptor {
  template: 'completion_certificate_v1';
  render_capability: 'document.render';
  register_under_project_id: string;
  document_type: typeof COMPLETION_CERTIFICATE_DOCUMENT_TYPE;
  document_subtype: typeof COMPLETION_CERTIFICATE_SUBTYPE;
  fields: {
    project_id: string;
    project_code: string | null;
    client_display_name: string;
    property_address: string;
    install_completed_on: string;
    series: string;
    crew_id: string | null;
    punch_closed_at: string | null;
    opening_count: number;
    warranty_registration_deadline: string;
    expected_warranty_expiry: string;
  };
}

export function completionCertificateDescriptor(
  project: CompletionCertificateProject,
  install: CompletionCertificateInstall,
): CompletionCertificateDescriptor {
  if (!isIsoDate(install.install_completed_on)) {
    throw new Error('install_completed_on must be YYYY-MM-DD');
  }
  return {
    template: 'completion_certificate_v1',
    render_capability: 'document.render',
    register_under_project_id: project.id,
    document_type: COMPLETION_CERTIFICATE_DOCUMENT_TYPE,
    document_subtype: COMPLETION_CERTIFICATE_SUBTYPE,
    fields: {
      project_id: project.id,
      project_code: project.project_code ?? null,
      client_display_name: project.client_display_name,
      property_address: project.property_address,
      install_completed_on: install.install_completed_on,
      series: install.series,
      crew_id: install.crew_id,
      punch_closed_at: install.punch_closed_at,
      opening_count: install.opening_count,
      warranty_registration_deadline: warrantyRegistrationDeadline(
        install.install_completed_on,
      ),
      expected_warranty_expiry: expectedWarrantyExpiry(
        install.install_completed_on,
      ),
    },
  };
}

// --- archive plan --------------------------------------------------------------

export interface ArchivePlan {
  project_id: string;
  required: string[];
  present: string[];
  missing: string[];
  blocked: boolean;
}

export function archivePlan(
  project: { id: string },
  docs: DocumentRef[],
  opts: { punch_item_count?: number } = {},
): ArchivePlan {
  const required: string[] = [...ARCHIVE_REQUIRED_DOCUMENT_TYPES];
  if ((opts.punch_item_count ?? 0) > 0) required.push('punch');
  const current = new Set(
    docs.filter((d) => d.is_current).map((d) => d.document_type),
  );
  const present = required.filter((t) => current.has(t));
  const missing = required.filter((t) => !current.has(t));
  return {
    project_id: project.id,
    required,
    present,
    missing,
    blocked: missing.length > 0,
  };
}
