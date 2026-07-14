// Preston AI OS - global system controls (Phase 3 runtime). PURE.
// One canonical gate for the whole runtime. Every dispatch/lease/execution
// decision consults these. Default posture is fully stopped / non-executing.

export type HermesMode =
  | 'disabled'
  | 'observe_only'
  | 'propose_only'
  | 'dispatch_eligible'
  | 'paused'
  | 'stopped';

export interface SystemControls {
  execution_enabled: boolean; // global execution kill (default false)
  owner_stop: boolean; // hard owner stop (default false = not stopped)
  paused: boolean; // soft pause
  hermes_mode: HermesMode;
  remote_runner_enabled: boolean; // default false
  updated_at: string;
}

// Fail-closed defaults: nothing runs, Hermes disabled.
export const DEFAULT_CONTROLS: SystemControls = {
  execution_enabled: false,
  owner_stop: false,
  paused: false,
  hermes_mode: 'disabled',
  remote_runner_enabled: false,
  updated_at: '1970-01-01T00:00:00.000Z',
};

// True only when the runtime is permitted to do execution work at all:
// execution globally enabled, not stopped, not paused. Unknown/partial state
// resolves to false.
export function runtimeActive(c: SystemControls): boolean {
  return Boolean(c.execution_enabled) && !c.owner_stop && !c.paused;
}

// Owner stop or global execution-disable both halt everything.
export function isHalted(c: SystemControls): boolean {
  return c.owner_stop === true || c.execution_enabled !== true;
}
