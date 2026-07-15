import { describe, expect, it } from 'vitest';
import { constantTimeEqual, evaluateWebhook, MAX_UPDATE_BYTES } from '../src/lib/ai-os/telegram-security';

const NOW = '2026-07-14T12:00:00.000Z';
const nowSec = Math.floor(Date.parse(NOW) / 1000);

const ENV = {
  TELEGRAM_INTAKE_ENABLED: 'true',
  TELEGRAM_WEBHOOK_SECRET: 'super-secret-token',
  TELEGRAM_OWNER_CHAT_ID: 'owner-chat',
  TELEGRAM_OWNER_USER_ID: 'owner-user',
};

function update(text: string, over: Record<string, unknown> = {}) {
  return {
    update_id: 100,
    message: { message_id: 1, date: nowSec, text, chat: { id: 'owner-chat' }, from: { id: 'owner-user' } },
    ...over,
  };
}

function evalW(over: Partial<Parameters<typeof evaluateWebhook>[0]> = {}) {
  return evaluateWebhook({
    secretHeader: 'super-secret-token',
    contentLength: 100,
    body: update('/status'),
    env: ENV,
    now: NOW,
    isReplay: () => false,
    ...over,
  });
}

describe('constantTimeEqual', () => {
  it('is true for equal strings, false otherwise (incl. length diff)', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('evaluateWebhook - fail-closed authenticity', () => {
  it('disabled unless intake is enabled', () => {
    expect(evalW({ env: { ...ENV, TELEGRAM_INTAKE_ENABLED: 'false' } }).status).toBe('disabled');
  });
  it('unconfigured when the webhook secret or owner ids are missing', () => {
    expect(evalW({ env: { ...ENV, TELEGRAM_WEBHOOK_SECRET: '' } }).status).toBe('unconfigured');
  });
  it('rejects an oversize body', () => {
    expect(evalW({ contentLength: MAX_UPDATE_BYTES + 1 }).status).toBe('too_large');
  });
  it('rejects a missing or NaN Content-Length (fail-closed)', () => {
    expect(evalW({ contentLength: null }).status).toBe('too_large');
    expect(evalW({ contentLength: Number.NaN }).status).toBe('too_large');
  });
  it('forbids a missing or wrong secret token (before trusting the body)', () => {
    expect(evalW({ secretHeader: null }).status).toBe('forbidden');
    expect(evalW({ secretHeader: 'wrong' }).status).toBe('forbidden');
  });
  it('forbids a non-owner chat/user even with the right secret', () => {
    expect(evalW({ body: update('/status', { message: { message_id: 1, date: nowSec, text: '/status', chat: { id: 'other' }, from: { id: 'owner-user' } } }) }).status).toBe('forbidden');
    expect(evalW({ body: update('/status', { message: { message_id: 1, date: nowSec, text: '/status', chat: { id: 'owner-chat' }, from: { id: 'intruder' } } }) }).status).toBe('forbidden');
  });
  it('accepts a valid, fresh owner command and flags confirmation', () => {
    expect(evalW().status).toBe('accepted');
    expect(evalW().command).toBe('/status');
    expect(evalW().requires_confirmation).toBe(false);
    expect(evalW({ body: update('/stop') }).requires_confirmation).toBe(true);
  });
  it('rejects a stale update', () => {
    const stale = update('/status', { message: { message_id: 1, date: nowSec - 600, text: '/status', chat: { id: 'owner-chat' }, from: { id: 'owner-user' } } });
    expect(evalW({ body: stale }).status).toBe('expired');
  });
  it('rejects a replayed update_id (durable dedup predicate)', () => {
    expect(evalW({ isReplay: (id) => id === 100 }).status).toBe('replay');
  });
  it('denies an unknown/unparseable payload by default', () => {
    expect(evalW({ body: null }).status).toBe('unknown');
    expect(evalW({ body: update('hello not a command') }).status).toBe('unknown');
  });
});
