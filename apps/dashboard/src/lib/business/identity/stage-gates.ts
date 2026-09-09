// Phase 1 Lane A - project stage / gate model.
//
// A project moves through STAGES in order. Each stage has an ENTRY GATE:
// a list of deterministic predicates over a typed ProjectFacts snapshot.
// evaluateGate reports every failed predicate; ANY failure blocks. No
// predicate consults a model, a score, or a free-text field.
//
// Owner rules pinned (plan section 19, must not be reopened here):
//   * contract_signed requires a PROVIDER-verified signature;
//   * final measurement no sooner than 3 BUSINESS days after signing;
//   * no PO before final measure; PO uses final measured sizes only,
//     enforced as: the PO hash must be bound to the approved final
//     measurement hash;
//   * order_ready needs signed + payment condition + final measure
//     approved + building/LPC/DOB conditions + PO hash bound.
//
// Business-day math counts Monday-Friday only. Public holidays are OUT
// OF SCOPE for this module (documented; a holiday calendar would only
// make the earliest date later, never earlier, so this is the
// permissive-but-safe floor the owner rule allows).

export type ProjectStage =
  | 'lead'
  | 'qualified'
  | 'visit_scheduled'
  | 'measured'
  | 'quoted'
  | 'proposal_sent'
  | 'accepted'
  | 'contract_signed'
  | 'deposit_received'
  | 'final_measured'
  | 'order_ready'
  | 'ordered'
  | 'received'
  | 'install_scheduled'
  | 'installed'
  | 'punch'
  | 'closed_out'
  | 'closed';

export const PROJECT_STAGES: readonly ProjectStage[] = [
  'lead',
  'qualified',
  'visit_scheduled',
  'measured',
  'quoted',
  'proposal_sent',
  'accepted',
  'contract_signed',
  'deposit_received',
  'final_measured',
  'order_ready',
  'ordered',
  'received',
  'install_scheduled',
  'installed',
  'punch',
  'closed_out',
  'closed',
] as const;

export const FINAL_MEASURE_MIN_BUSINESS_DAYS = 3;

export type ComplianceCondition = 'not_required' | 'pending' | 'approved';

export interface ProjectFacts {
  // ISO timestamp of the evaluation moment.
  now: string;
  lead_created: boolean;
  qualified: boolean;
  site_visit_scheduled_at?: string | null;
  measured_at?: string | null;
  // An owner-approved quote version exists (quotes.status approved).
  quote_approved: boolean;
  proposal_sent_at?: string | null;
  proposal_accepted_at?: string | null;
  contract: {
    provider_verified: boolean; // e.g. DocuSign envelope completed
    signed_at?: string | null;
    document_hash?: string | null;
  };
  deposit: {
    received: boolean;
    amount_cents: number;
    required_cents: number;
  };
  final_measure: {
    recorded_at?: string | null;
    approved: boolean;
    hash?: string | null;
  };
  building_approval: ComplianceCondition;
  lpc: ComplianceCondition;
  dob: ComplianceCondition;
  po: {
    hash?: string | null;
    bound_measure_hash?: string | null;
  };
  order: {
    placed: boolean;
    order_number?: string | null;
    received: boolean;
  };
  install: {
    scheduled_at?: string | null;
    completed_at?: string | null;
    punch_open_count: number;
  };
  final_payment_received: boolean;
  closeout_docs_complete: boolean;
}

// --- business-day math -----------------------------------------------------

// Calendar date (YYYY-MM-DD) of an ISO value, taken from the string so
// callers control the timezone by what they pass.
export function dateOnly(iso: string): string | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isFinite(t) ? m[1] : null;
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isBusinessDay(date: string): boolean {
  const dow = toUtc(date).getUTCDay();
  return dow >= 1 && dow <= 5;
}

// The date `n` business days after `date` (n >= 0). The start date
// itself never counts; a Friday + 1 = Monday.
export function addBusinessDays(date: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`business days must be a non-negative int: ${n}`);
  }
  const d = toUtc(date);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(fromUtc(d))) left -= 1;
  }
  return fromUtc(d);
}

// Number of business days strictly after `from` up to and including
// `to`; 0 when `to` <= `from`.
export function businessDaysBetween(from: string, to: string): number {
  const a = toUtc(from);
  const b = toUtc(to);
  if (b <= a) return 0;
  let count = 0;
  const d = new Date(a);
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(fromUtc(d))) count += 1;
  }
  return count;
}

