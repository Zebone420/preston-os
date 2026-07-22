// Business Command Center read models (Phase 6C).
//
// Pure, deterministic aggregation over row arrays. Works identically
// on Supabase rows and on the fixture dataset, so every page can
// degrade to labeled fixture data in setup mode. Defensive coercion:
// unknown shapes never throw, they just fall out of the aggregates.

export type Row = Record<string, unknown>;

export function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return 0;
}

export function asBool(v: unknown): boolean {
  return v === true;
}

// Render integer cents as dollars, e.g. 925438 -> "$9,254.38".
export function formatCents(cents: unknown): string {
  const n = asNumber(cents);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  const grouped = dollars
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${rem}`;
}

export function formatMilliPct(milli: unknown): string {
  const n = asNumber(milli);
  return `${(n / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

const ACTIVE_LEAD_STAGES = new Set([
  'lead',
  'qualified',
  'site_visit',
  'quote_requested',
  'quote_drafted',
  'quote_sent',
  'follow_up',
  'negotiation',
]);

const OPEN_QUOTE_STATUSES = new Set(['draft', 'pending_approval']);

const ACTIVE_PROJECT_STATUSES = new Set([
  'pending_contract',
  'contracted',
  'in_progress',
  'punch_list',
  'final_inspection',
]);

const PENDING_ORDER_STATUSES = new Set([
  'not_ordered',
  'ordered',
  'in_production',
  'shipped',
  'backordered',
  'exception',
]);

const UPCOMING_INSTALL_STATUSES = new Set([
  'tentative',
  'scheduled',
  'in_progress',
]);

export interface ExecutiveSummary {
  active_leads: number;
  open_quotes: number;
  won_jobs: number;
  active_projects: number;
  pending_orders: number;
  upcoming_installations: number;
  outstanding_cents: number;
  pending_approvals: number;
  open_recommendations: number;
  operational_exceptions: number;
}

export interface ExecutiveInputs {
  leads: Row[];
  quotes: Row[];
  projects: Row[];
  vendorOrders: Row[];
  installationEvents: Row[];
  paymentSummaries: ProjectPaymentSummary[];
  approvals: Row[];
  recommendations: Row[];
  milestones: Row[];
}

export function buildExecutiveSummary(
  inputs: ExecutiveInputs,
): ExecutiveSummary {
  const outstanding = inputs.paymentSummaries.reduce(
    (sum, p) => sum + Math.max(p.outstanding_cents, 0),
    0,
  );
  const exceptions =
    inputs.vendorOrders.filter(
      (o) =>
        asString(o.delivery_status) === 'exception' ||
        asBool(o.backordered),
    ).length +
    inputs.milestones.filter((m) => asString(m.status) === 'blocked')
      .length;
  return {
    active_leads: inputs.leads.filter(
      (l) =>
        ACTIVE_LEAD_STAGES.has(asString(l.stage)) && !asBool(l.archived),
    ).length,
    open_quotes: inputs.quotes.filter(
      (q) =>
        OPEN_QUOTE_STATUSES.has(asString(q.status)) &&
        !asBool(q.archived),
    ).length,
    won_jobs: inputs.leads.filter(
      (l) => asString(l.stage) === 'won' && !asBool(l.archived),
    ).length,
    active_projects: inputs.projects.filter((p) =>
      ACTIVE_PROJECT_STATUSES.has(asString(p.status)),
    ).length,
    pending_orders: inputs.vendorOrders.filter((o) =>
      PENDING_ORDER_STATUSES.has(asString(o.delivery_status)),
    ).length,
    upcoming_installations: inputs.installationEvents.filter((e) =>
      UPCOMING_INSTALL_STATUSES.has(asString(e.status)),
    ).length,
    outstanding_cents: outstanding,
    pending_approvals: inputs.approvals.filter(
      (a) => asString(a.decision) === 'pending',
    ).length,
    open_recommendations: inputs.recommendations.filter(
      (r) => asString(r.status) === 'open',
    ).length,
    operational_exceptions: exceptions,
  };
}

// --- payments and margin ---------------------------------------------------

export interface ProjectPaymentSummary {
  project_id: string;
  contract_value_cents: number;
  collected_cents: number;
  outstanding_cents: number;
  schedule_type: string;
  overdue: boolean;
}

// Contract value resolution, newest-first: (1) a payment_schedules
// row linked directly to the project (schedules are read newest
// first, so the most recent project-linked schedule wins); else
// (2) fall back through project.quote_id to the newest quote
// version's total and embedded schedule - this is the path agent-
// created drafts take, since the agent links schedules to the
// version, not the project. Collected = sum of recorded payment
// events for the project. Overdue heuristic (V1): outstanding > 0
// while the project is in punch_list/final_inspection/closed -
// late-stage with money open.
export function buildProjectPaymentSummary(
  project: Row,
  schedules: Row[],
  payments: Row[],
  quoteVersions: Row[] = [],
): ProjectPaymentSummary {
  const projectId = asString(project.id);
  const schedule = schedules.find(
    (s) => asString(s.project_id) === projectId,
  );
  let scheduleTotal = 0;
  let scheduleType = '';
  if (schedule) {
    scheduleTotal = asNumber(schedule.total_cents);
    scheduleType = asString(schedule.schedule_type);
  } else {
    const quoteId = asString(project.quote_id);
    if (quoteId) {
      let newest: Row | undefined;
      for (const v of quoteVersions) {
        if (asString(v.quote_id) !== quoteId) continue;
        if (!newest || asNumber(v.version) > asNumber(newest.version)) {
          newest = v;
        }
      }
      if (newest) {
        scheduleTotal = asNumber(newest.total_cents);
        const plan = newest.payment_schedule as
          | { schedule_type?: unknown }
          | null
          | undefined;
        scheduleType = plan ? asString(plan.schedule_type) : '';
      }
    }
  }
  const collected = payments
    .filter((p) => asString(p.project_id) === projectId)
    .reduce((sum, p) => sum + asNumber(p.amount_cents), 0);
  const outstanding = Math.max(scheduleTotal - collected, 0);
  const lateStage = ['punch_list', 'final_inspection', 'closed'].includes(
    asString(project.status),
  );
  return {
    project_id: projectId,
    contract_value_cents: scheduleTotal,
    collected_cents: collected,
    outstanding_cents: outstanding,
    schedule_type: scheduleType,
    overdue: lateStage && outstanding > 0,
  };
}

export interface MarginSummary {
  quote_version_id: string;
  quote_id: string;
  material_cents: number;
  labor_cents: number;
  fees_cents: number;
  markup_cents: number;
  tax_cents: number;
  total_cents: number;
  margin_cents: number;
  margin_note: string;
}

export function buildMarginSummary(version: Row): MarginSummary {
  return {
    quote_version_id: asString(version.id),
    quote_id: asString(version.quote_id),
    material_cents: asNumber(version.material_cents),
    labor_cents: asNumber(version.labor_cents),
    fees_cents: asNumber(version.fees_cents),
    markup_cents: asNumber(version.markup_cents),
    tax_cents: asNumber(version.tax_cents),
    total_cents: asNumber(version.total_cents),
    margin_cents: asNumber(version.margin_cents),
    margin_note:
      'projected margin equals explicit markup (V4 markup rule pending)',
  };
}

// --- pipeline --------------------------------------------------------------

export interface PipelineColumn {
  stage: string;
  leads: Row[];
}

export function buildPipeline(
  leads: Row[],
  stages: readonly string[],
): PipelineColumn[] {
  return stages.map((stage) => ({
    stage,
    leads: leads.filter(
      (l) => asString(l.stage) === stage && !asBool(l.archived),
    ),
  }));
}

// --- staleness -------------------------------------------------------------

export interface StalenessInfo {
  latest_iso: string;
  stale: boolean;
}

// A dataset is considered stale when its newest record timestamp is
// older than maxAgeHours relative to the injected now.
export function assessStaleness(
  rows: Row[],
  nowIso: string,
  maxAgeHours: number,
): StalenessInfo {
  let latest = '';
  for (const r of rows) {
    const ts =
      asString(r.updated_at) || asString(r.created_at) || '';
    if (ts > latest) latest = ts;
  }
  if (!latest) return { latest_iso: '', stale: true };
  const ageMs = Date.parse(nowIso) - Date.parse(latest);
  return {
    latest_iso: latest,
    stale: !Number.isFinite(ageMs) || ageMs > maxAgeHours * 3600_000,
  };
}
