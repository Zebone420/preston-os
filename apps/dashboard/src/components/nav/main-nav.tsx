import { resolveOwner } from '@/lib/ai-os/owner-context';
import { NavMenu } from './nav-menu';

// Preston OS main navigation gate. Server component rendered from the
// ROOT LAYOUT on every dashboard page. Renders NOTHING unless the
// request belongs to an allowlisted OWNER - the same fail-closed
// predicate (resolveOwner -> isOwnerEmail) every other protected
// surface uses. This covers setup mode, unauthenticated visitors, and
// authenticated NON-owners (who can still reach /login to
// re-authenticate but must see no protected navigation there).
// resolveOwner is cache()-memoized per render pass, so this gate and
// the page's own owner check share one auth round-trip. The menu
// itself (grouping, active states, expansion, sign-out) is the client
// NavMenu over the central nav-config; sign-out remains the single
// signOutOwner -> performSignOut -> redirect('/login') implementation.

export async function MainNav() {
  const owner = await resolveOwner();
  if (!owner) return null; // setup / unauthenticated / not the owner
  return <NavMenu />;
}
