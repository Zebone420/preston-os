import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { readSystemControlsChecked } from '@/lib/ai-os/store';
import { loadOrchestrationReadModel } from '@/lib/ai-os/orchestration/read-model';
import { ComposerForm } from './composer-form';

// Preston AI OS - Phase 7 Goals/Tasks Request Composer. Owner-gated,
// SIMULATION-ONLY. The owner describes work in plain language; the composer
// interprets it into a structured, policy-classified proposal; nothing
// durable exists until the owner explicitly confirms the preview. Nothing on
// this page executes, sends, deploys, or approves.
export const dynamic = 'force-dynamic';

export default async function ComposerPage() {
  const ctx = await resolveOwner();
  if (!ctx) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Request Composer</h1>
        <p className="mt-4 rounded bg-amber-900 p-3 text-sm">
          Owner login required.{' '}
          <Link href="/login" className="underline">Sign in</Link>.
        </p>
      </main>
    );
  }

  const controls = await readSystemControlsChecked(ctx.client);
  const rm = await loadOrchestrationReadModel(ctx.client, 5);

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Request Composer</h1>
          <span className="rounded bg-purple-900 px-2 py-0.5 text-xs">
            SIMULATION-ONLY
          </span>
        </div>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4 text-xs">
        <span className="mr-2 text-sm font-medium">Runtime safety</span>
        <span className={'rounded px-2 py-0.5 ' + (controls.controls.execution_enabled ? 'bg-red-900' : 'bg-emerald-900')}>
          execution: {String(controls.controls.execution_enabled)}
        </span>
        <span className={'rounded px-2 py-0.5 ' + (controls.controls.remote_runner_enabled ? 'bg-red-900' : 'bg-emerald-900')}>
          remote_runner: {String(controls.controls.remote_runner_enabled)}
        </span>
        <span className="rounded bg-slate-800 px-2 py-0.5">
          hermes_mode: {controls.controls.hermes_mode}
        </span>
        {!rm.applied && (
          <span className="rounded bg-amber-900 px-2 py-0.5">
            migration 0010 not applied - proposals can be previewed but not persisted
          </span>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <ComposerForm />
      </section>

      <p className="mt-4 rounded bg-slate-900 p-3 text-xs text-slate-500">
        The composer treats your text as data, never as instruction authority:
        it cannot enable execution, touch production, use credentials, send
        messages, move money, or bypass approvals - such requests are rejected.
        Confirmation creates simulation-only staging records; gated tasks stay
        parked until you approve them through the owner approval path.
      </p>
    </main>
  );
}