export function earliestFinalMeasureDate(signedAtIso: string): string | null {
  const signed = dateOnly(signedAtIso);
  if (!signed) return null;
  return addBusinessDays(signed, FINAL_MEASURE_MIN_BUSINESS_DAYS);
}

// --- gates -----------------------------------------------------------------

export interface GatePredicate {
  name: string;
  check: (f: ProjectFacts) => boolean;
}

const has = (v: unknown): boolean =>
  typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined;

const P = {
  lead_created: { name: 'lead_created', check: (f) => f.lead_created },
  qualified: { name: 'qualified', check: (f) => f.qualified },
  site_visit_scheduled: {
    name: 'site_visit_scheduled',
    check: (f) => has(f.site_visit_scheduled_at),
  },
  measured: { name: 'measured', check: (f) => has(f.measured_at) },
  quote_approved: { name: 'quote_approved', check: (f) => f.quote_approved },
  proposal_sent: {
    name: 'proposal_sent',
    check: (f) => has(f.proposal_sent_at),
  },
  proposal_accepted: {
    name: 'proposal_accepted',
    check: (f) => has(f.proposal_accepted_at),
  },
  contract_provider_verified: {
    name: 'contract_provider_verified',
    check: (f) => f.contract.provider_verified === true,
  },
  contract_signed_at: {
    name: 'contract_signed_at',
    check: (f) => dateOnly(f.contract.signed_at ?? '') !== null,
  },
  contract_document_hash: {
    name: 'contract_document_hash',
    check: (f) => has(f.contract.document_hash),
  },
  deposit_required_known: {
    name: 'deposit_required_known',
    check: (f) =>
      Number.isSafeInteger(f.deposit.required_cents) &&
      f.deposit.required_cents > 0,
  },
  deposit_received: {
    name: 'deposit_received',
    check: (f) => f.deposit.received === true,
  },
  deposit_amount_covers_required: {
    name: 'deposit_amount_covers_required',
    check: (f) =>
      Number.isSafeInteger(f.deposit.amount_cents) &&
      f.deposit.amount_cents >= f.deposit.required_cents,
  },
  final_measure_recorded: {
    name: 'final_measure_recorded',
    check: (f) => dateOnly(f.final_measure.recorded_at ?? '') !== null,
  },
  final_measure_after_3_business_days: {
    name: 'final_measure_after_3_business_days',
    check: (f) => {
      const recorded = dateOnly(f.final_measure.recorded_at ?? '');
      const earliest = earliestFinalMeasureDate(f.contract.signed_at ?? '');
      if (!recorded || !earliest) return false;
      return recorded >= earliest;
    },
  },
  final_measure_approved: {
    name: 'final_measure_approved',
    check: (f) => f.final_measure.approved === true,
  },
  final_measure_hash: {
    name: 'final_measure_hash',
    check: (f) => has(f.final_measure.hash),
  },
  payment_condition: {
    name: 'payment_condition',
    check: (f) =>
      f.deposit.received === true &&
      Number.isSafeInteger(f.deposit.required_cents) &&
      f.deposit.required_cents > 0 &&
      f.deposit.amount_cents >= f.deposit.required_cents,
  },
  building_condition: {
    name: 'building_condition',
    check: (f) => f.building_approval !== 'pending',
  },
  lpc_condition: { name: 'lpc_condition', check: (f) => f.lpc !== 'pending' },
  dob_condition: { name: 'dob_condition', check: (f) => f.dob !== 'pending' },
  po_hash_bound_to_final_measure: {
    name: 'po_hash_bound_to_final_measure',
    check: (f) =>
      has(f.po.hash) &&
      has(f.po.bound_measure_hash) &&
      has(f.final_measure.hash) &&
      f.po.bound_measure_hash === f.final_measure.hash,
  },
  order_placed: { name: 'order_placed', check: (f) => f.order.placed === true },
  order_number: { name: 'order_number', check: (f) => has(f.order.order_number) },
  order_received: {
    name: 'order_received',
    check: (f) => f.order.received === true,
  },
  install_scheduled: {
    name: 'install_scheduled',
    check: (f) => has(f.install.scheduled_at),
  },
  install_completed: {
    name: 'install_completed',
    check: (f) => has(f.install.completed_at),
  },
  punch_resolved: {
    name: 'punch_resolved',
    check: (f) =>
      Number.isSafeInteger(f.install.punch_open_count) &&
      f.install.punch_open_count === 0,
  },
  final_payment_received: {
    name: 'final_payment_received',
    check: (f) => f.final_payment_received === true,
  },
  closeout_docs_complete: {
    name: 'closeout_docs_complete',
    check: (f) => f.closeout_docs_complete === true,
  },
} satisfies Record<string, GatePredicate>;

