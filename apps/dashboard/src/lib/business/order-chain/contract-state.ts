// Order chain - contract state machine (Phase 5 SAFE unit).
//
// Pure, deterministic. Mirrors public.contracts (migration 0032).
//
//   drafted -> sent -> viewed -> completed
//   drafted|sent|viewed -> voided | expired | superseded
//   completed -> superseded (a newer contract replaces it)
//
// COMPLETION IS PROVIDER-EVIDENCE ONLY. The only input that can move
// a contract to 'completed' is a provider event whose
// provider_event_verified flag is true and whose provider_event_id
// has never been seen. Email text, chat text, or an owner saying
// "they signed" can never complete a contract through this module;
// the 'message_text' input exists precisely so that path is refused
// by construction rather than by omission.
//
// Nothing here sends anything. There is no provider client. DocuSign
// is retained as the provider (owner rule, plan section 19), and the
// provider CHECK in 0032 pins that.

import { isIsoTimestamp } from './actor';
import { isSha256 } from './hash';

export type ContractState =
  | 'drafted'
  | 'sent'
  | 'viewed'
  | 'completed'
  | 'voided'
  | 'expired'
  | 'superseded';

export const CONTRACT_STATES: readonly ContractState[] = [
  'drafted',
  'sent',
  'viewed',
  'completed',
  'voided',
  'expired',
  'superseded',
];

export type ContractProvider = 'docusign';

export interface ContractRecord {
  id: string;
  project_id: string;
  quote_version_id: string;
  template_id: string;
  template_sha256: string;
  provider: ContractProvider;
  provider_envelope_id: string | null;
  state: ContractState;
  signed_at: string | null;
  provider_event_verified: boolean;
  payload_hash: string;
  included_forms: string[];
}

export interface ContractTemplateRecord {
  id: string;
  name: string;
  version: number;
  sha256: string;
  required_forms: string[];
  approved_by: string | null;
  approved_at: string | null;
  is_current: boolean;
}

export type ProviderEventType =
  | 'envelope-sent'
  | 'envelope-delivered'
  | 'envelope-completed'
  | 'envelope-declined'
  | 'envelope-voided';

export interface ProviderEvent {
  type: 'provider_event';
  provider_event_id: string;
  event_type: ProviderEventType;
  provider_envelope_id: string;
  provider_event_verified: boolean;
  occurred_at: string;
}

export type ContractEvent =
  | { type: 'mark_sent'; provider_envelope_id: string; at: string }
  | { type: 'mark_viewed'; at: string }
  | ProviderEvent
  | { type: 'void'; at: string }
  | { type: 'expire'; at: string }
  | { type: 'supersede'; at: string }
  // Free text from any channel. Always refused: data, never authority.
  | { type: 'message_text'; text: string };

export type ContractRefusal =
  | 'unverified_source'
  | 'provider_event_unverified'
  | 'duplicate_provider_event'
  | 'envelope_mismatch'
  | 'invalid_transition'
  | 'terminal_state'
  | 'invalid_event'
  | 'issuance_unbound';

export type ContractTransition =
  | { ok: true; contract: ContractRecord; provider_event_id: string | null }
  | { ok: false; reason: ContractRefusal; contract: ContractRecord };

const TERMINAL: ReadonlySet<ContractState> = new Set([
  'voided',
  'expired',
  'superseded',
]);

function refuse(
  contract: ContractRecord,
  reason: ContractRefusal,
): ContractTransition {
  return { ok: false, reason, contract };
}

