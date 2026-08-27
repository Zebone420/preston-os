import {
  controlSurfaceProof,
  remoteRunnerEnabled,
  MAX_RUNTIME_CAP_SECONDS,
} from '@/lib/remote-control';

// Remote-live safety-envelope reference (read-only). Originally the Phase-4
// dry-run proof page; the copy was refreshed at the fast-track cleanup
// (2026-08-26) after a production audit worker flagged the stale Phase-4
// wording - Remote-Live has since been proven end-to-end (timer-driven
// bounded execution, golden baseline sealed). Live posture lives at /os and
// through Preston Control; nothing on this page runs anything.

export const dynamic = 'force-dynamic';

export default function RemotePage() {
  const env = process.env as Record<string, string | undefined>;
  const enabled = remoteRunnerEnabled(env);
  const proof = controlSurfaceProof();

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Remote-Live Control Surface</h1>
        <span className="rounded bg-slate-800 px-2 py-1 text-xs">
          safety-envelope reference - live posture at /os
        </span>
      </header>

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded bg-slate-900 px-3 py-2">
          Remote runner:{' '}
          <strong className={enabled ? 'text-amber-400' : 'text-emerald-400'}>
            {enabled ? 'ENABLED (dry-run only)' : 'DISABLED (default)'}
          </strong>
        </span>
        <span className="rounded bg-slate-900 px-3 py-2">
          Execution model:{' '}
          <strong className="text-emerald-400">BOUNDED (owner-gated)</strong>
        </span>
        <span className="rounded bg-slate-900 px-3 py-2">
          Max runtime cap: <strong>{MAX_RUNTIME_CAP_SECONDS}s</strong>
        </span>
      </div>

      <p className="mb-4 rounded bg-slate-900 p-3 text-xs text-slate-400">
        Reference list of the remote-execution safety envelope. These controls
        were unit-tested here and subsequently proven under live remote drills
        (staging B5, production B6 - timer-driven bounded execution with SSOT
        evidence). Current live state: /os and Preston Control status.
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
                  <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs">proven</span>
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
