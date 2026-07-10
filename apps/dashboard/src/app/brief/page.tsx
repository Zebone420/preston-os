import Link from 'next/link';
import { buildDailyBrief } from '@/lib/daily-brief';

// Chief-of-Staff Daily Brief - Phase 3 GREEN (read-only). Composes mock/
// read-only Gmail + Calendar summaries, pending approvals, a routing
// placeholder, and DRAFT recommendations. Nothing sends or writes; every
// recommendation must go through the Approval Center.

export const dynamic = 'force-dynamic';

export default async function BriefPage() {
  const now = new Date().toISOString();
  const brief = await buildDailyBrief({ now, env: process.env as Record<string, string | undefined> });

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Daily Brief - Chief of Staff</h1>
        <nav className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-300 underline">
            Dashboard
          </Link>
          <Link href="/approvals" className="text-sm text-slate-300 underline">
            Approval Center
          </Link>
          <span className="rounded bg-amber-900 px-2 py-1 text-xs">
            PHASE 3 - read-only, drafts only
          </span>
        </nav>
      </header>

      <ul className="mb-4 space-y-1 rounded bg-slate-900 p-3 text-xs text-slate-400">
        {brief.notes.map((n, i) => (
          <li key={i}>- {n}</li>
        ))}
      </ul>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Inbox summary ({brief.gmail.source})</h2>
          {brief.gmail.note && <p className="mb-2 text-xs text-slate-500">{brief.gmail.note}</p>}
          <ul className="space-y-1 text-sm text-slate-300">
            {brief.gmail.items.map((m) => (
              <li key={m.id}>
                <span className="text-slate-400">{m.from}</span> - {m.subject}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">
            Today&apos;s appointments ({brief.calendar.source})
          </h2>
          {brief.calendar.note && (
            <p className="mb-2 text-xs text-slate-500">{brief.calendar.note}</p>
          )}
          <p className="mb-2 text-xs text-slate-500">{brief.appointments.note}</p>
          <ul className="space-y-1 text-sm text-slate-300">
            {brief.appointments.stops.map((s) => (
              <li key={s.id}>
                <span className="text-slate-400">{s.start}</span> - {s.title} ({s.location})
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">
            Pending approvals ({brief.pending_approvals.count})
          </h2>
          <ul className="space-y-1 text-sm text-slate-300">
            {brief.pending_approvals.items.map((i) => (
              <li key={i.approval_id}>
                [{i.risk_class}] {i.action_type} - {i.summary}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Recommended drafts (need approval)</h2>
          <ul className="space-y-1 text-sm text-slate-300">
            {brief.recommendations.map((r) => (
              <li key={r.task_id}>
                <span className="rounded bg-emerald-950 px-1 text-xs text-slate-400">
                  draft_email
                </span>{' '}
                {r.draft.summary}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
