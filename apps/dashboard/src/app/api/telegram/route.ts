import { NextResponse } from 'next/server';
import { intakeTelegram, type TelegramUpdate } from '@/lib/ai-os/bridges/telegram';

// Preston AI OS - Telegram receiver (Phase 4B). DISABLED by default.
// A webhook endpoint that VALIDATES an owner command (owner user + chat
// allowlist, freshness) and classifies it. It NEVER sends a Telegram message,
// never runs shell, and never executes a business action. State-changing
// commands are flagged as requiring confirmation. Turning real command
// insertion on (with a service identity) is a separate owner activation gate;
// until then this only acknowledges and reports the parsed intent.
//
// Durable replay protection at activation is the command idempotency_key
// (telegram:<message_id>), which the DB unique constraint dedupes; this handler
// additionally checks owner identity + freshness.
export const dynamic = 'force-dynamic';

interface TgMessage {
  message_id?: number;
  date?: number;
  text?: string;
  chat?: { id?: number | string };
  from?: { id?: number | string };
}

export async function POST(request: Request) {
  // Fail-closed: the receiver is inert unless explicitly enabled by the owner.
  if (process.env.TELEGRAM_INTAKE_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, disabled: true }, { status: 503 });
  }
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  const ownerUserId = process.env.TELEGRAM_OWNER_USER_ID;
  if (!ownerChatId || !ownerUserId) {
    return NextResponse.json({ ok: false, error: 'intake not configured' }, { status: 503 });
  }

  let body: { message?: TgMessage };
  try {
    body = (await request.json()) as { message?: TgMessage };
  } catch {
    // Acknowledge malformed updates so Telegram does not retry-storm.
    return NextResponse.json({ ok: false, error: 'invalid update' }, { status: 200 });
  }

  const msg = body.message ?? {};
  const update: TelegramUpdate = {
    chat_id: String(msg.chat?.id ?? ''),
    from_id: String(msg.from?.id ?? ''),
    text: String(msg.text ?? ''),
    message_id: Number(msg.message_id ?? 0),
    date: Number(msg.date ?? 0),
  };

  const result = intakeTelegram(update, {
    ownerChatId,
    ownerUserId,
    seenMessageIds: new Set(), // durable dedup is the command idempotency_key at activation
    now: new Date().toISOString(),
  });

  // Always 200 to Telegram (never send a message). Report the parsed intent
  // only; accepted state-change commands still require confirmation before any
  // effect, and command insertion is a later owner-run activation step.
  return NextResponse.json(
    {
      ok: result.status === 'accepted',
      status: result.status,
      command: result.command,
      requires_confirmation: result.requires_confirmation,
    },
    { status: 200 },
  );
}
