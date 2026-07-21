'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import {
  updateRecommendationStatusCAS,
} from '@/lib/business/business-store';
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

// Dollars-and-cents form field -> integer cents. "1200" -> 120000,
// "1200.50" -> 120050. Invalid input becomes NaN so validation
// rejects it instead of silently coercing.
function cents(v: FormDataEntryValue | null): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  if (Number.isNaN(n)) return Number.NaN;
  return Math.round(n * 100);
}

function readItems(formData: FormData): QuoteItemInput[] {
  const items: QuoteItemInput[] = [];
  for (let i = 1; i <= 5; i++) {
    const label = String(formData.get(`item${i}_label`) ?? '').trim();
    const description = String(
      formData.get(`item${i}_description`) ?? '',
    ).trim();
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
      product_line: String(
        formData.get(`item${i}_product_line`) ?? '',
      ).trim(),
      description,
      quantity,
      unit_material_cents: material,
      unit_labor_cents: labor,
      line_fees_cents: fees,
    });
  }
  return items;
}

export async function createQuoteDraft(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) {
    redirect('/business/quotes?msg=denied');
  }

  const markupModeRaw = String(formData.get('markup_mode') ?? 'none');
  const request: QuoteDraftRequest = {
    title: String(formData.get('title') ?? '').trim(),
    client_id: String(formData.get('client_id') ?? '').trim() || undefined,
    lead_id: String(formData.get('lead_id') ?? '').trim() || undefined,
    property_id:
      String(formData.get('property_id') ?? '').trim() || undefined,
    quote_id: String(formData.get('quote_id') ?? '').trim() || undefined,
    scope_type: String(formData.get('scope_type') ?? '') || undefined,
    jurisdiction:
      String(formData.get('jurisdiction') ?? '') || undefined,
    quote_fees_cents: cents(formData.get('quote_fees')) ?? 0,
    markup_mode: markupModeRaw,
    markup_value:
      markupModeRaw === 'percent_milli'
        ? (num(formData.get('markup_percent')) ?? 0) * 1000
        : markupModeRaw === 'fixed_cents'
          ? (cents(formData.get('markup_fixed')) ?? 0)
          : 0,
    items: readItems(formData),
    st124_tracking:
      formData.get('st124') === 'on'
        ? { st124_claimed: 'owner_to_review' }
        : {},
    exclusions: String(formData.get('exclusions') ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    idempotency_key:
      String(formData.get('idempotency_key') ?? '').trim() ||
      randomUUID(),
    correlation_id: undefined,
    created_by: ctx.ownerEmail,
  };

  const result = await runQuoteDraftAgent(
    {
      client: ctx.client,
      ids: () => randomUUID(),
      now: () => new Date().toISOString(),
      audit: async (action, detail) => {
        await logAudit(
          {
            actor: 'quote-draft-agent',
            action,
            action_class: 'YELLOW',
            environment: 'staging',
            detail,
          },
          { supabase: ctx.audit },
        );
      },
    },
    request,
  );

  revalidatePath('/business/quotes');
  revalidatePath('/business');
  if (result.status === 'completed' || result.status === 'duplicate') {
    redirect(
      `/business/quotes/${result.quote_id}?msg=${result.status}`,
    );
  }
  const detail =
    result.status === 'failed_validation'
      ? [...result.missing_fields, ...result.errors].slice(0, 8).join(',')
      : result.errors.slice(0, 3).join(',');
  redirect(
    `/business/quotes?msg=${result.status}&detail=${encodeURIComponent(detail)}`,
  );
}

export async function decideRecommendation(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) {
    redirect('/business?msg=denied');
  }
  const id = String(formData.get('recommendation_id') ?? '');
  const decisionRaw = String(formData.get('decision') ?? '');
  const decision =
    decisionRaw === 'acknowledged' || decisionRaw === 'dismissed'
      ? decisionRaw
      : null;
  if (!decision) {
    redirect('/business?msg=invalid');
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
    '/business?msg=' + (outcome.ok ? decision : outcome.error ?? 'error'),
  );
}
