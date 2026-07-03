import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client (anon key, RLS-bound).
// Returns null in setup mode (env not yet configured by the owner).
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
