import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/ai-os/telegram-security';
import { intakeChatGpt } from '@/lib/ai-os/bridges/chatgpt';
import { isValidRuntimeId, RUNTIME_ID_RE } from '@/lib/ai-os/commands';
import { readSystemControls, type RuntimeClient } from '@/lib/ai-os/store';
import { createCommandProposal } from '@/lib/ai-os/controlplane';
import { type AuditSink } from '@/lib/audit';
import { getServerSupabase } from '@/lib/supabase/server';

// Preston AI OS - ChatGPT connector intake (Phase 5J). DISABLED by default.
// Server-to-server: authenticated by a bearer token (constant-time compared),
// NOT an owner session cookie (see the proxy.ts exclusion for this path).
// Fail-closed HEADER-ONLY guards run BEFORE the body is read (same shape as
// the telegram receiver): intake-enabled + configured + staging posture +
// Content-Length (reject missing/NaN/oversize) + constant-time bearer token.
// Only then is the (bounded, authenticated) body parsed. This route performs
// PROPOSAL CREATION ONLY - no shell, no git, no enqueue, no execution field is
// ever set; validation, production screening, audit, and DB idempotency dedup
// all run through the SAME shared core submitCommandProposal uses
// (controlplane.createCommandProposal), just with forceApproval set so this
// connector channel can never receive an implicitly-approved proposal.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;

export interface ChatGptIntakeDeps {
  client: RuntimeClient;
  audit: AuditSink | null;
}

