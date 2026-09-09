// Phase 3 - INTERNAL capabilities on the deterministic business runner:
// proposal.document.render, vendor.quote.parse, vendor.quote.reconcile,
// iqplus.report.ingest.

import { describe, expect, it } from 'vitest';
import {
  checkQuoteReconciles,
  formatCents,
  renderProposal,
} from '../src/lib/ai-os/capabilities/business/proposal-render';
import {
  moneyToCents,
  parseVendorQuoteText,
} from '../src/lib/ai-os/capabilities/business/vendor-quote-parse';
import {
  reconcileVendorQuote,
} from '../src/lib/ai-os/capabilities/business/vendor-quote-reconcile';
import { ingestIqplusReport } from '../src/lib/ai-os/capabilities/business/iqplus-ingest';
import { ProposalRenderParamsSchema } from '../src/lib/ai-os/capabilities/business/schemas';
import {
  CLIENT_EMAIL,
  HD_QUOTE_TEXT,
  IQ_REPORT_TEXT,
  PROJECT,
  QUOTE,
  REQUESTED_SPEC,
  VENDOR_LINES,
  describeCapabilityMatrix,
  execValid,
  iqplusParams,
  makeFakeDb,
  proposalParams,
  reconcileParams,
  vendorParseParams,
  type MatrixSpec,
} from './business-capability-harness.test';

// --- proposal.document.render ----------------------------------------------

const badLine = { ...QUOTE, line_items: [
  { ...QUOTE.line_items[0], line_total_cents: 246913 }, QUOTE.line_items[1]] };

const PROPOSAL_SPEC: MatrixSpec = {
  capability: 'proposal.document.render',
  approval_class: 'INTERNAL',
  risk_class: 'GREEN',
  operation_kind: 'write',
  valid: () => proposalParams(),
  schemaInvalid: [
    { name: 'unknown template', reason: 'schema_invalid:template_id',
      params: proposalParams({ template_id: 'proposal_v9' }) },
    { name: 'non-USD currency', reason: 'schema_invalid:quote.currency',
      params: proposalParams({ quote: { ...QUOTE, currency: 'EUR' } }) },
    { name: 'fractional cents', reason: 'schema_invalid:quote.total_cents',
      params: proposalParams({ quote: { ...QUOTE, total_cents: 1.5 } }) },
    { name: 'no line items', reason: 'schema_invalid:quote.line_items',
      params: proposalParams({ quote: { ...QUOTE, line_items: [] } }) },
  ],
  negatives: [
    { name: 'line total does not reconcile', reason: 'totals_not_reconciled:line:1',
      params: proposalParams({ quote: badLine }) },
    { name: 'subtotal does not reconcile', reason: 'totals_not_reconciled:subtotal',
      params: proposalParams({ quote: { ...QUOTE, subtotal_cents: 345613 } }) },
    { name: 'total does not reconcile (wrong tax policy)', reason: 'totals_not_reconciled:total',
      params: proposalParams({ quote: { ...QUOTE, tax_cents: 0 } }) },
    { name: 'duplicate line numbers', reason: 'line_numbers_not_unique',
      params: proposalParams({ quote: { ...QUOTE,
        line_items: [QUOTE.line_items[0], { ...QUOTE.line_items[1], line_no: 1 }],
        subtotal_cents: 345612 } }) },
  ],
};

describeCapabilityMatrix(PROPOSAL_SPEC);

describe('proposal.document.render - deterministic render', () => {
  it('renders a versioned descriptor with a canonical filename and content hash', () => {
    const p = ProposalRenderParamsSchema.parse(proposalParams());
    const a = renderProposal(p);
    const b = renderProposal(p);
    expect(a).toEqual(b);
    expect(a.descriptor.filename).toBe(`${PROJECT}_PROPOSAL_CLIENT_V01.txt`);
    expect(a.descriptor.document_type).toBe('proposal');
    expect(a.descriptor.version).toBe(1);
    expect(a.descriptor.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.descriptor.total_cents).toBe(376285);
    expect(a.rendered_text).toContain('Total: $3,762.85');
    expect(a.rendered_text).toContain('TW3046');
    expect(a.rendered_text).not.toMatch(/deposit|50 ?\/ ?25|payment/i);
  });
  it('a new version changes the descriptor id and filename', () => {
    const v1 = renderProposal(ProposalRenderParamsSchema.parse(proposalParams()));
    const v2 = renderProposal(ProposalRenderParamsSchema.parse(
      proposalParams({ quote: { ...QUOTE, version: 2 } })));
    expect(v2.descriptor.document_id).not.toBe(v1.descriptor.document_id);
    expect(v2.descriptor.filename).toBe(`${PROJECT}_PROPOSAL_CLIENT_V02.txt`);
  });
  it('never recomputes: only compares the input arithmetic', () => {
    expect(checkQuoteReconciles(QUOTE)).toBeNull();
    expect(checkQuoteReconciles(badLine)).toBe('totals_not_reconciled:line:1');
    expect(formatCents(376285)).toBe('$3,762.85');
    expect(formatCents(5)).toBe('$0.05');
  });
  it('the runner output carries descriptor + text and binds the amount', async () => {
    const db = makeFakeDb();
    const { res } = await execValid(db, PROPOSAL_SPEC);
    expect(res.ok).toBe(true);
    const d = res.output?.descriptor as Record<string, unknown>;
    expect(d.filename).toBe(`${PROJECT}_PROPOSAL_CLIENT_V01.txt`);
    expect(String(res.output?.rendered_text)).toContain('PROPOSAL P26-0041 V01');
    expect((res.output?.canonical as Record<string, unknown>).total_cents).toBe(376285);
  });
});

