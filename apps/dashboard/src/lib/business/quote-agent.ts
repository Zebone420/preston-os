// Quote-draft agent (Phase 6E) - SIMULATION ONLY.
//
// Accepts a normalized quote request, validates it fail-closed,
// prices it with the deterministic engine, and persists a versioned
// DRAFT plus an approval request for the owner. Structural
// guarantees:
//   - produces drafts only; there is no send capability here;
//   - never updates an external CRM/accounting/production system
//     (only the RLS-bound staging business tables via the store);
//   - never invents product specifications or pricing: anything
//     missing is reported in missing_fields and the run fails
//     closed instead of guessing;
//   - simulation_only=true and execution_eligible=false are forced
//     on every run row (and DB CHECK-pinned by migration 0009);
//   - owner approval is always required (approvals row + links);
//   - idempotent: same idempotency_key returns the stored run.
//
// Persistence order (audit H2/F2 fix): draft entities first
// (quote -> version -> items -> schedule), the approval request
// only after the draft fully exists, then the quote header CAS
// bump, run record, and activity entry. A mid-sequence failure
// therefore leaves at worst a visible draft WITHOUT an approval -
// never a pending approval that points at nothing, and never a
// current_version that points at a missing version row.
//
// Known accepted races (owner-only surface, documented): the
// idempotency check is check-then-act; a concurrent duplicate
// submit can create a second draft, which the unique run key then
// surfaces (run insert dedups; the loser is audited as a race).
//
// No clock or randomness inside: callers inject now() and ids().

import type { RuntimeClient } from '../ai-os/store';
import {
  attachVersionApproval,
  BUSINESS_TABLES,
  bumpQuoteVersionCAS,
  insertActivityEvent,
  insertApprovalLink,
  insertApprovalRequest,
  insertBusinessRecord,
  readQuoteById,
  readQuoteDraftRunByKey,
} from './business-store';
import {
  calculateQuote,
  validateQuoteEngineInput,
  type QuoteEngineInput,
} from './quote-engine';
import { UUID_RE, type QuoteStatus } from './types';

export const QUOTE_AGENT_NAME = 'quote-draft-agent';

const MAX_TITLE_CHARS = 200;
const MAX_TEXT_CHARS = 500;
const MAX_EXCLUSIONS = 20;

export interface QuoteDraftRequest extends QuoteEngineInput {
  title?: string;
  client_id?: string;
  lead_id?: string;
  property_id?: string;
  quote_id?: string; // set to draft a new version of an existing quote
  idempotency_key?: string;
  correlation_id?: string;
  created_by?: string;
}

export interface QuoteAgentDeps {
  client: RuntimeClient;
  ids: () => string;
  now: () => string;
  audit?: (
    action: string,
    detail: Record<string, unknown>,
  ) => Promise<void>;
}

export interface QuoteAgentResult {
  status: 'completed' | 'failed_validation' | 'failed_error' | 'duplicate';
  run_id?: string;
  quote_id?: string;
  quote_version_id?: string;
  version?: number;
  approval_id?: string;
  total_cents?: number;
  missing_fields: string[];
  errors: string[];
  assumptions: string[];
  // Non-fatal follow-up write failures (links/run/activity). The
  // draft itself is intact when these appear.
  warnings: string[];
  // For duplicate outcomes: the stored run's original status.
  stored_run_status?: string;
}

function clip(v: string | undefined, max: number): string {
  return (v ?? '').trim().slice(0, max);
}

function requestErrors(req: QuoteDraftRequest): {
  errors: string[];
  missing: string[];
} {
  const errors: string[] = [];
  const missing: string[] = [];
  if (!req.idempotency_key || req.idempotency_key.length < 8) {
    errors.push('idempotency_key_required');
  }
  if (req.quote_id) {
    if (!UUID_RE.test(req.quote_id)) errors.push('quote_id_invalid');
  } else {
    if (!req.title || req.title.trim().length === 0) {
      missing.push('title');
    }
    if (!req.client_id) {
      missing.push('client_id');
    } else if (!UUID_RE.test(req.client_id)) {
      errors.push('client_id_invalid');
    }
  }
  for (const [field, value] of [
    ['lead_id', req.lead_id],
    ['property_id', req.property_id],
  ] as const) {
    if (value && !UUID_RE.test(value)) errors.push(`${field}_invalid`);
  }
  return { errors, missing };
}

