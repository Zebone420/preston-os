import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import {
  getPrestonEvidence,
  getPrestonGoal,
  hermesToolContext,
} from '@/lib/hermes/adapter';
import { isArtifactRef } from '@/lib/hermes/view-models';

// Hermes Supervisor Dashboard v0 - goal inspection. READ ONLY: renders
// exactly what getPrestonGoal and getPrestonEvidence report. No approve,
// no reject, no cancel, no follow-up - those stay in Preston Control.
export const dynamic = 'force-dynamic';

export default async function HermesGoalPage({
  params,
}: {
  params: Promise<{ goal_id: string }>;
}) {
  const { goal_id } = await params;
  const owner = await resolveOwner();
  if (!owner) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes - Goal</h1>
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
  const res = await getPrestonGoal(tctx, goal_id);
  if (!res.found) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes - Goal</h1>
        <p className="mt-4 rounded bg-amber-950 p-3 text-sm text-amber-300">
          goal not readable: {res.error}
        </p>
        <Link href="/hermes" className="mt-4 inline-block text-sm underline">
          back to Hermes
        </Link>
      </main>
    );
  }
  const evidence = await getPrestonEvidence(tctx, { goal_id });
  const g = res.goal;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Goal</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
          {g.status}
        </span>
        <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
          READ ONLY
        </span>
        <Link href="/hermes" className="text-sm underline">
          back to Hermes
        </Link>
      </header>

      <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="font-medium">{g.title || '(untitled)'}</div>
        <p className="mt-1 text-slate-300">{g.objective}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="text-slate-500">goal_id</dt>
          <dd className="font-mono">{g.goal_id}</dd>
          <dt className="text-slate-500">environment</dt>
          <dd>{g.environment}</dd>
          <dt className="text-slate-500">source</dt>
          <dd>{g.source}</dd>
          <dt className="text-slate-500">requested_by</dt>
          <dd>{g.requested_by}</dd>
          <dt className="text-slate-500">created_at</dt>
          <dd>{g.created_at}</dd>
          <dt className="text-slate-500">updated_at</dt>
          <dd>{g.updated_at}</dd>
          <dt className="text-slate-500">correlation_id</dt>
          <dd className="font-mono">{g.correlation_id}</dd>
          <dt className="text-slate-500">simulation_only</dt>
          <dd>{String(g.simulation_only)}</dd>
        </dl>
        {(res.parent_goal_id || res.child_goal_ids.length > 0) && (
          <div className="mt-3 text-xs">
            {res.parent_goal_id && (
              <div>
                parent goal:{' '}
                <Link
                  href={`/hermes/goals/${res.parent_goal_id}`}
                  className="font-mono underline"
                >
                  {res.parent_goal_id}
                </Link>
              </div>
            )}
            {res.child_goal_ids.map((c) => (
              <div key={c}>
                child goal:{' '}
                <Link
                  href={`/hermes/goals/${c}`}
                  className="font-mono underline"
                >
                  {c}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-2 font-medium">
          Jobs{' '}
          {!res.jobs_read_ok && (
            <span className="text-xs text-amber-400">
              (jobs read failed - list may be incomplete)
            </span>
          )}
        </h2>
        {res.jobs.length === 0 ? (
          <p className="text-xs text-slate-500">no jobs recorded</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-normal">Job</th>
                  <th className="py-1 pr-3 font-normal">Kind</th>
                  <th className="py-1 pr-3 font-normal">Role</th>
                  <th className="py-1 pr-3 font-normal">Status</th>
                  <th className="py-1 pr-3 font-normal">Risk</th>
                  <th className="py-1 pr-3 font-normal">Attempts</th>
                  <th className="py-1 pr-3 font-normal">Failure</th>
                </tr>
              </thead>
              <tbody>
                {res.jobs.map((j) => (
                  <tr
                    key={j.job_id}
                    className="border-t border-slate-800 align-top"
                  >
                    <td className="py-1 pr-3">
                      <Link
                        href={`/hermes/jobs/${j.job_id}`}
                        className="underline"
                      >
                        {j.title || '(untitled)'}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">
                        {j.job_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="py-1 pr-3">{j.kind}</td>
                    <td className="py-1 pr-3">{j.assigned_role ?? '-'}</td>
                    <td className="py-1 pr-3">{j.status}</td>
                    <td className="py-1 pr-3">{j.risk_class}</td>
                    <td className="py-1 pr-3">{j.attempts}</td>
                    <td className="py-1 pr-3 text-xs text-red-300">
                      {j.failure_reason ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-medium">Pending approvals</h2>
          <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
            DISPLAY ONLY
          </span>
        </div>
        {res.pending_approvals.length === 0 ? (
          <p className="text-xs text-slate-500">
            no pending approvals for this goal
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {res.pending_approvals.map((a) => (
              <li key={a.approval_id} className="border-t border-slate-800 py-1">
                <span className="font-mono text-xs">{a.approval_id}</span>{' '}
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                  {a.risk_class}
                </span>{' '}
                <span className="text-xs">{a.action}</span>
                <div className="text-xs text-slate-500">
                  reason: {a.reason} | env: {a.environment} | expires:{' '}
                  {a.expires_at}
                  {!a.decision_open && (
                    <span className="text-amber-400"> (expired)</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-2 font-medium">Evidence</h2>
        {!evidence.ok ? (
          <p className="text-xs text-amber-400">
            evidence not readable: {evidence.error}
          </p>
        ) : evidence.items.length === 0 ? (
          <p className="text-xs text-slate-500">no evidence recorded</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {evidence.items.map((item) => (
              <li key={item.job_id} className="border-t border-slate-800 py-1">
                <Link
                  href={`/hermes/jobs/${item.job_id}`}
                  className="underline"
                >
                  {item.title || item.kind}
                </Link>{' '}
                <span className="text-xs text-slate-500">
                  [{item.status}]
                </span>
                {item.failure_summary && (
                  <div className="text-xs text-red-300">
                    {item.failure_summary}
                  </div>
                )}
                {item.evidence_refs.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    no evidence refs
                  </div>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {item.evidence_refs.map((ref, i) => (
                      <li key={i} className="font-mono">
                        {isArtifactRef(ref) ? (
                          <Link
                            href={`/hermes/artifacts/${ref}`}
                            className="underline"
                          >
                            {ref}
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