// --- vendor.quote.parse ------------------------------------------------------

const PARSE_SPEC: MatrixSpec = {
  capability: 'vendor.quote.parse',
  approval_class: 'INTERNAL',
  risk_class: 'GREEN',
  operation_kind: 'read',
  valid: () => vendorParseParams(),
  schemaInvalid: [
    { name: 'missing source hash', reason: 'schema_invalid:source.sha256',
      params: vendorParseParams({ source: { document_id: 'doc-hd-quote-1', sha256: 'x' } }) },
    { name: 'empty text', reason: 'schema_invalid:quote_text',
      params: vendorParseParams({ quote_text: '' }) },
    { name: 'oversized text', reason: 'schema_invalid:quote_text',
      params: vendorParseParams({ quote_text: 'x'.repeat(6001) }) },
  ],
  negatives: [],
};

describeCapabilityMatrix(PARSE_SPEC);

describe('vendor.quote.parse - Home Depot fixture', () => {
  it('parses header, blocks, line items with spec fields, and totals', () => {
    const q = parseVendorQuoteText(HD_QUOTE_TEXT);
    expect(q.vendor).toBe('home_depot');
    expect(q.quote_number).toBe('H1256-471919');
    expect(q.case_number).toBe('04512345');
    expect(q.quote_date).toBe('06/12/2026');
    expect(q.revision).toBe('V2');
    expect(q.sold_to[0]).toBe('Preston Windows and Doors');
    expect(q.ship_to.length).toBe(3);
    expect(q.line_items.length).toBe(2);
    expect(q.line_items[0]).toEqual({
      line_no: 1, qty: 2, description: 'Andersen 400 Series Woodwright Double-Hung',
      unit_price_cents: 123456, ext_price_cents: 246912,
      spec: { unit: 'TW3046', size: '36 x 54', color: 'White', glass: 'Low-E4',
        grille: 'Colonial' },
    });
    expect(q.totals).toEqual({ subtotal_cents: 345612, tax_cents: 30673, total_cents: 376285 });
    expect(q.warnings).toEqual(['ship_to_differs_from_sold_to']);
    expect(q.contact_leakage).toBe(false);
  });
  it('is deterministic and never recomputes (mismatches become warnings)', () => {
    expect(parseVendorQuoteText(HD_QUOTE_TEXT)).toEqual(parseVendorQuoteText(HD_QUOTE_TEXT));
    const wrong = HD_QUOTE_TEXT.replace('Ext $2,469.12', 'Ext $2,469.13')
      .replace('Total: $3,762.85', 'Total: $3,000.00');
    const q = parseVendorQuoteText(wrong);
    expect(q.line_items[0].ext_price_cents).toBe(246913);
    expect(q.warnings).toContain('line_ext_mismatch:1');
    expect(q.warnings).toContain('subtotal_mismatch');
    expect(q.warnings).toContain('total_mismatch');
  });
  it('flags client contact leakage in Ship-To and Sold-To', () => {
    const contacts = [{ name: 'Jane Example', phone: '917-555-0123', email: CLIENT_EMAIL }];
    const leaked = HD_QUOTE_TEXT.replace(
      'Ship To:\nPreston Windows and Doors', 'Ship To:\nJane Example\nPhone: 917-555-0123');
    const q = parseVendorQuoteText(leaked, contacts);
    expect(q.contact_leakage).toBe(true);
    expect(q.warnings).toContain('client_contact_leakage:ship_to');
    expect(q.warnings).not.toContain('client_contact_leakage:sold_to');
    const soldLeak = HD_QUOTE_TEXT.replace('Phone: 718-555-0100', `Email: ${CLIENT_EMAIL}`);
    expect(parseVendorQuoteText(soldLeak, contacts).warnings)
      .toContain('client_contact_leakage:sold_to');
  });
  it('unknown vendors and unparsable lines degrade to warnings, never throws', () => {
    const q = parseVendorQuoteText('ACME QUOTE\nLine Items:\nsomething odd\n');
    expect(q.vendor).toBe('unknown');
    expect(q.warnings).toContain('quote_number_missing');
    expect(q.warnings).toContain('unparsed_line:3');
    expect(q.warnings).toContain('no_line_items');
    expect(q.warnings).toContain('totals_missing');
    expect(moneyToCents('1,234.56')).toBe(123456);
    expect(moneyToCents('abc')).toBeNull();
  });
  it('the runner output carries the parsed quote', async () => {
    const db = makeFakeDb();
    const { res } = await execValid(db, PARSE_SPEC);
    expect(res.ok).toBe(true);
    const vq = res.output?.vendor_quote as Record<string, unknown>;
    expect(vq.quote_number).toBe('H1256-471919');
    expect((vq.line_items as unknown[]).length).toBe(2);
  });
});

