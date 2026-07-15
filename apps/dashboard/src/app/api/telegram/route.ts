import { NextResponse } from 'next/server';
import { evaluateWebhook } from '@/lib/ai-os/telegram-security';

// Preston AI OS - Telegram receiver (Phase 4B.1). DISABLED by default.
// All authenticity/replay/freshness/size logic lives in evaluateWebhook (pure,
// tested). This route only adapts the HTTP request. It NEVER sends a Telegram
// message, runs shell, or executes a business action. Command insertion (via a
// service identity) is a later owner gate; for now it returns the parsed intent.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const contentLengthRaw = request.headers.get('content-length');
  const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null;
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');

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
    env: process.env as Record<string, string | undefined>,
    now: new Date().toISOString(),
    // Durable replay dedup is enforced at command insertion via the unique
    // idempotency_key telegram:<update_id>; a later activation gate wires a
    // persisted check here. Until then, never treat as replay.
    isReplay: () => false,
  });

  // Never send a Telegram message; report the parsed intent only. Accepted
  // state-change commands still require confirmation before any effect.
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
