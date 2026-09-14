import { describe, expect, it } from 'vitest';
import {
  guardInstallTransition,
  initialInstallState,
  installStateAtLeast,
  nextInstallState,
  transitionInstallState,
  type InstallGuardFacts,
} from '../src/lib/business/lifecycle/install-state';
import {
  openPunchItem,
  punchClosurePredicate,
  resolvePunchItem,
  startPunchItem,
  waivePunchItem,
  type PunchItem,
} from '../src/lib/business/lifecycle/punch';
import {
  INSTALL_STATES,
  type InstallState,
} from '../src/lib/business/lifecycle/types';

const P = '00000000-0000-4000-8000-0000000000aa';
const AT = '2026-09-05T10:00:00.000Z';
const OWNER = { kind: 'owner' as const, id: 'owner-1' };
const CREW = { kind: 'crew' as const, id: 'crew-a' };

function item(id: string, severity: PunchItem['severity']): PunchItem {
  const r = openPunchItem({ id, project_id: P, description: 'x', severity });
  if (!r.ok) throw new Error(r.reason);
  return r.item;
}

function allGood(): InstallGuardFacts {
  return {
    readiness_all_ok: true,
    crew_assignment_state: 'confirmed',
    documents: [{ id: 'ph1', document_type: 'installation_photo',
      is_current: true }],
    punch_items: [],
    closeout_docs_present: true,
    warranty_registered_at: AT,
    archive_missing_document_types: [],
  };
}

describe('install state chain', () => {
  it('nextInstallState follows the pinned order and ends at archived', () => {
    for (let i = 0; i < INSTALL_STATES.length - 1; i++) {
      expect(nextInstallState(INSTALL_STATES[i])).toBe(INSTALL_STATES[i + 1]);
    }
    expect(nextInstallState('archived')).toBeNull();
    expect(installStateAtLeast('punch_closed', 'installed')).toBe(true);
    expect(installStateAtLeast('installed', 'punch_closed')).toBe(false);
  });

  it('walks the whole chain when every guard holds', () => {
    let rec = initialInstallState(P, AT);
    for (const to of INSTALL_STATES.slice(1)) {
      const r = transitionInstallState(rec, to, allGood(), AT);
      expect(r.ok, to).toBe(true);
      if (r.ok) rec = r.record;
    }
    expect(rec.state).toBe('archived');
    expect(rec.evidence.from).toBe('warranty_registered');
  });

  it('refuses skipping and going backwards', () => {
    const rec = initialInstallState(P, AT);
    expect(transitionInstallState(rec, 'scheduled', allGood(), AT).ok).toBe(false);
    const g = guardInstallTransition('installed', 'ready', allGood());
    expect(g.ok).toBe(false);
  });

  it('refuses a bad timestamp', () => {
    const rec = initialInstallState(P, AT);
    expect(transitionInstallState(rec, 'ready', allGood(), 'now').ok).toBe(false);
  });

  const blocks: Array<[InstallState, InstallState, (f: InstallGuardFacts) => void,
    RegExp]> = [
    ['not_ready', 'ready', (f) => { f.readiness_all_ok = false; }, /readiness/],
    ['ready', 'scheduled', (f) => { f.crew_assignment_state = 'proposed'; },
      /confirmed/],
    ['scheduled', 'in_progress', (f) => { f.crew_assignment_state = 'cancelled'; },
      /not active/],
    ['in_progress', 'installed', (f) => { f.documents = []; }, /installation_photo/],
    ['in_progress', 'installed', (f) => {
      f.documents = [{ id: 'old', document_type: 'installation_photo',
        is_current: false }];
    }, /installation_photo/],
    ['in_progress', 'installed', (f) => {
      f.documents = [{ id: 's', document_type: 'site_photo', is_current: true }];
    }, /installation_photo/],
    ['punch_open', 'punch_closed', (f) => {
      f.punch_items = [item('p1', 'functional')];
    }, /p1/],
    ['punch_closed', 'closed_out', (f) => { f.closeout_docs_present = false; },
      /completion certificate/],
    ['closed_out', 'warranty_registered', (f) => {
      f.warranty_registered_at = null;
    }, /warranty/],
    ['warranty_registered', 'archived', (f) => {
      f.archive_missing_document_types = ['warranty'];
    }, /warranty/],
  ];

  for (const [from, to, breakIt, rx] of blocks) {
    it(`${from} -> ${to} is guarded`, () => {
      const f = allGood();
      breakIt(f);
      const g = guardInstallTransition(from, to, f);
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.reason).toMatch(rx);
      expect(guardInstallTransition(from, to, allGood()).ok).toBe(true);
    });
  }

  it('installed evidence lists the registered photo ids', () => {
    const g = guardInstallTransition('in_progress', 'installed', allGood());
    expect(g.ok && g.evidence.installation_photo_document_ids).toEqual(['ph1']);
  });
});