// --- vendor.quote.reconcile --------------------------------------------------

const RECONCILE_SPEC: MatrixSpec = {
  capability: 'vendor.quote.reconcile',
  approval_class: 'INTERNAL',
  risk_class: 'GREEN',
  operation_kind: 'read',
  valid: () => reconcileParams(),
  schemaInvalid: [
    { name: 'unknown spec source', reason: 'schema_invalid:requested_spec.source',
      params: reconcileParams({ requested_spec: { ...REQUESTED_SPEC, source: 'guess' } }) },
    { name: 'spec without lines', reason: 'schema_invalid:requested_spec.lines',
      params: reconcileParams({ requested_spec: { ...REQUESTED_SPEC, lines: [] } }) },
    { name: 'vendor line without spec', reason: 'schema_invalid:vendor_quote.line_items.0.spec',
      params: reconcileParams({ vendor_quote:
        { quote_number: 'H1', line_items: [{ line_no: 1, qty: 1 }] } }) },
  ],
  negatives: [],
};

describeCapabilityMatrix(RECONCILE_SPEC);

describe('vendor.quote.reconcile - line by line', () => {
  type VendorQuote = Parameters<typeof reconcileVendorQuote>[0];
  const vendor: VendorQuote = {
    quote_number: 'H1256-471919',
    line_items: VENDOR_LINES,
  };
  const spec = REQUESTED_SPEC as Parameters<typeof reconcileVendorQuote>[1];
  it('reconciles a matching quote with zero diffs', () => {
    const r = reconcileVendorQuote(vendor, spec);
    expect(r).toEqual({ result: 'reconciled', compared_lines: 2, diffs: [] });
  });
  it('itemizes SKU, qty, size, option mismatches, missing options and lines', () => {
    const drifted: VendorQuote = {
      quote_number: 'H1256-471919',
      line_items: [
        { line_no: 1, qty: 3, spec: { unit: 'TW3042', size: '36 x 50', color: 'Sandtone',
          glass: 'Low-E4' } },
        { line_no: 3, qty: 1, spec: { unit: 'AW31', size: '30 x 30' } },
      ],
    };
    const r = reconcileVendorQuote(drifted, spec);
    expect(r.result).toBe('reconciliation_failed');
    expect(r.compared_lines).toBe(1);
    expect(r.diffs).toEqual([
      { line_no: 1, kind: 'sku_mismatch', key: null, expected: 'TW3046', actual: 'TW3042' },
      { line_no: 1, kind: 'qty_mismatch', key: null, expected: '2', actual: '3' },
      { line_no: 1, kind: 'size_mismatch', key: null, expected: '36 x 54', actual: '36 x 50' },
      { line_no: 1, kind: 'option_mismatch', key: 'color', expected: 'White',
        actual: 'Sandtone' },
      { line_no: 1, kind: 'option_missing', key: 'grille', expected: 'Colonial', actual: null },
      { line_no: 2, kind: 'missing_line', key: null, expected: 'CW24', actual: null },
      { line_no: 3, kind: 'extra_line', key: null, expected: null, actual: 'AW31' },
    ]);
  });
  it('ANY single mismatch fails reconciliation (case/whitespace are not mismatches)', () => {
    const relaxed = { ...vendor, line_items: [
      { ...VENDOR_LINES[0], spec: { ...VENDOR_LINES[0].spec, color: '  white ' } },
      VENDOR_LINES[1]] };
    expect(reconcileVendorQuote(relaxed, spec).result).toBe('reconciled');
    const one = { ...vendor, line_items: [
      { ...VENDOR_LINES[0], spec: { ...VENDOR_LINES[0].spec, glass: 'Low-E4 SmartSun' } },
      VENDOR_LINES[1]] };
    const r = reconcileVendorQuote(one, spec);
    expect(r.result).toBe('reconciliation_failed');
    expect(r.diffs.length).toBe(1);
    expect(r.diffs[0].kind).toBe('option_mismatch');
  });
  it('the runner output carries the reconciliation report', async () => {
    const db = makeFakeDb();
    const { res } = await execValid(db, RECONCILE_SPEC);
    expect(res.ok).toBe(true);
    expect((res.output?.reconciliation as Record<string, unknown>).result).toBe('reconciled');
    const db2 = makeFakeDb();
    const failing = { ...RECONCILE_SPEC, valid: () => reconcileParams({
      vendor_quote: { quote_number: 'H1', line_items: [VENDOR_LINES[0]] } }) };
    const bad = await execValid(db2, failing);
    expect(bad.res.ok).toBe(true); // the READ succeeded; the finding is data
    const rep = bad.res.output?.reconciliation as Record<string, unknown>;
    expect(rep.result).toBe('reconciliation_failed');
    expect((rep.diffs as unknown[]).length).toBe(1);
  });
});

