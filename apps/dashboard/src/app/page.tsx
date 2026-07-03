// Preston OS Active Base - v0 dashboard home (five cards).
// Phase 0B-2: initial structure with MOCK placeholders. Real TEST/DEV
// data wiring lands with the Airtable/Supabase gates. Every card is
// read-only; every element carries its action-class label.

const CARDS = [
  {
    key: 'today',
    title: 'Today',
    hint: "Today's appointments and schedule",
  },
  {
    key: 'leads',
    title: 'Leads / Follow-ups',
    hint: 'Leads and follow-ups needing attention',
  },
  {
    key: 'projects',
    title: 'Projects / Blockers',
    hint: 'Active projects and current blockers',
  },
  {
    key: 'quotes',
    title: 'Quotes / Missing Info',
    hint: 'Quote status and missing information',
  },
  {
    key: 'approvals',
    title: 'Approval Queue / AI Brief',
    hint: 'Pending approvals and the daily brief',
  },
];

function setupMode(): boolean {
  return !(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export default function Home() {
  const setup = setupMode();
  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Preston OS - Active Base</h1>
        {setup ? (
          <span className="rounded bg-amber-900 px-2 py-1 text-xs">
            SETUP MODE - Supabase env not configured; auth gate inactive
          </span>
        ) : (
          <span className="rounded bg-emerald-900 px-2 py-1 text-xs">
            CONNECTED - staging
          </span>
        )}
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((c) => (
          <section
            key={c.key}
            className="rounded-lg border border-slate-800 bg-slate-900 p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">{c.title}</h2>
              <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs">
                GREEN read-only
              </span>
            </div>
            <p className="text-sm text-slate-400">{c.hint}</p>
            <p className="mt-3 text-xs text-slate-500">
              MOCK - real TEST/DEV data arrives with the wiring gate
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
