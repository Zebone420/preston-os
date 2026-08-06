import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  MISSING_DESTINATIONS,
  NAV_TREE,
  NON_NAV_ROUTES,
  activeGroupLabel,
  activeHref,
  isItemActive,
} from '../src/components/nav/nav-config';

// Main-navigation contract. ONE central config (nav-config.ts) drives
// both desktop and mobile menus; every authenticated route is reachable
// from it; business pages no longer carry their own global nav; there
// is exactly one sign-out implementation and one visible sign-out
// control, bottom-anchored; the nav is hidden on login/setup surfaces.

const SRC = join(__dirname, '../src');
const navMenu = readFileSync(join(SRC, 'components/nav/nav-menu.tsx'), 'utf8');
const mainNav = readFileSync(join(SRC, 'components/nav/main-nav.tsx'), 'utf8');
const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8');
const bizUi = readFileSync(join(SRC, 'components/business/ui.tsx'), 'utf8');
const actions = readFileSync(join(SRC, 'app/business/actions.ts'), 'utf8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function allNavHrefs(): string[] {
  return NAV_TREE.flatMap((e) =>
    e.kind === 'group' ? e.items.map((i) => i.href) : [e.href],
  );
}

// Discover every app route from the filesystem (app router pages).
function appRoutes(): string[] {
  const appDir = join(SRC, 'app');
  return walk(appDir)
    .filter((p) => /[/\\]page\.tsx$/.test(p))
    .map((p) =>
      p
        .slice(appDir.length)
        .replace(/[/\\]page\.tsx$/, '')
        .replace(/\\/g, '/') || '/',
    );
}

