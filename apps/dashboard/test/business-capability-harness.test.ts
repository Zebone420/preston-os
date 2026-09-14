// Phase 3 (Safe Business Capability Foundation) - shared test harness for
// the business-capability-*.test.ts suite. Exports the in-memory fake DB
// (same idiom as capability-spine.test.ts, plus a system_controls row),
// deterministic fixtures (example.com recipients ONLY), request/approval
// builders, and `describeCapabilityMatrix`, which registers the standard
// per-capability matrix: contract, schema, authorization, negatives,
// idempotency, replay, sandbox proof, kill/disable.
//
// This file is imported by the other suites; its own self-check tests are
// registered only when vitest collects THIS file (testPath guard) so they
// do not re-run under every importer.

import { describe, expect, it } from 'vitest';
import type { RuntimeClient } from '../src/lib/ai-os/store';
import type { SystemControls } from '../src/lib/ai-os/controls';
import {
  executeCapability,
  type CapabilityAdapter,
  type CapabilityExecutorDeps,
} from '../src/lib/ai-os/capabilities/executor';
import { lookupCapability } from '../src/lib/ai-os/capabilities/registry';
import {
  deriveSideEffectId,
  payloadHash,
  sideEffectApprovalHash,
  validateCapabilityRequest,
  type CapabilityRequest,
} from '../src/lib/ai-os/capabilities/contract';
import {
  makeBusinessAdapters,
  makeBusinessExecutorDeps,
} from '../src/lib/ai-os/capabilities/business/compose';
import { deriveBusinessIdempotencyKey } from '../src/lib/ai-os/capabilities/business/replay';
import { approvalBindingHash } from '../src/lib/ai-os/capabilities/business/stale-approval';
import {
  makeNoCredentialBroker,
} from '../src/lib/ai-os/capabilities/providers/sandbox-credentials';
import type { CredentialBroker } from '../src/lib/ai-os/capabilities/credentials';
import type {
  ProposalRenderParams,
  VendorQuoteReconcileParams,
} from '../src/lib/ai-os/capabilities/business/schemas';

export const NOW = '2026-09-08T12:00:00.000Z';
export const nowMs = Date.parse(NOW);
export const OWNER = 'owner@example.com';
export const ACTOR = 'preston-worker';
export const PROJECT = 'P26-0041';
export const OTHER_PROJECT = 'P26-0099';
export const SHA_A = '0123456789abcdef'.repeat(4);
export const SHA_B = 'fedcba9876543210'.repeat(4);

const CONTROLS_ACTIVE = {
  id: 'global', execution_enabled: true, owner_stop: false, paused: false,
  hermes_mode: 'observe_only', remote_runner_enabled: false, updated_at: NOW,
};

export interface FakeDb {
  client: RuntimeClient;
  rowsOf: (t: string) => Record<string, unknown>[];
  touched: string[];
}

// side_effects keys on side_effect_id + unique idempotency_key (migration
// 0026); system_controls is a singleton row (null => no row at all).
export function makeFakeDb(opts: {
  failInsertOn?: Set<string>;
  controls?: Partial<SystemControls> | null;
} = {}): FakeDb {
  const tables = new Map<string, Record<string, unknown>[]>();
  const touched: string[] = [];
  const rowsOf = (t: string) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  if (opts.controls !== null) {
    rowsOf('system_controls').push({ ...CONTROLS_ACTIVE, ...(opts.controls ?? {}) });
  }
  const pk = (t: string) =>
    t === 'orchestration_approvals' ? 'approval_id'
      : t === 'side_effects' ? 'side_effect_id' : 'id';
  const dup = { data: null, error: { message: 'duplicate key unique constraint' } };
  const client: RuntimeClient = {
    from(table: string) {
      touched.push(table);
      return {
        insert(row: Record<string, unknown>) {
          return { select() {
            if (opts.failInsertOn?.has(table)) {
              return Promise.resolve({ data: null, error: { message: 'unavailable' } });
            }
            const rows = rowsOf(table); const key = pk(table);
            if (row[key] !== undefined && rows.some((r) => r[key] === row[key])) {
              return Promise.resolve(dup);
            }
            if (table === 'side_effects' &&
                rows.some((r) => r.idempotency_key === row.idempotency_key)) {
              return Promise.resolve(dup);
            }
            rows.push({ ...row });
            return Promise.resolve({ data: [{ [key]: row[key] ?? 'x' }], error: null });
          } };
        },
        select() {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            order() { return { limit(n: number) {
              return Promise.resolve({
                data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n),
                error: null });
            } }; },
            limit(n: number) {
              return Promise.resolve({
                data: rowsOf(table).filter((r) => f.every((g) => g(r))).slice(0, n),
                error: null });
            },
          });
          return chain([]);
        },
        update(patch: Record<string, unknown>) {
          const chain = (f: Array<(r: Record<string, unknown>) => boolean>) => ({
            eq(c: string, v: string) { return chain([...f, (r) => String(r[c]) === v]); },
            lte() { return chain(f); }, gt() { return chain(f); },
            select() {
              const matched = rowsOf(table).filter((r) => f.every((g) => g(r)));
              for (const r of matched) Object.assign(r, patch);
              return Promise.resolve({
                data: matched.map((r) => ({ [pk(table)]: r[pk(table)] })), error: null });
            },
          });
          return chain([]);
        },
      };
    },
  };
  return { client, rowsOf, touched };
}

