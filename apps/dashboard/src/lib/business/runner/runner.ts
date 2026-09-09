// Phase 4 - Deterministic Business Runner (plan section 2.5).
//
// runPlaybookStep drives exactly ONE step of a run. It is:
//   - deterministic: same (playbook, run, context) -> same result;
//   - resumable: the run's step_cursor is the only progress state;
//   - idempotent per (run.idempotency_key, step_cursor): re-driving a
//     step that already produced its evidence/proposal is a no-op.
// The runner never calls a provider, the capability executor, or a
// worker. propose_capability yields a PROPOSAL record for Preston Control
// to gate and execute; the run then waits for the result event.
//
// PURE: no I/O, no clock (context.now is injected), no randomness.

import {
  approvalClassFor,
  type ExceptionRoute,
  type PlaybookDeclaration,
} from './playbook';
import {
  STEPS,
  type CapabilityProposal,
  type EvidenceEntry,
  type StepContext,
  type StepResult,
} from './steps';

export type RunState =
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'blocked',
  'completed',
  'failed',
  'cancelled',
];

export interface PlaybookRun {
  id: string;
  playbook_id: string;
  version: number;
  project_id: string | null;
  trigger_ref: string;
  state: RunState;
  step_cursor: number;
  waiting_for: string | null;
  wait_until: string | null;
  evidence: EvidenceEntry[];
  last_error: string | null;
  idempotency_key: string;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type Transition =
  | 'noop'
  | 'advanced'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed';

export interface RunStepOutcome {
  run: PlaybookRun;
  transition: Transition;
  proposal?: CapabilityProposal;
  advance?: { to: string };
}

export interface CreateRunInput {
  id: string;
  project_id: string | null;
  trigger_ref: string;
  idempotency_key: string;
  now: string;
}

export function createRun(
  playbook: PlaybookDeclaration,
  input: CreateRunInput,
): PlaybookRun {
  return {
    id: input.id,
    playbook_id: playbook.id,
    version: playbook.version,
    project_id: input.project_id,
    trigger_ref: input.trigger_ref,
    state: 'running',
    step_cursor: 0,
    waiting_for: null,
    wait_until: null,
    evidence: [],
    last_error: null,
    idempotency_key: input.idempotency_key,
    started_at: input.now,
    updated_at: input.now,
    completed_at: null,
  };
}

function keepEvidence(
  policy: PlaybookDeclaration['evidence_policy'],
  e: EvidenceEntry,
): boolean {
  if (policy === 'every_step') return true;
  return e.phase !== 'done' && e.phase !== 'wait';
}

function withEvidence(
  playbook: PlaybookDeclaration,
  run: PlaybookRun,
  entries: EvidenceEntry[],
): EvidenceEntry[] {
  const kept = entries.filter((e) => keepEvidence(playbook.evidence_policy, e));
  return kept.length === 0 ? run.evidence : [...run.evidence, ...kept];
}

function retryCount(run: PlaybookRun, cursor: number): number {
  return run.evidence.filter(
    (e) => e.step_cursor === cursor && e.phase === 'retry',
  ).length;
}

function hasPhase(
  run: PlaybookRun,
  cursor: number,
  phase: EvidenceEntry['phase'],
): boolean {
  return run.evidence.some(
    (e) => e.step_cursor === cursor && e.phase === phase,
  );
}

function finish(
  run: PlaybookRun,
  patch: Partial<PlaybookRun>,
  now: string,
): PlaybookRun {
  return { ...run, ...patch, updated_at: now };
}

function routeFor(
  playbook: PlaybookDeclaration,
  res: StepResult,
): ExceptionRoute {
  const name = res.failed_predicate ?? '';
  const declared = playbook.exception_routes[name];
  if (declared) return declared;
  return res.next === 'wait' ? 'wait' : 'block';
}

// Drive one step. Returns a NEW run object; the input is never mutated.
export function runPlaybookStep(
  playbook: PlaybookDeclaration,
  run: PlaybookRun,
  ctx: StepContext,
): RunStepOutcome {
  const now = ctx.now;
  if (run.playbook_id !== playbook.id || run.version !== playbook.version) {
    return {
      run: finish(
        run,
        { state: 'failed', last_error: 'playbook_mismatch' },
        now,
      ),
      transition: 'failed',
    };
  }
  if (TERMINAL_RUN_STATES.includes(run.state)) {
    return { run, transition: 'noop' };
  }
  const cursor = run.step_cursor;
  const total = playbook.steps.length;
  if (cursor >= total) {
    return {
      run: finish(
        run,
        {
          state: 'completed',
          waiting_for: null,
          wait_until: null,
          completed_at: run.completed_at ?? now,
        },
        now,
      ),
      transition: 'completed',
    };
  }
  // Idempotency guard: a replayed run whose step already finished only
  // moves the cursor; no evidence is duplicated.
  if (hasPhase(run, cursor, 'done')) {
    return {
      run: finish(
        run,
        {
          step_cursor: cursor + 1,
          state: cursor + 1 >= total ? 'completed' : 'running',
          waiting_for: null,
          wait_until: null,
          completed_at: cursor + 1 >= total ? now : null,
        },
        now,
      ),
      transition: cursor + 1 >= total ? 'completed' : 'advanced',
    };
  }

  const step = playbook.steps[cursor];
  const fn = STEPS[step.kind];
  const res = fn(ctx, step.args, {
    cursor,
    playbook_id: playbook.id,
    playbook_version: playbook.version,
    run_id: run.id,
    run_idempotency_key: run.idempotency_key,
    approval_class: (cap) => approvalClassFor(playbook, cap),
  });

  if (res.ok && (res.next === 'continue' || res.next === 'complete')) {
    const nextCursor = cursor + 1;
    const done = res.next === 'complete' || nextCursor >= total;
    return {
      run: finish(
        run,
        {
          step_cursor: nextCursor,
          state: done ? 'completed' : 'running',
          waiting_for: null,
          wait_until: null,
          evidence: withEvidence(playbook, run, res.evidence),
          completed_at: done ? now : null,
        },
        now,
      ),
      transition: done ? 'completed' : 'advanced',
      advance: res.advance,
    };
  }

  if (res.ok && res.next === 'wait') {
    const waitingFor = res.wait?.waiting_for ?? null;
    const waitUntil = res.wait?.wait_until ?? null;
    // Same step already proposed / already waiting on the same event:
    // nothing new to record and no second proposal.
    if (res.proposal && hasPhase(run, cursor, 'proposed')) {
      return { run, transition: 'noop' };
    }
    if (
      !res.proposal &&
      run.state === 'waiting' &&
      run.waiting_for === waitingFor
    ) {
      return { run, transition: 'noop' };
    }
    return {
      run: finish(
        run,
        {
          state: 'waiting',
          waiting_for: waitingFor,
          wait_until: waitUntil,
          evidence: withEvidence(playbook, run, res.evidence),
        },
        now,
      ),
      transition: 'waiting',
      proposal: res.proposal,
    };
  }

  // Failure: route via the declaration's exception routes.
  const route = routeFor(playbook, res);
  const predicate = res.failed_predicate ?? `${step.kind}.failed`;
  if (route === 'complete') {
    return {
      run: finish(
        run,
        {
          state: 'completed',
          waiting_for: null,
          wait_until: null,
          evidence: withEvidence(playbook, run, [
            ...res.evidence,
            {
              step_cursor: cursor,
              step: step.kind,
              phase: 'exception',
              at: now,
              detail: { predicate, route: 'complete' },
            },
          ]),
          completed_at: now,
        },
        now,
      ),
      transition: 'completed',
    };
  }
  if (route === 'wait') {
    const waitingFor = res.wait?.waiting_for ?? `retry:${predicate}`;
    if (
      run.state === 'waiting' &&
      run.waiting_for === waitingFor &&
      run.wait_until !== null &&
      Date.parse(now) < Date.parse(run.wait_until)
    ) {
      return { run, transition: 'noop' };
    }
    const attempts = retryCount(run, cursor);
    if (attempts >= playbook.retries.max) {
      return {
        run: finish(
          run,
          {
            state: 'blocked',
            waiting_for: null,
            wait_until: null,
            last_error: `retries_exhausted:${predicate}`,
            evidence: withEvidence(playbook, run, [
              {
                step_cursor: cursor,
                step: step.kind,
                phase: 'blocked',
                at: now,
                detail: { predicate, attempts, reason: 'retries_exhausted' },
              },
            ]),
          },
          now,
        ),
        transition: 'blocked',
      };
    }
    const attempt = attempts + 1;
    const backoffUntil = new Date(
      Date.parse(now) + playbook.retries.backoff_ms * attempt,
    ).toISOString();
    const waitUntil = res.wait?.wait_until ?? backoffUntil;
    return {
      run: finish(
        run,
        {
          state: 'waiting',
          waiting_for: waitingFor,
          wait_until: waitUntil,
          evidence: withEvidence(playbook, run, [
            {
              step_cursor: cursor,
              step: step.kind,
              phase: 'retry',
              at: now,
              detail: { predicate, attempt, wait_until: waitUntil },
            },
          ]),
        },
        now,
      ),
      transition: 'waiting',
    };
  }
  return {
    run: finish(
      run,
      {
        state: 'blocked',
        waiting_for: null,
        wait_until: null,
        last_error: predicate,
        evidence: withEvidence(playbook, run, [
          ...res.evidence,
          {
            step_cursor: cursor,
            step: step.kind,
            phase: 'blocked',
            at: now,
            detail: { predicate, route: 'block' },
          },
        ]),
      },
      now,
    ),
    transition: 'blocked',
  };
}

export interface RunOutcome {
  run: PlaybookRun;
  transitions: Transition[];
  proposals: CapabilityProposal[];
  advances: Array<{ to: string }>;
}

// Drive a run until it waits, blocks, completes or fails. Bounded by the
// step count: a single drive can never loop.
export function runPlaybook(
  playbook: PlaybookDeclaration,
  run: PlaybookRun,
  ctx: StepContext,
): RunOutcome {
  const transitions: Transition[] = [];
  const proposals: CapabilityProposal[] = [];
  const advances: Array<{ to: string }> = [];
  let current = run;
  for (let i = 0; i <= playbook.steps.length; i += 1) {
    const out = runPlaybookStep(playbook, current, ctx);
    transitions.push(out.transition);
    if (out.proposal) proposals.push(out.proposal);
    if (out.advance) advances.push(out.advance);
    current = out.run;
    if (out.transition !== 'advanced') break;
  }
  return { run: current, transitions, proposals, advances };
}