// --- iqplus.report.ingest ----------------------------------------------------

const INGEST_SPEC: MatrixSpec = {
  capability: 'iqplus.report.ingest',
  approval_class: 'INTERNAL',
  risk_class: 'GREEN',
  operation_kind: 'read',
  valid: () => iqplusParams(),
  schemaInvalid: [
    { name: 'missing source', reason: 'schema_invalid:source',
      params: iqplusParams({ source: undefined }) },
    { name: 'empty report', reason: 'schema_invalid:report_text',
      params: iqplusParams({ report_text: '' }) },
    { name: 'malformed client contact', reason: 'schema_invalid:client_contacts.0.email',
      params: iqplusParams({ client_contacts: [{ email: 'nope' }] }) },
  ],
  negatives: [
    { name: 'unrecognized report', reason: 'report_unrecognized',
      params: iqplusParams({ report_text: 'HOME DEPOT QUOTE\nLine Items:\n' }) },
    { name: 'client contact leaked outside contact fields', reason: 'client_contact_leakage',
      params: iqplusParams({ report_text:
        IQ_REPORT_TEXT.replace('Opening 1: Kitchen', 'Opening 1: Jane Example kitchen') }) },
  ],
};

describeCapabilityMatrix(INGEST_SPEC);

describe('iqplus.report.ingest - openings and units, no prices, no contacts', () => {
  it('parses openings/units/spec/qty, strips contact fields, drops prices', () => {
    const r = ingestIqplusReport(IQ_REPORT_TEXT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.quote_number).toBe('IQ-2026-000123');
    expect(r.report.version).toBe(2);
    expect(r.report.project_ref).toBe(PROJECT);
    expect(r.report.openings.length).toBe(2);
    expect(r.report.openings[0]).toEqual({
      opening_no: 1, label: 'Kitchen',
      units: [{ unit_no: 1, description: '400 Series Woodwright Double-Hung TW3046',
        sku: 'TW3046', qty: 2,
        spec: { size: '36 x 54', color: 'White', glass: 'Low-E4', grille: 'Colonial' } }],
    });
    expect(r.report.openings[1].units[0].sku).toBe('CW24');
    expect(r.report.stripped_fields).toEqual(['customer', 'email', 'phone']);
    expect(r.report.warnings).toEqual(['price_fields_dropped:1']);
    const text = JSON.stringify(r.report);
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('917-555');
    expect(text).not.toContain(CLIENT_EMAIL);
    expect(text).not.toContain('$');
  });
  it('is deterministic', () => {
    expect(ingestIqplusReport(IQ_REPORT_TEXT)).toEqual(ingestIqplusReport(IQ_REPORT_TEXT));
  });
  it('refuses when a known client contact survives outside the stripped fields', () => {
    const leaked = IQ_REPORT_TEXT.replace(
      'Opening 2: Living Room', 'Opening 2: call 917-555-0123');
    expect(ingestIqplusReport(leaked, [{ phone: '917-555-0123' }]))
      .toEqual({ ok: false, reason: 'client_contact_leakage' });
  });
  it('the runner output carries the contact-free report', async () => {
    const db = makeFakeDb();
    const { res } = await execValid(db, INGEST_SPEC);
    expect(res.ok).toBe(true);
    const rep = res.output?.report as Record<string, unknown>;
    expect((rep.openings as unknown[]).length).toBe(2);
    expect(rep.stripped_fields).toEqual(['customer', 'email', 'phone']);
    expect(JSON.stringify(res.output)).not.toContain('Jane Example');
  });
});
