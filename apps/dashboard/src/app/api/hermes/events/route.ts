import { NextResponse } from 'next/server';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { hermesToolContext, pollPrestonEvents } from '@/lib/hermes/adapter';

// Hermes Supervisor Dashboard v0 - live activity feed transport. Owner
// session only (same resolveOwner chokepoint as every /api/os route);
// READ ONLY: delegates to the supported preston_poll_events operation and
// returns its result verbatim. cursor_invalid passes through as the
// tool's own { ok:false, error:'cursor_invalid' } - the client surfaces a
// re-anchor state; it is NEVER flattened into an empty feed here.
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const ctx = await resolveOwner();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'owner authorization required' },
      { status: 401 },
    );
  }
  const url = new URL(request.url);
  const cursorRaw = url.searchParams.get('cursor');
  const cursor = cursorRaw === null || cursorRaw === ''
    ? undefined
    : cursorRaw;
  const limitRaw = Number(url.searchParams.get('limit') ?? '');
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)))
    : undefined;
  const out = await pollPrestonEvents(hermesToolContext(ctx), {
    cursor,
    limit,
  });
  return NextResponse.json(out, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