async function recordRun(
  deps: QuoteAgentDeps,
  req: QuoteDraftRequest,
  fields: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string; duplicate?: boolean }> {
  // A run row is always written, even for invalid requests. When the
  // key is missing/invalid we mint a unique fallback so every failed
  // attempt stays in the audit trail instead of deduping against ''.
  const key =
    req.idempotency_key && req.idempotency_key.length >= 8
      ? req.idempotency_key
      : `invalid-key:${deps.now()}:${deps.ids()}`;
  const res = await insertBusinessRecord(
    deps.client,
    BUSINESS_TABLES.quoteDraftRuns,
    {
      agent_name: QUOTE_AGENT_NAME,
      input: sanitizeInput(req),
      correlation_id: req.correlation_id ?? `qd:${key}`,
      idempotency_key: key,
      created_by: clip(req.created_by, MAX_TEXT_CHARS) || 'owner',
      simulation_only: true,
      execution_eligible: false,
      ...fields,
    },
  );
  return { ok: res.ok, id: res.id, duplicate: res.duplicate };
}

// The persisted input is the normalized business payload only -
// no free-form nested objects beyond the known engine fields.
function sanitizeInput(req: QuoteDraftRequest): Record<string, unknown> {
  return {
    title: clip(req.title, MAX_TITLE_CHARS),
    client_id: req.client_id ?? null,
    lead_id: req.lead_id ?? null,
    property_id: req.property_id ?? null,
    quote_id: req.quote_id ?? null,
    scope_type: req.scope_type ?? null,
    jurisdiction: req.jurisdiction ?? null,
    quote_fees_cents: req.quote_fees_cents ?? 0,
    markup_mode: req.markup_mode ?? 'none',
    markup_value: req.markup_value ?? 0,
    items: (req.items ?? []).map((it) => ({
      opening_label: clip(it.opening_label, MAX_TEXT_CHARS),
      product_line: clip(it.product_line, MAX_TEXT_CHARS),
      description: clip(it.description, MAX_TEXT_CHARS),
      quantity: it.quantity ?? null,
      unit_material_cents: it.unit_material_cents ?? null,
      unit_labor_cents: it.unit_labor_cents ?? null,
      line_fees_cents: it.line_fees_cents ?? 0,
    })),
    st124_tracking: req.st124_tracking ?? {},
    exclusions: (req.exclusions ?? [])
      .slice(0, MAX_EXCLUSIONS)
      .map((e) => clip(e, MAX_TEXT_CHARS)),
  };
}

