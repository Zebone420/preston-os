import Link from 'next/link';
import { depsFrom, resolveOwner } from '@/lib/ai-os/owner-context';
import { readStatus } from '@/lib/ai-os/controlplane';
import { listAgents, listCommandPackets, listJobs } from '@/lib/ai-os/store';

// Preston AI OS - Owner Control Center (Phase 4). Read-only, owner-gated.
// Shows global controls, agents, recent command proposals, and jobs from the
// Supabase control plane. No execution controls here (pause/resume/stop go
// through the audited POST /api/os/control). No secrets are displayed.
export const dynamic = 'force-dynamic';

function Badge({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={'rounded px-2 py-0.5 text-xs ' + (on ? 'bg-emerald-900' : 'bg-slate-700')}>
      {label}: {on ? 'on' : 'off'}
    </span>
  );
}

export default async function OsControlCenter() {
  const ctx = await resolveOwner();
  if (!ctx) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Preston AI OS - Control Center</h1>
        <p className="mt-4 rounded bg-amber-900 p-3 text-sm">
          Owner login required. <Link href="/login" className="underline">Sign in</Link>.
        </p>
      </main>
    );
  }

  const status = await readStatus(depsFrom(ctx));
  const commands = await listCommandPackets(ctx.client, 10);
  const jobs = await listJobs(ctx.client, 10);
  const agents = await listAgents(ctx.client, 20);

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Preston AI OS - Control Center</h1>
        <nav className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-300 underline">Dashboard</Link>
          <Link href="/approvals" className="text-sm text-slate-300 underline">Approvals</Link>
        </nav>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <span className="mr-2 font-medium">Runtime controls</span>
        <Badge label="execution" on={status.execution_enabled} />
        <Badge label="owner_stop" on={status.owner_stop} />
        <Badge label="paused" on={status.paused} />
        <Badge label="runner" on={status.remote_runner_enabled} />
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">hermes: {status.hermes_mode}</span>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Agents ({agents.rows.length})</h2>
          {agents.error && <p className="text-xs text-red-300">{agents.error}</p>}
          {agents.rows.length === 0 && !agents.error && (
            <p className="text-xs text-slate-500">No agents registered.</p>
          )}
          <ul className="space-y-1 text-sm text-slate-300">
            {agents.rows.map((a) => (
              <li key={String(a['id'])}>
                {String(a['id'])} - {String(a['status'] ?? 'offline')}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Commands ({commands.rows.length})</h2>
          {commands.error && <p className="text-xs text-red-300">{commands.error}</p>}
          {commands.rows.length === 0 && !commands.error && (
            <p className="text-xs text-slate-500">No command proposals yet.</p>
          )}
          <ul className="space-y-1 text-sm text-slate-300">
            {commands.rows.map((c) => (
              <li key={String(c['id'])}>
                [{String(c['action_class'] ?? '?')}] {String(c['requested_action'] ?? '')} - {String(c['status'] ?? 'proposed')}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Jobs ({jobs.rows.length})</h2>
          {jobs.error && <p className="text-xs text-red-300">{jobs.error}</p>}
          {jobs.rows.length === 0 && !jobs.error && (
            <p className="text-xs text-slate-500">No jobs in the queue.</p>
          )}
          <ul className="space-y-1 text-sm text-slate-300">
            {jobs.rows.map((j) => (
              <li key={String(j['id'])}>
                {String(j['id'])} - {String(j['status'] ?? '?')} [{String(j['risk_class'] ?? '?')}]
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-4 rounded bg-slate-900 p-3 text-xs text-slate-500">
        Read-only. Nothing on this page executes. Hermes: {status.hermes_mode}; runner{' '}
        {status.remote_runner_enabled ? 'enabled' : 'disabled'}; execution{' '}
        {status.execution_enabled ? 'enabled' : 'disabled'}. Controls change only
        through the audited /api/os/control endpoint.
      </p>
    </main>
  );
}
