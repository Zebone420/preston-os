// Preston AI OS - Phase 7 graduation ladder. PURE.
//
//   CODED -> TESTED -> DEPLOYED -> SHADOW -> OWNER_APPROVED_LIVE
//         -> CERTIFIED -> L1_VETO -> L1_AUTO
//
// A class advances ONE rung at a time and only through an owner grant. The
// rung says what a class MAY do; the GLOBAL system controls (ai-os/
// controls.ts: hermes_mode / execution_enabled / owner_stop / paused) are a
// ceiling that always wins - a rung can never raise what the controls
// forbid, and effectiveMode() (effective-mode.ts) can only LOWER a rung.
// STEP_UP classes (money / legal / order / authority) are capped at
// OWNER_APPROVED_LIVE forever.

import type { SystemControls } from '../../ai-os/controls';
import type { ApprovalClass, AutonomyClassRow, Rung } from './types';

export const RUNGS: readonly Rung[] = [
  'CODED',
  'TESTED',
  'DEPLOYED',
  'SHADOW',
  'OWNER_APPROVED_LIVE',
  'CERTIFIED',
  'L1_VETO',
  'L1_AUTO',
];

export const LOWEST_RUNG: Rung = 'CODED';
export const STEP_UP_CEILING: Rung = 'OWNER_APPROVED_LIVE';

export function isRung(v: unknown): v is Rung {
  return typeof v === 'string' && (RUNGS as readonly string[]).includes(v);
}

// Unknown input sorts BELOW the lowest rung (fail closed).
export function rungIndex(r: unknown): number {
  return isRung(r) ? RUNGS.indexOf(r) : -1;
}

export function nextRung(r: Rung): Rung | null {
  const i = rungIndex(r);
  return i >= 0 && i < RUNGS.length - 1 ? RUNGS[i + 1] : null;
}

export function prevRung(r: Rung): Rung | null {
  const i = rungIndex(r);
  return i > 0 ? RUNGS[i - 1] : null;
}

export function minRung(a: Rung, b: Rung): Rung {
  return rungIndex(a) <= rungIndex(b) ? a : b;
}

export function rungAtLeast(r: Rung, floor: Rung): boolean {
  return rungIndex(r) >= rungIndex(floor);
}

// What a rung permits. Every action is fail-closed: absent = forbidden.
//   shadow_compute       - compute the proposal/result; record; NEVER act
//   owner_approved_live  - execute ONLY after a per-action owner approval
//   execute_then_veto    - schedule; execute after the veto window elapses
//   execute_unattended   - execute without a per-action approval
export type AutonomyAction =
  | 'shadow_compute'
  | 'owner_approved_live'
  | 'execute_then_veto'
  | 'execute_unattended';

export const AUTONOMY_ACTIONS: readonly AutonomyAction[] = [
  'shadow_compute',
  'owner_approved_live',
  'execute_then_veto',
  'execute_unattended',
];

export type AllowSet = Readonly<Record<AutonomyAction, boolean>>;

export const NOTHING_ALLOWED: AllowSet = Object.freeze({
  shadow_compute: false,
  owner_approved_live: false,
  execute_then_veto: false,
  execute_unattended: false,
});

const MATRIX: Readonly<Record<Rung, AllowSet>> = Object.freeze({
  CODED: NOTHING_ALLOWED,
  TESTED: NOTHING_ALLOWED,
  DEPLOYED: NOTHING_ALLOWED,
  SHADOW: Object.freeze({ ...NOTHING_ALLOWED, shadow_compute: true }),
  OWNER_APPROVED_LIVE: Object.freeze({
    ...NOTHING_ALLOWED, shadow_compute: true, owner_approved_live: true,
  }),
  // CERTIFIED = criteria proven, still every action owner-approved.
  CERTIFIED: Object.freeze({
    ...NOTHING_ALLOWED, shadow_compute: true, owner_approved_live: true,
  }),
  L1_VETO: Object.freeze({
    ...NOTHING_ALLOWED, shadow_compute: true, owner_approved_live: true,
    execute_then_veto: true,
  }),
  L1_AUTO: Object.freeze({
    ...NOTHING_ALLOWED, shadow_compute: true, owner_approved_live: true,
    execute_then_veto: true, execute_unattended: true,
  }),
});

export function allowsFor(rung: Rung): AllowSet {
  return MATRIX[rung] ?? NOTHING_ALLOWED;
}

export function rungAllows(rung: unknown, action: AutonomyAction): boolean {
  if (!isRung(rung)) return false;
  return allowsFor(rung)[action] === true;
}

// The ceiling a class can EVER reach: its own max_rung, and for STEP_UP
// classes never above OWNER_APPROVED_LIVE regardless of what the row says.
export function classCeiling(
  approvalClass: ApprovalClass, maxRung: Rung,
): Rung {
  const declared = isRung(maxRung) ? maxRung : LOWEST_RUNG;
  return approvalClass === 'STEP_UP'
    ? minRung(declared, STEP_UP_CEILING)
    : declared;
}

// The ceiling the GLOBAL controls impose on every class at once. Only
// dispatch_eligible + execution_enabled (and not stopped/paused) leaves the
// class rung in charge; observe/propose modes are shadow-only; everything
// else permits nothing at all.
export function controlsCeiling(controls: SystemControls): Rung {
  if (controls.owner_stop === true) return LOWEST_RUNG;
  if (controls.paused === true) return LOWEST_RUNG;
  switch (controls.hermes_mode) {
    case 'dispatch_eligible':
      return controls.execution_enabled === true ? 'L1_AUTO' : 'SHADOW';
    case 'observe_only':
    case 'propose_only':
      return 'SHADOW';
    default:
      return LOWEST_RUNG; // disabled | paused | stopped | unknown
  }
}

// Convenience: the rung a class row resolves to under the controls alone
// (no grant/anomaly validation - see effective-mode.ts for the full rule).
// This can only LOWER the row's rung, never raise it.
export function effectiveRungCeiling(
  classRow: Pick<AutonomyClassRow, 'rung' | 'approval_class' | 'max_rung'>,
  controls: SystemControls,
): Rung {
  const rung = isRung(classRow.rung) ? classRow.rung : LOWEST_RUNG;
  const capped = minRung(
    rung, classCeiling(classRow.approval_class, classRow.max_rung),
  );
  return minRung(capped, controlsCeiling(controls));
}
