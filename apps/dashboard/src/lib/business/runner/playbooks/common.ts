// Shared defaults for the v1 playbook declarations. Every capability id
// and predicate name below is a STRING REFERENCE to another lane's
// contract (identity, stage-gates, comms detectors, capabilities,
// order-chain). Nothing is imported or executed from those lanes.

import type { RetryPolicy, WorkerUse } from '../playbook';

export const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_RETRIES: RetryPolicy = { max: 3, backoff_ms: 6 * HOUR_MS };

export const NO_WORKER: WorkerUse = { kind: 'none' };

// Predicate names owned by other lanes (data-only inputs to the runner).
export const PRED = {
  identityConfirmed: 'identity.confirmed',
  projectMatchResolved: 'project.match.resolved',
  leadParsed: 'lead.parsed',
  detectorFindings: 'detector.findings_available',
  availabilityStaffSelected: 'availability.staff_selected',
  visitSlotSelected: 'visit.slot_selected',
  openingsNormalized: 'openings.normalized',
  openingsFinalValidated: 'openings.final_measure_validated',
  scopeBuilt: 'scope.built',
  contactLeakClear: 'contact_leak.clear',
  vendorQuoteReconciled: 'vendor_quote.reconciled',
  quoteEngineCalculated: 'quote_engine.calculated',
  quoteArithmeticValidated: 'quote.arithmetic_validated',
  inboundReplyAbsent: 'inbound.reply_absent',
  gateContractProviderVerified: 'stage_gate.contract_provider_verified',
  gateFinalMeasureAfter3Days: 'stage_gate.final_measure_after_3_business_days',
  gatePoHashBound: 'stage_gate.po_hash_bound_to_final_measure',
  orderEligibility: 'order_eligibility',
} as const;

// Capability ids owned by other lanes (proposed through, never called).
export const CAP = {
  projectMatchPropose: 'project.match.propose',
  dealFindingRecord: 'deal.finding.record',
  timelineEventRecord: 'timeline.event.record',
  documentRegister: 'document.register',
  gmailDraft: 'gmail.message.draft',
  gmailSend: 'gmail.message.send',
  calendarEventCreate: 'calendar.event.create',
  proposalRender: 'proposal.document.render',
  contractPackageRender: 'contract.package.render',
  poRender: 'po.document.render',
  vendorQuoteRequestSend: 'vendor.quote.request.send',
  vendorQuoteParse: 'vendor.quote.parse',
  vendorQuoteReconcile: 'vendor.quote.reconcile',
  docusignEnvelopeSend: 'docusign.envelope.send',
  vendorOrderPlace: 'vendor.order.place',
  followUpClockArm: 'follow_up.clock.arm',
  followUpClockTouch: 'follow_up.clock.touch',
} as const;
