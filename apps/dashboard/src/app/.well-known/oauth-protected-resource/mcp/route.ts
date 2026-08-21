import { NextResponse } from 'next/server';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import { protectedResourceMetadata } from '@/lib/preston-control/metadata';

// RFC 9728 path-insert form (/.well-known/oauth-protected-resource/mcp):
// identical document to the root form. Route-segment config must be literal
// per file, hence the small duplication instead of a re-export.
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
