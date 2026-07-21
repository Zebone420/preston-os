// AI recommendation rule engine (Phase 6C).
//
// Deterministic, pure rules over business rows with an injected
// clock. Produces ADVICE ONLY: every recommendation requires owner
// approval/acknowledgement and nothing here can act, send, or
// modify a business record. Idempotency keys are stable per
// (kind, entity) so re-running generation never duplicates rows.

import {
  asBool,
  asNumber,
  asString,
  buildProjectPaymentSummary,
  type Row,
} from './read-models';
import type {
  RecommendationConfidence,
  RecommendationKind,
} from './types';

export interface RecommendationDraft {
  kind: RecommendationKind;
  entity_type: string;
  entity_id: string;
  evidence: string[];
  assumptions: string[];
  confidence: RecommendationConfidence;
  suggested_next_step: string;
  approval_required: true;
  correlation_id: string;
  idempotency_key: string;
}

export interface RecommendationInputs {
  quotes: Row[];
  projects: Row[];
  milestones: Row[];
  vendorOrders: Row[];
  installationEvents: Row[];
  paymentSchedules: Row[];
  paymentEvents: Row[];
  communications: Row[];
  quoteVersions: Row[];
  properties: Row[];
  nowIso: string;
}

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / DAY_MS);
}

function make(
  kind: RecommendationKind,
  entityType: string,
  entityId: string,
  evidence: string[],
  assumptions: string[],
  confidence: RecommendationConfidence,
  nextStep: string,
): RecommendationDraft {
  return {
    kind,
    entity_type: entityType,
    entity_id: entityId,
    evidence,
    assumptions,
    confidence,
    suggested_next_step: nextStep,
    approval_required: true,
    correlation_id: `rec:${kind}:${entityId}`,
    idempotency_key: `rec:${kind}:${entityId}`,
  };
}

