// Playbook declaration validation + hash stability + v1 set invariants.

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CLASS_FLOOR,
  approvalClassFor,
  canonicalJson,
  declarationHash,
  validateDeclaration,
  type PlaybookDeclaration,
} from '../src/lib/business/runner/playbook';
import {
  CONTRACT_PROCEED_V1,
  ORDER_CYCLE_V1,
  PLAYBOOKS_V1,
  findPlaybook,
} from '../src/lib/business/runner/playbooks';

function base(over: Partial<PlaybookDeclaration> = {}): PlaybookDeclaration {
  return {
    id: 'test.playbook',
    version: 1,
    trigger: 'event.test',
    required_data: ['project.id'],
    allowed_capabilities: ['gmail.message.draft', 'gmail.message.send'],
    predicates: ['identity.confirmed', 'gate.one'],
    worker_use: { kind: 'none' },
    approvals: {
      'gmail.message.draft': 'INTERNAL',
      'gmail.message.send': 'EXTERNAL',
    },
    evidence_policy: 'every_step',
    retries: { max: 2, backoff_ms: 1000 },
    exception_routes: { 'gate.one': 'wait' },
    exit_condition: 'draft and send proposed',
    steps: [
      { kind: 'check_identity', args: { predicate: 'identity.confirmed' } },
      { kind: 'evaluate_gate', args: { predicate: 'gate.one' } },
      { kind: 'propose_capability', args: { capability_id: 'gmail.message.draft' } },
      { kind: 'propose_capability', args: { capability_id: 'gmail.message.send' } },
    ],
    ...over,
  };
}

describe('validateDeclaration - fail closed', () => {
  it('accepts a well-formed declaration', () => {
    expect(validateDeclaration(base())).toEqual({ ok: true, errors: [] });
  });
  it('rejects a step proposing a capability outside allowed_capabilities', () => {
    const d = base({
      steps: [
        { kind: 'propose_capability', args: { capability_id: 'vendor.order.place' } },
      ],
    });
    const v = validateDeclaration(d);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('steps[0].capability_not_allowed:vendor.order.place');
  });
  it('rejects an EXTERNAL capability without an approval class', () => {
    const d = base({ approvals: { 'gmail.message.draft': 'INTERNAL' } });
    const v = validateDeclaration(d);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('approval_class_missing:gmail.message.send');
  });
  it('rejects a STEP_UP capability declared below its floor', () => {
    const d = base({
      allowed_capabilities: ['vendor.order.place'],
      approvals: { 'vendor.order.place': 'EXTERNAL' },
      steps: [
        { kind: 'propose_capability', args: { capability_id: 'vendor.order.place' } },
      ],
    });
    const v = validateDeclaration(d);
    expect(v.errors).toContain('approval_class_below_floor:vendor.order.place');
  });
  it('rejects unknown capability ids and approvals for disallowed ones', () => {
    const d = base({
      allowed_capabilities: ['mystery.thing.do'],
      approvals: { 'mystery.thing.do': 'STEP_UP', 'gmail.message.send': 'EXTERNAL' },
      steps: [{ kind: 'advance_state', args: { to: 'qualified' } }],
    });
    const v = validateDeclaration(d);
    expect(v.errors).toContain('capability_unknown:mystery.thing.do');
    expect(v.errors).toContain('approval_for_disallowed:gmail.message.send');
  });
  it('rejects undeclared predicates and forbidden advance targets', () => {
    const d = base({
      steps: [
        { kind: 'evaluate_gate', args: { predicate: 'not.declared' } },
        { kind: 'advance_state', args: { to: 'ordered' } },
        { kind: 'advance_state', args: { to: 'won' } },
      ],
    });
    const v = validateDeclaration(d);
    expect(v.errors).toContain('steps[0].predicate_undeclared:not.declared');
    expect(v.errors).toContain('steps[1].advance_forbidden:ordered');
    expect(v.errors).toContain('steps[2].advance_forbidden:won');
  });
  it('rejects unbounded retries, bad routes and a worker without purpose', () => {
    expect(validateDeclaration(base({ retries: { max: 99, backoff_ms: 0 } })).errors)
      .toContain('retries_invalid');
    const badRoute = base({
      exception_routes: { 'gate.one': 'retry_forever' as never },
    });
    expect(validateDeclaration(badRoute).errors).toContain('route_invalid:gate.one');
    const w = base({ worker_use: { kind: 'claude', purpose: '' } });
    expect(validateDeclaration(w).errors).toContain('worker_use_purpose_missing');
  });
  it('approvalClassFor is null outside the allow-list', () => {
    expect(approvalClassFor(base(), 'gmail.message.send')).toBe('EXTERNAL');
    expect(approvalClassFor(base(), 'vendor.order.place')).toBeNull();
  });
});

