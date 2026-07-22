'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import type { OwnerContext } from '@/lib/ai-os/owner-context';
import {
  BUSINESS_TABLES,
  insertActivityEvent,
  insertBusinessRecord,
  updateLeadStageCAS,
  updateRecommendationStatusCAS,
} from '@/lib/business/business-store';
import {
  humanizeQuoteCodes,
  humanizeRecommendationOutcome,
  validateClientForm,
  validateLeadForm,
  validatePaymentForm,
  validateStageChange,
} from '@/lib/business/business-forms';
import { loadBusinessData } from '@/lib/business/page-data';
import { generateRecommendations } from '@/lib/business/recommendations';
import {
  runQuoteDraftAgent,
  type QuoteDraftRequest,
} from '@/lib/business/quote-agent';
import type { QuoteItemInput } from '@/lib/business/quote-engine';

// Business Command Center server actions. A Server Action is a public
// POST entry point, so the owner check is re-done HERE inside each
// action (proxy gate and RLS are additional layers, not substitutes).
// Everything below records simulation-state business data only:
// nothing sends, nothing executes, nothing touches production.

function num(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined;
  const s = String(v).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

// Dollars-and-cents form field -> integer cents, parsed digit-wise
// (never via binary-float multiplication): "1200" -> 120000,
// "1200.50" -> 120050, "1.005" -> 101 (third decimal rounds half
// up). Invalid input becomes NaN so validation rejects it instead
// of silently coercing. An optional leading minus is supported for
// adjustment amounts.
function cents(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined;
  const s = String(v).trim();
  if (s === '') return undefined;
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return Number.NaN;
  const sign = m[1] ? -1 : 1;
  const dollars = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(3, '0');
  const centPart = Number(frac.slice(0, 2));
  const roundUp = Number(frac[2]) >= 5 ? 1 : 0;
  const out = dollars * 100 + centPart + roundUp;
  return Number.isSafeInteger(out) ? sign * out : Number.NaN;
}

// Percent form field -> integer milli-percent, digit-wise:
// "25" -> 25000, "8.875" -> 8875, "2.01" -> 2010 (no float
// artifacts like 2009.9999...).
function milliPct(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined;
  const s = String(v).trim();
  if (s === '') return undefined;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return Number.NaN;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(3, '0').slice(0, 3);
  const out = whole * 1000 + Number(frac);
  return Number.isSafeInteger(out) ? out : Number.NaN;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function readItems(formData: FormData): QuoteItemInput[] {
  const items: QuoteItemInput[] = [];
  for (let i = 1; i <= 5; i++) {
    const label = str(formData, `item${i}_label`);
    const description = str(formData, `item${i}_description`);
    const quantity = num(formData.get(`item${i}_quantity`));
    const material = cents(formData.get(`item${i}_material`));
    const labor = cents(formData.get(`item${i}_labor`));
    const fees = cents(formData.get(`item${i}_fees`));
    const empty =
      label === '' &&
      description === '' &&
      quantity === undefined &&
      material === undefined &&
      labor === undefined &&
      fees === undefined;
    if (empty) continue;
    items.push({
      opening_label: label,
      product_line: str(formData, `item${i}_product_line`),
      description,
      quantity,
      unit_material_cents: material,
      unit_labor_cents: labor,
      line_fees_cents: fees,
    });
  }
  return items;
}

// ---------------------------------------------------------------
// Quote-draft agent form (useActionState: failures return state so
// the owner's input is NEVER discarded; success redirects).
// ---------------------------------------------------------------

export interface QuoteFormState {
  status: 'idle' | 'error';
  messages: string[];
  values: Record<string, string>;
}

const QUOTE_FORM_FIELDS = [
  'title',
  'client_id',
  'lead_id',
  'property_id',
  'quote_id',
  'scope_type',
  'jurisdiction',
  'quote_fees',
  'markup_mode',
  'markup_percent',
  'markup_fixed',
  'exclusions',
  'st124',
  ...[1, 2, 3, 4, 5].flatMap((i) => [
    `item${i}_label`,
    `item${i}_product_line`,
    `item${i}_description`,
    `item${i}_quantity`,
    `item${i}_material`,
    `item${i}_labor`,
    `item${i}_fees`,
  ]),
];

function echoValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of QUOTE_FORM_FIELDS) {
    out[f] = String(formData.get(f) ?? '');
  }
  return out;
}