export function generateRecommendations(
  inputs: RecommendationInputs,
): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  const now = inputs.nowIso;

  // 1. Quote follow-up: open quote untouched for 3+ days.
  for (const q of inputs.quotes) {
    const status = asString(q.status);
    if (status !== 'draft' && status !== 'pending_approval') continue;
    const updated = asString(q.updated_at) || asString(q.created_at);
    const age = daysBetween(updated, now);
    if (age >= 3) {
      out.push(
        make(
          'quote_follow_up',
          'quote',
          asString(q.id),
          [
            `Quote "${asString(q.title)}" is ${status}.`,
            `No update recorded for ${age} days.`,
          ],
          ['Owner review may be waiting on client input.'],
          age >= 7 ? 'high' : 'medium',
          'Review the draft and decide approve, revise, or follow up.',
        ),
      );
    }
  }

  // 2/3. Per-project payment and stall checks.
  for (const p of inputs.projects) {
    const projectId = asString(p.id);
    const status = asString(p.status);
    const active = [
      'pending_contract',
      'contracted',
      'in_progress',
      'punch_list',
      'final_inspection',
    ].includes(status);
    if (!active) continue;

    const pay = buildProjectPaymentSummary(
      p,
      inputs.paymentSchedules,
      inputs.paymentEvents,
    );
    const projectOrders = inputs.vendorOrders.filter(
      (o) => asString(o.project_id) === projectId,
    );
    const orderInFlight = projectOrders.some((o) =>
      ['in_production', 'shipped', 'delivered'].includes(
        asString(o.delivery_status),
      ),
    );
    if (pay.outstanding_cents > 0 && pay.collected_cents > 0 && orderInFlight) {
      out.push(
        make(
          'missing_payment',
          'project',
          projectId,
          [
            'Deposit collected but a balance remains outstanding.',
            'Product is already ordered or in transit.',
          ],
          ['Next stage is typically collected before installation.'],
          'medium',
          'Review whether the next payment stage should be requested.',
        ),
      );
    }

    const projectMilestones = inputs.milestones.filter(
      (m) => asString(m.project_id) === projectId,
    );
    let latestTouch = asString(p.updated_at) || asString(p.created_at);
    for (const m of projectMilestones) {
      const ts = asString(m.updated_at) || asString(m.created_at);
      if (ts > latestTouch) latestTouch = ts;
    }
    const stallDays = daysBetween(latestTouch, now);
    if (stallDays >= 14) {
      out.push(
        make(
          'stalled_project',
          'project',
          projectId,
          [
            `Project "${asString(p.title)}" is ${status}.`,
            `No project or milestone update for ${stallDays} days.`,
          ],
          ['Work may be progressing without being recorded.'],
          'medium',
          'Check project status and record the current state.',
        ),
      );
    }
  }

  // 4. Delayed orders: expected ship date passed without shipment.
  for (const o of inputs.vendorOrders) {
    const status = asString(o.delivery_status);
    if (['shipped', 'delivered'].includes(status)) continue;
    const expected = asString(o.expected_ship_date);
    if (!expected) continue;
    const lateDays = daysBetween(`${expected}T00:00:00.000Z`, now);
    if (lateDays > 0) {
      out.push(
        make(
          'delayed_order',
          'vendor_order',
          asString(o.id),
          [
            `Order ${asString(o.order_number) || '(no number)'} expected ` +
              `to ship ${expected}.`,
            `${lateDays} day(s) past the expected ship date, status ` +
              `${status}.`,
          ],
          ['Vendor has not confirmed a new ship date.'],
          lateDays > 7 ? 'high' : 'medium',
          'Contact the vendor for an updated ship date.',
        ),
      );
    }
  }

  // 5. Installation risk: upcoming install with blockers.
  for (const e of inputs.installationEvents) {
    const status = asString(e.status);
    if (!['tentative', 'scheduled'].includes(status)) continue;
    const projectId = asString(e.project_id);
    const blockers: string[] = [];
    if (!asBool(e.site_ready)) blockers.push('Site not marked ready.');
    const permits = inputs.milestones.filter(
      (m) =>
        asString(m.project_id) === projectId &&
        ['permit_lpc', 'permit_dob'].includes(asString(m.kind)) &&
        !['done', 'not_applicable'].includes(asString(m.status)),
    );
    for (const m of permits) {
      blockers.push(`Milestone ${asString(m.kind)} is ` +
        `${asString(m.status)}.`);
    }
    if (blockers.length > 0) {
      out.push(
        make(
          'installation_risk',
          'installation_event',
          asString(e.id),
          [
            `Installation ${status} for ` +
              `${asString(e.scheduled_date) || '(no date)'}.`,
            ...blockers,
          ],
          ['Blockers must clear before the date can be confirmed.'],
          blockers.length > 1 ? 'high' : 'medium',
          'Resolve blockers before confirming the installation date.',
        ),
      );
    }
  }

  // 6. Missing document: LPC property without a completed LPC step.
  for (const prop of inputs.properties) {
    if (!asBool(prop.lpc_review)) continue;
    const propId = asString(prop.id);
    const relatedProjects = inputs.projects.filter(
      (p) => asString(p.property_id) === propId,
    );
    for (const p of relatedProjects) {
      const projectId = asString(p.id);
      const lpc = inputs.milestones.find(
        (m) =>
          asString(m.project_id) === projectId &&
          asString(m.kind) === 'permit_lpc',
      );
      const done =
        lpc &&
        ['done', 'not_applicable'].includes(asString(lpc.status));
      if (!done) {
        out.push(
          make(
            'missing_document',
            'project',
            projectId,
            [
              'Property is flagged for LPC review.',
              lpc
                ? `permit_lpc milestone is ${asString(lpc.status)}.`
                : 'No permit_lpc milestone recorded.',
            ],
            ['LPC approval documentation may be outstanding.'],
            'medium',
            'Confirm LPC filing status and attach documentation.',
          ),
        );
      }
    }
  }

  // 7. Margin anomaly: current quote version has zero margin.
  for (const v of inputs.quoteVersions) {
    if (asNumber(v.margin_cents) === 0 && asNumber(v.total_cents) > 0) {
      out.push(
        make(
          'margin_anomaly',
          'quote_version',
          asString(v.id),
          [
            'Quote version carries zero explicit markup/margin.',
            'Margin model is markup-only until the V4 ruling.',
          ],
          ['Owner may intend margin inside material pricing.'],
          'low',
          'Confirm intended margin before approving this draft.',
        ),
      );
    }
  }

  // 8. Client response: newest communication is inbound.
  const byClient = new Map<string, Row[]>();
  for (const c of inputs.communications) {
    const clientId = asString(c.client_id);
    if (!clientId) continue;
    const list = byClient.get(clientId) ?? [];
    list.push(c);
    byClient.set(clientId, list);
  }
  for (const [clientId, comms] of byClient) {
    const sorted = [...comms].sort((a, b) =>
      asString(a.occurred_at) < asString(b.occurred_at) ? 1 : -1,
    );
    const newest = sorted[0];
    if (newest && asString(newest.direction) === 'inbound') {
      const age = daysBetween(asString(newest.occurred_at), now);
      if (age >= 1) {
        out.push(
          make(
            'client_response',
            'client',
            clientId,
            [
              `Newest communication is inbound: ` +
                `"${asString(newest.subject)}".`,
              `Waiting ${age} day(s) without a recorded reply.`,
            ],
            ['A reply may have happened outside recorded channels.'],
            age >= 3 ? 'high' : 'medium',
            'Draft a reply for owner review (drafts are never sent).',
          ),
        );
      }
    }
  }

  // Deterministic order: kind, then entity id.
  return out.sort((a, b) =>
    a.kind === b.kind
      ? a.entity_id.localeCompare(b.entity_id)
      : a.kind.localeCompare(b.kind),
  );
}
