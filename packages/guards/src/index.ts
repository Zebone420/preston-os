// Preston AI safety guards. Phase 0B: every guard fails closed.

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

export const SHUTOFF_FLAGS = [
  'DISABLE_ALL_AI_WRITES',
  'DISABLE_CLIENT_MESSAGES',
  'DISABLE_EMAIL_SEND',
  'DISABLE_CALENDAR_WRITES',
  'DISABLE_AIRTABLE_PROD_WRITES',
  'DISABLE_N8N_ACTIVATION',
  'DISABLE_REMOTE_RUNNER',
  'DISABLE_PRODUCTION_DEPLOY',
] as const;

export type ShutoffFlag = (typeof SHUTOFF_FLAGS)[number];

type Env = Record<string, string | undefined>;

// Fail closed: unknown flag, missing value, or any value other than
// the literal string "false" means BLOCKED.
export function isDisabled(flag: string, env: Env = process.env): boolean {
  if (!(SHUTOFF_FLAGS as readonly string[]).includes(flag)) return true;
  const v = env[flag];
  if (v === undefined || v.trim() === '') return true;
  return v.trim().toLowerCase() !== 'false';
}

// Phase 0B: every send path is blocked unconditionally.
export function assertNoSend(channel: string): never {
  throw new GuardError(
    'no-send guard: sending via "' + channel + '" is blocked in Phase 0B',
  );
}

export function assertNoProdWrite(environment: string): void {
  if (environment === 'production') {
    throw new GuardError(
      'production-write guard: production writes are blocked',
    );
  }
}

export function assertAirtableTestOnly(
  baseId: string,
  allowedBaseId: string | undefined,
): void {
  if (!allowedBaseId || allowedBaseId.trim() === '') {
    throw new GuardError(
      'airtable guard: AIRTABLE_TEST_BASE_ID is not configured',
    );
  }
  if (baseId !== allowedBaseId.trim()) {
    throw new GuardError(
      'airtable guard: base is not on the TEST/DEV allowlist',
    );
  }
}

export function assertNoN8nActivation(payload: unknown): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    if (obj['active'] === true) {
      throw new GuardError(
        'n8n guard: workflow activation payloads are blocked',
      );
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(payload);
}

export function assertOwnerChatId(
  chatId: string,
  ownerChatId: string | undefined,
): void {
  if (!ownerChatId || ownerChatId.trim() === '') {
    throw new GuardError('telegram guard: owner chat id is not configured');
  }
  if (chatId !== ownerChatId.trim()) {
    throw new GuardError('telegram guard: chat id is not the owner');
  }
}

// Outbound message scrubber: blocks secret-shaped strings from ever
// leaving in a notification. Throws on match. The private-key pattern
// is assembled from parts so this file cannot match scanners itself.
const KEY_BLOCK = new RegExp('-----BEGIN' + ' [A-Z ]*PRIVATE KEY');
const SECRET_PATTERNS: RegExp[] = [
  KEY_BLOCK,
  /eyJ[A-Za-z0-9_-]{15,}\.eyJ/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{20,}/,
  /[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/,
];

export function scrubOutboundMessage(text: string): string {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new GuardError(
        'scrubber: outbound message contains a secret-shaped string',
      );
    }
  }
  return text;
}

// Untrusted external content (Phase 1: Gmail/Calendar/email/web text).
// External content is DATA ONLY and never instruction authority
// (CLAUDE.md rule 12). This neutralizes it for safe handling: normalizes
// newlines, removes control characters except tab and newline, trims, and
// caps length. Callers must never execute or follow any instruction found
// inside the returned text.
export const UNTRUSTED_MAX_LEN = 2000;

export function neutralizeUntrusted(
  text: unknown,
  maxLen: number = UNTRUSTED_MAX_LEN,
): string {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + ' [truncated]';
}
