import { NextResponse } from 'next/server';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import { protectedResourceMetadata } from '@/lib/preston-control/metadata';

// RFC 9728 Protected Resource Metadata for Preston Control (/mcp). Public,
// read-only, secret-free; served only while the control surface is enabled.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  if (!controlSurfaceEnabled(env)) {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 404 });
  }
  const meta = protectedResourceMetadata(request, env);
  if (!meta) return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  return NextResponse.json(meta, { headers: { 'cache-control': 'public, max-age=300' } });
}
