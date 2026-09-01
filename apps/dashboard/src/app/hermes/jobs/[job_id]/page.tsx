import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { getPrestonJob, hermesToolContext } from '@/lib/hermes/adapter';
import { isArtifactRef } from '@/lib/hermes/view-models';

// Hermes Supervisor Dashboard v0 - job inspection. READ ONLY: renders
// exactly what getPrestonJob reports (job row, run liveness, related
// approval restated display-only, per-attempt result reports). Missing
// telemetry renders as UNKNOWN/absent - never inferred.
export const dynamic = 'force-dynamic';

export default async function HermesJobPage({
  params,
}: {
  params: Promise<{ job_id: string }>;
}) {
  const { job_id } = await params;
  const owner = await resolveOwner();
  if (!owner) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes - Job</h1>
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

  const tctx = hermesToolContext(owner);
  const res = await getPrestonJob(tctx, job_id);
  if (!res.found) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes - Job</h1>
        <p className="mt-4 rounded bg-amber-950 p-3 text-sm text-amber-300">
          job not readable: {res.error}
        </p>
        <Link href="/hermes" className="mt-4 inline-block text-sm underline">
          back to Hermes
        </Link>
      </main>
    );
  }
  const j = res.job;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Job</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
          {j.status}
        </span>
        <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
          READ ONLY
        </span>
        <Link href={`/hermes/goals/${j.goal_id}`} className="text-sm underline">
          goal {j.goal_id.slice(0, 8)}
        </Link>
        <Link href="/hermes" className="text-sm underline">
          back to Hermes
        </Link>
      </header>

      <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="font-medium">{j.title || '(untitled)'}</div>
        <p className="mt-1 text-slate-300">{j.objective}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="text-slate-500">job_id</dt>
          <dd className="font-mono">{j.job_id}</dd>
          <dt className="text-slate-500">kind</dt>
          <dd>{j.kind}</dd>
          <dt className="text-slate-500">assigned_role</dt>
          <dd>{j.assigned_role ?? 'UNKNOWN'}</dd>
          <dt className="text-slate-500">risk_class</dt>
          <dd>{j.risk_class}</dd>
          <dt className="text-slate-500">attempts</dt>
          <dd>{j.attempts}</dd>
          <dt className="text-slate-500">requires_approval</dt>
          <dd>{String(j.requires_approval)}</dd>
          <dt className="text-slate-500">run active</dt>
          <dd>
            {String(res.run.active)}
            {res.run.lease_expires_at
              ? ` (lease expires ${res.run.lease_expires_at})`
              : ''}
          </dd>
          <dt className="text-slate-500">updated_at</dt>
          <dd>{j.updated_at}</dd>
        </dl>
        {j.failure_reason && (
          <p className="mt-2 rounded bg-red-950 p-2 text-xs text-red-300">
            failure: {j.failure_reason}
          </p>
        )}
      </section>

      {res.approval && (
        <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="font-medium">Related approval</h2>
            <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
              DISPLAY ONLY - decide in Preston Control
            </span>
          </div>
          <div className="font-mono text-xs">{res.approval.approval_id}</div>
          <div className="text-xs text-slate-400">
            [{res.approval.risk_class}] {res.approval.action} -{' '}
            {res.approval.status} | expires {res.approval.expires_at}
          </div>
          <div className="text-xs text-slate-500">
            reason: {res.approval.reason}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-2 font-medium">
          Result reports{' '}
          {!res.result_reports_read_ok && (
            <span className="text-xs text-amber-400">
              (reports read failed - UNKNOWN)
            </span>
          )}
        </h2>
        {res.result_reports.length === 0 ? (
          <p className="text-xs text-slate-500">
            no result reports recorded (a normal state until the runtime
            records one for this job)
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {res.result_reports.map((r) => (
              <li
                key={r.attempt}
                className="rounded border border-slate-800 bg-slate-950 p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5">
                    attempt {r.attempt}
                  </span>
                  <span
                    className={
                      'rounded px-1.5 py-0.5 ' +
                      (r.outcome === 'completed'
                        ? 'bg-emerald-900'
                        : 'bg-red-900')
                    }
                  >
                    {r.outcome || 'UNKNOWN'}
                  </span>
                  <span>mode: {r.mode || 'UNKNOWN'}</span>
                  <span>role: {r.provider_role || 'UNKNOWN'}</span>
                  <span>
                    model: {r.provider_model ?? 'UNKNOWN'}
                  </span>
                  <span>
                    duration:{' '}
                    {r.duration_ms === null ? 'UNKNOWN' : `${r.duration_ms}ms`}
                  </span>
                  <span className="text-slate-500">
                    recorded {r.recorded_at}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300">{r.summary}</p>
                {r.failure_reason && (
                  <p className="mt-1 text-xs text-red-300">
                    failure: {r.failure_reason}
                  </p>
                )}
                {r.files_changed.length > 0 && (
                  <div className="mt-1 text-xs text-slate-400">
                    files changed:{' '}
                    <span className="font-mono">
                      {r.files_changed.join(', ')}
                    </span>
                  </div>
                )}
                {r.evidence_refs.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {r.evidence_refs.map((ref, i) => (
                      <li key={i} className="font-mono">
                        {isArtifactRef(ref) ? (
                          <Link
                            href={`/hermes/artifacts/${String(ref)}`}
                            className="underline"
                          >
                            {String(ref)}
                          </Link>
                        ) : (
                          String(ref)
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
