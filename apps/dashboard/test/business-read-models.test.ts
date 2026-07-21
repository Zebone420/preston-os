import { describe, expect, it } from 'vitest';
import {
  brownstoneCalc,
  buildFixtureDataset,
} from '../src/lib/business/fixtures';
import {
  assessStaleness,
  buildExecutiveSummary,
  buildMarginSummary,
  buildPipeline,
  buildProjectPaymentSummary,
  formatCents,
  formatMilliPct,
  type Row,
} from '../src/lib/business/read-models';
import { generateRecommendations } from '../src/lib/business/recommendations';
import { LEAD_STAGES } from '../src/lib/business/types';

const ds = buildFixtureDataset();
const NOW = '2026-07-21T12:00:00.000Z';

const asRows = (arr: object[]) => arr as unknown as Row[];

function recommendationInputs() {
  return {
    quotes: asRows(ds.quotes),
    projects: asRows(ds.projects),
    milestones: asRows(ds.milestones),
    vendorOrders: asRows(ds.vendorOrders),
    installationEvents: asRows(ds.installationEvents),
    paymentSchedules: asRows(ds.paymentSchedules),
    paymentEvents: asRows(ds.paymentEvents),
    communications: asRows(ds.communications),
    quoteVersions: asRows(ds.quoteVersions),
    properties: asRows(ds.properties),
    nowIso: NOW,
  };
}

describe('formatting helpers', () => {
  it('formats cents as grouped dollars', () => {
    expect(formatCents(925438)).toBe('$9,254.38');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(formatCents(-2500)).toBe('-$25.00');
  });

  it('formats milli-percent rates', () => {
    expect(formatMilliPct(8875)).toBe('8.875%');
    expect(formatMilliPct(6625)).toBe('6.625%');
    expect(formatMilliPct(25000)).toBe('25%');
  });
});

describe('executive summary over fixtures', () => {
  it('computes exact counts', () => {
    const paySummaries = ds.projects.map((p) =>
      buildProjectPaymentSummary(
        p as unknown as Row,
        asRows(ds.paymentSchedules),
        asRows(ds.paymentEvents),
      ),
    );
    const summary = buildExecutiveSummary({
      leads: asRows(ds.leads),
      quotes: asRows(ds.quotes),
      projects: asRows(ds.projects),
      vendorOrders: asRows(ds.vendorOrders),
      installationEvents: asRows(ds.installationEvents),
      paymentSummaries: paySummaries,
      approvals: [],
      recommendations: asRows(ds.recommendations),
      milestones: asRows(ds.milestones),
    });
    expect(summary.active_leads).toBe(4);
    expect(summary.open_quotes).toBe(2);
    expect(summary.won_jobs).toBe(0);
    expect(summary.active_projects).toBe(1);
    expect(summary.pending_orders).toBe(1);
    expect(summary.upcoming_installations).toBe(1);
    expect(summary.pending_approvals).toBe(0);
    expect(summary.open_recommendations).toBe(3);
    expect(summary.operational_exceptions).toBe(0);
    // deposit was 50 percent; the rest is outstanding
    const total = brownstoneCalc.total_cents;
    const deposit =
      brownstoneCalc.payment_schedule.stages[0].amount_cents;
    expect(summary.outstanding_cents).toBe(total - deposit);
  });
});

describe('payment and margin summaries', () => {
  it('collected + outstanding reconcile with the schedule total', () => {
    const s = buildProjectPaymentSummary(
      ds.projects[0] as unknown as Row,
      asRows(ds.paymentSchedules),
      asRows(ds.paymentEvents),
    );
    expect(s.contract_value_cents).toBe(brownstoneCalc.total_cents);
    expect(s.collected_cents).toBe(
      brownstoneCalc.payment_schedule.stages[0].amount_cents,
    );
    expect(s.collected_cents + s.outstanding_cents).toBe(
      s.contract_value_cents,
    );
    expect(s.overdue).toBe(false);
  });

  it('margin summary mirrors version numbers with the V4 note', () => {
    const m = buildMarginSummary(ds.quoteVersions[0] as unknown as Row);
    expect(m.total_cents).toBe(brownstoneCalc.total_cents);
    expect(m.margin_cents).toBe(0);
    expect(m.margin_note).toContain('V4');
  });
});

describe('pipeline and staleness', () => {
  it('buckets every lead exactly once across all stages', () => {
    const cols = buildPipeline(asRows(ds.leads), LEAD_STAGES);
    const totals = cols.reduce((a, c) => a + c.leads.length, 0);
    expect(totals).toBe(ds.leads.length);
    const drafted = cols.find((c) => c.stage === 'quote_drafted');
    expect(drafted?.leads).toHaveLength(1);
  });

  it('flags stale and fresh datasets correctly', () => {
    const fresh = assessStaleness(asRows(ds.leads), NOW, 24 * 14);
    expect(fresh.stale).toBe(false);
    const stale = assessStaleness(asRows(ds.leads), NOW, 24);
    expect(stale.stale).toBe(true);
    expect(assessStaleness([], NOW, 24).stale).toBe(true);
  });
});

describe('recommendation rules over fixtures', () => {
  it('is deterministic and produces the expected kinds', () => {
    const a = generateRecommendations(recommendationInputs());
    const b = generateRecommendations(recommendationInputs());
    expect(a).toEqual(b);
    const kinds = new Set(a.map((r) => r.kind));
    // Brownstone: install tentative with site not ready + LPC open.
    expect(kinds.has('installation_risk')).toBe(true);
    // LPC property without completed permit_lpc milestone.
    expect(kinds.has('missing_document')).toBe(true);
    // Both fixture versions carry zero markup margin.
    expect(kinds.has('margin_anomaly')).toBe(true);
    // Open quotes older than 3 days (T2/T3 vs NOW).
    expect(kinds.has('quote_follow_up')).toBe(true);
    // Deposit collected, balance open, order in production.
    expect(kinds.has('missing_payment')).toBe(true);
    // Expected ship date is in the future - no delayed order.
    expect(kinds.has('delayed_order')).toBe(false);
  });

  it('every recommendation requires approval and has evidence', () => {
    const recs = generateRecommendations(recommendationInputs());
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.approval_required).toBe(true);
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.suggested_next_step.length).toBeGreaterThan(0);
      expect(r.idempotency_key).toBe(`rec:${r.kind}:${r.entity_id}`);
    }
  });

  it('fires delayed_order once the expected ship date passes', () => {
    const inputs = recommendationInputs();
    inputs.nowIso = '2026-08-20T12:00:00.000Z';
    const recs = generateRecommendations(inputs);
    expect(recs.some((r) => r.kind === 'delayed_order')).toBe(true);
  });
});
