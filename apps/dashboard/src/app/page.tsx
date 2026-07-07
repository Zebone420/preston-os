import Link from 'next/link';
import {
  getApprovalsCard,
  getLeadsCard,
  getProjectsCard,
  getQuotesCard,
  getTodayCard,
  type CardData,
  type SupabaseLike,
} from '@/lib/cards';
import { getServerSupabase } from '@/lib/supabase/server';

// Preston OS Active Base - v0 dashboard home (five cards).
// Read-only. Sources switch from MOCK to TEST/DEV automatically when
// the owner configures env values; no code change needed.

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<CardData['source'], string> = {
  mock: 'MOCK',
  airtable_test: 'AIRTABLE TEST/DEV',
  supabase_staging: 'SUPABASE STAGING',
};

function setupMode(): boolean {
  return !(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export default async function Home() {
  const supabase = (await getServerSupabase()) as unknown as
    | SupabaseLike
    | null;
  const [today, leads, projects, quotes, approvals] = await Promise.all([
    getTodayCard(),
    getLeadsCard(),
    getProjectsCard(),
    getQuotesCard(),
    getApprovalsCard(supabase),
  ]);

  const cards: { key: string; title: string; data: CardData }[] = [
    { key: 'today', title: 'Today', data: today },
    { key: 'leads', title: 'Leads / Follow-ups', data: leads },
    { key: 'projects', title: 'Projects / Blockers', data: projects },
    { key: 'quotes', title: 'Quotes / Missing Info', data: quotes },
    { key: 'approvals', title: 'Approval Queue / AI Brief', data: approvals },
  ];

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Preston OS - Active Base</h1>
        <nav className="flex items-center gap-3">
          <Link href="/audit" className="text-sm text-slate-300 underline">
            Audit View
          </Link>
          <Link href="/approvals" className="text-sm text-slate-300 underline">
            Approval Center
          </Link>
          {setupMode() ? (
            <span className="rounded bg-amber-900 px-2 py-1 text-xs">
              SETUP MODE - Supabase env not configured
            </span>
          ) : (
            <span className="rounded bg-emerald-900 px-2 py-1 text-xs">
              CONNECTED - staging
            </span>
          )}
        </nav>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <section
            key={c.key}
            className="rounded-lg border border-slate-800 bg-slate-900 p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-medium">{c.title}</h2>
              <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs">
                GREEN read-only
              </span>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              source: {SOURCE_LABEL[c.data.source]}
              {c.data.note ? ' - ' + c.data.note : ''}
            </p>
            <ul className="space-y-1">
              {c.data.items.map((item) => (
                <li key={item.id} className="text-sm text-slate-300">
                  {item.title}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
