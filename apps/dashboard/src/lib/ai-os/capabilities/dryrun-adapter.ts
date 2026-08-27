// Preston AI OS - dry-run provider adapter (power-station master goal
// section 15). A LOCAL, in-process test provider that proves the capability
// spine end to end with NO external side effect: registry lookup, policy
// classification, approval gate, trusted executor, side-effect ledger,
// idempotency, every outcome class, reconciliation, evidence/readback.
//
// The adapter's behavior is driven by the request's params.outcome so a
// drill can exercise each executor path deterministically:
//   (absent) / 'success' -> ok
//   'terminal'           -> terminal refusal
//   'retryable'          -> retryable fault
//   'uncertain'          -> uncertain outcome (provider "may have acted")
//   'hang'               -> never resolves (proves the definition timeout)
//
// It requires NO credential: a drill also pins that the credential broker is
// never consulted for it (worker/executor secret isolation evidence).

import type { AdapterOutcome, CapabilityAdapter } from './executor';

export const DRYRUN_PROVIDER = 'preston.dryrun';

export function makeDryrunAdapter(): CapabilityAdapter {
  return {
    async execute(input): Promise<AdapterOutcome> {
      const outcome = String(input.request.params['outcome'] ?? 'success');
      if (outcome === 'terminal') {
        return { status: 'terminal', reason: 'dryrun_terminal_requested' };
      }
      if (outcome === 'retryable') {
        return { status: 'retryable', reason: 'dryrun_retryable_requested' };
      }
      if (outcome === 'uncertain') {
        return { status: 'uncertain', reason: 'dryrun_uncertain_requested' };
      }
      if (outcome === 'hang') {
        // Deliberately unresolved: the executor's definition-timeout race is
        // the only way past this branch.
        return new Promise<AdapterOutcome>(() => { /* never resolves */ });
      }
      return {
        status: 'ok',
        provider_result_id: `dryrun-${input.payload_hash.slice(0, 12)}`,
        summary: `dry-run echo (${input.definition.name}) attempt ` +
          `${input.attempt}: no external system touched`,
        artifact_refs: [],
      };
    },
  };
}
