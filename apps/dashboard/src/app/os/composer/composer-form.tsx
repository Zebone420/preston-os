'use client';

// Preston AI OS - Phase 7 Composer form. CLIENT SHELL over pure helpers +
// server actions. The request text is UNTRUSTED and rendered ONLY as React
// text nodes (never markup). The two-step boundary is visible in the UI:
// "Interpret" produces a preview (nothing persisted), "Confirm & create" is
// the explicit owner confirmation. Duplicate submits are guarded by the
// pending state AND by the server-side idempotency key. No button here can
// execute, send, deploy, or approve anything.

import { useActionState, useState } from 'react';
import type { ComposedTask, ComposerProposal } from '@/lib/ai-os/orchestration/composer';
import { composeProposalAction, confirmProposalAction } from './actions';
import { INITIAL_COMPOSER_STATE } from './state';

export const REQUEST_PLACEHOLDER =
  'Example: Create a staging-only goal to verify the Phase 7 dashboard ' +
  'status page. Create tasks to inspect the staging status data, generate ' +
  'a simulation-only readiness summary, and attach internal evidence.';

// Human-readable badge label for a task's policy classification.
export function policyBadge(t: Pick<ComposedTask, 'tier' | 'requires_approval'>): string {
  if (t.requires_approval) return `${t.tier} - owner approval required`;
  return `${t.tier} - auto-runnable in simulation`;
}

// Human-readable error labels (never render raw internals to the owner
// without a stable prefix they can report).
export function errorLabel(code: string): string {
  const map: Record<string, string> = {
    empty_request: 'The request is empty.',
    request_too_long: 'The request is too long (4000 character limit).',
    owner_login_required: 'Owner login required.',
    'ambiguous_request:no_goal': 'No goal could be identified - state one clearly.',
    too_many_goals: 'Too many goals in one request (limit 3).',
    too_many_tasks: 'Too many tasks in one goal (limit 10).',
    duplicate_task_identifier: 'Duplicate task number in the request.',
    unsupported_execution_mode: 'Only simulation-mode staging work can be requested.',
    proposal_hash_mismatch: 'The request text changed after preview - re-interpret it.',
    idempotency_key_payload_mismatch:
      'This confirmation key was already used for a different request.',
    migration_0010_not_applied: 'Migration 0010 is not applied - nothing can be persisted yet.',
    secret_in_request: 'The request appears to contain secret material - remove it.',
  };
  if (map[code]) return map[code];
  if (code.startsWith('injection:')) {
    return 'The request contains instruction-override text and was rejected (' +
      code.slice('injection:'.length) + ').';
  }
  if (code.startsWith('prohibited:')) {
    return 'The request names a prohibited capability (' +
      code.slice('prohibited:'.length) + ') and was rejected.';
  }
  if (code.startsWith('invalid_dependency:')) return 'A task references a dependency that does not exist.';
  if (code.startsWith('unsupported_agent')) return 'The request names an unsupported agent (' + code + ').';
  if (code.startsWith('ambiguous_request:')) return 'The request is ambiguous (' + code + ').';
  return code;
}

// Total counts for the confirmation summary line.
export function proposalCounts(p: ComposerProposal): {
  goals: number; tasks: number; approvals: number;
} {
  return {
    goals: p.goals.length,
    tasks: p.goals.reduce((n, g) => n + g.tasks.length, 0),
    approvals: p.approvals_required,
  };
}