describe('punch list operations', () => {
  it('open -> in_progress -> resolved; resolved is terminal', () => {
    const p = item('p1', 'functional');
    const s = startPunchItem(p);
    expect(s.ok && s.item.state).toBe('in_progress');
    if (!s.ok) throw new Error(s.reason);
    const r = resolvePunchItem(s.item, CREW, AT);
    expect(r.ok && r.item.state).toBe('resolved');
    expect(r.ok && r.item.resolved_by).toBe('crew:crew-a');
    if (!r.ok) throw new Error(r.reason);
    expect(resolvePunchItem(r.item, CREW, AT).ok).toBe(false);
    expect(startPunchItem(r.item).ok).toBe(false);
    expect(p.state).toBe('open'); // inputs are never mutated
  });

  it('openPunchItem validates', () => {
    expect(openPunchItem({ id: '', project_id: P, description: 'x',
      severity: 'cosmetic' }).ok).toBe(false);
    expect(openPunchItem({ id: 'p', project_id: P, description: '  ',
      severity: 'cosmetic' }).ok).toBe(false);
    expect(openPunchItem({ id: 'p', project_id: P, description: 'x',
      severity: 'urgent' as PunchItem['severity'] }).ok).toBe(false);
  });

  it('waiver: owner only, cosmetic only', () => {
    const cosmetic = item('c1', 'cosmetic');
    const functional = item('f1', 'functional');
    const safety = item('s1', 'safety');
    expect(waivePunchItem(cosmetic, CREW, AT).ok).toBe(false);
    expect(waivePunchItem(cosmetic, { kind: 'agent', id: 'owner' }, AT).ok)
      .toBe(false);
    expect(waivePunchItem(cosmetic, { kind: 'owner', id: '' }, AT).ok).toBe(false);
    expect(waivePunchItem(functional, OWNER, AT).ok).toBe(false);
    expect(waivePunchItem(safety, OWNER, AT).ok).toBe(false);
    const w = waivePunchItem(cosmetic, OWNER, AT);
    expect(w.ok && w.item.state).toBe('waived_by_owner');
    expect(w.ok && w.item.resolved_by).toBe('owner:owner-1');
    if (w.ok) expect(waivePunchItem(w.item, OWNER, AT).ok).toBe(false);
  });

  it('closure predicate: severity rules', () => {
    expect(punchClosurePredicate([]).ok).toBe(true);
    const openCosmetic = item('c1', 'cosmetic');
    const c = punchClosurePredicate([openCosmetic]);
    expect(c.ok).toBe(false);
    expect(c.open_cosmetic).toEqual(['c1']);
    const waived = waivePunchItem(openCosmetic, OWNER, AT);
    if (!waived.ok) throw new Error(waived.reason);
    expect(punchClosurePredicate([waived.item]).ok).toBe(true);
    const f = punchClosurePredicate([item('f1', 'functional'), waived.item]);
    expect(f.ok).toBe(false);
    expect(f.open_functional_or_safety).toEqual(['f1']);
    // A waived non-cosmetic row (impossible via punch.ts) still blocks.
    const rogue: PunchItem = { ...item('r1', 'safety'), state: 'waived_by_owner' };
    const rr = punchClosurePredicate([rogue]);
    expect(rr.ok).toBe(false);
    expect(rr.invalid_waivers).toEqual(['r1']);
  });

  it('install chain: punch_closed blocked by open severe, allowed after waiver', () => {
    const f = allGood();
    const cosmetic = item('c1', 'cosmetic');
    f.punch_items = [cosmetic, item('s1', 'safety')];
    expect(guardInstallTransition('punch_open', 'punch_closed', f).ok).toBe(false);
    const resolved = resolvePunchItem(f.punch_items[1], CREW, AT);
    const waived = waivePunchItem(cosmetic, OWNER, AT);
    if (!resolved.ok || !waived.ok) throw new Error('setup');
    f.punch_items = [waived.item, resolved.item];
    const g = guardInstallTransition('punch_open', 'punch_closed', f);
    expect(g.ok).toBe(true);
    expect(g.ok && g.evidence.waived_item_ids).toEqual(['c1']);
  });
});