describe('declarationHash - stability', () => {
  it('is a sha256 hex and independent of key order', () => {
    const a = base();
    const b = JSON.parse(JSON.stringify(a)) as PlaybookDeclaration;
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as PlaybookDeclaration;
    expect(declarationHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(declarationHash(reordered)).toBe(declarationHash(a));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }))
      .toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
  it('changes when any declared field changes', () => {
    const h = declarationHash(base());
    expect(declarationHash(base({ version: 2 }))).not.toBe(h);
    expect(declarationHash(base({ exit_condition: 'x' }))).not.toBe(h);
    expect(declarationHash(base({ approvals: {
      'gmail.message.draft': 'INTERNAL', 'gmail.message.send': 'STEP_UP',
    } }))).not.toBe(h);
  });
});

describe('v1 playbook set', () => {
  it('ships the ten Phase 4 playbooks, all valid, unique, and hash-stable', () => {
    expect(PLAYBOOKS_V1.map((p) => p.id)).toEqual([
      'lead.intake', 'deal.intelligence', 'visit.schedule', 'visit.recap',
      'vendor.quote_cycle', 'quote.client', 'follow_up', 'contract.proceed',
      'final_measure', 'order.cycle',
    ]);
    const hashes = new Set<string>();
    for (const p of PLAYBOOKS_V1) {
      const v = validateDeclaration(p);
      expect(v, p.id).toEqual({ ok: true, errors: [] });
      expect(p.version).toBe(1);
      expect(p.worker_use.kind).toBe('none');
      hashes.add(declarationHash(p));
      expect(declarationHash(p)).toBe(declarationHash(p));
    }
    expect(hashes.size).toBe(PLAYBOOKS_V1.length);
    expect(findPlaybook('order.cycle', 1)).toBe(ORDER_CYCLE_V1);
    expect(findPlaybook('order.cycle', 2)).toBeNull();
  });
  it('every capability referenced has a known floor; every predicate is declared', () => {
    for (const p of PLAYBOOKS_V1) {
      for (const c of p.allowed_capabilities) {
        expect(CAPABILITY_CLASS_FLOOR[c], `${p.id}:${c}`).toBeDefined();
      }
      for (const s of p.steps) {
        if (s.kind === 'evaluate_gate' || s.kind === 'check_identity') {
          expect(p.predicates).toContain(s.args.predicate);
        }
      }
    }
  });
  it('contract.proceed and order.cycle END at a STEP_UP proposal, never at an advance', () => {
    for (const p of [CONTRACT_PROCEED_V1, ORDER_CYCLE_V1]) {
      const last = p.steps[p.steps.length - 1];
      expect(last.kind).toBe('propose_capability');
      expect(p.approvals[String(last.args.capability_id)]).toBe('STEP_UP');
      expect(p.steps.some((s) => s.kind === 'advance_state')).toBe(false);
    }
    expect(ORDER_CYCLE_V1.predicates).toContain('order_eligibility');
    expect(ORDER_CYCLE_V1.predicates).toContain('stage_gate.po_hash_bound_to_final_measure');
    expect(ORDER_CYCLE_V1.predicates).toContain('contact_leak.clear');
  });
  it('no playbook ever advances into a money/legal/order/owner-final state', () => {
    for (const p of PLAYBOOKS_V1) {
      for (const s of p.steps) {
        if (s.kind !== 'advance_state') continue;
        expect(['contract_signed', 'deposit_received', 'ordered', 'charged', 'won', 'lost'])
          .not.toContain(s.args.to);
      }
    }
  });
});