const SIGNED: GatePredicate[] = [
  P.contract_provider_verified,
  P.contract_signed_at,
  P.contract_document_hash,
];

const ORDER_READY: GatePredicate[] = [
  ...SIGNED,
  P.payment_condition,
  P.final_measure_recorded,
  P.final_measure_after_3_business_days,
  P.final_measure_approved,
  P.final_measure_hash,
  P.building_condition,
  P.lpc_condition,
  P.dob_condition,
  P.po_hash_bound_to_final_measure,
];

export const STAGE_GATES: Readonly<Record<ProjectStage, GatePredicate[]>> = {
  lead: [],
  qualified: [P.lead_created, P.qualified],
  visit_scheduled: [P.qualified, P.site_visit_scheduled],
  measured: [P.qualified, P.measured],
  quoted: [P.measured, P.quote_approved],
  proposal_sent: [P.quote_approved, P.proposal_sent],
  accepted: [P.quote_approved, P.proposal_sent, P.proposal_accepted],
  contract_signed: [P.proposal_accepted, ...SIGNED],
  deposit_received: [
    ...SIGNED,
    P.deposit_required_known,
    P.deposit_received,
    P.deposit_amount_covers_required,
  ],
  final_measured: [
    ...SIGNED,
    P.final_measure_recorded,
    P.final_measure_after_3_business_days,
  ],
  order_ready: ORDER_READY,
  ordered: [...ORDER_READY, P.order_placed, P.order_number],
  received: [P.order_placed, P.order_number, P.order_received],
  install_scheduled: [P.order_received, P.install_scheduled],
  installed: [P.install_scheduled, P.install_completed],
  punch: [P.install_completed],
  closed_out: [P.install_completed, P.punch_resolved, P.final_payment_received],
  closed: [
    P.install_completed,
    P.punch_resolved,
    P.final_payment_received,
    P.closeout_docs_complete,
  ],
};

export interface GateVerdict {
  ok: boolean;
  stage: ProjectStage;
  failed_predicates: string[];
}

export function isProjectStage(v: unknown): v is ProjectStage {
  return typeof v === 'string' && (PROJECT_STAGES as readonly string[]).includes(v);
}

export function stageIndex(stage: ProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

export function nextStage(stage: ProjectStage): ProjectStage | null {
  const i = stageIndex(stage);
  return i >= 0 && i < PROJECT_STAGES.length - 1 ? PROJECT_STAGES[i + 1] : null;
}

// Every predicate is evaluated (no short-circuit) so the caller sees the
// full list of what is missing; a predicate that throws counts as failed.
export function evaluateGate(stage: ProjectStage, facts: ProjectFacts): GateVerdict {
  if (!isProjectStage(stage)) {
    return { ok: false, stage, failed_predicates: ['unknown_stage'] };
  }
  const failed: string[] = [];
  for (const p of STAGE_GATES[stage]) {
    let pass = false;
    try {
      pass = p.check(facts) === true;
    } catch {
      pass = false;
    }
    if (!pass) failed.push(p.name);
  }
  return { ok: failed.length === 0, stage, failed_predicates: failed };
}

export interface AdvanceVerdict extends GateVerdict {
  from: ProjectStage;
  to: ProjectStage | null;
}

// A project may only move to the IMMEDIATE next stage, and only when
// that stage's gate passes. Skipping stages is never allowed here.
export function canAdvance(
  from: ProjectStage,
  to: ProjectStage,
  facts: ProjectFacts,
): AdvanceVerdict {
  if (!isProjectStage(from) || !isProjectStage(to)) {
    return { ok: false, stage: to, from, to, failed_predicates: ['unknown_stage'] };
  }
  if (nextStage(from) !== to) {
    return {
      ok: false,
      stage: to,
      from,
      to,
      failed_predicates: ['not_the_next_stage'],
    };
  }
  const gate = evaluateGate(to, facts);
  return { ...gate, from, to };
}
