import { getServerSupabase } from '@/lib/supabase/server';
import { NavMenu } from './nav-menu';

// Preston OS main navigation gate. Server component rendered from the
// ROOT LAYOUT on every dashboard page. Renders NOTHING for an
// unauthenticated visitor (e.g. /login) or in setup mode, so the
// owner-gate surface is unchanged and no authenticated navigation is
// exposed pre-auth. The menu itself (grouping, active states,
// expansion, sign-out) is the client NavMenu over the central
// nav-config; sign-out remains the single signOutOwner ->
// performSignOut -> redirect('/login') implementation.

export async function MainNav() {
  const supabase = await getServerSupabase();
  if (!supabase) return null; // setup mode: no session surface
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null; // unauthenticated: no nav

  return <NavMenu />;
}
