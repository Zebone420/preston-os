// Preston Control - GPT Actions (REST) transport adapter helpers.
// Sibling of server.ts (MCP). Both call the SAME tools.ts service layer with
// the SAME auth.ts gates; this surface uses the 'gpt' OAuth client so a
// Custom GPT grant can be revoked independently of the MCP plugin.
//
// Shape: header-first fail-closed gates (size, bearer -> Supabase verify ->
// client_id -> owner allowlist -> is_owner()), zod-validated JSON bodies /
// query strings (strict: unknown keys rejected), and the tools' projected,
// secret-screened output. Errors are tag-only; no raw DB message leaks.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { ZodType } from 'zod';
import {
  authenticateControlRequest,
  type AuthResult,
  type ControlClient,
  type ControlSurface,
} from './auth';
import { protectedResourceMetadataUrl } from './metadata';
import type { ToolContext } from './tools';
import type { ComposerClient } from '@/lib/ai-os/orchestration/composer-persist';

export const CONTROL_API_PREFIX = '/api/control';
const MAX_BODY_BYTES = 16 * 1024;

// Surfaces accepted by the READ-ONLY operations (status, get_goal,
// get_job, list_approvals, poll_events, get_evidence, get_artifact).
// The 'hermes' dashboard surface appears HERE and nowhere else: the
// write/consequential routes (submit, follow-up, decision, cancel) keep
// the default ['gpt'], so a hermes-client token is wrong_client there by
// construction. Pinned in preston-control-hermes-surface.test.ts.
export const READ_SURFACES: readonly ControlSurface[] = ['gpt', 'hermes'];

export function clientFor(token: string): ControlClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // Anon key + the OWNER's bearer: PostgREST evaluates RLS / is_owner() under
  // auth.uid() of the token. No session persistence, no refresh.
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as ControlClient;
}

export function deniedResponse(auth: Exclude<AuthResult, { ok: true }>, request: Request): Response {
  const headers: Record<string, string> = {};
  if (auth.httpStatus === 401) {
    headers['WWW-Authenticate'] =
      `Bearer resource_metadata="${protectedResourceMetadataUrl(request)}"`;
  }
  return NextResponse.json({ ok: false, status: auth.reason }, { status: auth.httpStatus, headers });
}

export type Handler<I> = (ctx: ToolContext, input: I) => Promise<unknown>;

interface RouteOpts<I> {
  schema: ZodType<I>;
  handler: Handler<I>;
  // 'body' parses JSON (POST); 'query' parses the URL search params (GET).
  source: 'body' | 'query' | 'none';
  // Extra values merged before validation (e.g. a path parameter).
  pathParams?: Record<string, string>;
  // OAuth surfaces this route accepts (default: the GPT Actions surface
  // only). Read routes pass READ_SURFACES; consequential routes never do.
  surfaces?: readonly ControlSurface[];
}

function tooLarge(request: Request): boolean {
  const clRaw = request.headers.get('content-length');
  const n = clRaw === null ? null : Number(clRaw);
  return n === null || Number.isNaN(n) || n > MAX_BODY_BYTES;
}

// One entry point for every /api/control operation.
export async function controlRoute<I>(request: Request, opts: RouteOpts<I>): Promise<Response> {
  const env = process.env as Record<string, string | undefined>;

  if (opts.source === 'body' && tooLarge(request)) {
    return NextResponse.json({ ok: false, status: 'too_large' }, { status: 413 });
  }

  const auth = await authenticateControlRequest(
    request.headers.get('authorization'), env, { clientFor },
    opts.surfaces ?? ['gpt'],
  );
  if (!auth.ok) return deniedResponse(auth, request);

  let raw: unknown = {};
  if (opts.source === 'body') {
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
    }
  } else if (opts.source === 'query') {
    raw = Object.fromEntries(new URL(request.url).searchParams.entries());
  }
  const merged = { ...(raw as Record<string, unknown>), ...(opts.pathParams ?? {}) };
  const parsed = opts.schema.safeParse(merged);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, status: 'invalid_input', issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    );
  }

  const ctx: ToolContext = {
    client: auth.client as unknown as ComposerClient,
    ownerEmail: auth.ownerEmail,
    now: new Date().toISOString(),
  };
  try {
    const out = await opts.handler(ctx, parsed.data);
    return NextResponse.json(out, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, status: 'handler_failed' }, { status: 500 });
  }
}