export async function runQuoteDraftAgent(
  deps: QuoteAgentDeps,
  req: QuoteDraftRequest,
): Promise<QuoteAgentResult> {
  const base: QuoteAgentResult = {
    status: 'failed_validation',
    missing_fields: [],
    errors: [],
    assumptions: [],
    warnings: [],
  };

  // 0. Idempotency: an existing run with this key is authoritative.
  if (req.idempotency_key && req.idempotency_key.length >= 8) {
    const existing = await readQuoteDraftRunByKey(
      deps.client,
      req.idempotency_key,
    );
    if (existing.ok && existing.rows.length > 0) {
      const row = existing.rows[0];
      return {
        ...base,
        status: 'duplicate',
        run_id: String(row.id ?? ''),
        stored_run_status: String(row.status ?? ''),
        quote_id: row.quote_id ? String(row.quote_id) : undefined,
        quote_version_id: row.quote_version_id
          ? String(row.quote_version_id)
          : undefined,
      };
    }
  }

  // 1. Fail-closed validation (request shape + engine input).
  const reqCheck = requestErrors(req);
  const engineCheck = validateQuoteEngineInput(req);
  const missing = [
    ...reqCheck.missing,
    ...(engineCheck.ok ? [] : engineCheck.missing_fields),
  ];
  const errors = [
    ...reqCheck.errors,
    ...(engineCheck.ok ? [] : engineCheck.errors),
  ];
  if (missing.length > 0 || errors.length > 0) {
    const run = await recordRun(deps, req, {
      status: 'failed_validation',
      failure_reason: [...errors, ...missing.map((m) => `missing:${m}`)]
        .join('; ')
        .slice(0, 500),
      input_missing_fields: missing,
      assumptions: [],
    });
    await deps.audit?.('quote_draft_failed_validation', {
      missing_count: missing.length,
      error_count: errors.length,
    });
    return {
      ...base,
      status: 'failed_validation',
      run_id: run.id,
      missing_fields: missing,
      errors,
    };
  }

  // 2. Deterministic pricing.
  let calc;
  try {
    calc = calculateQuote(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'engine error';
    return failError(deps, req, base, message.slice(0, 200));
  }

  const nowIso = deps.now();
  const correlation =
    req.correlation_id ?? `qd:${req.idempotency_key}`;

  // 3. Resolve quote target: existing quote (new version) or new.
  let quoteId: string;
  let version: number;
  let quoteTitle: string;
  let isNewQuote = false;
  if (req.quote_id) {
    const found = await readQuoteById(deps.client, req.quote_id);
    if (!found.ok || found.rows.length === 0) {
      return failError(deps, req, base, 'quote_not_found');
    }
    const row = found.rows[0];
    quoteId = String(row.id);
    version = Number(row.current_version ?? 0) + 1;
    quoteTitle = String(row.title ?? 'quote');
  } else {
    quoteId = deps.ids();
    version = 1;
    quoteTitle = clip(req.title, MAX_TITLE_CHARS);
    isNewQuote = true;
  }

  // 4. Persist the draft entities FIRST (quote master as draft,
  // then version/items/schedule). unique(quote_id, version) is the
  // arbiter for concurrent version claims.
  if (isNewQuote) {
    const q = await insertBusinessRecord(
      deps.client,
      BUSINESS_TABLES.quotes,
      {
        id: quoteId,
        client_id: req.client_id,
        property_id: req.property_id ?? null,
        lead_id: req.lead_id ?? null,
        title: quoteTitle,
        status: 'draft',
        current_version: 0,
        approval_id: null,
        source: 'agent_simulation',
        provenance: { agent: QUOTE_AGENT_NAME, correlation },
      },
    );
    if (!q.ok) {
      return failError(deps, req, base, 'quote_persist_failed');
    }
  }

  const versionId = deps.ids();
  const v = await insertBusinessRecord(
    deps.client,
    BUSINESS_TABLES.quoteVersions,
    {
      id: versionId,
      quote_id: quoteId,
      version,
      product_line: calc.items[0]?.product_line ?? '',
      scope_type: calc.scope_type,
      jurisdiction: calc.jurisdiction,
      tax_rate_milli_pct: calc.tax_rate_milli_pct,
      material_cents: calc.material_cents,
      labor_cents: calc.labor_cents,
      fees_cents: calc.fees_cents,
      markup_mode: calc.markup_mode,
      markup_value: calc.markup_value,
      markup_cents: calc.markup_cents,
      subtotal_cents: calc.subtotal_cents,
      tax_cents: calc.tax_cents,
      total_cents: calc.total_cents,
      margin_cents: calc.margin_cents,
      payment_schedule: calc.payment_schedule,
      assumptions: calc.assumptions,
      exclusions: calc.exclusions,
      missing_fields: [],
      owner_confirmation_required: true,
      st124_tracking: calc.st124_tracking,
      draft_provenance: {
        agent: QUOTE_AGENT_NAME,
        engine: 'quote-engine',
        correlation,
      },
      simulation_state: 'simulation',
      approval_id: null,
      correlation_id: correlation,
      created_by: QUOTE_AGENT_NAME,
    },
  );
  if (!v.ok) {
    return failError(deps, req, base, 'version_persist_failed');
  }
  if (v.duplicate) {
    // Another draft claimed this version number first.
    return failError(deps, req, base, 'version_conflict');
  }

  for (const item of calc.items) {
    const res = await insertBusinessRecord(
      deps.client,
      BUSINESS_TABLES.quoteItems,
      {
        quote_version_id: versionId,
        position: item.position,
        opening_label: item.opening_label,
        product_line: item.product_line,
        description: item.description,
        quantity: item.quantity,
        unit_material_cents: item.unit_material_cents,
        unit_labor_cents: item.unit_labor_cents,
        line_fees_cents: item.line_fees_cents,
        line_total_cents: item.line_total_cents,
        item_flags: item.item_flags,
      },
    );
    if (!res.ok) {
      return failError(deps, req, base, 'items_persist_failed');
    }
  }

  const sched = await insertBusinessRecord(
    deps.client,
    BUSINESS_TABLES.paymentSchedules,
    {
      quote_version_id: versionId,
      schedule_type: calc.payment_schedule.schedule_type,
      stages: calc.payment_schedule.stages,
      total_cents: calc.payment_schedule.total_cents,
    },
  );
  if (!sched.ok) {
    return failError(deps, req, base, 'schedule_persist_failed');
  }

  // 5. Owner approval request - only now that the draft exists, so
  // a pending approval can never point at a missing draft.
  const approval = await insertApprovalRequest(deps.client, {
    requested_action:
      `quote_draft_approval: ${quoteTitle} v${version} ` +
      `(simulation draft)`,
    action_class: 'YELLOW',
    notes:
      'Quote draft produced by quote-draft-agent in simulation mode. ' +
      'Approval records a decision only; nothing executes or is ' +
      'delivered to a client.',
  });
  if (!approval.ok || !approval.id) {
    return failError(deps, req, base, 'approval_request_failed');
  }

  const warnings: string[] = [];
  const attach = await attachVersionApproval(
    deps.client,
    versionId,
    approval.id,
  );
  if (!attach.ok) warnings.push('version_approval_attach_failed');

  // 6. Publish the draft on the quote header (CAS on version) with
  // the new approval id.
  const pendingStatus: QuoteStatus = 'pending_approval';
  const bump = await bumpQuoteVersionCAS(
    deps.client,
    quoteId,
    version - 1,
    version,
    pendingStatus,
    nowIso,
    approval.id,
  );
  if (!bump.ok) {
    return failError(
      deps,
      req,
      base,
      bump.error === 'version_conflict'
        ? 'version_conflict'
        : 'quote_publish_failed',
    );
  }

  // 7. Approval links (version + quote, so the Approval Center can
  // deep-link the draft) + run record + activity ledger entry.
  const linkV = await insertApprovalLink(
    deps.client,
    approval.id,
    'quote_version',
    versionId,
    'quote_draft_approval',
  );
  const linkQ = await insertApprovalLink(
    deps.client,
    approval.id,
    'quote',
    quoteId,
    'quote_draft_approval',
  );
  if (!linkV.ok || !linkQ.ok) warnings.push('approval_link_failed');

  const run = await recordRun(deps, req, {
    status: 'completed',
    quote_id: quoteId,
    quote_version_id: versionId,
    input_missing_fields: [],
    assumptions: calc.assumptions,
  });
  if (run.duplicate) {
    // A concurrent submit with the same key finished first. The
    // stored run is authoritative; this draft is a race artifact.
    warnings.push('duplicate_run_race_detected');
    await deps.audit?.('quote_draft_race_detected', {
      quote_id: quoteId,
      idempotency_key: req.idempotency_key ?? '',
    });
  } else if (!run.ok) {
    warnings.push('run_record_failed');
  }

  const act = await insertActivityEvent(deps.client, {
    source: QUOTE_AGENT_NAME,
    entity_type: 'quote',
    entity_id: quoteId,
    action: 'quote_draft_created',
    summary:
      `Quote draft v${version} for "${quoteTitle}" ` +
      `(simulation; awaiting owner approval).`,
    actor: QUOTE_AGENT_NAME,
    provenance: { correlation, version_id: versionId },
    correlation_id: correlation,
    approval_id: approval.id,
    simulation_state: 'simulation',
    idempotency_key: `act:${req.idempotency_key}`,
  });
  if (!act.ok) warnings.push('activity_record_failed');

  await deps.audit?.('quote_draft_created', {
    quote_id: quoteId,
    version,
    total_cents: calc.total_cents,
    simulation: true,
    warnings,
  });

  return {
    status: 'completed',
    run_id: run.id,
    quote_id: quoteId,
    quote_version_id: versionId,
    version,
    approval_id: approval.id,
    total_cents: calc.total_cents,
    missing_fields: [],
    errors: [],
    assumptions: calc.assumptions,
    warnings,
  };
}

async function failError(
  deps: QuoteAgentDeps,
  req: QuoteDraftRequest,
  base: QuoteAgentResult,
  reason: string,
): Promise<QuoteAgentResult> {
  const run = await recordRun(deps, req, {
    status: 'failed_error',
    failure_reason: reason,
    input_missing_fields: [],
    assumptions: [],
  });
  await deps.audit?.('quote_draft_failed_error', { reason });
  return {
    ...base,
    status: 'failed_error',
    run_id: run.id,
    errors: [reason],
  };
}
