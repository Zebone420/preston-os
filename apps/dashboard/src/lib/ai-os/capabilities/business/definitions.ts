// Preston AI OS - Phase 3 business capability DEFINITIONS (master build
// plan sections 10/11, PHASE 3). PURE, in-code, frozen by registry.ts.
// Each definition carries the full section-10 contract: schema/validation
// (validate_params), provenance, actor, policy (risk class), approval
// class, idempotency + side-effect key strategy, evidence, failure behavior.
//
// EVERY provider here is a SANDBOX in this phase (providers/*): no external
// system is reachable. gmail.message.send ships enabled:false and the
// executor refuses it before any adapter step; the owner gate that flips it
// is a later, explicit, reviewed code change.

import type { CapabilityDefinition } from '../registry';
import { validateGmailDraft } from './gmail-draft';
import { validateCalendarEvent } from './calendar-event';
import { validateDriveFileWrite } from './drive-file';
import { validateProposalRender } from './proposal-render';
import { validateVendorQuoteParse } from './vendor-quote-parse';
import { validateVendorQuoteReconcile } from './vendor-quote-reconcile';
import { validateIqplusIngest } from './iqplus-ingest';

export const GMAIL_MESSAGE_DRAFT = 'gmail.message.draft';
export const GMAIL_MESSAGE_SEND = 'gmail.message.send';
export const CALENDAR_EVENT_CREATE = 'calendar.event.create';
export const DRIVE_FILE_WRITE = 'drive.file.write';
export const PROPOSAL_DOCUMENT_RENDER = 'proposal.document.render';
export const VENDOR_QUOTE_PARSE = 'vendor.quote.parse';
export const VENDOR_QUOTE_RECONCILE = 'vendor.quote.reconcile';
export const IQPLUS_REPORT_INGEST = 'iqplus.report.ingest';

export const GMAIL_PROVIDER = 'gmail';
export const CALENDAR_PROVIDER = 'calendar';
export const DRIVE_PROVIDER = 'drive';
export const BUSINESS_PROVIDER = 'preston.business';

export const BUSINESS_CAPABILITY_NAMES: readonly string[] = [
  GMAIL_MESSAGE_DRAFT, GMAIL_MESSAGE_SEND, CALENDAR_EVENT_CREATE, DRIVE_FILE_WRITE,
  PROPOSAL_DOCUMENT_RENDER, VENDOR_QUOTE_PARSE, VENDOR_QUOTE_RECONCILE, IQPLUS_REPORT_INGEST,
];

export const SEND_DISABLED_REASON = 'owner_gate_not_opened';

const EXTERNAL_EVIDENCE =
  'side_effects row + SideEffectRecorded event + canonical payload echo ' +
  '(provider_state sandbox_only)';
const INTERNAL_EVIDENCE = 'side_effects row + SideEffectRecorded event + output hash';
const KEY_STRATEGY = 'capability:project_id:payload_hash (business/replay.ts)';