interface ChatGptBody {
  owner_identity?: unknown;
  correlation_id?: unknown;
  idempotency_key?: unknown;
  command?: {
    requested_action?: unknown;
    target_project?: unknown;
    target_repository?: unknown;
    requested_scope?: unknown;
    expected_outcome?: unknown;
    constraints?: unknown;
  };
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function normIdentity(v: string): string {
  return v.trim().toLowerCase();
}

// Core orchestration, deliberately separated from POST's Request/env plumbing
// so it is directly unit-testable with injected (fake) store/audit deps - the
// same seam telegram-security.ts's evaluateWebhook uses for the telegram
// receiver. Assumes the caller has ALREADY passed the header-only fail-closed
// gates (enabled/configured/size/token) and handed over a parsed body.
export async function processChatGptIntake(
  body: ChatGptBody,
  env: Record<string, string | undefined>,
  now: string,
  deps: ChatGptIntakeDeps,
): Promise<{ httpStatus: number; json: Record<string, unknown> }> {
  const correlationId = str(body.correlation_id).trim();
  const idempotencyKey = str(body.idempotency_key).trim();
  if (!isValidRuntimeId(correlationId) || !isValidRuntimeId(idempotencyKey)) {
    return {
      httpStatus: 400,
      json: { ok: false, status: 'invalid', message: 'correlation_id and idempotency_key are required and must match ' + RUNTIME_ID_RE.source },
    };
  }

  const ownerIdentity = str(body.owner_identity).trim();
  const ownerIdentityEnv = String(env['CHATGPT_OWNER_IDENTITY'] ?? '');
  // Cheap pre-check (no DB round-trip) before touching the control plane -
  // an unauthorized caller costs nothing beyond string compares. The same
  // normalization (trim + lowercase) intakeChatGpt applies to its own
  // allowlist is applied here so both checks agree.
  if (ownerIdentity === '' || normIdentity(ownerIdentity) !== normIdentity(ownerIdentityEnv)) {
    return { httpStatus: 403, json: { ok: false, status: 'denied', message: 'owner identity not authorized', correlation_id: correlationId } };
  }

  const cmd = body.command ?? {};
  const controls = await readSystemControls(deps.client); // fails closed to fully-stopped
  const intake = intakeChatGpt(
    {
      owner_identity: ownerIdentity,
      requested_action: str(cmd.requested_action),
      target_project: str(cmd.target_project),
      target_repository: str(cmd.target_repository),
      requested_scope: cmd.requested_scope !== undefined ? str(cmd.requested_scope) : undefined,
      expected_outcome: cmd.expected_outcome !== undefined ? str(cmd.expected_outcome) : undefined,
      constraints: Array.isArray(cmd.constraints) ? (cmd.constraints as unknown[]).map((c) => str(c)) : undefined,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
    },
    {
      ownerAllowlist: [ownerIdentityEnv],
      controls,
      now,
      commandId: crypto.randomUUID(),
    },
  );

  if (intake.response.status === 'denied') {
    return { httpStatus: 403, json: { ok: false, status: 'denied', message: intake.response.message, correlation_id: correlationId } };
  }
  if (intake.response.status === 'stopped') {
    return { httpStatus: 503, json: { ok: false, status: 'stopped', message: intake.response.message, correlation_id: correlationId } };
  }
  if (intake.response.status === 'paused') {
    return { httpStatus: 200, json: { ok: false, status: 'paused', message: intake.response.message, correlation_id: correlationId } };
  }

  const packet = intake.packet!;
  // forceApproval: an external connector channel never gets an implicitly-
  // approved (GREEN) proposal, regardless of classifyRisk's verdict.
  const result = await createCommandProposal(
    { client: deps.client, audit: deps.audit },
    packet,
    { actor: ownerIdentity, forceApproval: true },
  );

  if (!result.ok) {
    if (result.code === 'production_rejected') {
      return { httpStatus: 400, json: { ok: false, status: 'production_rejected', message: result.message, correlation_id: correlationId } };
    }
    if (result.code === 'invalid') {
      return { httpStatus: 400, json: { ok: false, status: 'invalid', message: result.message, correlation_id: correlationId } };
    }
    // write_failed: never pass a raw DB error message through to the caller.
    return { httpStatus: 400, json: { ok: false, status: 'write_failed', message: 'unable to record proposal', correlation_id: correlationId } };
  }

  // On a duplicate, result.id is the AUTHORITATIVE stored row's id (looked up
  // by the store); if that lookup could not resolve, report null rather than
  // echoing this request's attempted id, which matches no stored row.
  const duplicate = result.code === 'duplicate';
  return {
    httpStatus: 200,
    json: {
      ok: true,
      packet_id: result.id ?? (duplicate ? null : packet.id),
      status: duplicate ? 'duplicate' : 'proposed',
      duplicate,
      correlation_id: correlationId,
    },
  };
}

export async function POST(request: Request) {
  const env = process.env as Record<string, string | undefined>;

  if (env['CHATGPT_INTAKE_ENABLED'] !== 'true') {
    return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
  }
  const token = env['CHATGPT_INTAKE_TOKEN'];
  const ownerIdentityEnv = env['CHATGPT_OWNER_IDENTITY'];
  // Staging-only posture, fail-closed (mirrors the dispatcher's stagingGate):
  // this route never runs against a database not explicitly marked staging.
  if (!token || !ownerIdentityEnv || env['SUPABASE_RUNTIME_ENV'] !== 'staging') {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  // Size gate BEFORE reading the body; missing/NaN Content-Length is rejected.
  const clRaw = request.headers.get('content-length');
  const contentLength = clRaw === null ? null : Number(clRaw);
  if (contentLength === null || Number.isNaN(contentLength) || contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, status: 'too_large' }, { status: 413 });
  }

  // Authenticity (constant-time) BEFORE trusting/parsing the body. Never log
  // or echo the header or configured token.
  const authHeader = request.headers.get('authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!presented || !constantTimeEqual(presented, token)) {
    return NextResponse.json({ ok: false, status: 'forbidden' }, { status: 401 });
  }

  let body: ChatGptBody;
  try {
    body = (await request.json()) as ChatGptBody;
  } catch {
    return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, status: 'bad_request' }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, status: 'unconfigured' }, { status: 503 });
  }

  const result = await processChatGptIntake(body, env, new Date().toISOString(), {
    client: supabase as unknown as RuntimeClient,
    audit: supabase as unknown as AuditSink,
  });
  return NextResponse.json(result.json, { status: result.httpStatus });
}