// Counting wrappers around the business sandbox adapters: the core proof
// is "adapter invocations" (1 maximum per side effect; 0 on refusal).
export function makeCountingAdapters(broker: CredentialBroker) {
  let calls = 0;
  const base = makeBusinessAdapters(broker);
  const adapters: Record<string, CapabilityAdapter> = {};
  for (const [provider, adapter] of Object.entries(base)) {
    adapters[provider] = {
      async execute(input) { calls++; return adapter.execute(input); },
    };
  }
  return { adapters, calls: () => calls };
}

export interface Harness {
  deps: CapabilityExecutorDeps;
  calls: () => number;
  broker: CredentialBroker;
}

export function makeHarness(
  db: FakeDb,
  over: Partial<CapabilityExecutorDeps> & { broker?: CredentialBroker } = {},
): Harness {
  const broker = over.broker ?? makeNoCredentialBroker();
  const counting = makeCountingAdapters(broker);
  const deps = makeBusinessExecutorDeps({
    client: db.client,
    actorId: ACTOR,
    ownerIdentity: OWNER,
    now: () => nowMs,
    readApproval: async (_c, id) =>
      db.rowsOf('orchestration_approvals').find((r) => r.approval_id === id),
    broker,
  });
  const merged: CapabilityExecutorDeps = { ...deps, adapters: counting.adapters, ...over };
  return { deps: merged, calls: counting.calls, broker };
}

export function request(
  capability: string,
  params: Record<string, unknown>,
  over: Partial<CapabilityRequest> = {},
): CapabilityRequest {
  return {
    capability,
    version: 1,
    target: `${capability}:${String(params.project_id ?? PROJECT)}`,
    params,
    goal_id: 'goal-biz-0001',
    job_id: 'job-biz-0001',
    run_id: 'run-biz-0001',
    request_id: 'req-biz-0001',
    idempotency_key: deriveBusinessIdempotencyKey({
      capability,
      project_id: String(params.project_id ?? PROJECT),
      payload_hash: payloadHash(params),
    }),
    ...over,
  };
}

// Seeds an owner approval bound to the request: canonical action hash
// (existing spine binding) + Phase 3 field-level binding_hash.
export function seedApproval(
  db: FakeDb,
  req: CapabilityRequest,
  approvalId: string,
  opts: {
    expiresAt?: string;
    bindingHash?: string | null; // null => omit the binding entirely
    status?: string;
    owner?: string;
  } = {},
): void {
  const lookup = lookupCapability(req.capability, req.version);
  if (!lookup.ok) throw new Error('bad capability in fixture');
  const v = validateCapabilityRequest(req);
  if (!v.ok) throw new Error('bad request in fixture');
  const def = lookup.definition;
  const created = NOW;
  const expires = opts.expiresAt ?? new Date(nowMs + 3_600_000).toISOString();
  const pv = def.validate_params ? def.validate_params(req.params) : null;
  const binding = pv && pv.ok ? pv.binding
    : { project_id: null, document_hash: null, amount: null, recipient: null };
  const computedBinding = approvalBindingHash({
    actor: ACTOR, action: def.name, payload_hash: v.payload_hash, ...binding,
  });
  const row: Record<string, unknown> = {
    approval_id: approvalId,
    status: opts.status ?? 'approved',
    owner_identity: opts.owner ?? OWNER,
    environment: 'staging',
    nonce: 'n-biz-1',
    decided_at: NOW,
    created_at: created,
    expires_at: expires,
    action_hash: sideEffectApprovalHash({
      approval_id: approvalId,
      definition: def,
      side_effect_id: deriveSideEffectId(req.idempotency_key),
      target: req.target,
      payload_hash: v.payload_hash,
      owner_identity: opts.owner ?? OWNER,
      created_at: created,
      expires_at: expires,
    }),
  };
  if (opts.bindingHash !== null) row.binding_hash = opts.bindingHash ?? computedBinding;
  db.rowsOf('orchestration_approvals').push(row);
}