export async function submitQuoteDraft(
  _prev: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const ctx = await resolveOwner();
  if (!ctx) {
    return {
      status: 'error',
      messages: ['Owner login required.'],
      values: echoValues(formData),
    };
  }

  // Markup mode/value cross-checks (audit M1): a value typed into
  // the box that does not match the selected mode is an error, and
  // a selected mode with an empty matching box stays undefined so
  // the engine's missing-field check fires - never a silent zero.
  const markupMode = str(formData, 'markup_mode') || 'none';
  const rawPercent = str(formData, 'markup_percent');
  const rawFixed = str(formData, 'markup_fixed');
  const mismatch =
    (markupMode === 'none' && (rawPercent !== '' || rawFixed !== '')) ||
    (markupMode === 'percent_milli' && rawFixed !== '') ||
    (markupMode === 'fixed_cents' && rawPercent !== '');
  if (mismatch) {
    return {
      status: 'error',
      messages: humanizeQuoteCodes(['markup_input_mismatch']),
      values: echoValues(formData),
    };
  }

  const request: QuoteDraftRequest = {
    title: str(formData, 'title'),
    client_id: str(formData, 'client_id') || undefined,
    lead_id: str(formData, 'lead_id') || undefined,
    property_id: str(formData, 'property_id') || undefined,
    quote_id: str(formData, 'quote_id') || undefined,
    scope_type: str(formData, 'scope_type') || undefined,
    jurisdiction: str(formData, 'jurisdiction') || undefined,
    quote_fees_cents: cents(formData.get('quote_fees')) ?? 0,
    markup_mode: markupMode,
    markup_value:
      markupMode === 'percent_milli'
        ? milliPct(formData.get('markup_percent'))
        : markupMode === 'fixed_cents'
          ? cents(formData.get('markup_fixed'))
          : 0,
    items: readItems(formData),
    st124_tracking:
      formData.get('st124') === 'on'
        ? { st124_claimed: 'owner_to_review' }
        : {},
    exclusions: str(formData, 'exclusions')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    // Server-generated per submission. Double-submit is prevented
    // by the pending-disabled button; a resubmit after a failure is
    // a NEW attempt and must not collide with the failed run's key.
    idempotency_key: randomUUID(),
    correlation_id: undefined,
    created_by: ctx.ownerEmail,
  };

  const result = await runQuoteDraftAgent(
    agentDeps(ctx),
    request,
  );

  if (
    (result.status === 'completed' || result.status === 'duplicate') &&
    result.quote_id
  ) {
    revalidatePath('/business/quotes');
    revalidatePath('/business');
    redirect(
      `/business/quotes/${result.quote_id}?msg=${result.status}`,
    );
  }

  const codes =
    result.status === 'failed_validation'
      ? [
          ...result.missing_fields.map((f) => `missing:${f}`),
          ...result.errors,
        ]
      : result.errors;
  return {
    status: 'error',
    messages: humanizeQuoteCodes(codes.slice(0, 10)),
    values: echoValues(formData),
  };
}

function agentDeps(ctx: OwnerContext) {
  return {
    client: ctx.client,
    ids: () => randomUUID(),
    now: () => new Date().toISOString(),
    audit: async (
      action: string,
      detail: Record<string, unknown>,
    ) => {
      await logAudit(
        {
          actor: 'quote-draft-agent',
          action,
          action_class: 'YELLOW' as const,
          environment: 'staging' as const,
          detail,
        },
        { supabase: ctx.audit },
      );
    },
  };
}

// ---------------------------------------------------------------
// Owner data entry (audit H1): clients, leads, stage moves, and
// payment facts. GREEN-class staging records with provenance and
// activity-ledger entries. Nothing sends or executes.
// ---------------------------------------------------------------

async function ownerEntryAudit(
  ctx: OwnerContext,
  action: string,
  detail: Record<string, unknown>,
) {
  await logAudit(
    {
      actor: 'owner',
      action,
      action_class: 'GREEN',
      environment: 'staging',
      detail,
    },
    { supabase: ctx.audit },
  );
}