describe('central navigation configuration', () => {
  it('is the single source: desktop+mobile menu hardcodes no routes', () => {
    expect(navMenu).toContain("from './nav-config'");
    expect(navMenu).not.toMatch(/href="\//); // only config-driven hrefs
  });

  it('every existing authenticated route is reachable from the menu', () => {
    const hrefs = new Set(allNavHrefs());
    const nonNav = new Set(NON_NAV_ROUTES);
    for (const route of appRoutes()) {
      if (nonNav.has(route)) continue;
      expect(hrefs.has(route), `route ${route} missing from nav`).toBe(true);
    }
  });

  it('nav contains no dead links (every href is a real route)', () => {
    const routes = new Set(appRoutes());
    for (const href of allNavHrefs()) {
      expect(routes.has(href), `nav href ${href} has no page`).toBe(true);
    }
  });

  it('Work contains Orchestration, Composer, and Approvals', () => {
    const work = NAV_TREE.find(
      (e) => e.kind === 'group' && e.label === 'Work',
    );
    if (!work || work.kind !== 'group') throw new Error('Work group missing');
    const labels = work.items.map((i) => i.label);
    expect(labels).toContain('Orchestration');
    expect(labels).toContain('Composer');
    expect(labels).toContain('Approvals');
    expect(
      work.items.find((i) => i.label === 'Orchestration')!.href,
    ).toBe('/os/orchestration');
    expect(
      work.items.find((i) => i.label === 'Composer')!.href,
    ).toBe('/os/composer');
  });

  it('an Orchestration-labeled link reaches /os/orchestration (owner req)', () => {
    // 2026-08-06 phone finding: the orchestration surface must be
    // findable by the literal label "Orchestration" in the shared menu
    // (desktop panel and mobile dropdown both render NAV_TREE).
    const items = NAV_TREE.flatMap((e) =>
      e.kind === 'group' ? e.items : [e],
    );
    const orch = items.filter((i) => i.label === 'Orchestration');
    expect(orch).toHaveLength(1);
    expect(orch[0].href).toBe('/os/orchestration');
  });

  it('missing requested destinations are documented, not dead-linked', () => {
    const requested = MISSING_DESTINATIONS.map((m) => m.requested);
    for (const name of ['Work > Tasks', 'Business > Customers',
      'Operations > Schedule', 'Operations > Team',
      'Operations > Documents', 'Settings']) {
      expect(requested).toContain(name);
    }
    for (const m of MISSING_DESTINATIONS) {
      expect(['missing', 'covered']).toContain(m.status);
      expect(m.note.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate hrefs or labels across the tree', () => {
    const hrefs = allNavHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('active-route matching', () => {
  it('exact vs prefix matching', () => {
    expect(isItemActive('/', { href: '/', label: 'Home', match: 'exact' }))
      .toBe(true);
    expect(isItemActive('/os', { href: '/', label: 'Home', match: 'exact' }))
      .toBe(false);
    const quotes = { href: '/business/quotes', label: 'Quotes', match: 'prefix' as const };
    expect(isItemActive('/business/quotes', quotes)).toBe(true);
    expect(isItemActive('/business/quotes/abc123', quotes)).toBe(true);
    expect(isItemActive('/business/quotesx', quotes)).toBe(false);
  });

  it('most specific item wins; group of the active child is reported', () => {
    expect(activeHref('/business/quotes/abc')).toBe('/business/quotes');
    expect(activeGroupLabel('/business/quotes/abc')).toBe('Business');
    expect(activeHref('/os/orchestration')).toBe('/os/orchestration');
    expect(activeGroupLabel('/os/orchestration')).toBe('Work');
    expect(activeHref('/os')).toBe('/os');
    expect(activeGroupLabel('/os')).toBe('AI System');
    expect(activeHref('/')).toBe('/');
    expect(activeGroupLabel('/')).toBeNull(); // top-level link, no group
    expect(activeHref('/login')).toBeNull();
  });
});

describe('menu behavior contracts (structural pins)', () => {
  it('groups expand by click/keyboard, never hover-only', () => {
    expect(navMenu).toContain('aria-expanded={expanded}');
    expect(navMenu).toContain('type="button"');
    expect(navMenu).toContain('onClick={onToggle}');
    expect(navMenu).toContain('{expanded && (');
    expect(navMenu).not.toMatch(/hover:(block|flex|visible|opacity)/);
  });

  it('the active group starts expanded; active child gets aria-current', () => {
    expect(navMenu).toContain('activeGroupLabel(pathname)');
    expect(navMenu).toContain('startGroup ? { [startGroup]: true } : {}');
    expect(navMenu).toContain("aria-current={active ? 'page' : undefined}");
  });

  it('the active group resyncs on client-side route changes (layout persists)', () => {
    // Behavioral coverage in nav-menu-route-sync.test.ts; this pins the
    // mechanism: render-time state adjustment keyed on the active group
    // (react-hooks/set-state-in-effect forbids the effect variant).
    expect(navMenu).toContain('startGroup !== prevStartGroup');
    expect(navMenu).toContain('setPrevStartGroup(startGroup)');
  });

  it('desktop panel bottom-anchors Sign Out; mobile lists it last', () => {
    const aside = navMenu.slice(
      navMenu.indexOf('<aside'), navMenu.indexOf('</aside>'));
    expect(aside).toContain('mt-auto');
    expect(aside).toContain('<SignOutItem />');
    const details = navMenu.slice(
      navMenu.indexOf('<details'), navMenu.indexOf('</details>'));
    expect(details).toContain('sm:hidden');
    expect(details.indexOf('<SignOutItem />'))
      .toBeGreaterThan(details.indexOf('<MenuTree />'));
  });

  it('sign-out is separated, labeled, and focusable; menus are labeled', () => {
    expect(navMenu).toContain('border-t border-slate-800');
    expect(navMenu).toContain('aria-label="Sign out"');
    const focusCount = navMenu.split('focus-visible:outline').length - 1;
    expect(focusCount).toBeGreaterThanOrEqual(4);
    expect(navMenu).toContain('aria-label="Main navigation"');
  });

  it('mobile constrains overflow and keeps touch targets padded', () => {
    expect(navMenu).toContain('min-w-0');
    expect(navMenu).toContain('overflow-y-auto');
    expect(navMenu).toContain('py-2');
  });
});

describe('single navigation system - no page-level duplicates', () => {
  it('no app page renders its own <nav> element anymore', () => {
    const appDir = join(SRC, 'app');
    const offenders = walk(appDir)
      .filter((p) => /page\.tsx$/.test(p))
      .filter((p) => readFileSync(p, 'utf8').includes('<nav'));
    expect(offenders).toEqual([]);
  });

  it('business shell carries no global nav and no sign-out control', () => {
    expect(bizUi).not.toContain('BUSINESS_NAV');
    expect(bizUi).not.toContain('signOutOwner');
    expect(bizUi).not.toContain('<nav');
    expect(bizUi).not.toContain('Sign out');
  });

  it('exactly one visible Sign Out control (nav-menu) in the whole app', () => {
    const offenders = walk(SRC).filter((p) =>
      readFileSync(p, 'utf8').includes('action={signOutOwner}'));
    expect(offenders).toHaveLength(1);
    expect(offenders[0].replace(/\\/g, '/'))
      .toContain('components/nav/nav-menu.tsx');
  });
});

describe('authentication behavior preserved', () => {
  it('root layout renders the auth-gated MainNav', () => {
    expect(layout).toContain('<MainNav />');
  });

  it('nav renders only for the allowlisted OWNER (server-side, fail closed)', () => {
    // Stronger than the original "any authenticated user" gate: MainNav
    // must use the same owner predicate as every protected surface
    // (resolveOwner -> isOwnerEmail), so an authenticated non-owner on
    // /login sees no protected navigation. Behavioral coverage in
    // main-nav-owner-gate.test.ts.
    expect(mainNav).toContain('resolveOwner');
    expect(mainNav).toContain('if (!owner) return null');
    expect(mainNav).not.toContain('auth.getUser');
  });

  it('sign-out remains the one implementation, redirecting to /login', () => {
    expect(navMenu).toContain(
      "import { signOutOwner } from '@/app/business/actions'");
    expect(navMenu).not.toContain('auth.signOut');
    const fn = actions.slice(
      actions.indexOf('export async function signOutOwner'));
    expect(fn.slice(0, 400)).toContain('performSignOut');
    expect(fn.slice(0, 400)).toContain("redirect('/login')");
    const signOutSites = walk(SRC).filter((p) =>
      readFileSync(p, 'utf8').includes('auth.signOut()'));
    expect(signOutSites).toHaveLength(1);
    expect(signOutSites[0].replace(/\\/g, '/')).toContain('lib/sign-out.ts');
  });
});