// --- fixtures ---------------------------------------------------------------

export const ALIASES = [
  { mailbox_identity: 'sales', email: 'sales@example.com', role: 'sales',
    active: true, canonical_sender: true,
    allowed_send_classes: ['client', 'internal', 'owner'] },
  { mailbox_identity: 'orders', email: 'orders@example.com', role: 'purchasing',
    active: true, canonical_sender: false,
    allowed_send_classes: ['vendor', 'internal'] },
  { mailbox_identity: 'legacy', email: 'legacy@example.com', role: 'legacy',
    active: false, canonical_sender: false, allowed_send_classes: ['client'] },
];

export const CLIENT_EMAIL = 'jane.client@example.com';
export const VENDOR_EMAIL = 'quotes.vendor@example.com';

export const ALLOWLIST = [
  { email: CLIENT_EMAIL, class: 'client', name: 'Jane Example',
    phone: '917-555-0123', project_id: PROJECT },
  { email: VENDOR_EMAIL, class: 'vendor', name: 'Vendor Desk' },
  { email: 'ops@example.com', class: 'internal' },
  { email: 'owner@example.com', class: 'owner' },
  { email: 'other.client@example.com', class: 'client', project_id: OTHER_PROJECT },
];

export const MANIFEST = [
  { document_id: 'doc-proposal-1', sha256: SHA_A, size_bytes: 1024,
    mime: 'application/pdf', filename: `${PROJECT}_PROPOSAL_CLIENT_V01.pdf` },
  { document_id: 'doc-spec-1', sha256: SHA_B, size_bytes: 2048,
    mime: 'application/pdf', filename: `${PROJECT}_VENDOR_HOMEDEPOT_SPEC_V01.pdf` },
];

export const ATTACHMENT_RAW = {
  ...MANIFEST[0],
  author: 'Somebody', title: 'Proposal draft', exif_gps: '40.7,-73.9',
  producer: 'Word', created_by: 'x',
};

export function gmailDraftParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    sender: { mailbox_identity: 'sales' },
    sender_aliases: ALIASES,
    recipient_allowlist: ALLOWLIST,
    to: [CLIENT_EMAIL],
    cc: ['ops@example.com'],
    subject: `Proposal ${PROJECT} V01`,
    body_text: 'Hello, please find the proposal attached. Regards, Preston.',
    attachments: [ATTACHMENT_RAW],
    attachment_manifest: MANIFEST,
    ...over,
  };
}

export function calendarParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    project_identity: { project_id: PROJECT, human_project_id: PROJECT, confirmed: true },
    title: `Final measure ${PROJECT}`,
    start: '2026-09-15T14:00:00.000Z',
    end: '2026-09-15T15:00:00.000Z',
    attendees: [CLIENT_EMAIL, 'ops@example.com'],
    recipient_allowlist: ALLOWLIST,
    location: '123 Example St, Brooklyn NY',
    description: 'Final measurement visit.',
    ...over,
  };
}

export function driveParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    folder_binding: {
      project_id: PROJECT, folder_id: 'folder_0041_abc', path: '/P26-0041/02_Proposals',
    },
    document: {
      document_id: 'doc-proposal-1',
      filename: `${PROJECT}_PROPOSAL_CLIENT_V01.pdf`,
      sha256: SHA_A, size_bytes: 1024, mime: 'application/pdf', version: 1,
    },
    operation: 'create',
    ...over,
  };
}

