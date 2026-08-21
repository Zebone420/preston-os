'use server';

import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { evaluateConsent, validAuthorizationId } from '@/lib/preston-control/consent';
import { getServerSupabase } from '@/lib/supabase/server';

// Preston Control - OAuth consent decision (Server Actions are public POST
// entry points, so the owner is re-checked HERE). Approve/deny are forwarded
// to the Supabase Auth OAuth server under the owner's own session; this
// action mints nothing and never sees a token.

type OAuthApi = {
  getAuthorizationDetails(id: string): Promise<{ data: unknown; error: { message: string } | null }>;
  approveAuthorization(id: string): Promise<{ data: { redirect_url?: string } | null; error: { message: string } | null }>;
  denyAuthorization(id: string): Promise<{ data: { redirect_url?: string } | null; error: { message: string } | null }>;
};

async function decide(formData: FormData, outcome: 'approve' | 'deny') {
  const ctx = await resolveOwner();
  if (!ctx) redirect('/login');
  const supabase = await getServerSupabase();
  if (!supabase) redirect('/login');
  const id = String(formData.get('authorization_id') ?? '');
  if (!validAuthorizationId(id)) redirect('/oauth/consent?error=authorization_id_invalid');

  const oauth = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
  const details = await oauth.getAuthorizationDetails(id);
  if (details.error || !details.data || typeof details.data !== 'object') {
    redirect('/oauth/consent?error=authorization_lookup_failed');
  }
  const d = details.data as Record<string, unknown>;
  if (typeof d['redirect_url'] === 'string') {
    // Already decided / auto-approved upstream: follow the server's answer.
    redirect(String(d['redirect_url']));
  }
  const gate = evaluateConsent(
    d as unknown as Parameters<typeof evaluateConsent>[0],
    ctx.ownerEmail,
    process.env as Record<string, string | undefined>,
  );
  // A failed gate ALWAYS denies upstream so the authorization cannot linger.
  const effective = gate.ok ? outcome : 'deny';
  const res = effective === 'approve'
    ? await oauth.approveAuthorization(id)
    : await oauth.denyAuthorization(id);

  await logAudit(
    {
      actor: 'preston-control', action: 'oauth_consent_' + effective,
      action_class: 'GREEN', environment: 'staging',
      detail: {
        authorization_id_prefix: id.slice(0, 8),
        client_id: String((d['client'] as Record<string, unknown> | undefined)?.['id'] ?? ''),
        gate: gate.ok ? 'ok' : gate.reason,
        requested: outcome,
        ok: !res.error,
      },
    },
    { supabase: ctx.audit },
  );

  if (res.error || !res.data?.redirect_url) {
    redirect('/oauth/consent?error=' + encodeURIComponent(gate.ok ? 'decision_failed' : gate.reason));
  }
  redirect(res.data.redirect_url);
}

export async function approveConsent(formData: FormData) {
  await decide(formData, 'approve');
}

export async function denyConsent(formData: FormData) {
  await decide(formData, 'deny');
}
