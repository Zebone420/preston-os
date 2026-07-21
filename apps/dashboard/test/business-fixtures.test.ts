import { describe, expect, it } from 'vitest';
import {
  brownstoneCalc,
  buildFixtureDataset,
  loftCalc,
} from '../src/lib/business/fixtures';
import { calculateQuote } from '../src/lib/business/quote-engine';
import {
  brownstoneQuoteInput,
  loftQuoteInput,
} from '../src/lib/business/fixtures';

const ds = buildFixtureDataset();

describe('business fixtures - engine consistency', () => {
  it('quote versions carry engine-computed numbers exactly', () => {
    const bv = ds.quoteVersions.find(
      (v) => v.correlation_id === 'fixture:quote:brownstone:v1',
    )!;
    expect(bv.total_cents).toBe(brownstoneCalc.total_cents);
    expect(bv.tax_cents).toBe(brownstoneCalc.tax_cents);
    expect(bv.subtotal_cents).toBe(brownstoneCalc.subtotal_cents);
    const lv = ds.quoteVersions.find(
      (v) => v.correlation_id === 'fixture:quote:loft:v1',
    )!;
    expect(lv.total_cents).toBe(loftCalc.total_cents);
    // Recomputing from the stored input reproduces the version.
    expect(calculateQuote(brownstoneQuoteInput).total_cents).toBe(
      bv.total_cents,
    );
    expect(calculateQuote(loftQuoteInput).total_cents).toBe(
      lv.total_cents,
    );
  });

  it('deposit payment equals the first 50/25/25 stage', () => {
    const dep = ds.paymentEvents[0];
    expect(dep.amount_cents).toBe(
      brownstoneCalc.payment_schedule.stages[0].amount_cents,
    );
  });
});

describe('business fixtures - labeling and safety', () => {
  it('every record with provenance is labeled as fixture data', () => {
    const withProvenance = [
      ...ds.clients,
      ...ds.properties,
      ...ds.leads,
      ...ds.quotes,
      ...ds.projects,
      ...ds.vendorOrders,
    ];
    for (const rec of withProvenance) {
      expect(rec.provenance).toMatchObject({ fixture: true });
      expect(rec.source === 'fixture' || rec.source === 'agent_simulation')
        .toBe(true);
    }
  });

  it('no communication is ever in a sent state', () => {
    for (const c of ds.communications) {
      expect(['draft', 'received', 'logged']).toContain(
        c.message_state,
      );
      expect(['inbound', 'outbound_draft']).toContain(c.direction);
    }
  });

  it('agent outputs are simulation-only and never executable', () => {
    for (const run of ds.quoteDraftRuns) {
      expect(run.simulation_only).toBe(true);
      expect(run.execution_eligible).toBe(false);
    }
    for (const v of ds.quoteVersions) {
      expect(v.simulation_state).toBe('simulation');
      expect(v.owner_confirmation_required).toBe(true);
    }
    for (const r of ds.recommendations) {
      expect(r.approval_required).toBe(true);
    }
  });
});

describe('business fixtures - referential integrity', () => {
  it('all foreign references resolve inside the dataset', () => {
    const clientIds = new Set(ds.clients.map((c) => c.id));
    const propertyIds = new Set(ds.properties.map((p) => p.id));
    const quoteIds = new Set(ds.quotes.map((q) => q.id));
    const versionIds = new Set(ds.quoteVersions.map((v) => v.id));
    const projectIds = new Set(ds.projects.map((p) => p.id));

    for (const l of ds.leads) {
      if (l.client_id) expect(clientIds.has(l.client_id)).toBe(true);
      if (l.property_id) {
        expect(propertyIds.has(l.property_id)).toBe(true);
      }
    }
    for (const q of ds.quotes) {
      expect(clientIds.has(q.client_id)).toBe(true);
      if (q.project_id) expect(projectIds.has(q.project_id)).toBe(true);
    }
    for (const v of ds.quoteVersions) {
      expect(quoteIds.has(v.quote_id)).toBe(true);
    }
    for (const it of ds.quoteItems) {
      expect(versionIds.has(it.quote_version_id)).toBe(true);
    }
    for (const m of ds.milestones) {
      expect(projectIds.has(m.project_id)).toBe(true);
    }
    for (const o of ds.vendorOrders) {
      expect(projectIds.has(o.project_id)).toBe(true);
    }
    for (const run of ds.quoteDraftRuns) {
      if (run.quote_id) expect(quoteIds.has(run.quote_id)).toBe(true);
      if (run.quote_version_id) {
        expect(versionIds.has(run.quote_version_id)).toBe(true);
      }
    }
  });

  it('idempotency keys are unique across the dataset', () => {
    const keys = [
      ...ds.paymentEvents.map((p) => p.idempotency_key),
      ...ds.recommendations.map((r) => r.idempotency_key),
      ...ds.quoteDraftRuns.map((r) => r.idempotency_key),
      ...ds.activityEvents.map((a) => a.idempotency_key),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