export const QUOTE: ProposalRenderParams['quote'] = {
  quote_id: 'quote-0041-v1',
  version: 1,
  currency: 'USD',
  line_items: [
    { line_no: 1, description: 'Andersen 400 Woodwright DH TW3046', qty: 2,
      unit_price_cents: 123456, line_total_cents: 246912 },
    { line_no: 2, description: 'Andersen 400 Casement CW24', qty: 1,
      unit_price_cents: 98700, line_total_cents: 98700 },
  ],
  subtotal_cents: 345612,
  tax_cents: 30673,
  total_cents: 376285,
};

export function proposalParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { project_id: PROJECT, template_id: 'proposal_v1', quote: QUOTE, ...over };
}

export const HD_QUOTE_TEXT = [
  'THE HOME DEPOT - SPECIAL ORDER QUOTE',
  'Quote #: H1256-471919',
  'Case #: 04512345',
  'Quote Date: 06/12/2026',
  'Revision: V2',
  '',
  'Sold To:',
  'Preston Windows and Doors',
  '123 Example St',
  'Brooklyn NY 11201',
  'Phone: 718-555-0100',
  '',
  'Ship To:',
  'Preston Windows and Doors',
  '123 Example St',
  'Brooklyn NY 11201',
  '',
  'Line Items:',
  '1 | Qty 2 | Andersen 400 Series Woodwright Double-Hung | Unit $1,234.56 | Ext $2,469.12',
  '  Unit: TW3046 | Size: 36 x 54 | Color: White | Glass: Low-E4 | Grille: Colonial',
  '2 | Qty 1 | Andersen 400 Series Casement | Unit $987.00 | Ext $987.00',
  '  Unit: CW24 | Size: 24 x 48 | Color: Sandtone | Glass: Low-E4 SmartSun',
  '',
  'Subtotal: $3,456.12',
  'Tax: $306.73',
  'Total: $3,762.85',
].join('\n');

export function vendorParseParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    source: { document_id: 'doc-hd-quote-1', sha256: SHA_B },
    quote_text: HD_QUOTE_TEXT,
    client_contacts: [{ name: 'Jane Example', phone: '917-555-0123', email: CLIENT_EMAIL }],
    ...over,
  };
}

export const VENDOR_LINES: VendorQuoteReconcileParams['vendor_quote']['line_items'] = [
  { line_no: 1, qty: 2, spec: { unit: 'TW3046', size: '36 x 54', color: 'White',
    glass: 'Low-E4', grille: 'Colonial' } },
  { line_no: 2, qty: 1, spec: { unit: 'CW24', size: '24 x 48', color: 'Sandtone',
    glass: 'Low-E4 SmartSun' } },
];

export const REQUESTED_SPEC: VendorQuoteReconcileParams['requested_spec'] = {
  spec_id: 'iq-2026-000123',
  version: 2,
  source: 'iqplus',
  lines: [
    { line_no: 1, sku: 'TW3046', qty: 2, size: { width: 36, height: 54 },
      options: { color: 'White', glass: 'Low-E4', grille: 'Colonial' } },
    { line_no: 2, sku: 'CW24', qty: 1, size: { width: 24, height: 48 },
      options: { color: 'Sandtone', glass: 'Low-E4 SmartSun' } },
  ],
};

export function reconcileParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    vendor_quote: { quote_number: 'H1256-471919', line_items: VENDOR_LINES },
    requested_spec: REQUESTED_SPEC,
    ...over,
  };
}

export const IQ_REPORT_TEXT = [
  'ANDERSEN IQ+ ABBREVIATED QUOTE REPORT',
  'Quote Number: IQ-2026-000123',
  'Version: 2',
  'Project: P26-0041',
  'Customer: Jane Example',
  'Phone: 917-555-0123',
  'Email: jane.client@example.com',
  '',
  'Opening 1: Kitchen',
  '  Unit 1: 400 Series Woodwright Double-Hung TW3046',
  '    Size: 36 x 54 | Color: White | Glass: Low-E4 | Grille: Colonial',
  '    Qty: 2',
  '    Price: $1,234.56',
  'Opening 2: Living Room',
  '  Unit 1: 400 Series Casement CW24',
  '    Size: 24 x 48 | Color: Sandtone | Glass: Low-E4 SmartSun',
  '    Qty: 1',
].join('\n');

