// Preston AI OS - Telegram command bridge (Phase 3). PURE parser + intake.
// Telegram is a REMOTE CONTROL surface, disabled until an owner activation
// gate. It parses owner commands into typed intents; it never executes shell,
// never sends a message, and never exposes secrets. Owner identity + chat
// allowlist + replay protection are enforced here; rate-limit/confirmation are
// contract expectations for the activation layer.

export type TelegramCommandName =
  | '/status'
  | '/pause'
  | '/resume'
  | '/stop'
  | '/approve'
  | '/reject'
  | '/build_next'
  | '/job'
  | '/agents'
  | '/health'
  | '/checkpoint';

const COMMANDS: readonly TelegramCommandName[] = [
  '/status', '/pause', '/resume', '/stop', '/approve', '/reject',
  '/build_next', '/job', '/agents', '/health', '/checkpoint',
];

// State-changing commands require an explicit confirmation step before the
// activation layer acts on them.
const STATE_CHANGING: ReadonlySet<TelegramCommandName> = new Set([
  '/pause', '/resume', '/stop', '/approve', '/reject', '/build_next',
]);

export interface TelegramUpdate {
  chat_id: string;
  from_id: string;
  text: string;
  message_id: number;
  date: number; // unix seconds
}

export interface ParsedTelegram {
  name: TelegramCommandName;
  args: string[];
}

// Parse a raw message into a typed command, or null if not a known command.
export function parseTelegram(text: string): ParsedTelegram | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  const name = parts[0].toLowerCase() as TelegramCommandName;
  if (!COMMANDS.includes(name)) return null;
  return { name, args: parts.slice(1) };
}

export interface TelegramIntakeOpts {
  ownerChatId: string;
  ownerUserId: string;
  seenMessageIds: Set<number>; // replay protection (caller persists)
  now: string;
  maxAgeSec?: number; // command freshness window (default 120s)
}

export type TelegramIntakeStatus =
  | 'accepted'
  | 'denied' // wrong chat/user
  | 'replay' // message id already seen
  | 'expired' // too old
  | 'unknown'; // not a command

export interface TelegramIntakeResult {
  status: TelegramIntakeStatus;
  command: TelegramCommandName | null;
  args: string[];
  requires_confirmation: boolean;
  reason?: string;
}

// Verify owner identity + chat allowlist + replay + freshness, then classify.
// Never executes; the activation layer acts on an 'accepted' result only after
// any required confirmation.
export function intakeTelegram(
  update: TelegramUpdate,
  opts: TelegramIntakeOpts,
): TelegramIntakeResult {
  const parsed = parseTelegram(update.text);
  if (!parsed) {
    return { status: 'unknown', command: null, args: [], requires_confirmation: false, reason: 'not a command' };
  }
  // Owner identity + chat allowlist (both must match).
  if (update.chat_id !== opts.ownerChatId || update.from_id !== opts.ownerUserId) {
    return { status: 'denied', command: null, args: [], requires_confirmation: false, reason: 'not owner/allowlisted chat' };
  }
  // Replay protection.
  if (opts.seenMessageIds.has(update.message_id)) {
    return { status: 'replay', command: null, args: [], requires_confirmation: false, reason: 'duplicate message id' };
  }
  // Freshness (command expiration).
  const maxAge = opts.maxAgeSec ?? 120;
  const ageSec = Math.floor(Date.parse(opts.now) / 1000) - update.date;
  if (ageSec > maxAge) {
    return { status: 'expired', command: null, args: [], requires_confirmation: false, reason: 'command too old' };
  }
  return {
    status: 'accepted',
    command: parsed.name,
    args: parsed.args,
    requires_confirmation: STATE_CHANGING.has(parsed.name),
  };
}

// Safe, secret-free rendering hint for a response (the activation layer sends).
export function renderTelegramReply(command: TelegramCommandName, body: string): string {
  return `${command}: ${body}`;
}
