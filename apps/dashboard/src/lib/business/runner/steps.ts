// Phase 4 - Deterministic Business Runner: the step vocabulary (plan
// section 2.5). Each step is a PURE function over (context, args). Steps
// never call a provider, never touch a database, never invoke an LLM.
// The only externally visible product of a step is a capability
// PROPOSAL record that Preston Control gates and executes elsewhere.
//
// Predicates evaluated by other lanes (identity, stage-gates, comms
// detectors, order-chain eligibility) arrive in the context as DATA under
// their string names; the runner never computes them itself.

import {
  FORBIDDEN_ADVANCE_TARGETS,
  canonicalJson,
  sha256Hex,
  type ApprovalClass,
  type StepKind,
} from './playbook';

export type StepNext = 'continue' | 'wait' | 'block' | 'complete';

export type EvidencePhase =
  | 'done'
  | 'wait'
  | 'proposed'
  | 'retry'
  | 'exception'
  | 'blocked';

export interface EvidenceEntry {
  step_cursor: number;
  step: StepKind;
  phase: EvidencePhase;
  at: string;
  detail: Record<string, unknown>;
}

export interface CapabilityProposal {
  proposal_id: string; // deterministic from (idempotency_key, cursor)
  capability_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  approval_class: ApprovalClass;
  project_id: string | null;
  playbook_id: string;
  playbook_version: number;
  run_id: string;
  step_cursor: number;
  idempotency_key: string; // `${run.idempotency_key}:${cursor}`
}

export interface ClockView {
  state: string;
  next_due_at: string | null;
}

export interface StepContext {
  now: string; // ISO timestamp injected by the caller
  project_id: string | null;
  stage: string | null; // current project stage (identity lane)
  identity_confidence: string | null; // identity ladder value (data only)
  predicates: Record<string, boolean | undefined>; // other lanes' verdicts
  clocks: Record<string, ClockView | undefined>;
  events: Record<string, string | undefined>; // event name -> occurred_at
  data: Record<string, unknown>; // required_data presence / payload inputs
}

export interface StepInput {
  cursor: number;
  playbook_id: string;
  playbook_version: number;
  run_id: string;
  run_idempotency_key: string;
  approval_class: (capabilityId: string) => ApprovalClass | null;
}

export interface StepResult {
  ok: boolean;
  next: StepNext;
  evidence: EvidenceEntry[];
  proposal?: CapabilityProposal;
  // Name routed through the declaration's exception_routes on failure.
  failed_predicate?: string;
  // Retryable failures (predicate not yet evaluated, event not yet
  // arrived) may be re-driven by the runner up to retries.max.
  retryable?: boolean;
  wait?: { waiting_for: string; wait_until: string | null };
  advance?: { to: string };
}

export type StepFn = (
  ctx: StepContext,
  args: Record<string, unknown>,
  input: StepInput,
) => StepResult;

const HOUR_MS = 60 * 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function entry(
  input: StepInput,
  step: StepKind,
  phase: EvidencePhase,
  at: string,
  detail: Record<string, unknown>,
): EvidenceEntry {
  return { step_cursor: input.cursor, step, phase, at, detail };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
}

export function proposalIdempotencyKey(
  runKey: string,
  cursor: number,
): string {
  return `${runKey}:${cursor}`;
}

// check_clock: the named follow-up clock must be in the expected state
// (default 'due'). Not yet due -> wait until next_due_at.
const check_clock: StepFn = (ctx, args, input) => {
  const name = str(args.clock);
  const expect = str(args.expect) || 'due';
  const clock = ctx.clocks[name];
  const predicate = `clock.${name}`;
  if (!clock) {
    return {
      ok: false,
      next: 'block',
      failed_predicate: predicate,
      evidence: [
        entry(input, 'check_clock', 'exception', ctx.now, {
          clock: name,
          reason: 'clock_missing',
        }),
      ],
    };
  }
  if (clock.state === expect) {
    return {
      ok: true,
      next: 'continue',
      evidence: [
        entry(input, 'check_clock', 'done', ctx.now, {
          clock: name,
          state: clock.state,
        }),
      ],
    };
  }
  return {
    ok: false,
    next: 'wait',
    failed_predicate: predicate,
    retryable: true,
    wait: { waiting_for: predicate, wait_until: clock.next_due_at },
    evidence: [
      entry(input, 'check_clock', 'wait', ctx.now, {
        clock: name,
        state: clock.state,
        expected: expect,
      }),
    ],
  };
};

