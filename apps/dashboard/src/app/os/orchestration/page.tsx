import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { readSystemControlsChecked } from '@/lib/ai-os/store';
import {
  AGENT_CONTRACTS,
  auditContracts,
} from '@/lib/ai-os/orchestration/agent-contracts';
import { COORDINATOR_LADDER } from '@/lib/ai-os/orchestration/coordinator';
import { loadOrchestrationReadModel } from '@/lib/ai-os/orchestration/read-model';
import { submitMasterGoal } from './actions';

// Preston AI OS - Phase 7 orchestration surface. Read-only, owner-gated.
// Shows the orchestration safety posture: agent capability contracts (default-
// deny), the coordinator ladder (current rung), and the runtime kill flags.
// Goal/job rows appear once migration 0010 is applied and the intake bridge is
// activated (both owner gates); until then this is the reference + posture
// view. Nothing here executes, approves, or sends.
export const dynamic = 'force-dynamic';

export default async function OrchestrationPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const ctx = await resolveOwner();
  if (!ctx) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Orchestration</h1>
        <p className="mt-4 rounded bg-amber-900 p-3 text-sm">
          Owner login required.{' '}
          <Link href="/login" className="underline">Sign in</Link>.
        </p>
      </main>
    );
  }

  const controls = await readSystemControlsChecked(ctx.client);
  const contractViolations = auditContracts();
  const rm = await loadOrchestrationReadModel(ctx.client, 20);
  const s = (r: Record<string, unknown>, k: string) => String(r[k] ?? '');

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">
            Orchestration (Phase 7)
          </h1>
          <span className="rounded bg-purple-900 px-2 py-0.5 text-xs">
            SIMULATION-ONLY
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
          <Link href="/os" className="underline">Control Center</Link>
          <Link href="/business" className="underline">Business</Link>
          <Link href="/audit" className="underline">Audit</Link>
        </nav>
      </header>

      {msg && (
        <p className="mb-4 rounded bg-slate-800 p-2 text-xs">{msg}</p>
      )}

      {!rm.applied && (
        <p className="mb-4 rounded bg-amber-900 p-3 text-xs">
          Migration 0010 is not applied - goal/job rows cannot be
          persisted yet. This is an owner gate
          (reports/PHASE_7_MIGRATION_0010_OWNER_PACKET.md). The safety
          posture below is live; goal submission is disabled until 0010
          is applied.
        </p>
      )}

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        {[
          ['Goals', rm.summary.total_goals],
          ['Running', rm.summary.running_goals],
          ['Blocked', rm.summary.blocked_goals],
          ['Approvals', rm.summary.open_approvals],
          ['Failed', rm.summary.failed_jobs],
          ['Dead-letter', rm.summary.dead_lettered_jobs],
        ].map(([label, n]) => (
          <div key={String(label)} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs uppercase text-slate-400">{label}</div>
            <div className="mt-1 text-xl font-semibold">{n}</div>
          </div>
        ))}
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <span className="mr-2 font-medium">Runtime safety</span>
        <span className={'rounded px-2 py-0.5 text-xs ' + (controls.controls.execution_enabled ? 'bg-red-900' : 'bg-emerald-900')}>
          execution: {String(controls.controls.execution_enabled)}
        </span>
        <span className={'rounded px-2 py-0.5 text-xs ' + (controls.controls.remote_runner_enabled ? 'bg-red-900' : 'bg-emerald-900')}>
          remote_runner: {String(controls.controls.remote_runner_enabled)}
        </span>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
          hermes_mode: {controls.controls.hermes_mode}
        </span>
        {!controls.readOk && (
          <span className="rounded bg-amber-900 px-2 py-0.5 text-xs">
            controls unreadable - fail-closed defaults shown
          </span>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">
            Agent contracts (default-deny)
          </h2>
          {contractViolations.length > 0 ? (
            <p className="rounded bg-red-950 p-2 text-xs text-red-300">
              CONTRACT VIOLATIONS: {contractViolations.join(', ')}
            </p>
          ) : (
            <p className="mb-2 text-xs text-emerald-300">
              all contracts healthy: no agent can approve, none has network,
              all staging-scoped
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-normal">Role</th>
                  <th className="py-1 pr-3 font-normal">Max risk</th>
                  <th className="py-1 pr-3 font-normal">Write</th>
                  <th className="py-1 pr-3 font-normal">Approve</th>
                  <th className="py-1 pr-3 font-normal">Caps</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(AGENT_CONTRACTS).map((c) => (
                  <tr key={c.role} className="border-t border-slate-800 align-top">
                    <td className="py-1 pr-3">{c.role}</td>
                    <td className="py-1 pr-3">{c.max_risk}</td>
                    <td className="py-1 pr-3">{c.write_scope}</td>
                    <td className="py-1 pr-3">{String(c.can_approve)}</td>
                    <td className="py-1 pr-3 text-xs text-slate-400">
                      {c.capabilities.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Coordinator ladder</h2>
          <ol className="space-y-1 text-sm">
            {COORDINATOR_LADDER.map((mode, i) => (
              <li key={mode} className="flex items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                  L{i}
                </span>
                <span>{mode}</span>
                {i <= 1 && (
                  <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-xs">
                    reachable (simulation)
                  </span>
                )}
                {i > 1 && (
                  <span className="rounded bg-amber-900 px-1.5 py-0.5 text-xs">
                    future owner gate
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Goal / job rows appear here once migration 0010 is owner-applied
            and the ChatGPT intake bridge is owner-activated. Both are owner
            gates. Nothing on this page executes, approves, or sends.
          </p>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Master goals</h2>
          {rm.goals.state === 'ok' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400"><tr>
                  <th className="py-1 pr-3 font-normal">Title</th>
                  <th className="py-1 pr-3 font-normal">Status</th>
                  <th className="py-1 pr-3 font-normal">Sim</th>
                </tr></thead>
                <tbody>
                  {rm.goals.rows.map((g) => (
                    <tr key={s(g, 'id')} className="border-t border-slate-800">
                      <td className="py-1 pr-3">{s(g, 'title')}</td>
                      <td className="py-1 pr-3">{s(g, 'status')}</td>
                      <td className="py-1 pr-3">{String(g.simulation_only)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {rm.goals.state === 'migration_absent' ? 'migration 0010 not applied'
                : rm.goals.state === 'empty' ? 'no goals yet'
                : `read error: ${rm.goals.note}`}
            </p>
          )}
          {rm.applied && (
            <form action={submitMasterGoal} className="mt-3 space-y-2 text-sm">
              <input name="title" placeholder="Goal title" className="w-full rounded bg-slate-800 p-1.5" />
              <input name="objective" placeholder="Objective (avoid gated verbs unless intended)" className="w-full rounded bg-slate-800 p-1.5" />
              <div className="text-xs text-slate-400">Tasks (kind|title|objective|depends by row #)</div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="grid grid-cols-4 gap-1">
                  <input name={`task${i}_kind`} placeholder="kind" className="rounded bg-slate-800 p-1.5" />
                  <input name={`task${i}_title`} placeholder="title" className="rounded bg-slate-800 p-1.5" />
                  <input name={`task${i}_objective`} placeholder="objective" className="rounded bg-slate-800 p-1.5" />
                  <input name={`task${i}_depends`} placeholder="deps e.g. 1" className="rounded bg-slate-800 p-1.5" />
                </div>
              ))}
              <button className="rounded bg-purple-900 px-3 py-1.5 text-sm">Submit goal (simulation)</button>
              <span className="ml-2 text-xs text-slate-500">decomposes + persists; runs only when the durable worker is deployed (owner gate)</span>
            </form>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-medium">Open approvals + failures</h2>
          <div className="text-xs text-slate-400">Open approvals: {rm.summary.open_approvals}</div>
          <ul className="mt-1 space-y-1 text-sm">
            {rm.approvals.rows.slice(0, 10).map((a) => (
              <li key={s(a, 'approval_id')}>
                [{s(a, 'risk_class')}] {s(a, 'action')} - {s(a, 'status')}
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-slate-400">Failed: {rm.summary.failed_jobs} | Dead-letter: {rm.summary.dead_lettered_jobs}</div>
          <ul className="mt-1 space-y-1 text-sm text-red-300">
            {rm.dead_letters.rows.slice(0, 10).map((j) => (
              <li key={s(j, 'id')}>{s(j, 'title')}: {s(j, 'failure_reason')}</li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-4 rounded bg-slate-900 p-3 text-xs text-slate-500">
        Phase 7 orchestration is coded and simulation-proven, not activated.
        The completion engine, adapters, and coordinator run in simulation
        only (executed=false everywhere). Real Claude/Codex capability is
        fail-closed to unavailable until an owner activation gate.
      </p>
    </main>
  );
}