export async function createBusinessClient(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) redirect('/business/quotes?msg=denied');
  const input = {
    display_name: str(formData, 'display_name'),
    client_type: str(formData, 'client_type') || 'residential',
    primary_email: str(formData, 'primary_email'),
    primary_phone: str(formData, 'primary_phone'),
    notes: str(formData, 'notes'),
  };
  const v = validateClientForm(input);
  if (!v.ok) {
    redirect(
      '/business/quotes?msg=' + encodeURIComponent(v.message),
    );
  }
  const id = randomUUID();
  const res = await insertBusinessRecord(
    ctx.client,
    BUSINESS_TABLES.clients,
    {
      id,
      display_name: input.display_name,
      client_type: input.client_type,
      primary_email: input.primary_email || null,
      primary_phone: input.primary_phone || null,
      notes: input.notes || null,
      source: 'owner_entry',
      provenance: { entered_by: ctx.ownerEmail },
    },
  );
  if (res.ok) {
    await insertActivityEvent(ctx.client, {
      source: 'owner_entry',
      entity_type: 'client',
      entity_id: id,
      action: 'client_created',
      summary: `Client "${input.display_name}" added by owner.`,
      actor: 'owner',
      correlation_id: `owner-entry:client:${id}`,
      idempotency_key: `act:client:${id}`,
    });
    await ownerEntryAudit(ctx, 'client_created', { client_id: id });
  }
  revalidatePath('/business/quotes');
  revalidatePath('/business');
  redirect(
    '/business/quotes?msg=' +
      encodeURIComponent(
        res.ok
          ? `Client "${input.display_name}" added.`
          : 'Client could not be saved - ' + (res.error ?? 'error'),
      ),
  );
}

export async function createSalesLead(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) redirect('/business/pipeline?msg=denied');
  const input = {
    display_name: str(formData, 'display_name'),
    stage: str(formData, 'stage') || 'lead',
    client_id: str(formData, 'client_id'),
    lead_source: str(formData, 'lead_source'),
    owner_next_action: str(formData, 'owner_next_action'),
  };
  const v = validateLeadForm(input);
  if (!v.ok) {
    redirect(
      '/business/pipeline?msg=' + encodeURIComponent(v.message),
    );
  }
  const id = randomUUID();
  const res = await insertBusinessRecord(
    ctx.client,
    BUSINESS_TABLES.leads,
    {
      id,
      display_name: input.display_name,
      stage: input.stage,
      client_id: input.client_id || null,
      lead_source: input.lead_source || null,
      owner_next_action: input.owner_next_action || null,
      source: 'owner_entry',
      provenance: { entered_by: ctx.ownerEmail },
    },
  );
  if (res.ok) {
    await insertActivityEvent(ctx.client, {
      source: 'owner_entry',
      entity_type: 'lead',
      entity_id: id,
      action: 'lead_created',
      summary:
        `Lead "${input.display_name}" added at stage ` +
        `${input.stage}.`,
      actor: 'owner',
      correlation_id: `owner-entry:lead:${id}`,
      idempotency_key: `act:lead:${id}`,
    });
    await ownerEntryAudit(ctx, 'lead_created', { lead_id: id });
  }
  revalidatePath('/business/pipeline');
  revalidatePath('/business');
  redirect(
    '/business/pipeline?msg=' +
      encodeURIComponent(
        res.ok
          ? `Lead "${input.display_name}" added.`
          : 'Lead could not be saved - ' + (res.error ?? 'error'),
      ),
  );
}

export async function moveLeadStage(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) redirect('/business/pipeline?msg=denied');
  const leadId = str(formData, 'lead_id');
  const fromStage = str(formData, 'from_stage');
  const toStage = str(formData, 'to_stage');
  const v = validateStageChange(toStage);
  if (!v.ok || toStage === fromStage) {
    redirect(
      '/business/pipeline?msg=' +
        encodeURIComponent(
          v.ok ? 'Pick a different stage.' : v.message,
        ),
    );
  }
  const res = await updateLeadStageCAS(
    ctx.client,
    leadId,
    fromStage,
    toStage,
    new Date().toISOString(),
  );
  if (res.ok) {
    await insertActivityEvent(ctx.client, {
      source: 'owner_entry',
      entity_type: 'lead',
      entity_id: leadId,
      action: 'lead_stage_changed',
      summary: `Lead moved ${fromStage} -> ${toStage}.`,
      actor: 'owner',
      correlation_id: `owner-entry:lead:${leadId}`,
      idempotency_key: `act:lead-stage:${leadId}:${toStage}:${fromStage}`,
    });
    await ownerEntryAudit(ctx, 'lead_stage_changed', {
      lead_id: leadId,
      to: toStage,
    });
  }
  revalidatePath('/business/pipeline');
  redirect(
    '/business/pipeline?msg=' +
      encodeURIComponent(
        res.ok
          ? `Moved to ${toStage}.`
          : res.error === 'stage_changed_elsewhere'
            ? 'Stage changed elsewhere - list refreshed.'
            : 'Stage move failed - ' + (res.error ?? 'error'),
      ),
  );
}

