import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateControlRequest } from '@/lib/preston-control/auth';
import { clientFor, deniedResponse as denied } from '@/lib/preston-control/http';
import { buildPrestonControlServer } from '@/lib/preston-control/server';
import type { ComposerClient } from '@/lib/ai-os/orchestration/composer-persist';

// Preston Control - ChatGPT MCP endpoint (Streamable HTTP, stateless).
// DISABLED by default (PRESTON_CONTROL_ENABLED must be exactly 'true').
// Cookie-less (proxy exclusion); every request is authenticated by the OAuth
// bearer the ChatGPT client obtained from the Supabase Auth OAuth server, and
// the tools run under THAT owner session (RLS-bound; never the service role,
// never the runtime service identity). Unauthenticated requests answer 401 +
// WWW-Authenticate pointing at the RFC 9728 protected-resource metadata, which
// is how the MCP client discovers the authorization server.
//
// Fail-closed, interface-only: this route never runs shell, git, SQL text, or
// execution; it adapts six existing owner functions (see lib/preston-control).
// An outage here leaves the timer, runtime service, dashboard, intake, and
// approvals untouched - nothing in Preston depends on this surface.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const env = process.env as Record<string, string | undefined>;

  // Size gate BEFORE the body is read; missing/NaN Content-Length rejected.
  const clRaw = request.headers.get('content-length');
  const contentLength = clRaw === null ? null : Number(clRaw);
  if (contentLength === null || Number.isNaN(contentLength) || contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, status: 'too_large' }, { status: 413 });
  }

  const auth = await authenticateControlRequest(
    request.headers.get('authorization'), env, { clientFor }, 'mcp',
  );
  if (!auth.ok) return denied(auth, request);

  const server = buildPrestonControlServer({
    client: auth.client as unknown as ComposerClient,
    ownerEmail: auth.ownerEmail,
    now: new Date().toISOString(),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session to hijack or replay
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    // One server per request; release resources regardless of outcome.
    void server.close().catch(() => undefined);
  }
}

// Stateless mode: no SSE resumption stream, no session deletion.
export async function GET(request: Request) {
  const env = process.env as Record<string, string | undefined>;
  const auth = await authenticateControlRequest(
    request.headers.get('authorization'), env, { clientFor }, 'mcp',
  );
  if (!auth.ok) return denied(auth, request);
  return NextResponse.json({ ok: false, status: 'method_not_allowed' }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ ok: false, status: 'method_not_allowed' }, { status: 405 });
}
