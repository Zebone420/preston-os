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
//   - owner approval is always required (approvals row + link);
//   - idempotent: same idempotency_key returns the stored run.
//
// No clock or randomness inside: callers inject now() and ids().

import type { RuntimeClient } from '../ai-os/store';
import {
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
  const res = await insertBusinessRecord(
    deps.client,
    BUSINESS_TABLES.quoteDraftRuns,
    {
      agent_name: QUOTE_AGENT_NAME,
      input: sanitizeInput(req),
      correlation_id:
        req.correlation_id ?? `qd:${req.idempotency_key ?? 'unknown'}`,
      idempotency_key: req.idempotency_key ?? '',
      created_by: req.created_by ?? 'owner',
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
    title: req.title ?? '',
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
      opening_label: it.opening_label ?? '',
      product_line: it.product_line ?? '',
      description: it.description ?? '',
      quantity: it.quantity ?? null,
      unit_material_cents: it.unit_material_cents ?? null,
      unit_labor_cents: it.unit_labor_cents ?? null,
      line_fees_cents: it.line_fees_cents ?? 0,
    })),
    st124_tracking: req.st124_tracking ?? {},
    exclusions: req.exclusions ?? [],
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
    const run = await recordRun(deps, req, {
      status: 'failed_error',
      failure_reason: message.slice(0, 500),
      input_missing_fields: [],
      assumptions: [],
    });
    return {
      ...base,
      status: 'failed_error',
      run_id: run.id,
      errors: [message],
    };
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
      const run = await recordRun(deps, req, {
        status: 'failed_error',
        failure_reason: 'quote_not_found',
        input_missing_fields: [],
        assumptions: [],
      });
      return {
        ...base,
        status: 'failed_error',
        run_id: run.id,
        errors: ['quote_not_found'],
      };
    }
    const row = found.rows[0];
    quoteId = String(row.id);
    version = Number(row.current_version ?? 0) + 1;
    quoteTitle = String(row.title ?? 'quote');
  } else {
    quoteId = deps.ids();
    version = 1;
    quoteTitle = (req.title ?? '').trim();
    isNewQuote = true;
  }

  // 4. Owner approval request (always required).
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
    const run = await recordRun(deps, req, {
      status: 'failed_error',
      failure_reason: 'approval_request_failed',
      input_missing_fields: [],
      assumptions: [],
    });
    return {
      ...base,
      status: 'failed_error',
      run_id: run.id,
      errors: ['approval_request_failed'],
    };
  }

  // 5. Persist quote master row / version bump (CAS).
  const pendingStatus: QuoteStatus = 'pending_approval';
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
        status: pendingStatus,
        current_version: version,
        approval_id: approval.id,
        source: 'agent_simulation',
        provenance: { agent: QUOTE_AGENT_NAME, correlation },
      },
    );
    if (!q.ok) {
      return failError(deps, req, base, 'quote_persist_failed');
    }
  } else {
    const bump = await bumpQuoteVersionCAS(
      deps.client,
      quoteId,
      version - 1,
      version,
      pendingStatus,
      nowIso,
    );
    if (!bump.ok) {
      return failError(
        deps,
        req,
        base,
        bump.error === 'version_conflict'
          ? 'version_conflict'
          : 'quote_persist_failed',
      );
    }
  }

  // 6. Persist the priced version, items, and payment schedule.
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
      approval_id: approval.id,
      correlation_id: correlation,
      created_by: QUOTE_AGENT_NAME,
    },
  );
  if (!v.ok) {
    return failError(deps, req, base, 'version_persist_failed');
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

  // 7. Approval link + run record + activity ledger entry.
  await insertApprovalLink(
    deps.client,
    approval.id,
    'quote_version',
    versionId,
    'quote_draft_approval',
  );

  const run = await recordRun(deps, req, {
    status: 'completed',
    quote_id: quoteId,
    quote_version_id: versionId,
    input_missing_fields: [],
    assumptions: calc.assumptions,
  });

  await insertActivityEvent(deps.client, {
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

  await deps.audit?.('quote_draft_created', {
    quote_id: quoteId,
    version,
    total_cents: calc.total_cents,
    simulation: true,
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
  return {
    ...base,
    status: 'failed_error',
    run_id: run.id,
    errors: [reason],
  };
}