export async function recordPaymentEvent(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) redirect('/business/payments?msg=denied');
  const input = {
    project_id: str(formData, 'project_id'),
    quote_id: str(formData, 'quote_id'),
    kind: str(formData, 'kind'),
    amount_cents: cents(formData.get('amount')),
    method: str(formData, 'method'),
    note: str(formData, 'note'),
  };
  const v = validatePaymentForm(input);
  if (!v.ok) {
    redirect(
      '/business/payments?msg=' + encodeURIComponent(v.message),
    );
  }
  const id = randomUUID();
  const res = await insertBusinessRecord(
    ctx.client,
    BUSINESS_TABLES.paymentEvents,
    {
      id,
      project_id: input.project_id || null,
      quote_id: input.quote_id || null,
      kind: input.kind,
      amount_cents: input.amount_cents,
      method: input.method || null,
      recorded_by: ctx.ownerEmail,
      note: input.note || null,
      correlation_id: `owner-entry:payment:${id}`,
      idempotency_key: `payment:${id}`,
    },
  );
  if (res.ok) {
    await insertActivityEvent(ctx.client, {
      source: 'owner_entry',
      entity_type: input.project_id ? 'project' : 'quote',
      entity_id: input.project_id || input.quote_id,
      action: 'payment_recorded',
      summary: `Owner recorded ${input.kind}.`,
      actor: 'owner',
      correlation_id: `owner-entry:payment:${id}`,
      idempotency_key: `act:payment:${id}`,
    });
    await ownerEntryAudit(ctx, 'payment_recorded', {
      payment_event_id: id,
      kind: input.kind,
    });
  }
  revalidatePath('/business/payments');
  revalidatePath('/business');
  redirect(
    '/business/payments?msg=' +
      encodeURIComponent(
        res.ok
          ? 'Payment fact recorded.'
          : 'Payment could not be saved - ' + (res.error ?? 'error'),
      ),
  );
}

// ---------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------

// Owner-triggered recommendation generation. Runs the pure rule
// engine over current business data and persists new advice rows
// (idempotent per (kind, entity); dismissed pairs never re-fire by
// design). Advice only - nothing here acts on a business record.
export async function refreshRecommendations() {
  const ctx = await resolveOwner();
  if (!ctx) {
    redirect('/business?msg=denied');
  }
  const data = await loadBusinessData(ctx.client);
  const drafts = generateRecommendations({
    quotes: data.quotes,
    projects: data.projects,
    milestones: data.milestones,
    vendorOrders: data.vendorOrders,
    installationEvents: data.installationEvents,
    paymentSchedules: data.paymentSchedules,
    paymentEvents: data.paymentEvents,
    communications: data.communications,
    quoteVersions: data.quoteVersions,
    properties: data.properties,
    nowIso: new Date().toISOString(),
  });
  let created = 0;
  let deduped = 0;
  let failed = 0;
  for (const d of drafts) {
    const res = await insertBusinessRecord(
      ctx.client,
      BUSINESS_TABLES.recommendations,
      { ...d },
    );
    if (!res.ok) failed++;
    else if (res.duplicate) deduped++;
    else created++;
  }
  await logAudit(
    {
      actor: 'recommendation-rules',
      action: 'recommendations_generated',
      action_class: 'GREEN',
      environment: 'staging',
      detail: { evaluated: drafts.length, created, deduped, failed },
    },
    { supabase: ctx.audit },
  );
  revalidatePath('/business');
  redirect(
    '/business?msg=' +
      encodeURIComponent(
        `Recommendations: ${created} new, ${deduped} already known` +
          (failed > 0 ? `, ${failed} failed` : '') +
          '. Advice only - nothing was executed.',
      ),
  );
}

export async function decideRecommendation(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) {
    redirect(
      '/business?msg=' +
        encodeURIComponent(humanizeRecommendationOutcome('denied')),
    );
  }
  const id = str(formData, 'recommendation_id');
  const decisionRaw = str(formData, 'decision');
  const decision =
    decisionRaw === 'acknowledged' || decisionRaw === 'dismissed'
      ? decisionRaw
      : null;
  if (!decision) {
    redirect(
      '/business?msg=' +
        encodeURIComponent(humanizeRecommendationOutcome('invalid')),
    );
  }
  const outcome = await updateRecommendationStatusCAS(
    ctx.client,
    id,
    'open',
    decision,
    new Date().toISOString(),
  );
  await logAudit(
    {
      actor: 'owner',
      action: `recommendation_${decision}`,
      action_class: 'GREEN',
      environment: 'staging',
      detail: { recommendation_id: id, ok: outcome.ok },
    },
    { supabase: ctx.audit },
  );
  revalidatePath('/business');
  redirect(
    '/business?msg=' +
      encodeURIComponent(
        humanizeRecommendationOutcome(
          outcome.ok ? decision : (outcome.error ?? 'error'),
        ),
      ),
  );
}
