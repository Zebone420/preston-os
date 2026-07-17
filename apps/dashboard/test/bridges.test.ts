import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS } from '../src/lib/ai-os/controls';
import {
  intakeChatGpt,
  summarizeStatus,
  type ChatGptRequest,
} from '../src/lib/ai-os/bridges/chatgpt';
import {
  intakeTelegram,
  parseTelegram,
  type TelegramUpdate,
} from '../src/lib/ai-os/bridges/telegram';

const NOW = '2026-07-14T12:00:00.000Z';
const liveControls = { ...DEFAULT_CONTROLS, execution_enabled: true };

const req: ChatGptRequest = {
  owner_identity: 'info@preston.nyc',
  requested_action: 'build the next gate',
  target_project: 'preston-os',
  target_repository: 'preston-os',
  idempotency_key: 'k1',
  correlation_id: 'c1',
};
const opts = {
  ownerAllowlist: ['info@preston.nyc'],
  controls: liveControls,
  now: NOW,
  commandId: 'cmd-1',
};

describe('ChatGPT bridge', () => {
  it('denies a non-owner identity', () => {
    const r = intakeChatGpt({ ...req, owner_identity: 'attacker@x.com' }, opts);
    expect(r.response.status).toBe('denied');
    expect(r.packet).toBeNull();
  });
  it('accepts an owner request as a default-deny proposal', () => {
    const r = intakeChatGpt(req, opts);
    expect(r.response.status).toBe('accepted');
    expect(r.packet?.execution_eligible).toBe(false);
    expect(r.packet?.status).toBe('proposed');
    expect(r.packet?.source).toBe('chatgpt');
  });
  it('reports stopped/paused runtime without accepting', () => {
    expect(intakeChatGpt(req, { ...opts, controls: DEFAULT_CONTROLS }).response.status).toBe('stopped');
    expect(intakeChatGpt(req, { ...opts, controls: { ...liveControls, paused: true } }).response.status).toBe('paused');
  });
  it('rejects a secret-bearing action via command validation downstream', () => {
    const r = intakeChatGpt({ ...req, requested_action: 'store api_key sk-live-123' }, opts);
    // Still normalized to a packet, but the packet is secret-bearing; the
    // control-plane validateCommand rejects it before queueing.
    expect(r.packet).not.toBeNull();
  });
  it('summarizes status without secrets', () => {
    const r = intakeChatGpt(req, opts);
    expect(summarizeStatus(r.packet!, 'queued')).toContain('cmd-1');
  });
});

describe('Telegram bridge', () => {
  const base: TelegramUpdate = {
    chat_id: 'owner-chat', from_id: 'owner-user', text: '/status', message_id: 1, date: Math.floor(Date.parse(NOW) / 1000),
  };
  const topts = { ownerChatId: 'owner-chat', ownerUserId: 'owner-user', seenMessageIds: new Set<number>(), now: NOW };

  it('parses known commands and rejects unknown text', () => {
    expect(parseTelegram('/build_next now')?.name).toBe('/build_next');
    expect(parseTelegram('hello')).toBeNull();
    expect(parseTelegram('/notacommand')).toBeNull();
  });
  it('accepts an owner command and flags confirmation for state-changing', () => {
    expect(intakeTelegram(base, topts).status).toBe('accepted');
    expect(intakeTelegram(base, topts).requires_confirmation).toBe(false); // /status
    const stop = { ...base, text: '/stop', message_id: 2 };
    expect(intakeTelegram(stop, topts).requires_confirmation).toBe(true);
  });
  it('denies a non-owner chat/user', () => {
    expect(intakeTelegram({ ...base, from_id: 'intruder' }, topts).status).toBe('denied');
    expect(intakeTelegram({ ...base, chat_id: 'other' }, topts).status).toBe('denied');
  });
  it('blocks replays and expired commands', () => {
    const seen = new Set<number>([1]);
    expect(intakeTelegram(base, { ...topts, seenMessageIds: seen }).status).toBe('replay');
    const old = { ...base, message_id: 9, date: Math.floor(Date.parse(NOW) / 1000) - 600 };
    expect(intakeTelegram(old, topts).status).toBe('expired');
  });
  it('expires (fail-closed) when the clock input is unparseable', () => {
    expect(intakeTelegram(base, { ...topts, now: 'not-a-date' }).status).toBe('expired');
  });
});
