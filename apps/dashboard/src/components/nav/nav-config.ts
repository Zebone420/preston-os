// Preston OS - CENTRAL navigation configuration. The single source of
// truth for labels, routes, grouping, ordering, and active-route
// matching. Desktop and mobile navigation both consume THIS tree;
// route labels/mappings must never be duplicated elsewhere.
//
// Mapping decisions against the requested taxonomy (Home / Work /
// Business / Operations / AI System / Settings) are documented on each
// entry and in MISSING_DESTINATIONS: requested destinations without an
// existing route are OMITTED (never dead links) and listed there.

export interface NavItem {
  href: string;
  label: string;
  // 'exact' matches only the path itself; 'prefix' also matches
  // descendants (e.g. /business/quotes/[id] under Quotes).
  match: 'exact' | 'prefix';
}

export interface NavGroup {
  kind: 'group';
  label: string;
  items: ReadonlyArray<NavItem>;
}

export interface NavLink extends NavItem {
  kind: 'link';
}

export type NavEntry = NavLink | NavGroup;

export const NAV_TREE: ReadonlyArray<NavEntry> = [
  { kind: 'link', href: '/', label: 'Home', match: 'exact' },
  {
    kind: 'group',
    label: 'Work',
    items: [
      // Goals = the Phase 7 master-goal orchestration surface. This is
      // ALSO the requested "AI System > Orchestration" destination; it
      // is mapped once, here, to keep Goals one click away and avoid a
      // duplicate link (cross-reference documented in
      // MISSING_DESTINATIONS).
      { href: '/os/orchestration', label: 'Goals', match: 'prefix' },
      // Composer = the Goals/Tasks Request Composer (two-step NL
      // interpret -> owner confirm). Sits beside Goals: it is how new
      // goal graphs are requested.
      { href: '/os/composer', label: 'Composer', match: 'prefix' },
      { href: '/approvals', label: 'Approvals', match: 'prefix' },
      // Tasks, Jobs: no standalone routes (job detail renders inside
      // OS Control and Goals) - omitted, see MISSING_DESTINATIONS.
    ],
  },
  {
    kind: 'group',
    label: 'Business',
    items: [
      { href: '/business', label: 'Overview', match: 'exact' },
      // Leads = the pipeline surface (lead intake + stage moves).
      { href: '/business/pipeline', label: 'Leads', match: 'prefix' },
      { href: '/business/quotes', label: 'Quotes', match: 'prefix' },
      { href: '/business/projects', label: 'Projects', match: 'prefix' },
      // Existing surfaces beyond the requested list stay reachable:
      { href: '/business/payments', label: 'Payments', match: 'prefix' },
      { href: '/business/activity', label: 'Activity', match: 'prefix' },
      // Quote-agent run history (closest existing "Runs" surface).
      { href: '/business/agents', label: 'Agent Runs', match: 'prefix' },
      // Customers: no standalone route (clients are created inside
      // Quotes) - omitted, see MISSING_DESTINATIONS.
    ],
  },
  {
    kind: 'group',
    label: 'Operations',
    items: [
      // Reports = the Daily Brief (the app's reporting surface).
      { href: '/brief', label: 'Daily Brief', match: 'prefix' },
      // Schedule, Team, Documents: no routes - omitted.
    ],
  },
  {
    kind: 'group',
    label: 'AI System',
    items: [
      // OS Control hosts the agent registry, commands, and job queue
      // (covers requested "Agents" and "Jobs" as page sections).
      { href: '/os', label: 'OS Control', match: 'exact' },
      { href: '/audit', label: 'Logs', match: 'prefix' },
      { href: '/remote', label: 'Remote', match: 'prefix' },
      // Orchestration: mapped once under Work > Goals (same page).
    ],
  },
  // Settings: no route exists - omitted, see MISSING_DESTINATIONS.
];

// Requested destinations with NO existing route (omitted from the menu
// rather than rendered dead), plus cross-referenced placements.
export const MISSING_DESTINATIONS: ReadonlyArray<{
  requested: string;
  status: 'missing' | 'covered';
  note: string;
}> = [
  { requested: 'Work > Tasks', status: 'missing', note: 'no tasks route' },
  {
    requested: 'Work > Jobs', status: 'covered',
    note: 'job queue renders inside /os and /os/orchestration',
  },
  {
    requested: 'Business > Customers', status: 'missing',
    note: 'clients are created inside /business/quotes; no list page',
  },
  { requested: 'Operations > Schedule', status: 'missing', note: 'no route' },
  { requested: 'Operations > Team', status: 'missing', note: 'no route' },
  {
    requested: 'Operations > Documents', status: 'missing', note: 'no route',
  },
  {
    requested: 'Operations > Reports', status: 'covered',
    note: 'mapped to /brief (Daily Brief)',
  },
  {
    requested: 'AI System > Agents', status: 'covered',
    note: 'agent registry is a section of /os; run history at /business/agents',
  },
  {
    requested: 'AI System > Runs', status: 'covered',
    note: 'mapped to /business/agents (Agent Runs)',
  },
  {
    requested: 'AI System > Orchestration', status: 'covered',
    note: 'mapped once under Work > Goals (/os/orchestration)',
  },
  { requested: 'Settings', status: 'missing', note: 'no settings route' },
];

// Routes intentionally NOT in the menu (auth/setup surfaces and
// page-local detail views reachable from their parent list).
export const NON_NAV_ROUTES: ReadonlyArray<string> = [
  '/login', // owner-gate surface; nav is hidden there anyway
  '/business/quotes/[id]', // detail subview of Quotes
];

export function isItemActive(pathname: string, item: NavItem): boolean {
  if (item.match === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

// The single most specific active item wins (longest matching href), so
// /business/quotes highlights Quotes, not Overview.
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const entry of NAV_TREE) {
    const items = entry.kind === 'group' ? entry.items : [entry];
    for (const item of items) {
      if (isItemActive(pathname, item)) {
        if (best === null || item.href.length > best.length) best = item.href;
      }
    }
  }
  return best;
}

export function activeGroupLabel(pathname: string): string | null {
  const href = activeHref(pathname);
  if (href === null) return null;
  for (const entry of NAV_TREE) {
    if (entry.kind !== 'group') continue;
    if (entry.items.some((i) => i.href === href)) return entry.label;
  }
  return null;
}
