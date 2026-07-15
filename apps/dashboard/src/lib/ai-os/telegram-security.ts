import { parseTelegram, type TelegramCommandName } from './bridges/telegram';

// Preston AI OS - Telegram webhook security (Phase 4B.1). PURE + testable.
// HTTP bodies can be forged, so owner ids alone are insufficient: the webhook
// secret token (Telegram's X-Telegram-Bot-Api-Secret-Token, compared in
// constant time) is the primary authenticity check. Also enforces max body
// size, freshness, replay dedup (durable via an injected `seen` predicate),
// and default-deny for unknown payloads. Never sends; never executes.

export const MAX_UPDATE_BYTES = 16 * 1024;

// Constant-time string comparison (no early return on mismatch). Pure JS so it
// is deterministic and testable in any environment.
export function constantTimeEqual(a: string, b: string): boolean {
  const av = a ?? '';
  const bv = b ?? '';
  // Compare against a fixed length to avoid leaking length via timing.
  const len = Math.max(av.length, bv.length);
  let diff = av.length ^ bv.length;
  for (let i = 0; i < len; i++) {
    diff |= (av.charCodeAt(i) || 0) ^ (bv.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type WebhookStatus =
  | 'accepted'
  | 'disabled' // intake not enabled
  | 'unconfigured' // required env missing
  | 'forbidden' // secret token missing/wrong, or wrong owner/chat
  | 'too_large'
  | 'replay'
  | 'expired'
  | 'unknown'; // unparseable / not a known command

export interface WebhookInput {
  secretHeader: string | null; // X-Telegram-Bot-Api-Secret-Token
  contentLength: number | null;
  body: unknown; // parsed JSON (or null)
  env: Record<string, string | undefined>;
  now: string;
  isReplay: (updateId: number) => boolean; // durable dedup, injected
}

export interface WebhookResult {
  status: WebhookStatus;
  httpStatus: number;
  command: TelegramCommandName | null;
  requires_confirmation: boolean;
}

interface TgBody {
  update_id?: number;
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number | string };
  };
}

function res(status: WebhookStatus, httpStatus: number): WebhookResult {
  return { status, httpStatus, command: null, requires_confirmation: false };
}

// Evaluate an inbound webhook. Order: enabled -> configured -> size -> secret ->
// owner identity -> freshness -> replay -> command parse. Fail-closed at every
// step; default-deny unknown payloads.
export function evaluateWebhook(input: WebhookInput): WebhookResult {
  const { env } = input;
  if (env['TELEGRAM_INTAKE_ENABLED'] !== 'true') return res('disabled', 503);

  const secret = env['TELEGRAM_WEBHOOK_SECRET'];
  const ownerChatId = env['TELEGRAM_OWNER_CHAT_ID'];
  const ownerUserId = env['TELEGRAM_OWNER_USER_ID'];
  if (!secret || !ownerChatId || !ownerUserId) return res('unconfigured', 503);

  if (input.contentLength !== null && input.contentLength > MAX_UPDATE_BYTES) {
    return res('too_large', 413);
  }
  // Authenticity: constant-time secret-token check BEFORE trusting the body.
  if (!input.secretHeader || !constantTimeEqual(input.secretHeader, secret)) {
    return res('forbidden', 403);
  }

  const body = (input.body ?? {}) as TgBody;
  const msg = body.message;
  if (!msg || typeof msg.text !== 'string') return res('unknown', 200);

  const chatId = String(msg.chat?.id ?? '');
  const fromId = String(msg.from?.id ?? '');
  if (chatId !== ownerChatId || fromId !== ownerUserId) return res('forbidden', 403);

  // Freshness (reject stale updates).
  const ageSec = Math.floor(Date.parse(input.now) / 1000) - Number(msg.date ?? 0);
  if (ageSec > 120) return res('expired', 200);

  // Durable replay dedup by update_id (injected predicate).
  const updateId = Number(body.update_id ?? 0);
  if (input.isReplay(updateId)) return res('replay', 200);

  const parsed = parseTelegram(msg.text);
  if (!parsed) return res('unknown', 200);

  return {
    status: 'accepted',
    httpStatus: 200,
    command: parsed.name,
    requires_confirmation: ['/pause', '/resume', '/stop', '/approve', '/reject', '/build_next'].includes(parsed.name),
  };
}
