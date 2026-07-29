// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Review Finding 2 (navigation group synchronization) - BEHAVIORAL
// reproduction of a client-side route transition.
//
// The root layout persists across App Router soft navigations, so
// NavMenu stays MOUNTED and only usePathname changes. The expanded-
// group state must therefore resynchronize when the active route moves
// to a different group (in-page cross-links, browser back/forward);
// otherwise the active group stays collapsed and no rendered link
// carries aria-current. Initial-load behavior is separately pinned in
// main-nav.test.ts; these tests exercise the transition itself.

let currentPath = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.PropsWithChildren<{ href: string } & Record<string, unknown>>) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/app/business/actions', () => ({
  signOutOwner: async () => {},
}));

import { NavMenu } from '../src/components/nav/nav-menu';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function renderNav() {
  act(() => {
    root.render(React.createElement(NavMenu));
  });
}

function navigateTo(path: string) {
  currentPath = path;
  renderNav(); // same element type at the same root: state is preserved
}

function activeLinks(): string[] {
  return Array.from(
    container.querySelectorAll('a[aria-current="page"]'),
  ).map((a) => a.getAttribute('href') ?? '');
}

function links(href: string): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll(`a[href="${href}"]`));
}

// Desktop and mobile render independent MenuTree instances with their
// own state, so single-instance assertions scope to the desktop aside.
function desktop(): Element {
  const aside = container.querySelector('aside');
  if (!aside) throw new Error('desktop aside not found');
  return aside;
}

function desktopLinks(href: string): HTMLAnchorElement[] {
  return Array.from(desktop().querySelectorAll(`a[href="${href}"]`));
}

function groupButton(label: string): HTMLButtonElement {
  const btn = Array.from(desktop().querySelectorAll('button')).find(
    (b) => b.textContent?.includes(label),
  );
  if (!btn) throw new Error(`group button ${label} not found`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  currentPath = '/';
});

describe('NavMenu group state across client-side route transitions', () => {
  it('initial load: active group expanded, active child has aria-current', () => {
    currentPath = '/business';
    renderNav();
    expect(links('/business').length).toBeGreaterThan(0);
    expect(activeLinks()).toContain('/business');
  });

  it('cross-group navigation expands the new active group and moves aria-current', () => {
    currentPath = '/business';
    renderNav();
    expect(activeLinks()).toContain('/business');

    // Soft-navigate to a route in a DIFFERENT (collapsed) group, as an
    // in-page cross-link or back/forward would.
    navigateTo('/audit');

    expect(links('/audit').length).toBeGreaterThan(0); // group is open
    expect(activeLinks()).toContain('/audit'); // aria-current moved
    expect(activeLinks()).not.toContain('/business');
  });

  it('cross-group navigation keeps the previously expanded group open', () => {
    currentPath = '/business';
    renderNav();
    navigateTo('/os/orchestration');
    // New active group (Work) opened...
    expect(activeLinks()).toContain('/os/orchestration');
    // ...and the group the user had open is not force-collapsed.
    expect(links('/business').length).toBeGreaterThan(0);
  });

  it('same-group navigation respects a manual collapse of the active group', () => {
    currentPath = '/business';
    renderNav();

    // The user deliberately collapses the active group (desktop button).
    const businessBtn = groupButton('Business');
    act(() => {
      businessBtn.click();
    });
    expect(desktopLinks('/business').length).toBe(0);

    // Navigating WITHIN the same group must not fight the user's choice.
    navigateTo('/business/quotes');
    expect(desktopLinks('/business/quotes').length).toBe(0);
  });

  it('returning to a manually collapsed group re-expands it (it became active)', () => {
    // Deliberate precedence: the active-group-visible contract outranks
    // a stale manual collapse. If the group stayed collapsed on
    // re-entry, the active child could not carry aria-current - the
    // exact defect this suite exists to prevent.
    currentPath = '/business';
    renderNav();
    act(() => {
      groupButton('Business').click();
    });
    expect(desktopLinks('/business').length).toBe(0);

    navigateTo('/audit');
    navigateTo('/business');

    expect(desktopLinks('/business').length).toBeGreaterThan(0);
    expect(activeLinks()).toContain('/business');
  });

  it('mobile menu mirrors the resynchronized state (shared MenuTree)', () => {
    currentPath = '/business';
    renderNav();
    navigateTo('/audit');
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    const mobileActive = details!.querySelectorAll('a[aria-current="page"]');
    expect(mobileActive.length).toBe(1);
    expect(mobileActive[0].getAttribute('href')).toBe('/audit');
  });
});
