import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutOwner } from '@/app/business/actions';

// Shared Business Command Center presentation pieces (server-safe,
// no client JS). Follows the established dark-slate idiom. These
// exist so the eight business surfaces stay visually consistent
// without a design-system rewrite.

export const BUSINESS_NAV = [
  { href: '/business', label: 'Overview' },
  { href: '/business/pipeline', label: 'Pipeline' },
  { href: '/business/quotes', label: 'Quotes' },
  { href: '/business/projects', label: 'Projects' },
  { href: '/business/payments', label: 'Payments' },
  { href: '/business/activity', label: 'Activity' },
  { href: '/business/agents', label: 'Agents' },
  { href: '/approvals', label: 'Approvals' },
] as const;

export function BusinessShell({
  title,
  mode,
  children,
}: {
  title: string;
  mode: 'setup' | 'connected';
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <ModeBadge mode={mode} />
        </div>
        <nav className="flex flex-wrap items-center gap-3">
          {BUSINESS_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-sm text-slate-300 underline"
            >
              {n.label}
            </Link>
          ))}
          <Link href="/" className="text-sm text-slate-500 underline">
            Home
          </Link>
          <form action={signOutOwner}>
            <button className="text-sm text-slate-500 underline">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </main>
  );
}

export function LoginRequired({ title }: { title: string }) {
  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-4 rounded bg-amber-900 p-3 text-sm">
        Owner login required.{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
        .
      </p>
    </main>
  );
}

export function ModeBadge({ mode }: { mode: 'setup' | 'connected' }) {
  return mode === 'setup' ? (
    <span className="rounded bg-amber-900 px-2 py-0.5 text-xs">
      SETUP MODE - fixture data
    </span>
  ) : (
    <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs">
      SUPABASE STAGING
    </span>
  );
}

export function SimulationBadge() {
  return (
    <span className="rounded bg-purple-900 px-2 py-0.5 text-xs">
      SIMULATION
    </span>
  );
}

export function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'warn'
      ? 'border-amber-800'
      : tone === 'bad'
        ? 'border-red-800'
        : tone === 'ok'
          ? 'border-emerald-800'
          : 'border-slate-800';
  return (
    <div
      className={
        'rounded-lg border bg-slate-900 p-4 ' + toneClass
      }
    >
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="mb-2 rounded bg-red-950 p-2 text-xs text-red-300">
      read failed: {error}
    </p>
  );
}

export function EmptyNote({
  show,
  text,
}: {
  show: boolean;
  text: string;
}) {
  if (!show) return null;
  return <p className="text-xs text-slate-500">{text}</p>;
}

export function FooterNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded bg-slate-900 p-3 text-xs text-slate-500">
      {children}
    </p>
  );
}

export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-slate-400">
          <tr>
            {headers.map((h) => (
              <th key={h} className="py-1 pr-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function statusTone(status: string): string {
  if (
    [
      'approved',
      'won',
      'done',
      'completed',
      'delivered',
      'closed',
    ].includes(status)
  ) {
    return 'bg-emerald-900';
  }
  if (
    [
      'rejected',
      'lost',
      'cancelled',
      'exception',
      'blocked',
      'failed_error',
      'failed_validation',
    ].includes(status)
  ) {
    return 'bg-red-900';
  }
  if (
    [
      'pending_approval',
      'backordered',
      'follow_up',
      'negotiation',
      'in_progress',
      'punch_list',
    ].includes(status)
  ) {
    return 'bg-amber-900';
  }
  return 'bg-slate-700';
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={
        'rounded px-2 py-0.5 text-xs ' + statusTone(status)
      }
    >
      {status || 'unknown'}
    </span>
  );
}

export function formatTimestamp(iso: unknown): string {
  if (typeof iso !== 'string' || iso.length < 10) return '';
  // Owner-readable UTC timestamp without milliseconds.
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');
}
