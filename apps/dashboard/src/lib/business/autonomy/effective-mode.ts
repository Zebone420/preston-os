// Preston AI OS - Phase 7 effective mode. PURE. THE function the executor /
// business runner consults before treating any capability as anything other
// than owner-approved. It can only LOWER a rung, never raise one, and it
// fails closed at every step:
//
//   1. unknown / malformed class          -> CODED (nothing allowed)
//   2. replay grants + anomalies in time order from CODED:
//        - a revoked or expired grant is ignored (chain breaks below it)
//        - a grant must move exactly one rung from the replayed state
//        - an anomaly with demoted_to lowers the replayed state
//   3. an UNACKNOWLEDGED critical anomaly pins its demoted rung
//   4. min(replayed, persisted class rung)
//   5. class ceiling (max_rung; STEP_UP never above OWNER_APPROVED_LIVE)
//   6. GLOBAL controls ceiling applied LAST (owner_stop / execution_enabled
//      / paused / hermes_mode) - it always wins.

import type { SystemControls } from '../../ai-os/controls';
import { effectiveSeverity } from './demotion';
import {
  allowsFor,
  classCeiling,
  controlsCeiling,
  isRung,
  LOWEST_RUNG,
  minRung,
  nextRung,
  NOTHING_ALLOWED,
  type AllowSet,
} from './ladder';
import type {
  AutonomyAnomalyRow,
  AutonomyClassRow,
  AutonomyGrantRow,
  Rung,
} from './types';

export interface EffectiveModeInput {
  classRow: AutonomyClassRow | null | undefined;
  grants: readonly AutonomyGrantRow[];
  anomalies: readonly AutonomyAnomalyRow[];
  controls: SystemControls;
  now: string; // ISO instant used for grant expiry
}

export interface EffectiveMode {
  class_id: string | null;
  rung: Rung; // the rung after every ceiling
  allows: AllowSet;
  reasons: string[];
  granted_rung: Rung; // replayed from grants/anomalies before ceilings
  promotions_frozen: boolean; // unacknowledged major/critical anomaly
}

type Event =
  | { at: number; kind: 'grant'; grant: AutonomyGrantRow }
  | { at: number; kind: 'anomaly'; anomaly: AutonomyAnomalyRow };

function ms(iso: string | null | undefined): number {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return v;
}

export function effectiveMode(input: EffectiveModeInput): EffectiveMode {
  const reasons: string[] = [];
  const row = input.classRow;
  const nowMs = ms(input.now);

  if (!row || typeof row.class_id !== 'string' || !isRung(row.rung)) {
    return {
      class_id: row?.class_id ?? null, rung: LOWEST_RUNG, allows: NOTHING_ALLOWED,
      reasons: ['unknown_class'], granted_rung: LOWEST_RUNG, promotions_frozen: true,
    };
  }
  if (!Number.isFinite(nowMs)) {
    return {
      class_id: row.class_id, rung: LOWEST_RUNG, allows: NOTHING_ALLOWED,
      reasons: ['invalid_now'], granted_rung: LOWEST_RUNG, promotions_frozen: true,
    };
  }

  // 2. chronological replay
  const events: Event[] = [];
  for (const g of input.grants) {
    if (!g || g.class_id !== row.class_id) continue;
    events.push({ at: ms(g.granted_at), kind: 'grant', grant: g });
  }
  for (const a of input.anomalies) {
    if (!a || a.class_id !== row.class_id) continue;
    events.push({ at: ms(a.detected_at), kind: 'anomaly', anomaly: a });
  }
  // Unparseable timestamps sort FIRST (a grant then chains from CODED and
  // almost surely breaks; an anomaly still applies) - fail closed.
  events.sort((x, y) => {
    const ax = Number.isFinite(x.at) ? x.at : Number.NEGATIVE_INFINITY;
    const ay = Number.isFinite(y.at) ? y.at : Number.NEGATIVE_INFINITY;
    return ax - ay;
  });

  let state: Rung = LOWEST_RUNG;
  for (const e of events) {
    if (e.kind === 'grant') {
      const g = e.grant;
      if (g.revoked_at) { reasons.push(`grant_revoked:${g.id}`); continue; }
      const exp = ms(g.expires_at);
      if (g.expires_at && (!Number.isFinite(exp) || exp <= nowMs)) {
        reasons.push(`grant_expired:${g.id}`); continue;
      }
      if (!isRung(g.from_rung) || !isRung(g.to_rung) || g.from_rung !== state ||
          nextRung(state) !== g.to_rung) {
        reasons.push(`grant_chain_break:${g.id}`); continue;
      }
      state = g.to_rung;
    } else {
      const a = e.anomaly;
      if (isRung(a.demoted_to)) {
        const lowered = minRung(state, a.demoted_to);
        if (lowered !== state) reasons.push(`anomaly_demoted:${a.id}`);
        state = lowered;
      }
    }
  }
  const granted = state;

  // 3. unacknowledged critical anomalies pin; major/critical freeze
  let frozen = false;
  for (const a of input.anomalies) {
    if (!a || a.class_id !== row.class_id || a.acknowledged_by) continue;
    const sev = effectiveSeverity(a);
    if (sev === 'major' || sev === 'critical') frozen = true;
    if (sev === 'critical' && isRung(a.demoted_to)) {
      const pinned = minRung(state, a.demoted_to);
      if (pinned !== state) reasons.push(`anomaly_pinned:${a.id}`);
      state = pinned;
    }
  }

  // 4. never above the persisted class rung
  if (minRung(state, row.rung) !== state) {
    reasons.push('class_row_below_grants');
  } else if (state !== row.rung) {
    reasons.push('class_row_above_grants');
  }
  state = minRung(state, row.rung);

  // 5. class ceiling
  const ceiling = classCeiling(row.approval_class, row.max_rung);
  if (minRung(state, ceiling) !== state) {
    reasons.push(row.approval_class === 'STEP_UP' ? 'step_up_ceiling' : 'class_ceiling');
    state = ceiling;
  }

  // 6. global controls LAST
  const cc = controlsCeiling(input.controls);
  if (minRung(state, cc) !== state) {
    reasons.push(`controls_ceiling:${cc}`);
    state = cc;
  }

  return {
    class_id: row.class_id,
    rung: state,
    allows: allowsFor(state),
    reasons,
    granted_rung: granted,
    promotions_frozen: frozen,
  };
}
