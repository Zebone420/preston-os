import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { readSystemControlsChecked } from '@/lib/ai-os/store';
import {
  AGENT_CONTRACTS,
  auditContracts,
} from '@/lib/ai-os/orchestration/agent-contracts';
import { COORDINATOR_LADDER } from '@/lib/ai-os/orchestration/coordinator';

// Preston AI OS - Phase 7 orchestration surface. Read-only, owner-gated.
// Shows the orchestration safety posture: agent capability contracts (default-
// deny), the coordinator ladder (current rung), and the runtime kill flags.
// Goal/job rows appear once migration 0010 is applied and the intake bridge is
// activated (both owner gates); until then this is the reference + posture
// view. Nothing here executes, approves, or sends.
export const dynamic = 'force-dynamic';

export default async function OrchestrationPage() {
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

      <p className="mt-4 rounded bg-slate-900 p-3 text-xs text-slate-500">
        Phase 7 orchestration is coded and simulation-proven, not activated.
        The completion engine, adapters, and coordinator run in simulation
        only (executed=false everywhere). Real Claude/Codex capability is
        fail-closed to unavailable until an owner activation gate.
      </p>
    </main>
  );
}