export function ComposerForm() {
  const [composeState, composeAction, composePending] =
    useActionState(composeProposalAction, INITIAL_COMPOSER_STATE);
  const [confirmState, confirmAction, confirmPending] =
    useActionState(confirmProposalAction, INITIAL_COMPOSER_STATE);
  const [cancelled, setCancelled] = useState(false);

  // The confirm result supersedes the compose preview; Cancel hides the
  // preview client-side (nothing durable existed yet).
  const active = confirmState.step !== 'idle' ? confirmState : composeState;
  const proposal = !cancelled && composeState.step === 'proposal' &&
    confirmState.step === 'idle' ? composeState.proposal : null;
  const pending = composePending || confirmPending;

  return (
    <div className="space-y-4">
      <form action={composeAction} className="space-y-2"
        onSubmit={() => setCancelled(false)}>
        <label htmlFor="composer-request" className="block text-sm font-medium">
          Describe the goal and tasks (plain language, staging simulation only)
        </label>
        <textarea
          id="composer-request"
          name="request"
          rows={5}
          maxLength={4000}
          defaultValue={active.raw_request}
          placeholder={REQUEST_PLACEHOLDER}
          aria-label="Operational request"
          className="w-full rounded bg-slate-800 p-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          aria-label="Interpret request"
          className="rounded bg-slate-700 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {composePending ? 'Interpreting...' : 'Interpret request'}
        </button>
        <span className="ml-2 text-xs text-slate-500">
          Interpreting creates nothing - you will confirm before anything is created.
        </span>
      </form>

      <div aria-live="polite" className="space-y-3">
        {pending && (
          <p className="rounded bg-slate-800 p-2 text-xs" role="status">Working...</p>
        )}

        {active.step === 'error' && active.errors.length > 0 && (
          <div className="rounded bg-red-950 p-3 text-sm text-red-200" role="alert">
            <p className="font-medium">Rejected - nothing was created.</p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {active.errors.slice(0, 8).map((e) => (
                <li key={e}>{errorLabel(e)}</li>
              ))}
            </ul>
            {active.notice && <p className="mt-1 text-xs text-red-300">{active.notice}</p>}
          </div>
        )}

        {proposal && (
          <section className="rounded-lg border border-purple-900 bg-slate-900 p-4">
            <h2 className="font-medium">
              Proposal preview
              <span className="ml-2 rounded bg-slate-800 px-2 py-0.5 text-xs">
                nothing created yet
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {(() => { const c = proposalCounts(proposal); return (
                `${c.goals} goal(s), ${c.tasks} task(s), ${c.approvals} requiring owner approval.`
              ); })()}
            </p>
            {proposal.goals.map((g) => (
              <div key={g.local_id} className="mt-3 rounded border border-slate-800 p-3">
                <div className="text-sm font-medium">{g.title}</div>
                <div className="text-xs text-slate-400">{g.objective}</div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-400"><tr>
                      <th className="py-1 pr-2 font-normal">#</th>
                      <th className="py-1 pr-2 font-normal">Kind</th>
                      <th className="py-1 pr-2 font-normal">Task</th>
                      <th className="py-1 pr-2 font-normal">Depends</th>
                      <th className="py-1 pr-2 font-normal">Agent</th>
                      <th className="py-1 pr-2 font-normal">Policy</th>
                    </tr></thead>
                    <tbody>
                      {g.tasks.map((t) => (
                        <tr key={t.local_id} className="border-t border-slate-800 align-top">
                          <td className="py-1 pr-2">{t.local_id}</td>
                          <td className="py-1 pr-2">{t.kind}</td>
                          <td className="py-1 pr-2">{t.title}</td>
                          <td className="py-1 pr-2">{t.depends_on_local.join(', ') || '-'}</td>
                          <td className="py-1 pr-2">{t.requested_role}</td>
                          <td className="py-1 pr-2">
                            <span className={t.requires_approval
                              ? 'rounded bg-amber-900 px-1.5 py-0.5'
                              : 'rounded bg-emerald-900 px-1.5 py-0.5'}>
                              {policyBadge(t)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {proposal.constraints.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Recorded constraints: {proposal.constraints.join(' | ')}
              </p>
            )}
            {proposal.warnings.length > 0 && (
              <p className="mt-1 text-xs text-amber-400">
                Warnings: {proposal.warnings.join(', ')}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <form action={confirmAction}>
                <input type="hidden" name="raw_request" value={composeState.raw_request} />
                <input type="hidden" name="request_key" value={composeState.request_key} />
                <input type="hidden" name="proposal_hash" value={proposal.proposal_hash} />
                <button
                  type="submit"
                  disabled={pending}
                  aria-label="Confirm and create goal graph"
                  className="rounded bg-purple-900 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {confirmPending ? 'Creating...' : 'Confirm & create (simulation)'}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setCancelled(true)}
                aria-label="Cancel proposal"
                className="rounded bg-slate-800 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <span className="text-xs text-slate-500">
                Confirming persists the goal graph above (simulation-only,
                staging). Gated tasks will wait for your approval.
              </span>
            </div>
          </section>
        )}

        {confirmState.step === 'created' && (
          <section className="rounded-lg border border-emerald-900 bg-slate-900 p-4"
            role="status">
            <h2 className="font-medium text-emerald-300">
              {confirmState.replayed ? 'Already created (duplicate confirm)' : 'Created'}
            </h2>
            <p className="mt-1 text-xs text-slate-400">{confirmState.notice}</p>
            {confirmState.created.map((g) => (
              <div key={g.goal_id} className="mt-2 rounded border border-slate-800 p-3 text-xs">
                <div>Goal <code>{g.goal_id}</code> ({g.goal_local_id})</div>
                <ul className="mt-1 list-inside list-disc">
                  {g.job_ids.map((j) => (
                    <li key={j.job_id}>
                      {j.title}: <code>{j.job_id}</code>
                      {j.requires_approval ? ' - awaiting owner approval' : ''}
                    </li>
                  ))}
                </ul>
                {g.approval_ids.length > 0 && (
                  <div className="mt-1">
                    Approvals: {g.approval_ids.map((a) => a.approval_id).join(', ')}
                  </div>
                )}
              </div>
            ))}
            <p className="mt-2 text-xs text-slate-500">
              Track lifecycle and decide apr-... approvals on the
              Orchestration page (/os/orchestration) - NOT the Approval
              Center, which covers business approvals only.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
