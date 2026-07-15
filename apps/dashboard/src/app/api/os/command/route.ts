import { NextResponse } from 'next/server';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { submitCommandProposal } from '@/lib/ai-os/controlplane';
import type { CommandSource } from '@/lib/ai-os/commands';

// Owner-only command intake (Phase 4). POST a command; it becomes a default-deny
// PROPOSAL in the control plane (never executes). Owner is re-checked here;
// production targets are rejected; the write is audited. Serves the dashboard,
// ChatGPT, and Telegram intake paths (all produce proposals only).
export const dynamic = 'force-dynamic';

const SOURCES: readonly CommandSource[] = [
  'chatgpt', 'telegram', 'dashboard', 'owner_cli', 'claude', 'codex', 'hermes', 'scheduler',
];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export async function POST(request: Request) {
  const ctx = await resolveOwner();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'owner authorization required' },
      { status: 401 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const rawSource = str(body['source'], 'dashboard');
  const source = (SOURCES as readonly string[]).includes(rawSource)
    ? (rawSource as CommandSource)
    : 'dashboard';

  const result = await submitCommandProposal(depsFrom(ctx), {
    ownerEmail: ctx.ownerEmail,
    source,
    requested_action: str(body['requested_action']),
    target_project: str(body['target_project']),
    target_repository: str(body['target_repository']),
    requested_scope: body['requested_scope'] ? str(body['requested_scope']) : undefined,
    expected_outcome: body['expected_outcome'] ? str(body['expected_outcome']) : undefined,
    constraints: Array.isArray(body['constraints'])
      ? (body['constraints'] as unknown[]).map((c) => str(c))
      : undefined,
    correlation_id: str(body['correlation_id']),
    idempotency_key: str(body['idempotency_key']),
    commandId: str(body['command_id']) || crypto.randomUUID(),
  });

  const status = result.ok ? 200 : result.code === 'denied' ? 403 : 400;
  return NextResponse.json(result, { status });
}