// check_stage: current stage must be one of args.any_of.
const check_stage: StepFn = (ctx, args, input) => {
  const anyOf = strList(args.any_of);
  const predicate = str(args.predicate) || `stage.any_of.${anyOf.join('_')}`;
  const ok = ctx.stage !== null && anyOf.includes(ctx.stage);
  return {
    ok,
    next: ok ? 'continue' : 'block',
    failed_predicate: ok ? undefined : predicate,
    evidence: [
      entry(input, 'check_stage', ok ? 'done' : 'exception', ctx.now, {
        stage: ctx.stage,
        any_of: anyOf,
      }),
    ],
  };
};

// check_identity: the identity lane's predicate (e.g. identity.confirmed)
// must be true. Consequential use on an unconfirmed identity blocks.
const check_identity: StepFn = (ctx, args, input) => {
  const predicate = str(args.predicate) || 'identity.confirmed';
  const v = ctx.predicates[predicate];
  const ok = v === true;
  return {
    ok,
    next: ok ? 'continue' : 'block',
    failed_predicate: ok ? undefined : predicate,
    retryable: v === undefined,
    evidence: [
      entry(input, 'check_identity', ok ? 'done' : 'exception', ctx.now, {
        predicate,
        value: v ?? null,
        identity_confidence: ctx.identity_confidence,
      }),
    ],
  };
};

// evaluate_gate: a named deterministic predicate. true -> continue;
// false -> routed failure; undefined (not yet evaluated) -> retryable.
const evaluate_gate: StepFn = (ctx, args, input) => {
  const predicate = str(args.predicate);
  const v = ctx.predicates[predicate];
  if (v === true) {
    return {
      ok: true,
      next: 'continue',
      evidence: [
        entry(input, 'evaluate_gate', 'done', ctx.now, { predicate }),
      ],
    };
  }
  return {
    ok: false,
    next: 'block',
    failed_predicate: predicate,
    retryable: v === undefined,
    evidence: [
      entry(input, 'evaluate_gate', 'exception', ctx.now, {
        predicate,
        value: v ?? null,
      }),
    ],
  };
};

function buildProposal(
  ctx: StepContext,
  args: Record<string, unknown>,
  input: StepInput,
  step: StepKind,
): StepResult {
  const capabilityId = str(args.capability_id);
  const approvalClass = input.approval_class(capabilityId);
  if (!capabilityId || !approvalClass) {
    return {
      ok: false,
      next: 'block',
      failed_predicate: 'capability.not_allowed',
      evidence: [
        entry(input, step, 'blocked', ctx.now, {
          capability_id: capabilityId,
          reason: 'capability_not_allowed',
        }),
      ],
    };
  }
  const resultEvent = `capability.${capabilityId}`;
  const observed = ctx.events[resultEvent];
  if (observed) {
    return {
      ok: true,
      next: 'continue',
      evidence: [
        entry(input, step, 'done', ctx.now, {
          capability_id: capabilityId,
          result_observed_at: observed,
        }),
      ],
    };
  }
  const payloadArg = args.payload;
  const payload: Record<string, unknown> =
    payloadArg && typeof payloadArg === 'object' && !Array.isArray(payloadArg)
      ? { ...(payloadArg as Record<string, unknown>) }
      : {};
  if (step === 'render_document') {
    payload.document_kind = str(args.document_kind);
    payload.template = str(args.template);
  }
  // Only the declared input refs travel; the runner never copies data.
  const inputRefs = strList(args.input_refs);
  if (inputRefs.length > 0) payload.input_refs = inputRefs;
  payload.project_id = ctx.project_id;
  const idem = proposalIdempotencyKey(input.run_idempotency_key, input.cursor);
  const payload_hash = sha256Hex(canonicalJson(payload));
  const proposal: CapabilityProposal = {
    proposal_id: `pb-${sha256Hex(idem).slice(0, 32)}`,
    capability_id: capabilityId,
    payload,
    payload_hash,
    approval_class: approvalClass,
    project_id: ctx.project_id,
    playbook_id: input.playbook_id,
    playbook_version: input.playbook_version,
    run_id: input.run_id,
    step_cursor: input.cursor,
    idempotency_key: idem,
  };
  return {
    ok: true,
    next: 'wait',
    proposal,
    wait: { waiting_for: resultEvent, wait_until: null },
    evidence: [
      entry(input, step, 'proposed', ctx.now, {
        capability_id: capabilityId,
        payload_hash,
        approval_class: approvalClass,
        proposal_id: proposal.proposal_id,
      }),
    ],
  };
}

