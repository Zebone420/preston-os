// Phase 7 graduated autonomy - ladder pins: ordering, allow matrix, the
// STEP_UP ceiling, and the GLOBAL controls ceiling that always wins.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS, type SystemControls } from '../src/lib/ai-os/controls';
import {
  AUTONOMY_ACTIONS,
  classCeiling,
  controlsCeiling,
  effectiveRungCeiling,
  isRung,
  minRung,
  nextRung,
  prevRung,
  rungAllows,
  rungIndex,
  RUNGS,
  STEP_UP_CEILING,
} from '../src/lib/business/autonomy/ladder';
import type { Rung } from '../src/lib/business/autonomy/types';

const LIVE: SystemControls = {
  ...DEFAULT_CONTROLS, execution_enabled: true, hermes_mode: 'dispatch_eligible',
};

describe('ladder ordering', () => {
  it('has the eight plan rungs in graduation order', () => {
    expect(RUNGS).toEqual([
      'CODED', 'TESTED', 'DEPLOYED', 'SHADOW', 'OWNER_APPROVED_LIVE',
      'CERTIFIED', 'L1_VETO', 'L1_AUTO',
    ]);
  });
  it('nextRung / prevRung walk one rung; ends are null', () => {
    expect(nextRung('CODED')).toBe('TESTED');
    expect(nextRung('L1_VETO')).toBe('L1_AUTO');
    expect(nextRung('L1_AUTO')).toBeNull();
    expect(prevRung('CODED')).toBeNull();
    expect(prevRung('L1_AUTO')).toBe('L1_VETO');
    for (let i = 0; i < RUNGS.length - 1; i++) {
      expect(prevRung(nextRung(RUNGS[i]) as Rung)).toBe(RUNGS[i]);
    }
  });
  it('unknown rungs sort below CODED and are never rungs', () => {
    expect(rungIndex('AUTONOMOUS')).toBe(-1);
    expect(isRung('autonomous_mode')).toBe(false);
    expect(isRung(undefined)).toBe(false);
    expect(minRung('L1_AUTO', 'SHADOW')).toBe('SHADOW');
  });
});

describe('rungAllows matrix', () => {
  it('CODED/TESTED/DEPLOYED permit nothing', () => {
    for (const r of ['CODED', 'TESTED', 'DEPLOYED']) {
      for (const a of AUTONOMY_ACTIONS) expect(rungAllows(r, a)).toBe(false);
    }
  });
  it('SHADOW permits shadow computation only', () => {
    expect(rungAllows('SHADOW', 'shadow_compute')).toBe(true);
    expect(rungAllows('SHADOW', 'owner_approved_live')).toBe(false);
    expect(rungAllows('SHADOW', 'execute_then_veto')).toBe(false);
    expect(rungAllows('SHADOW', 'execute_unattended')).toBe(false);
  });
  it('OWNER_APPROVED_LIVE and CERTIFIED permit owner-approved execution only', () => {
    for (const r of ['OWNER_APPROVED_LIVE', 'CERTIFIED']) {
      expect(rungAllows(r, 'owner_approved_live')).toBe(true);
      expect(rungAllows(r, 'execute_then_veto')).toBe(false);
      expect(rungAllows(r, 'execute_unattended')).toBe(false);
    }
  });
  it('L1_VETO adds the veto window; only L1_AUTO executes unattended', () => {
    expect(rungAllows('L1_VETO', 'execute_then_veto')).toBe(true);
    expect(rungAllows('L1_VETO', 'execute_unattended')).toBe(false);
    expect(rungAllows('L1_AUTO', 'execute_unattended')).toBe(true);
  });
  it('an unknown rung permits nothing (fail closed)', () => {
    expect(rungAllows('L2_AUTO', 'shadow_compute')).toBe(false);
    expect(rungAllows(null, 'shadow_compute')).toBe(false);
  });
});

describe('STEP_UP ceiling', () => {
  it('STEP_UP classes never exceed OWNER_APPROVED_LIVE even if the row says so', () => {
    expect(STEP_UP_CEILING).toBe('OWNER_APPROVED_LIVE');
    expect(classCeiling('STEP_UP', 'L1_AUTO')).toBe('OWNER_APPROVED_LIVE');
    expect(classCeiling('STEP_UP', 'SHADOW')).toBe('SHADOW');
    expect(classCeiling('EXTERNAL', 'L1_VETO')).toBe('L1_VETO');
    expect(classCeiling('INTERNAL', 'L1_AUTO')).toBe('L1_AUTO');
  });
  it('effectiveRungCeiling caps a STEP_UP row at OWNER_APPROVED_LIVE under live controls', () => {
    const r = effectiveRungCeiling(
      { rung: 'L1_AUTO', approval_class: 'STEP_UP', max_rung: 'L1_AUTO' }, LIVE,
    );
    expect(r).toBe('OWNER_APPROVED_LIVE');
    expect(rungAllows(r, 'execute_unattended')).toBe(false);
  });
});

describe('global controls ceiling ALWAYS wins', () => {
  it('owner_stop => nothing allowed regardless of rung', () => {
    const stopped = { ...LIVE, owner_stop: true };
    expect(controlsCeiling(stopped)).toBe('CODED');
    for (const rung of RUNGS) {
      const eff = effectiveRungCeiling(
        { rung, approval_class: 'INTERNAL', max_rung: 'L1_AUTO' }, stopped,
      );
      for (const a of AUTONOMY_ACTIONS) expect(rungAllows(eff, a)).toBe(false);
    }
  });
  it('DEFAULT_CONTROLS (disabled, execution off) => CODED ceiling', () => {
    expect(controlsCeiling(DEFAULT_CONTROLS)).toBe('CODED');
  });
  it('stopped / paused / disabled modes => CODED; observe/propose => SHADOW', () => {
    expect(controlsCeiling({ ...LIVE, hermes_mode: 'stopped' })).toBe('CODED');
    expect(controlsCeiling({ ...LIVE, hermes_mode: 'paused' })).toBe('CODED');
    expect(controlsCeiling({ ...LIVE, hermes_mode: 'disabled' })).toBe('CODED');
    expect(controlsCeiling({ ...LIVE, paused: true })).toBe('CODED');
    expect(controlsCeiling({ ...LIVE, hermes_mode: 'observe_only' })).toBe('SHADOW');
    expect(controlsCeiling({ ...LIVE, hermes_mode: 'propose_only' })).toBe('SHADOW');
  });
  it('dispatch_eligible without execution_enabled is shadow-only', () => {
    expect(controlsCeiling({ ...LIVE, execution_enabled: false })).toBe('SHADOW');
  });
  it('the ceiling can only LOWER a rung, never raise it', () => {
    expect(effectiveRungCeiling(
      { rung: 'SHADOW', approval_class: 'INTERNAL', max_rung: 'L1_AUTO' }, LIVE,
    )).toBe('SHADOW');
    expect(effectiveRungCeiling(
      { rung: 'L1_AUTO', approval_class: 'INTERNAL', max_rung: 'L1_AUTO' }, LIVE,
    )).toBe('L1_AUTO');
    expect(effectiveRungCeiling(
      { rung: 'L1_AUTO', approval_class: 'INTERNAL', max_rung: 'L1_AUTO' },
      { ...LIVE, hermes_mode: 'observe_only' },
    )).toBe('SHADOW');
  });
});
