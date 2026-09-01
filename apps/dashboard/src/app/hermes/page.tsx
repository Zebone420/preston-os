import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import {
  getPrestonGoal,
  getPrestonStatus,
  hermesToolContext,
  listPrestonApprovals,
} from '@/lib/hermes/adapter';
import {
  aggregateJobRows,
  toGoalCard,
  toHeader,
  toMetrics,
  type HermesGoalCard,
  type Metric,
} from '@/lib/hermes/view-models';
import { SupervisorFeed } from './event-feed';

// Hermes Supervisor Dashboard v0 - READ-ONLY observation surface above
// Preston Control. Every number on this page comes from the supported
// Preston Control read operations (see lib/hermes/adapter.ts); nothing
// here executes, approves, cancels, submits, or writes. Unknown is
// rendered as UNKNOWN, never as an invented zero.
export const dynamic = 'force-dynamic';

const GOAL_DETAIL_LIMIT = 6;

function MetricCard({ label, value }: { label: string; value: Metric }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div
        className={
          'mt-1 text-xl font-semibold ' +
          (value === 'UNKNOWN' ? 'text-amber-400' : '')
        }
      >
        {value}
      </div>
    </div>
  );
}

function Flag({
  label,
  value,
  dangerWhenTrue,
}: {
  label: string;
  value: boolean;
  dangerWhenTrue: boolean;
}) {
  const danger = dangerWhenTrue === value;
  return (
    <span
      className={
        'rounded px-2 py-0.5 text-xs ' +
        (danger ? 'bg-red-900' : 'bg-emerald-900')
      }
    >
      {label}: {String(value)}
    </span>
  );
}