export function iqplusParams(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    source: { document_id: 'doc-iq-report-1', sha256: SHA_A },
    report_text: IQ_REPORT_TEXT,
    client_contacts: [{ name: 'Jane Example', phone: '917-555-0123', email: CLIENT_EMAIL }],
    ...over,
  };
}

// --- the standard matrix ----------------------------------------------------

export interface MatrixSpec {
  capability: string;
  approval_class: 'INTERNAL' | 'EXTERNAL';
  risk_class: string;
  operation_kind: 'read' | 'write';
  valid: () => Record<string, unknown>;
  schemaInvalid: Array<{ name: string; params: Record<string, unknown>; reason: string }>;
  negatives: Array<{ name: string; params: Record<string, unknown>; reason: string }>;
}

// Executes a valid request end to end (seeding an approval for EXTERNAL).
export async function execValid(
  db: FakeDb, spec: MatrixSpec, h: Harness = makeHarness(db), approvalId = 'apr-biz-0001',
) {
  const req = request(spec.capability, spec.valid(),
    spec.approval_class === 'EXTERNAL' ? { approval_id: approvalId } : {});
  if (spec.approval_class === 'EXTERNAL') seedApproval(db, req, approvalId);
  const res = await executeCapability(h.deps, req);
  return { req, res, h };
}

