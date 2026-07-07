import Link from 'next/link';
import {
  controlSurfaceProof,
  remoteRunnerEnabled,
  MAX_RUNTIME_CAP_SECONDS,
} from '@/lib/remote-control';

// Remote-live proof dashboard - Phase 4 GREEN (read-only). Shows the safety
// envelope status. The remote runner is disabled by default and live remote
// execution is blocked in Phase 4. Nothing on this page runs anything.

export const dynamic = 'force-dynamic';

export default function RemotePage() {
  const env = process.env as Record<string, string | undefined>;
  const enabled = remoteRunnerEnabled(env);
  const proof = controlSurfaceProof();

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Remote-Live Control Surface</h1>
        <nav className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-300 underline">
            Dashboard
          </Link>
          <span className="rounded bg-amber-900 px-2 py-1 text-xs">
            PHASE 4 - dry-run only, runner disabled
          </span>
        </nav>
      </header>

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded bg-slate-900 px-3 py-2">
          Remote runner:{' '}
          <strong className={enabled ? 'text-amber-400' : 'text-emerald-400'}>
            {enabled ? 'ENABLED (dry-run only)' : 'DISABLED (default)'}
          </strong>
        </span>
        <span className="rounded bg-slate-900 px-3 py-2">
          Live remote execution: <strong className="text-emerald-400">BLOCKED</strong>
        </span>
        <span className="rounded bg-slate-900 px-3 py-2">
          Max runtime cap: <strong>{MAX_RUNTIME_CAP_SECONDS}s</strong>
        </span>
      </div>

      <p className="mb-4 rounded bg-slate-900 p-3 text-xs text-slate-400">
        Every control below is implemented and unit-tested locally. None is yet
        proven under a remote drill (Phase 5). Laptop-close-safe cannot be
        claimed until every item is proven_remotely.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="p-2">Control</th>
              <th className="p-2">Implemented</th>
              <th className="p-2">Proven remotely</th>
              <th className="p-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {proof.map((p) => (
              <tr key={p.key} className="border-t border-slate-800">
                <td className="p-2">{p.label}</td>
                <td className="p-2">
                  <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs">yes</span>
                </td>
                <td className="p-2">
                  <span className="rounded bg-amber-900 px-2 py-0.5 text-xs">not yet</span>
                </td>
                <td className="p-2 text-slate-400">{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
