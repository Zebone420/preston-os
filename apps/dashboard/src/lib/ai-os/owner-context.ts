import { cache } from 'react';
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

// cache(): per-request memoization within one React render pass, so the
// root-layout MainNav and the page share a single supabase.auth.getUser
// round-trip instead of issuing one each (Next 16 authentication guide,
// DAL pattern). Route handlers and server actions are outside the React
// component tree, where cache() simply does not memoize - every
// control-plane caller still resolves the owner fresh per request.
export const resolveOwner = cache(
  async (): Promise<OwnerContext | null> => {
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
  },
);

// Common deps shape for the control-plane handlers, from an owner context.
export function depsFrom(ctx: OwnerContext) {
  return {
    client: ctx.client,
    audit: ctx.audit,
    env: process.env as Record<string, string | undefined>,
    now: new Date().toISOString(),
  };
}