export function describeCapabilityMatrix(spec: MatrixSpec): void {
  describe(`${spec.capability} - contract`, () => {
    it('is registered at version 1 with the declared classes', () => {
      const r = lookupCapability(spec.capability, 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.definition.approval_class).toBe(spec.approval_class);
      expect(r.definition.risk_class).toBe(spec.risk_class);
      expect(r.definition.operation_kind).toBe(spec.operation_kind);
      expect(r.definition.requires_approval).toBe(spec.approval_class === 'EXTERNAL');
      expect(r.definition.idempotency_strategy).toBe('ledger_key');
      expect(typeof r.definition.validate_params).toBe('function');
      expect(r.definition.provenance.length).toBeGreaterThan(0);
      expect(r.definition.evidence.length).toBeGreaterThan(0);
      expect(r.definition.failure_behavior.length).toBeGreaterThan(0);
      expect(lookupCapability(spec.capability, 2).ok).toBe(false);
    });
  });

  describe(`${spec.capability} - schema`, () => {
    it('accepts the valid fixture', () => {
      const r = lookupCapability(spec.capability, 1);
      if (!r.ok || !r.definition.validate_params) throw new Error('fixture');
      const pv = r.definition.validate_params(spec.valid());
      expect(pv.ok).toBe(true);
      if (pv.ok) expect(pv.binding.project_id).toBe(String(spec.valid().project_id));
    });
    for (const bad of spec.schemaInvalid) {
      it(`refuses ${bad.name} (${bad.reason})`, async () => {
        const r = lookupCapability(spec.capability, 1);
        if (!r.ok || !r.definition.validate_params) throw new Error('fixture');
        const pv = r.definition.validate_params(bad.params);
        expect(pv).toEqual({ ok: false, reason: bad.reason });
        const db = makeFakeDb();
        const h = makeHarness(db);
        const res = await executeCapability(h.deps, request(spec.capability, bad.params));
        expect(res.error).toEqual({ error_class: 'terminal', reason: bad.reason });
        expect(db.rowsOf('side_effects').length).toBe(0);
        expect(h.calls()).toBe(0);
      });
    }
  });

  // Pure READ capabilities without a policy refusal (parse/reconcile) carry
  // their negatives at the pure-function level in their own suite.
  if (spec.negatives.length > 0) describe(`${spec.capability} - negatives`, () => {
    for (const neg of spec.negatives) {
      it(`refuses ${neg.name} before any ledger/provider step`, async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const req = request(spec.capability, neg.params,
          spec.approval_class === 'EXTERNAL' ? { approval_id: 'apr-biz-neg' } : {});
        // Even a would-be approval cannot rescue a policy refusal: the
        // refusal precedes the approval gate.
        const res = await executeCapability(h.deps, req);
        expect(res.error).toEqual({ error_class: 'terminal', reason: neg.reason });
        expect(db.rowsOf('side_effects').length).toBe(0);
        expect(h.calls()).toBe(0);
      });
    }
  });

  describe(`${spec.capability} - authorization`, () => {
    if (spec.approval_class === 'EXTERNAL') {
      it('missing approval is refused (ledger row refused, adapter untouched)', async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const res = await executeCapability(h.deps, request(spec.capability, spec.valid()));
        expect(res.error).toEqual({ error_class: 'terminal', reason: 'approval_required' });
        expect(db.rowsOf('side_effects')[0].status).toBe('refused');
        expect(h.calls()).toBe(0);
      });
      it('expired approval is refused', async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const req = request(spec.capability, spec.valid(), { approval_id: 'apr-biz-exp' });
        seedApproval(db, req, 'apr-biz-exp',
          { expiresAt: new Date(nowMs - 1_000).toISOString() });
        const res = await executeCapability(h.deps, req);
        expect(res.error?.reason).toBe('approval_expired_at_execution');
        expect(h.calls()).toBe(0);
      });
      it('mismatched (tampered payload) approval is refused - stale approval', async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const req = request(spec.capability, spec.valid(), { approval_id: 'apr-biz-tamper' });
        seedApproval(db, req, 'apr-biz-tamper');
        const tampered = { ...req, params: { ...req.params, tamper: 'x' } };
        const res = await executeCapability(h.deps, tampered);
        expect(res.error?.reason).toMatch(/^approval_(action_hash_mismatch|schema_invalid)/);
        expect(h.calls()).toBe(0);
      });
      it('approval without the field-level binding is refused', async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const req = request(spec.capability, spec.valid(), { approval_id: 'apr-biz-nob' });
        seedApproval(db, req, 'apr-biz-nob', { bindingHash: null });
        const res = await executeCapability(h.deps, req);
        expect(res.error?.reason).toBe('approval_binding_missing');
        expect(h.calls()).toBe(0);
      });
      it('approval whose binding names another envelope is refused', async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const req = request(spec.capability, spec.valid(), { approval_id: 'apr-biz-wrongb' });
        seedApproval(db, req, 'apr-biz-wrongb', { bindingHash: SHA_B });
        const res = await executeCapability(h.deps, req);
        expect(res.error?.reason).toBe('approval_binding_mismatch');
        expect(h.calls()).toBe(0);
      });
      it('a different owner identity cannot approve', async () => {
        const db = makeFakeDb();
        const h = makeHarness(db);
        const req = request(spec.capability, spec.valid(), { approval_id: 'apr-biz-owner' });
        seedApproval(db, req, 'apr-biz-owner', { owner: 'intruder@example.com' });
        const res = await executeCapability(h.deps, req);
        expect(res.error?.reason).toBe('approval_owner_mismatch');
        expect(h.calls()).toBe(0);
      });
    } else {
      it('INTERNAL: executes without an approval record', async () => {
        const db = makeFakeDb();
        const { res, h } = await execValid(db, spec);
        expect(res.ok).toBe(true);
        expect(h.calls()).toBe(1);
        expect(db.rowsOf('side_effects')[0].approval_id).toBeNull();
      });
    }
  });

  describe(`${spec.capability} - idempotency + replay`, () => {
    it('same key => one row, one execution; replay returns the stored outcome', async () => {
      const db = makeFakeDb();
      const first = await execValid(db, spec);
      expect(first.res.ok).toBe(true);
      expect(first.h.calls()).toBe(1);
      // fresh process (new deps + adapters), same durable ledger
      const h2 = makeHarness(db);
      const again = await executeCapability(h2.deps, first.req);
      expect(again.ok).toBe(true);
      expect(again.side_effect_id).toBe(first.res.side_effect_id);
      expect(again.summary).toMatch(/^replayed:/);
      expect(again.provider_state).toBe('sandbox_only');
      expect(again.provider_result_id).toBe(first.res.provider_result_id);
      expect(h2.calls()).toBe(0);
      expect(db.rowsOf('side_effects').length).toBe(1);
    });
    it('a different request_id with the same payload converges on the same row', async () => {
      const db = makeFakeDb();
      const first = await execValid(db, spec);
      const dup = { ...first.req, request_id: 'req-biz-0002', run_id: 'run-biz-0002' };
      const res = await executeCapability(first.h.deps, dup);
      expect(res.side_effect_id).toBe(first.res.side_effect_id);
      expect(first.h.calls()).toBe(1);
      expect(db.rowsOf('side_effects').length).toBe(1);
    });
  });

  describe(`${spec.capability} - sandbox proof`, () => {
    it('reports provider_state sandbox_only, identity sandbox, no credential', async () => {
      const db = makeFakeDb();
      const { res, h } = await execValid(db, spec);
      expect(res.ok).toBe(true);
      expect(res.provider_state).toBe('sandbox_only');
      expect(res.provider_result_id).toMatch(/^sandbox-/);
      expect(res.output?.provider_identity).toBe('sandbox');
      expect(res.output?.provider_state).toBe('sandbox_only');
      expect(res.output?.credential_state).toBe('no_credential');
      expect(res.artifact_refs).toContain('provider_state:sandbox_only');
      expect(h.broker.stats()).toEqual({ resolutions: 1, disk_reads: 0 });
      const row = db.rowsOf('side_effects')[0];
      expect(row.status).toBe('succeeded');
      expect(row.account_id).toBeNull();
      expect(String(row.provider_result_id)).toMatch(/^sandbox-/);
    });
    it('refuses to act if a credential were ever presented', async () => {
      const db = makeFakeDb();
      const liveBroker: CredentialBroker = {
        resolve: (provider) => ({ ok: true,
          credential: { provider, secret: 'fake-not-a-secret', expires_at_ms: null } }),
        stats: () => ({ resolutions: 0, disk_reads: 0 }),
      };
      const { res } = await execValid(db, spec, makeHarness(db, { broker: liveBroker }));
      expect(res.error).toEqual(
        { error_class: 'terminal', reason: 'sandbox_refuses_credential' });
      expect(db.rowsOf('side_effects')[0].status).toBe('failed');
    });
  });

  describe(`${spec.capability} - kill / disable`, () => {
    const cases: Array<[string, Partial<SystemControls> | null, string]> = [
      ['execution_enabled=false', { execution_enabled: false },
        'runtime_halted:execution_disabled'],
      ['owner_stop=true', { owner_stop: true }, 'runtime_halted:owner_stop'],
      ['paused=true', { paused: true }, 'runtime_halted:paused'],
      ['controls row unreadable', null, 'runtime_halted:owner_stop'],
    ];
    for (const [name, controls, reason] of cases) {
      it(`${name} => refused before ledger and provider`, async () => {
        const db = makeFakeDb({ controls });
        const h = makeHarness(db);
        const req = request(spec.capability, spec.valid(),
          spec.approval_class === 'EXTERNAL' ? { approval_id: 'apr-biz-kill' } : {});
        if (spec.approval_class === 'EXTERNAL') seedApproval(db, req, 'apr-biz-kill');
        const res = await executeCapability(h.deps, req);
        expect(res.error).toEqual({ error_class: 'terminal', reason });
        expect(db.rowsOf('side_effects').length).toBe(0);
        expect(h.calls()).toBe(0);
      });
    }
  });
}

