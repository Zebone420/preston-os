'use client';

// Preston OS main menu (client). Renders the CENTRAL nav-config tree
// as a desktop left panel and a mobile collapsible menu. Group
// expansion is click/keyboard driven (real <button aria-expanded>, no
// hover-only behavior); the group containing the active route starts
// expanded; the active group and active child are visibly marked
// (aria-current on the child). Sign-out REUSES the signOutOwner server
// action - no client-side auth logic here.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { signOutOwner } from '@/app/business/actions';
import {
  NAV_TREE,
  activeGroupLabel,
  activeHref,
  type NavGroup,
  type NavItem,
} from './nav-config';

const LINK_BASE =
  'block rounded px-2 py-2 text-sm underline-offset-2 hover:underline ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500';

function ItemLink({ item, current }: { item: NavItem; current: string | null }) {
  const active = current === item.href;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`${LINK_BASE} ${active ? 'bg-slate-800 text-slate-100' : 'text-slate-300'}`}
      >
        {item.label}
      </Link>
    </li>
  );
}

function Group({
  group,
  current,
  expanded,
  onToggle,
}: {
  group: NavGroup;
  current: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isActiveGroup = group.items.some((i) => i.href === current);
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={`flex w-full items-center justify-between rounded px-2 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500 ${
          isActiveGroup ? 'text-purple-300' : 'text-slate-200'
        }`}
      >
        <span>{group.label}</span>
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <ul className="ml-2 space-y-1 border-l border-slate-800 pl-2">
          {group.items.map((i) => (
            <ItemLink key={i.href} item={i} current={current} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SignOutItem() {
  return (
    <form action={signOutOwner} className="border-t border-slate-800 pt-3">
      <button
        type="submit"
        aria-label="Sign out"
        className="rounded px-2 py-2 text-sm text-slate-400 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500"
      >
        Sign out
      </button>
    </form>
  );
}

function MenuTree() {
  const pathname = usePathname() ?? '/';
  const current = activeHref(pathname);
  const startGroup = activeGroupLabel(pathname);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    startGroup ? { [startGroup]: true } : {},
  );
  const toggle = (label: string) =>
    setOpen((o) => ({ ...o, [label]: !o[label] }));

  return (
    <ul className="space-y-1">
      {NAV_TREE.map((entry) =>
        entry.kind === 'link' ? (
          <ItemLink key={entry.href} item={entry} current={current} />
        ) : (
          <Group
            key={entry.label}
            group={entry}
            current={current}
            expanded={open[entry.label] === true}
            onToggle={() => toggle(entry.label)}
          />
        ),
      )}
    </ul>
  );
}

export function NavMenu() {
  return (
    <>
      {/* Desktop: left side panel; sign-out pinned to the bottom */}
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950 p-4 text-slate-100 sm:block">
        <nav aria-label="Main navigation" className="flex h-full min-h-0 flex-col">
          <MenuTree />
          <div className="mt-auto pt-4">
            <SignOutItem />
          </div>
        </nav>
      </aside>
      {/* Mobile: collapsible main menu; groups expand inside it;
          sign-out last and separated. min-w-0 + block links prevent
          horizontal overflow; px/py-2 keeps touch targets ~40px. */}
      <details className="min-w-0 border-b border-slate-800 bg-slate-950 p-3 text-slate-100 sm:hidden">
        <summary className="cursor-pointer rounded px-2 py-2 text-sm text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500">
          Menu
        </summary>
        <nav aria-label="Main navigation" className="mt-2 space-y-3">
          <MenuTree />
          <SignOutItem />
        </nav>
      </details>
    </>
  );
}
