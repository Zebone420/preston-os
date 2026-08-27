// Preston AI OS - os-runtime Telegram sender (fast-track Phase H).
//
// This is the OS-RUNTIME PORT of lib/telegram.notifyOwner: the compiled
// dispatcher cannot import lib/telegram (its guard chain re-exports from
// packages/guards, outside the runtime build's rootDir), so the SAME
// fail-closed contract is implemented here self-contained - the same parity
// idiom as the bash ports of the ps1 scanners. Any change to one side must
// be mirrored in the other (lib/telegram.ts <-> this file).
//
// Contract (all enforced BEFORE any network call):
//   - missing token or owner chat id  -> not configured, no send
//   - chat id != configured owner id  -> refused (owner-only channel)
//   - secret-shaped content           -> refused (scrubber throws-equivalent)
//   - DISABLE_ALL_AI_WRITES not exactly 'false' -> shutoff, no send
//   - notify-only: no webhook, no polling, no inbound handling.

export interface RuntimeNotifyResult {
  sent: boolean;
  reason: string;
}

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

// Same secret shapes as packages/guards scrubOutboundMessage (assembled so
// scanners cannot match this file itself).
const KEY_BLOCK = new RegExp('-----BEGIN' + ' [A-Z ]*PRIVATE KEY');
const SECRET_PATTERNS: readonly RegExp[] = [
  KEY_BLOCK,
  /eyJ[A-Za-z0-9_-]{15,}\.eyJ/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/,
];

export async function runtimeNotifyOwner(
  text: string,
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<RuntimeNotifyResult> {
  const token = String(env['TELEGRAM_BOT_TOKEN'] ?? '').trim();
  const owner = String(env['TELEGRAM_OWNER_CHAT_ID'] ?? '').trim();
  if (!token || !owner) return { sent: false, reason: 'telegram_not_configured' };
  for (const p of SECRET_PATTERNS) {
    if (p.test(text)) return { sent: false, reason: 'secret_shaped_content_refused' };
  }
  const shutoff = String(env['DISABLE_ALL_AI_WRITES'] ?? '').trim().toLowerCase();
  if (shutoff !== 'false') {
    return { sent: false, reason: 'shutoff_disable_all_ai_writes' };
  }
  try {
    const res = await fetchImpl(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: owner, text }),
      },
    );
    if (!res.ok) return { sent: false, reason: 'telegram_http_' + res.status };
    return { sent: true, reason: 'ok' };
  } catch {
    return { sent: false, reason: 'telegram_unreachable' };
  }
}