export const BUSINESS_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    name: GMAIL_MESSAGE_DRAFT,
    version: 1,
    provider: GMAIL_PROVIDER,
    operation_kind: 'write',
    risk_class: 'YELLOW',
    requires_approval: true,
    target_scope: 'one Gmail DRAFT from an alias-registry sender to allowlisted recipients',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: true,
    artifact_output: false,
    approval_class: 'EXTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'business runner / worker proposal with alias + allowlist inputs',
    actor: 'trusted executor -> gmail sandbox adapter',
    side_effect_key: KEY_STRATEGY,
    evidence: EXTERNAL_EVIDENCE,
    failure_behavior: 'policy refusal terminal before ledger; adapter fault uncertain',
    validate_params: validateGmailDraft,
  },
  {
    name: GMAIL_MESSAGE_SEND,
    version: 1,
    provider: GMAIL_PROVIDER,
    operation_kind: 'write',
    risk_class: 'RED',
    requires_approval: true,
    target_scope: 'DISABLED: no message may leave Preston until the owner gate opens',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: true,
    artifact_output: false,
    approval_class: 'EXTERNAL',
    enabled: false,
    disabled_reason: SEND_DISABLED_REASON,
    provenance: 'none in this phase (registered for contract completeness only)',
    actor: 'trusted executor (refuses before any adapter)',
    side_effect_key: KEY_STRATEGY,
    evidence: 'static refusal capability_disabled:owner_gate_not_opened',
    failure_behavior: 'always terminal capability_disabled; approval cannot lift it',
    validate_params: validateGmailDraft,
  },
  {
    name: CALENDAR_EVENT_CREATE,
    version: 1,
    provider: CALENDAR_PROVIDER,
    operation_kind: 'write',
    risk_class: 'RED',
    requires_approval: true,
    target_scope: 'one calendar event for a CONFIRMED project with allowlisted attendees',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: false,
    artifact_output: false,
    approval_class: 'EXTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'business runner with confirmed project identity + allowlist inputs',
    actor: 'trusted executor -> calendar sandbox adapter',
    side_effect_key: KEY_STRATEGY,
    evidence: EXTERNAL_EVIDENCE,
    failure_behavior: 'policy refusal terminal before ledger; adapter fault uncertain',
    validate_params: validateCalendarEvent,
  },
  {
    name: DRIVE_FILE_WRITE,
    version: 1,
    provider: DRIVE_PROVIDER,
    operation_kind: 'write',
    risk_class: 'YELLOW',
    requires_approval: true,
    target_scope:
      'CREATE one canonically named file in the bound project folder (never move/delete)',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: true,
    artifact_output: true,
    approval_class: 'EXTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'business runner with project + folder binding + document hash inputs',
    actor: 'trusted executor -> drive sandbox adapter',
    side_effect_key: KEY_STRATEGY,
    evidence: EXTERNAL_EVIDENCE,
    failure_behavior: 'policy refusal terminal before ledger; adapter fault uncertain',
    validate_params: validateDriveFileWrite,
  },
  {
    name: PROPOSAL_DOCUMENT_RENDER,
    version: 1,
    provider: BUSINESS_PROVIDER,
    operation_kind: 'write',
    risk_class: 'GREEN',
    requires_approval: false,
    target_scope: 'internal versioned document descriptor from structured quote input',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: false,
    artifact_output: true,
    approval_class: 'INTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'deterministic price engine output (arithmetic is input)',
    actor: 'trusted executor -> internal deterministic runner',
    side_effect_key: KEY_STRATEGY,
    evidence: INTERNAL_EVIDENCE,
    failure_behavior: 'totals_not_reconciled terminal before ledger',
    validate_params: validateProposalRender,
  },
  {
    name: VENDOR_QUOTE_PARSE,
    version: 1,
    provider: BUSINESS_PROVIDER,
    operation_kind: 'read',
    risk_class: 'GREEN',
    requires_approval: false,
    target_scope: 'parse one vendor quote text fixture; no external read',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: true,
    artifact_output: true,
    approval_class: 'INTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'Gmail/Drive ingestion (text already stored as a document)',
    actor: 'trusted executor -> internal deterministic runner',
    side_effect_key: KEY_STRATEGY,
    evidence: INTERNAL_EVIDENCE,
    failure_behavior: 'schema refusal terminal; parse never throws (warnings)',
    validate_params: validateVendorQuoteParse,
  },
  {
    name: VENDOR_QUOTE_RECONCILE,
    version: 1,
    provider: BUSINESS_PROVIDER,
    operation_kind: 'read',
    risk_class: 'GREEN',
    requires_approval: false,
    target_scope: 'compare parsed vendor quote vs requested spec; no external read',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: true,
    artifact_output: true,
    approval_class: 'INTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'vendor.quote.parse output + IQ+/NQR requested spec',
    actor: 'trusted executor -> internal deterministic runner',
    side_effect_key: KEY_STRATEGY,
    evidence: INTERNAL_EVIDENCE,
    failure_behavior: 'any mismatch => output reconciliation_failed with diffs',
    validate_params: validateVendorQuoteReconcile,
  },
  {
    name: IQPLUS_REPORT_INGEST,
    version: 1,
    provider: BUSINESS_PROVIDER,
    operation_kind: 'read',
    risk_class: 'GREEN',
    requires_approval: false,
    target_scope: 'parse one IQ+ abbreviated report text fixture; no prices; no contacts',
    timeout_ms: 10_000,
    idempotency_strategy: 'ledger_key',
    dry_run_supported: true,
    artifact_input: true,
    artifact_output: true,
    approval_class: 'INTERNAL',
    enabled: true,
    disabled_reason: null,
    provenance: 'IQ+ report already stored as a document',
    actor: 'trusted executor -> internal deterministic runner',
    side_effect_key: KEY_STRATEGY,
    evidence: INTERNAL_EVIDENCE,
    failure_behavior: 'client_contact_leakage / report_unrecognized terminal before ledger',
    validate_params: validateIqplusIngest,
  },
];