function GoalRow({ g }: { g: HermesGoalCard }) {
  const counts = Object.entries(g.job_status_counts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return (
    <tr className="border-t border-slate-800 align-top">
      <td className="py-1 pr-3">
        <Link href={`/hermes/goals/${g.goal_id}`} className="underline">
          {g.title || '(untitled)'}
        </Link>
        <div className="font-mono text-xs text-slate-500">
          {g.goal_id.slice(0, 8)}
        </div>
      </td>
      <td className="py-1 pr-3">{g.status}</td>
      <td className="py-1 pr-3 text-xs">{g.created_at}</td>
      <td className="py-1 pr-3">
        {g.jobs_read_ok ? g.job_total : 'UNKNOWN'}
        <div className="text-xs text-slate-500">{counts}</div>
      </td>
      <td className="py-1 pr-3">{g.pending_approvals}</td>
      <td className="py-1 pr-3">
        {g.evidence_refs > 0 ? `yes (${g.evidence_refs})` : 'none'}
      </td>
    </tr>
  );
}

export default async function HermesPage() {
  const owner = await resolveOwner();
  if (!owner) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes</h1>
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
  const status = await getPrestonStatus(tctx);
  const approvals = await listPrestonApprovals(tctx);
  const header = toHeader(status);
  const metrics = toMetrics(status);

  // Bounded per-goal detail via the supported preston_get_goal read.
  const recent = status.recent_goals.slice(0, GOAL_DETAIL_LIMIT);
  const details = await Promise.all(
    recent.map((g) => getPrestonGoal(tctx, g.goal_id)),
  );
  const goalCards = details
    .filter((d): d is Extract<typeof d, { found: true }> => d.found)
    .map(toGoalCard);
  const jobRows = aggregateJobRows(details);

  const failures = status.failures;
  const deadLetters = status.dead_letters;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Hermes</h1>
        <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
          SUPERVISOR DASHBOARD v0 - READ ONLY
        </span>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
          env: {header.environment}
        </span>
        <span
          className={
            'rounded px-2 py-0.5 text-xs ' +
            (header.posture === 'operating'
              ? 'bg-emerald-900'
              : 'bg-amber-900')
          }
        >
          posture: {header.posture}
        </span>
        <span className="text-xs text-slate-500">
          as of {header.generated_at}
        </span>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <span className="mr-2 font-medium">System</span>
        {!header.controls_readable && (
          <span className="rounded bg-amber-900 px-2 py-0.5 text-xs">
            controls UNREADABLE - fail-closed values shown
          </span>
        )}
        <Flag
          label="execution"
          value={header.execution_enabled}
          dangerWhenTrue={true}
        />
        <Flag
          label="remote_runner"
          value={header.remote_runner_enabled}
          dangerWhenTrue={true}
        />
        <Flag
          label="owner_stop"
          value={header.owner_stop}
          dangerWhenTrue={true}
        />
        <Flag label="paused" value={header.paused} dangerWhenTrue={true} />
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
          hermes_mode: {header.hermes_mode}
        </span>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <MetricCard label="Goals" value={metrics.total_goals} />
        <MetricCard label="Running" value={metrics.running_goals} />
        <MetricCard label="Blocked" value={metrics.blocked_goals} />
        <MetricCard
          label="Pending approvals"
          value={metrics.pending_approvals}
        />
        <MetricCard label="Failed" value={metrics.failed_jobs} />
        <MetricCard
          label="Dead-lettered"
          value={metrics.dead_lettered_jobs}
        />
      </section>

      {header.needs_attention.length > 0 && (
        <section className="mb-4 rounded-lg border border-amber-900 bg-amber-950 p-4">
          <h2 className="mb-1 font-medium text-amber-300">
            Needs attention
          </h2>
          <ul className="list-inside list-disc text-sm text-amber-200">
            {header.needs_attention.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Recent goals</h2>
          <p className="mb-2 text-xs text-slate-500">
            via getPrestonStatus + getPrestonGoal (bounded to the{' '}
            {GOAL_DETAIL_LIMIT} most recent)
          </p>
          {goalCards.length === 0 ? (
            <p className="text-xs text-slate-500">
              no goals in the covered window
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Goal</th>
                    <th className="py-1 pr-3 font-normal">Status</th>
                    <th className="py-1 pr-3 font-normal">Created</th>
                    <th className="py-1 pr-3 font-normal">Jobs</th>
                    <th className="py-1 pr-3 font-normal">Approvals</th>
                    <th className="py-1 pr-3 font-normal">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {goalCards.map((g) => (
                    <GoalRow key={g.goal_id} g={g} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Jobs (recent goals)</h2>
          <p className="mb-2 text-xs text-slate-500">
            provider/model and duration appear on the job detail page when
            the platform reports them - never inferred here
          </p>
          {jobRows.length === 0 ? (
            <p className="text-xs text-slate-500">
              no jobs in the covered window
            </p>
          ) : (
            <div className="max-h-96 overflow-x-auto overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Job</th>
                    <th className="py-1 pr-3 font-normal">Role</th>
                    <th className="py-1 pr-3 font-normal">Status</th>
                    <th className="py-1 pr-3 font-normal">Risk</th>
                    <th className="py-1 pr-3 font-normal">Attempts</th>
                    <th className="py-1 pr-3 font-normal">Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {jobRows.map((j) => (
                    <tr
                      key={j.job_id}
                      className="border-t border-slate-800 align-top"
                    >
                      <td className="py-1 pr-3">
                        <Link
                          href={`/hermes/jobs/${j.job_id}`}
                          className="underline"
                        >
                          {j.title || j.kind}
                        </Link>
                        <div className="font-mono text-xs text-slate-500">
                          {j.job_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="py-1 pr-3">
                        {j.assigned_role ?? 'UNKNOWN'}
                      </td>
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
      </div>

      <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Pending owner approvals</h2>
          <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
            DISPLAY ONLY - decisions happen in Preston Control
          </span>
        </div>
        {!approvals.read_ok ? (
          <p className="text-xs text-amber-400">
            approvals UNREADABLE (fail-closed) - count is UNKNOWN
          </p>
        ) : approvals.approvals.length === 0 ? (
          <p className="text-xs text-slate-500">no pending approvals</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-normal">Approval</th>
                  <th className="py-1 pr-3 font-normal">Goal / Job</th>
                  <th className="py-1 pr-3 font-normal">Action</th>
                  <th className="py-1 pr-3 font-normal">Reason</th>
                  <th className="py-1 pr-3 font-normal">Risk</th>
                  <th className="py-1 pr-3 font-normal">Env</th>
                  <th className="py-1 pr-3 font-normal">Expires</th>
                </tr>
              </thead>
              <tbody>
                {approvals.approvals.map((a) => (
                  <tr
                    key={a.approval_id}
                    className="border-t border-slate-800 align-top"
                  >
                    <td className="py-1 pr-3 font-mono text-xs">
                      {a.approval_id}
                      {!a.decision_open && (
                        <div className="text-amber-400">expired</div>
                      )}
                    </td>
                    <td className="py-1 pr-3 font-mono text-xs">
                      {a.goal_id ? (
                        <Link
                          href={`/hermes/goals/${a.goal_id}`}
                          className="underline"
                        >
                          {a.goal_id.slice(0, 8)}
                        </Link>
                      ) : (
                        '-'
                      )}{' '}
                      /{' '}
                      {a.job_id ? (
                        <Link
                          href={`/hermes/jobs/${a.job_id}`}
                          className="underline"
                        >
                          {a.job_id.slice(0, 8)}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-1 pr-3 text-xs">{a.action}</td>
                    <td className="py-1 pr-3 text-xs">{a.reason}</td>
                    <td className="py-1 pr-3">{a.risk_class}</td>
                    <td className="py-1 pr-3">{a.environment}</td>
                    <td className="py-1 pr-3 text-xs">{a.expires_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Failed jobs</h2>
          {status.read_states.jobs !== 'ok' &&
            status.read_states.jobs !== 'empty' && (
              <p className="mb-2 text-xs text-amber-400">
                jobs bucket {status.read_states.jobs} - listing may be
                incomplete
              </p>
            )}
          {failures.length === 0 ? (
            <p className="text-xs text-slate-500">
              no failed jobs in the covered window
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {failures.map((j) => (
                <li key={j.job_id} className="border-t border-slate-800 py-1">
                  <Link
                    href={`/hermes/jobs/${j.job_id}`}
                    className="underline"
                  >
                    {j.title || j.kind}
                  </Link>{' '}
                  <span className="font-mono text-xs text-slate-500">
                    {j.job_id.slice(0, 8)}
                  </span>
                  <div className="text-xs text-red-300">
                    {j.failure_reason ?? 'no failure reason recorded'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Dead-lettered jobs</h2>
          <p className="mb-2 text-xs text-slate-500">
            historical dead letters remain visible; they are facts, not
            noise
          </p>
          {deadLetters.length === 0 ? (
            <p className="text-xs text-slate-500">
              no dead-lettered jobs in the covered window
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {deadLetters.map((j) => (
                <li key={j.job_id} className="border-t border-slate-800 py-1">
                  <Link
                    href={`/hermes/jobs/${j.job_id}`}
                    className="underline"
                  >
                    {j.title || j.kind}
                  </Link>{' '}
                  <span className="font-mono text-xs text-slate-500">
                    {j.job_id.slice(0, 8)}
                  </span>
                  <div className="text-xs text-red-300">
                    {j.failure_reason ?? 'no failure reason recorded'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <SupervisorFeed environment={header.environment} />

      <p className="mt-4 rounded bg-slate-900 p-3 text-xs text-slate-500">
        Hermes observes through Preston Control only: getPrestonStatus,
        getPrestonGoal, getPrestonJob, listPrestonApprovals,
        pollPrestonEvents, getPrestonEvidence, getPrestonArtifact. It has
        no execution, approval, cancellation, or submission authority.
      </p>
    </main>
  );
}