// --- harness self-check (registered only when this file is the entry) -----

if (String(expect.getState().testPath ?? '').replace(/\\/g, '/')
  .endsWith('/business-capability-harness.test.ts')) {
  describe('business capability harness self-check', () => {
    it('the fake ledger enforces unique idempotency keys like migration 0026', async () => {
      const db = makeFakeDb();
      const ins = (id: string, key: string) => db.client.from('side_effects')
        .insert({ side_effect_id: id, idempotency_key: key }).select('side_effect_id');
      expect((await ins('se-1', 'k1')).error).toBeNull();
      expect((await ins('se-2', 'k1')).error?.message).toMatch(/duplicate/);
      expect((await ins('se-1', 'k2')).error?.message).toMatch(/duplicate/);
      expect(db.rowsOf('side_effects').length).toBe(1);
    });
    it('seeds an active controls row by default and none when asked', () => {
      expect(makeFakeDb().rowsOf('system_controls').length).toBe(1);
      expect(makeFakeDb({ controls: null }).rowsOf('system_controls').length).toBe(0);
    });
    it('every fixture recipient/sender is an example.com address', () => {
      for (const a of ALIASES) expect(a.email.endsWith('@example.com')).toBe(true);
      for (const a of ALLOWLIST) expect(a.email.endsWith('@example.com')).toBe(true);
      expect(OWNER.endsWith('@example.com')).toBe(true);
    });
  });
}