function accept(
  contract: ContractRecord,
  providerEventId: string | null = null,
): ContractTransition {
  return { ok: true, contract, provider_event_id: providerEventId };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasIssuanceBindings(contract: ContractRecord): boolean {
  return nonEmpty(contract.quote_version_id) && isSha256(contract.payload_hash) &&
    Array.isArray(contract.included_forms);
}

// Apply one event. knownEventIds is the set of provider_event_id
// values already recorded for this contract (from
// contract_provider_events); a repeat is refused before any state
// logic runs. The input contract is never mutated.
export function applyContractEvent(
  contract: ContractRecord,
  event: ContractEvent,
  knownEventIds: Iterable<string> = [],
): ContractTransition {
  if (event.type === 'message_text') {
    return refuse(contract, 'unverified_source');
  }
  if (TERMINAL.has(contract.state)) {
    return refuse(contract, 'terminal_state');
  }
  const known = new Set(knownEventIds);

  if (event.type === 'provider_event') {
    if (
      !nonEmpty(event.provider_event_id) ||
      !nonEmpty(event.provider_envelope_id) ||
      !nonEmpty(event.occurred_at)
    ) {
      return refuse(contract, 'invalid_event');
    }
    if (known.has(event.provider_event_id)) {
      return refuse(contract, 'duplicate_provider_event');
    }
    if (event.provider_event_verified !== true) {
      return refuse(contract, 'provider_event_unverified');
    }
    if (
      contract.provider_envelope_id !== null &&
      contract.provider_envelope_id !== event.provider_envelope_id
    ) {
      return refuse(contract, 'envelope_mismatch');
    }
    return applyProviderEvent(contract, event);
  }

  if (contract.state === 'completed') {
    if (event.type === 'supersede') {
      return accept({ ...contract, state: 'superseded' });
    }
    return refuse(contract, 'terminal_state');
  }

  switch (event.type) {
    case 'mark_sent':
      if (contract.state !== 'drafted') {
        return refuse(contract, 'invalid_transition');
      }
      if (!nonEmpty(event.provider_envelope_id)) {
        return refuse(contract, 'invalid_event');
      }
      if (!hasIssuanceBindings(contract)) {
        return refuse(contract, 'issuance_unbound');
      }
      return accept({
        ...contract,
        state: 'sent',
        provider_envelope_id: event.provider_envelope_id,
      });
    case 'mark_viewed':
      if (contract.state !== 'sent') {
        return refuse(contract, 'invalid_transition');
      }
      return accept({ ...contract, state: 'viewed' });
    case 'void':
      return accept({ ...contract, state: 'voided' });
    case 'expire':
      return accept({ ...contract, state: 'expired' });
    case 'supersede':
      return accept({ ...contract, state: 'superseded' });
    default:
      return refuse(contract, 'invalid_event');
  }
}

function applyProviderEvent(
  contract: ContractRecord,
  event: ProviderEvent,
): ContractTransition {
  const id = event.provider_event_id;
  const bound = {
    ...contract,
    provider_envelope_id: event.provider_envelope_id,
  };
  switch (event.event_type) {
    case 'envelope-sent':
      if (contract.state !== 'drafted') {
        return refuse(contract, 'invalid_transition');
      }
      if (!hasIssuanceBindings(contract)) {
        return refuse(contract, 'issuance_unbound');
      }
      return accept({ ...bound, state: 'sent' }, id);
    case 'envelope-delivered':
      if (contract.state !== 'sent') {
        return refuse(contract, 'invalid_transition');
      }
      return accept({ ...bound, state: 'viewed' }, id);
    case 'envelope-completed':
      if (contract.state !== 'sent' && contract.state !== 'viewed') {
        return refuse(contract, 'invalid_transition');
      }
      return accept(
        {
          ...bound,
          state: 'completed',
          signed_at: event.occurred_at,
          provider_event_verified: true,
        },
        id,
      );
    case 'envelope-declined':
    case 'envelope-voided':
      if (contract.state === 'completed') {
        return refuse(contract, 'terminal_state');
      }
      return accept({ ...bound, state: 'voided' }, id);
    default:
      return refuse(contract, 'invalid_event');
  }
}

// Version binding: a contract is only valid against the template
// version it was generated from. If the registry's current template
// hash differs, the contract is stale and nothing downstream may
// rely on it until re-issued.
export type TemplateBinding =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'template_unknown'
        | 'template_not_current'
        | 'template_not_approved'
        | 'template_id_mismatch'
        | 'stale_contract'
        | 'document_unbound'
        | 'quote_unbound'
        | 'required_form_missing';
    };

export function checkTemplateBinding(
  contract: Pick<
    ContractRecord,
    'template_id' | 'template_sha256' | 'payload_hash' | 'quote_version_id' |
      'included_forms'
  >,
  template: ContractTemplateRecord | null | undefined,
): TemplateBinding {
  if (!template) {
    return { ok: false, reason: 'template_unknown' };
  }
  if (template.is_current !== true) {
    return { ok: false, reason: 'template_not_current' };
  }
  if (!nonEmpty(template.approved_by) || !isIsoTimestamp(template.approved_at)) {
    return { ok: false, reason: 'template_not_approved' };
  }
  if (contract.template_id !== template.id) {
    return { ok: false, reason: 'template_id_mismatch' };
  }
  if (!isSha256(template.sha256) || contract.template_sha256 !== template.sha256) {
    return { ok: false, reason: 'stale_contract' };
  }
  if (!isSha256(contract.payload_hash)) {
    return { ok: false, reason: 'document_unbound' };
  }
  if (!nonEmpty(contract.quote_version_id)) {
    return { ok: false, reason: 'quote_unbound' };
  }
  const included = new Set(
    Array.isArray(contract.included_forms) ? contract.included_forms : [],
  );
  const required = Array.isArray(template.required_forms)
    ? template.required_forms.filter(nonEmpty)
    : [];
  if (required.some((form) => !included.has(form))) {
    return { ok: false, reason: 'required_form_missing' };
  }
  return { ok: true };
}

// A signed contract for order-gate purposes: completed, driven by a
// verified provider event, and still bound to the current template.
export type SignedCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not_completed'
        | 'provider_not_verified'
        | 'stale_contract'
        | 'template_unknown'
        | 'template_not_current'
        | 'template_not_approved'
        | 'template_id_mismatch'
        | 'document_unbound'
        | 'quote_unbound'
        | 'required_form_missing'
        | 'missing_signed_at';
    };

export function isSignedContract(
  contract: ContractRecord,
  template: ContractTemplateRecord | null | undefined,
): SignedCheck {
  if (contract.state !== 'completed') {
    return { ok: false, reason: 'not_completed' };
  }
  if (contract.provider_event_verified !== true) {
    return { ok: false, reason: 'provider_not_verified' };
  }
  if (!nonEmpty(contract.signed_at)) {
    return { ok: false, reason: 'missing_signed_at' };
  }
  const binding = checkTemplateBinding(contract, template);
  if (!binding.ok) return binding;
  return { ok: true };
}

// A delayed or missing webhook leaves the contract pending: it is
// neither signed nor failed. Callers must treat pending as NOT signed.
export function isCompletionPending(contract: ContractRecord): boolean {
  return contract.state === 'sent' || contract.state === 'viewed';
}
