import { NextResponse } from 'next/server';
import {
  constantTimeEqual,
  evaluateWebhook,
  MAX_UPDATE_BYTES,
} from '@/lib/ai-os/telegram-security';

// Preston AI OS - Telegram receiver (Phase 4B.1). DISABLED by default.
// Fail-closed HEADER-ONLY guards run BEFORE the body is read, so an
// unauthenticated caller cannot force a large buffered parse: intake-enabled +
// configured + Content-Length (reject missing/NaN/oversize) + constant-time
// secret token. Only then is the (bounded, authenticated) body parsed and the
// rest validated by evaluateWebhook. This route NEVER sends a Telegram message,
// runs shell, or executes a business action.
export const dynamic = 'force-dynamic';

// Bounded in-process replay memory (layer 1 of the Phase 5G dedup; see below).
// Insertion-ordered; oldest ids are evicted at the cap so memory stays bounded.
const SEEN_CAP = 5000;
const seenUpdateIds = new Set<number>();
function rememberUpdateId(id: number): void {
  seenUpdateIds.add(id);
  if (seenUpdateIds.size > SEEN_CAP) {
    const oldest = seenUpdateIds.values().next().value;
    if (oldest !== undefined) seenUpdateIds.delete(oldest);
  }
}

export async function POST(request: Request) {
  const env = process.env as Record<string, string | undefined>;

  if (env['TELEGRAM_INTAKE_ENABLED'] !== 'true') {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
  }
  const secret = env['TELEGRAM_WEBHOOK_SECRET'];
  if (!secret || !env['TELEGRAM_OWNER_CHAT_ID'] || !env['TELEGRAM_OWNER_USER_ID']) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  // Size gate BEFORE reading the body; missing/NaN Content-Length is rejected.
  const clRaw = request.headers.get('content-length');
  const contentLength = clRaw === null ? null : Number(clRaw);
  if (contentLength === null || Number.isNaN(contentLength) || contentLength > MAX_UPDATE_BYTES) {
    return NextResponse.json({ ok: false, status: 'too_large' }, { status: 413 });
  }

  // Authenticity (constant-time) BEFORE trusting/parsing the body.
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');
  if (!secretHeader || !constantTimeEqual(secretHeader, secret)) {
    return NextResponse.json({ ok: false, status: 'forbidden' }, { status: 403 });
  }

  // Body is now bounded + authenticated; safe to parse.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null; // handled as unknown/deny by the evaluator
  }

  const result = evaluateWebhook({
    secretHeader,
    contentLength,
    body,
    env,
    now: new Date().toISOString(),
    // Replay dedup, two layers (Phase 5G):
    //  1. HERE: a bounded in-process update_id set - best-effort, per-instance,
    //     lost on restart, and check-then-set (not atomic). Acceptable ONLY
    //     because this route performs no side effect.
    //  2. DURABLE (authored, NOT yet bound): migration 0006 telegram_updates +
    //     store.recordTelegramUpdate (unique update_id, atomic, cross-instance).
    //     It MUST be wired before this route ever gains a side effect - that
    //     is the command-insertion activation gate, which also supplies the
    //     service-identity client this credential-less route lacks.
    isReplay: (updateId) => seenUpdateIds.has(updateId),
  });

  if (result.status === 'accepted') {
    const updateId = Number((body as { update_id?: unknown } | null)?.update_id ?? 0);
    if (Number.isInteger(updateId) && updateId > 0) rememberUpdateId(updateId);
  }

  return NextResponse.json(
    {
      ok: result.status === 'accepted',
      status: result.status,
      command: result.command,
      requires_confirmation: result.requires_confirmation,
    },
    { status: result.httpStatus },
  );
}
