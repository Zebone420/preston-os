import Link from 'next/link';
import { getServerSupabase } from '@/lib/supabase/server';

// Audit View: read-only render of the append-only audit_log table,
// newest first. In setup mode there is no audit source yet.

export const dynamic = 'force-dynamic';

interface AuditRow {
  created_at: string;
  actor: string;
  action: string;
  action_class: string | null;
  environment: string | null;
}

export default async function AuditPage() {
  const supabase = await getServerSupabase();
  let rows: AuditRow[] = [];
  let note = '';

  if (!supabase) {
    note = 'SETUP MODE: Supabase env not configured; no audit source yet.';
  } else {
    const { data, error } = await supabase
      .from('audit_log')
      .select('created_at, actor, action, action_class, environment')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      note = 'audit read failed: ' + error.message;
    } else {
      rows = (data ?? []) as AuditRow[];
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Audit View</h1>
        <nav className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-300 underline">
            Dashboard
          </Link>
          <span className="rounded bg-emerald-900 px-2 py-1 text-xs">
            GREEN read-only
          </span>
        </nav>
      </header>
      {note && (
        <p className="mb-4 rounded bg-amber-900 p-2 text-sm">{note}</p>
      )}
      {rows.length === 0 && !note && (
        <p className="text-sm text-slate-400">No audit records yet.</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Action</th>
                <th className="p-2">Class</th>
                <th className="p-2">Environment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="p-2 text-slate-400">{r.created_at}</td>
                  <td className="p-2">{r.actor}</td>
                  <td className="p-2">{r.action}</td>
                  <td className="p-2">{r.action_class ?? '-'}</td>
                  <td className="p-2">{r.environment ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
