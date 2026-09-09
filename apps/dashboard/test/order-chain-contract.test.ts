import { describe, expect, it } from 'vitest';
import {
  applyContractEvent,
  checkTemplateBinding,
  isCompletionPending,
  isSignedContract,
  type ContractRecord,
  type ProviderEvent,
} from '../src/lib/business/order-chain/contract-state';
import {
  completedContract,
  draftedContract,
  SIGNED_AT,
  STALE_TEMPLATE_SHA,
  TEMPLATE_SHA,
} from './order-chain-fixtures';

function sent(): ContractRecord {
  const t = applyContractEvent(draftedContract(), {
    type: 'mark_sent',
    provider_envelope_id: 'env-001',
    at: '2026-09-01T10:00:00.000Z',
  });
  if (!t.ok) throw new Error('fixture: send failed');
  return t.contract;
}

function completedEvent(over: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    type: 'provider_event',
    provider_event_id: 'evt-complete-1',
    event_type: 'envelope-completed',
    provider_envelope_id: 'env-001',
    provider_event_verified: true,
    occurred_at: SIGNED_AT,
    ...over,
  };
}

describe('contract state - completion requires a verified provider event', () => {
  it('walks drafted -> sent -> viewed -> completed on verified events', () => {
    const s = sent();
    expect(s.state).toBe('sent');
    const v = applyContractEvent(s, { type: 'mark_viewed', at: SIGNED_AT });
    expect(v.ok && v.contract.state).toBe('viewed');
    const c = applyContractEvent(v.contract, completedEvent());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.contract.state).toBe('completed');
    expect(c.contract.signed_at).toBe(SIGNED_AT);
    expect(c.contract.provider_event_verified).toBe(true);
    expect(c.provider_event_id).toBe('evt-complete-1');
    expect(isSignedContract(c.contract, TEMPLATE_SHA)).toEqual({ ok: true });
  });

  it('email text can never complete a contract, whatever it says', () => {
    const s = sent();
    const r = applyContractEvent(s, {
      type: 'message_text',
      text: 'Completed: All parties have signed the envelope env-001.',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unverified_source');
    expect(r.contract).toEqual(s);
  });

  it('an unverified provider event does not complete', () => {
    const r = applyContractEvent(
      sent(),
      completedEvent({ provider_event_verified: false }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('provider_event_unverified');
  });

  it('there is no input shape that sets completed without a provider event', () => {
    // Exhaustive: every non-provider event type from sent/viewed.
    const s = sent();
    const kinds = ['mark_sent', 'mark_viewed', 'void', 'expire', 'supersede'];
    for (const type of kinds) {
      const r = applyContractEvent(s, {
        type,
        at: SIGNED_AT,
        provider_envelope_id: 'env-001',
      } as never);
      if (r.ok) expect(r.contract.state).not.toBe('completed');
    }
  });

  it('rejects a duplicate provider_event_id (replayed webhook)', () => {
    const s = sent();
    const first = applyContractEvent(s, completedEvent(), []);
    expect(first.ok).toBe(true);
    const replay = applyContractEvent(s, completedEvent(), ['evt-complete-1']);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('duplicate_provider_event');
  });

  it('refuses a completion for a different envelope', () => {
    const r = applyContractEvent(
      sent(),
      completedEvent({ provider_envelope_id: 'env-OTHER' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('envelope_mismatch');
  });

  it('a delayed or missing webhook keeps the contract pending, not signed', () => {
    const s = sent();
    expect(isCompletionPending(s)).toBe(true);
    const signed = isSignedContract(s, TEMPLATE_SHA);
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.reason).toBe('not_completed');
    expect(isCompletionPending(completedContract())).toBe(false);
  });

  it('completion cannot happen from drafted (no envelope was sent)', () => {
    const r = applyContractEvent(draftedContract(), completedEvent());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_transition');
  });

  it('terminal states refuse further transitions', () => {
    const voided = applyContractEvent(sent(), { type: 'void', at: SIGNED_AT });
    expect(voided.ok && voided.contract.state).toBe('voided');
    const r = applyContractEvent(voided.contract, completedEvent());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('terminal_state');
  });

  it('a completed contract can only be superseded', () => {
    const c = completedContract();
    const v = applyContractEvent(c, { type: 'void', at: SIGNED_AT });
    expect(v.ok).toBe(false);
    const s = applyContractEvent(c, { type: 'supersede', at: SIGNED_AT });
    expect(s.ok && s.contract.state).toBe('superseded');
  });

  it('a verified provider void after completion is refused', () => {
    const r = applyContractEvent(
      completedContract(),
      completedEvent({ event_type: 'envelope-voided', provider_event_id: 'evt-v' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('terminal_state');
  });

  it('never mutates the input contract', () => {
    const s = sent();
    const snapshot = JSON.stringify(s);
    applyContractEvent(s, completedEvent());
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('contract state - template version binding', () => {
  it('a contract bound to a superseded template is stale', () => {
    const c = completedContract();
    expect(checkTemplateBinding(c, STALE_TEMPLATE_SHA)).toEqual({
      ok: false,
      reason: 'stale_contract',
    });
    const signed = isSignedContract(c, STALE_TEMPLATE_SHA);
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.reason).toBe('stale_contract');
  });

  it('an unknown current template fails closed', () => {
    expect(checkTemplateBinding(completedContract(), null)).toEqual({
      ok: false,
      reason: 'template_unknown',
    });
  });

  it('a completed row without provider verification is not signed', () => {
    const c = { ...completedContract(), provider_event_verified: false };
    const r = isSignedContract(c, TEMPLATE_SHA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('provider_not_verified');
  });
});
