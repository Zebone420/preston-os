import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '../src/app/api/telegram/route';

// End-to-end route tests (Phase 5G): the receiver rejects a replayed update_id
// at the ROUTE level (bounded in-process layer; the durable layer is migration
// 0006 + store.recordTelegramUpdate, bound at the command-insertion gate).
// Request objects strip Content-Length per the fetch spec, so we pass a
// header/json stub with the same surface the route consumes.

const ENV_KEYS = [
  'TELEGRAM_INTAKE_ENABLED', 'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_OWNER_CHAT_ID', 'TELEGRAM_OWNER_USER_ID',
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

function enableIntake() {
  process.env['TELEGRAM_INTAKE_ENABLED'] = 'true';
  process.env['TELEGRAM_WEBHOOK_SECRET'] = 's3cr3t';
  process.env['TELEGRAM_OWNER_CHAT_ID'] = 'chat-1';
  process.env['TELEGRAM_OWNER_USER_ID'] = 'user-1';
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function update(id: number) {
  return {
    update_id: id,
    message: {
      message_id: 1, date: Math.floor(Date.now() / 1000), text: '/status',
      chat: { id: 'chat-1' }, from: { id: 'user-1' },
    },
  };
}

function req(body: unknown, secret = 's3cr3t'): Request {
  const raw = JSON.stringify(body);
  return {
    headers: new Headers({
      'content-length': String(raw.length),
      'x-telegram-bot-api-secret-token': secret,
    }),
    json: async () => JSON.parse(raw) as unknown,
  } as unknown as Request;
}

describe('POST /api/telegram - replay rejection end-to-end', () => {
  it('is disabled by default (503, no processing)', async () => {
    delete process.env['TELEGRAM_INTAKE_ENABLED'];
    const res = await POST(req(update(1)));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('disabled');
  });

  it('accepts a fresh owner update once, then rejects its replay', async () => {
    enableIntake();
    const first = await POST(req(update(424201)));
    expect((await first.json()).status).toBe('accepted');
    const replayed = await POST(req(update(424201)));
    const body = await replayed.json();
    expect(body.status).toBe('replay');
    expect(body.ok).toBe(false);
  });

  it('a rejected (wrong-secret) update is NOT remembered - no dedup poisoning', async () => {
    enableIntake();
    const forged = await POST(req(update(424202), 'wrong-secret'));
    expect(forged.status).toBe(403);
    const legit = await POST(req(update(424202)));
    expect((await legit.json()).status).toBe('accepted');
  });
});
