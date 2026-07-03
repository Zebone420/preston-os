import { describe, expect, it } from 'vitest';
import {
  GuardError,
  assertAirtableTestOnly,
  assertNoN8nActivation,
  assertNoProdWrite,
  assertNoSend,
  assertOwnerChatId,
  isDisabled,
  scrubOutboundMessage,
} from '../src/index';

describe('isDisabled (fail closed)', () => {
  it('blocks when the flag is missing', () => {
    expect(isDisabled('DISABLE_EMAIL_SEND', {})).toBe(true);
  });
  it('blocks when the value is empty', () => {
    expect(isDisabled('DISABLE_EMAIL_SEND', { DISABLE_EMAIL_SEND: '' })).toBe(
      true,
    );
  });
  it('blocks on any value except the literal false', () => {
    expect(isDisabled('DISABLE_EMAIL_SEND', { DISABLE_EMAIL_SEND: 'no' })).toBe(
      true,
    );
  });
  it('blocks unknown flags even when set to false', () => {
    expect(isDisabled('DISABLE_UNKNOWN', { DISABLE_UNKNOWN: 'false' })).toBe(
      true,
    );
  });
  it('allows only when explicitly false', () => {
    expect(
      isDisabled('DISABLE_EMAIL_SEND', { DISABLE_EMAIL_SEND: 'false' }),
    ).toBe(false);
  });
});

describe('assertNoSend', () => {
  it('blocks every channel in Phase 0B', () => {
    for (const ch of ['email', 'sms', 'whatsapp', 'client_telegram']) {
      expect(() => assertNoSend(ch)).toThrow(GuardError);
    }
  });
});

describe('assertNoProdWrite', () => {
  it('blocks production', () => {
    expect(() => assertNoProdWrite('production')).toThrow(GuardError);
  });
  it('allows test_dev and staging', () => {
    expect(() => assertNoProdWrite('test_dev')).not.toThrow();
    expect(() => assertNoProdWrite('staging')).not.toThrow();
  });
});

describe('assertAirtableTestOnly', () => {
  it('blocks when no allowlist is configured', () => {
    expect(() => assertAirtableTestOnly('appAAA', undefined)).toThrow(
      GuardError,
    );
  });
  it('blocks bases not on the allowlist', () => {
    expect(() => assertAirtableTestOnly('appPROD', 'appTEST')).toThrow(
      GuardError,
    );
  });
  it('allows the TEST base', () => {
    expect(() => assertAirtableTestOnly('appTEST', 'appTEST')).not.toThrow();
  });
});

describe('assertNoN8nActivation', () => {
  it('blocks payloads that set active true, even nested', () => {
    expect(() =>
      assertNoN8nActivation({ workflow: { settings: { active: true } } }),
    ).toThrow(GuardError);
  });
  it('allows inactive drafts', () => {
    expect(() => assertNoN8nActivation({ active: false })).not.toThrow();
  });
});

describe('assertOwnerChatId', () => {
  it('blocks when the owner id is not configured', () => {
    expect(() => assertOwnerChatId('123', undefined)).toThrow(GuardError);
  });
  it('blocks non-owner chat ids', () => {
    expect(() => assertOwnerChatId('999', '123')).toThrow(GuardError);
  });
  it('allows the owner chat id', () => {
    expect(() => assertOwnerChatId('123', '123')).not.toThrow();
  });
});

describe('scrubOutboundMessage', () => {
  it('blocks api-key shaped strings (fixture built at runtime)', () => {
    const fake = 'sk-' + 'a'.repeat(24);
    expect(() => scrubOutboundMessage('key: ' + fake)).toThrow(GuardError);
  });
  it('blocks telegram-token shaped strings', () => {
    const fake = '12345678:AA' + 'b'.repeat(33);
    expect(() => scrubOutboundMessage(fake)).toThrow(GuardError);
  });
  it('blocks private-key headers', () => {
    const fake = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
    expect(() => scrubOutboundMessage(fake)).toThrow(GuardError);
  });
  it('allows ordinary notifications', () => {
    const msg = 'Approval requested: task 42 (YELLOW) awaits your decision.';
    expect(scrubOutboundMessage(msg)).toBe(msg);
  });
});
