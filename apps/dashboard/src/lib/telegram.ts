import {
  assertOwnerChatId,
  isDisabled,
  scrubOutboundMessage,
} from './guards';

// Telegram Stage 1: OUTBOUND NOTIFICATION-ONLY. Hardcoded mode - not
// configurable by env. No webhook, no polling, no inbound handling,
// no command execution from Telegram. Stage 2 (APPROVE/DENY replies)
// is future backlog behind its own gate (see NEXT_GATES.md).
export const TELEGRAM_MODE = 'notify_only' as const;

export interface NotifyResult {
  sent: boolean;
  reason: string;
}

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

// Fail-closed rules, all enforced BEFORE any network call:
// - missing token or owner chat id -> module disabled, no send
// - chat id mismatch -> GuardError (logged by caller to access_events)
// - secret-shaped content -> GuardError from the scrubber
// - DISABLE_ALL_AI_WRITES not explicitly false -> no send
// Telegram unavailable -> { sent: false }; the underlying action never
// executes or auto-approves anything; caller logs the failure.
export async function notifyOwner(
  text: string,
  chatId: string,
  opts?: { env?: Env; fetchImpl?: FetchLike },
): Promise<NotifyResult> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const token = env['TELEGRAM_BOT_TOKEN'];
  const owner = env['TELEGRAM_OWNER_CHAT_ID'];

  if (!token || !owner) {
    return { sent: false, reason: 'telegram_not_configured' };
  }
  assertOwnerChatId(chatId, owner);
  const safe = scrubOutboundMessage(text);
  if (isDisabled('DISABLE_ALL_AI_WRITES', env)) {
    return { sent: false, reason: 'shutoff_disable_all_ai_writes' };
  }

  try {
    const res = await fetchImpl(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: safe }),
      },
    );
    if (!res.ok) {
      return { sent: false, reason: 'telegram_http_' + res.status };
    }
    return { sent: true, reason: 'ok' };
  } catch {
    return { sent: false, reason: 'telegram_unreachable' };
  }
}