// render_document: a proposal for a render/draft capability (plan 10.3
// external preparation). The runner never renders anything itself.
const render_document: StepFn = (ctx, args, input) =>
  buildProposal(ctx, args, input, 'render_document');

// propose_capability: emit a proposal record and wait for its result
// event. Never calls a provider, an executor, or an adapter.
const propose_capability: StepFn = (ctx, args, input) =>
  buildProposal(ctx, args, input, 'propose_capability');

// wait_for_event: continue when the named event has occurred; otherwise
// wait (optionally bounded by timeout_hours -> routed timeout failure).
const wait_for_event: StepFn = (ctx, args, input) => {
  const event = str(args.event);
  const occurred = ctx.events[event];
  if (occurred) {
    return {
      ok: true,
      next: 'continue',
      evidence: [
        entry(input, 'wait_for_event', 'done', ctx.now, {
          event,
          occurred_at: occurred,
        }),
      ],
    };
  }
  const timeoutHours =
    typeof args.timeout_hours === 'number' ? args.timeout_hours : null;
  const startedAt = ctx.events[`wait_started.${event}`] ?? ctx.now;
  const waitUntil =
    timeoutHours === null
      ? null
      : iso(Date.parse(startedAt) + timeoutHours * HOUR_MS);
  if (waitUntil !== null && Date.parse(ctx.now) >= Date.parse(waitUntil)) {
    return {
      ok: false,
      next: 'block',
      failed_predicate: `event.${event}.timeout`,
      evidence: [
        entry(input, 'wait_for_event', 'exception', ctx.now, {
          event,
          reason: 'timeout',
          wait_until: waitUntil,
        }),
      ],
    };
  }
  return {
    ok: true,
    next: 'wait',
    wait: { waiting_for: event, wait_until: waitUntil },
    evidence: [
      entry(input, 'wait_for_event', 'wait', ctx.now, {
        event,
        wait_until: waitUntil,
      }),
    ],
  };
};

// advance_state: record an INTERNAL derived stage advance. Money/legal/
// order/owner-final-call states are structurally refused here too.
const advance_state: StepFn = (ctx, args, input) => {
  const to = str(args.to);
  if (!to || FORBIDDEN_ADVANCE_TARGETS.includes(to)) {
    return {
      ok: false,
      next: 'block',
      failed_predicate: 'advance.forbidden',
      evidence: [
        entry(input, 'advance_state', 'blocked', ctx.now, {
          to,
          reason: 'advance_forbidden',
        }),
      ],
    };
  }
  const terminal = args.terminal === true;
  return {
    ok: true,
    next: terminal ? 'complete' : 'continue',
    advance: { to },
    evidence: [
      entry(input, 'advance_state', 'done', ctx.now, {
        from: ctx.stage,
        to,
      }),
    ],
  };
};

export const STEPS: Readonly<Record<StepKind, StepFn>> = Object.freeze({
  check_clock,
  check_stage,
  check_identity,
  evaluate_gate,
  render_document,
  propose_capability,
  wait_for_event,
  advance_state,
});
