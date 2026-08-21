import { NextResponse } from 'next/server';
import { controlSurfaceEnabled } from '@/lib/preston-control/auth';
import { buildOpenApiDocument } from '@/lib/preston-control/openapi';
import { publicOrigin } from '@/lib/preston-control/metadata';

// Preston Control (GPT Actions surface) - the bounded OpenAPI 3.1 document
// the Custom GPT imports. Public (it describes shapes, not data; the
// Supabase auth URLs it names are already NEXT_PUBLIC_), served only while
// the surface is enabled. No secrets: client id/secret live only in the GPT
// editor's OAuth form.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  if (!controlSurfaceEnabled(env, 'gpt')) {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 404 });
  }
  return NextResponse.json(buildOpenApiDocument(publicOrigin(request, env)), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
