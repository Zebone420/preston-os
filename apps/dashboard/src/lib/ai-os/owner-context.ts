import { getServerSupabase } from '@/lib/supabase/server';
import { isOwnerEmail } from '@/lib/owner-auth';
import type { AuditSink } from '@/lib/audit';
import type { RuntimeClient } from './store';

// Preston AI OS - server-side owner context for control-plane routes (Phase 4).
// Resolves the authenticated owner from the RLS-bound server Supabase client and
// re-checks the allowlist INSIDE the handler (defense in depth over the proxy
// gate + RLS; a route/action is a public entry point). Returns null when not an
// owner. No secret is read or returned.

export interface OwnerContext {
  ownerEmail: string;
  client: RuntimeClient; // RLS-bound; adapters run as the owner session
  audit: AuditSink;
}

export async function resolveOwner(): Promise<OwnerContext | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null; // setup mode: no auth env
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isOwnerEmail(user.email, process.env)) return null;
  return {
    ownerEmail: user.email,
    client: supabase as unknown as RuntimeClient,
    audit: supabase as unknown as AuditSink,
  };
}

// Common deps shape for the control-plane handlers, from an owner context.
export function depsFrom(ctx: OwnerContext) {
  return {
    client: ctx.client,
    audit: ctx.audit,
    env: process.env as Record<string, string | undefined>,
    now: new Date().toISOString(),
  };
}
