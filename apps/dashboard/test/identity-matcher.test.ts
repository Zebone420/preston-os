// Phase 1 Lane A - deterministic project matcher. Synthetic fixtures only.

import { describe, expect, it } from 'vitest';
import {
  matchProject,
  SIGNAL_PRIORITY,
  signalRank,
  type MatchInput,
  type ProjectIndex,
} from '../src/lib/business/identity/matcher';

// Synthetic ids (not real client data).
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const P2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const P3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const PROJ_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'; // client 1, prop 1
const PROJ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'; // client 2, prop 2
const PROJ_C = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'; // client 1, prop 3
const CT1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const CT2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';

function index(): ProjectIndex {
  return {
    projects: [
      { id: PROJ_A, project_code: 'P26-0001', client_id: C1, property_id: P1 },
      { id: PROJ_B, project_code: 'P26-0002', client_id: C2, property_id: P2 },
      { id: PROJ_C, project_code: null, client_id: C1, property_id: P3 },
    ],
    external_links: [
      {
        external_system: 'home_depot_case', external_id: 'HD-100',
        entity_type: 'project', entity_id: PROJ_B, confidence: 'linked_auto',
      },
      {
        external_system: 'home_depot_case', external_id: 'HD-CAND',
        entity_type: 'project', entity_id: PROJ_A, confidence: 'candidate',
      },
      {
        external_system: 'gmail_thread', external_id: 'thread-A',
        entity_type: 'project', entity_id: PROJ_A, confidence: 'confirmed',
      },
    ],
    order_numbers: [
      { number: 'W123456', project_id: PROJ_B },
      { number: 'DUP-1', project_id: PROJ_A },
      { number: 'dup-1', project_id: PROJ_B },
    ],
    properties: [
      { id: P1, client_id: C1, address_line: '123 West 72nd Street', unit: '4B' },
      { id: P2, client_id: C2, address_line: '9 Park Place', unit: null },
      { id: P3, client_id: C1, address_line: '123 West 72nd Street', unit: '5C' },
    ],
    contacts: [
      { id: CT1, client_id: C1, email: 'Alex.Smith@example.com', phone: null },
      { id: CT2, client_id: C2, email: 'pat.smith@example.org',
        phone: '(212) 555-0100' },
    ],
    aliases: [
      { alias_kind: 'email', normalized_value: 'ops@vendor.example',
        project_id: PROJ_B, approved: true, active: true },
      { alias_kind: 'email', normalized_value: 'unapproved@vendor.example',
        project_id: PROJ_A, approved: false, active: true },
      { alias_kind: 'email', normalized_value: 'retired@vendor.example',
        project_id: PROJ_A, approved: true, active: false },
      { alias_kind: 'phone', normalized_value: '+12125550199',
        client_id: C1, approved: true, active: true },
    ],
  };
}

const linked = (input: MatchInput, id: string, signal: string) => {
  const r = matchProject(input, index());
  expect(r.outcome).toBe('linked');
  expect(r.confidence).toBe('linked_auto');
  expect(r.project_id).toBe(id);
  expect(r.signal).toBe(signal);
  expect(r.review_item).toBeUndefined();
  expect(r.evidence.at(-1)?.signal).toBe(signal);
  return r;
};

describe('signal priority table', () => {
  it('is exactly the plan order 1..8', () => {
    expect(SIGNAL_PRIORITY).toEqual([
      'project_code', 'external_id', 'gmail_thread', 'order_number',
      'property_client', 'known_contact', 'approved_alias', 'ai_candidate',
    ]);
    expect(signalRank('project_code')).toBe(1);
    expect(signalRank('ai_candidate')).toBe(8);
  });
});

describe('each signal rank', () => {
  it('1 exact Project ID (explicit or found in text)', () => {
    linked({ project_code: 'P26-0001' }, PROJ_A, 'project_code');
    linked({ text: 'Re: P26-0002 delivery' }, PROJ_B, 'project_code');
    expect(matchProject({ project_code: 'P26-0099' }, index()).outcome)
      .toBe('orphan');
  });

  it('2 exact source-system external ID (candidate links do not count)', () => {
    linked({ external: { system: 'home_depot_case', id: 'HD-100' } },
      PROJ_B, 'external_id');
    const r = matchProject(
      { external: { system: 'home_depot_case', id: 'HD-CAND' } }, index());
    expect(r.outcome).toBe('orphan');
    expect(matchProject(
      { external: { system: 'iqplus', id: 'HD-100' } }, index()).outcome)
      .toBe('orphan');
  });

  it('3 existing Gmail thread mapping', () => {
    linked({ gmail_thread_id: 'thread-A' }, PROJ_A, 'gmail_thread');
    linked({ external: { system: 'gmail_thread', id: 'thread-A' } },
      PROJ_A, 'gmail_thread');
    expect(matchProject({ gmail_thread_id: 'thread-zzz' }, index()).outcome)
      .toBe('orphan');
  });

  it('4 quote / order number (case-insensitive)', () => {
    linked({ order_numbers: ['w123456'] }, PROJ_B, 'order_number');
  });

  it('5 exact property + confirmed client', () => {
    linked({
      property: { address_line: '123 W. 72nd St, Apt 4B' },
      confirmed_client_id: C1,
    }, PROJ_A, 'property_client');
    // Property alone (no confirmed client) is not a signal.
    expect(matchProject({
      property: { address_line: '123 W. 72nd St, Apt 4B' },
    }, index()).outcome).toBe('orphan');
    // Right address, wrong (confirmed) client: no link.
    expect(matchProject({
      property: { address_line: '123 W. 72nd St, Apt 4B' },
      confirmed_client_id: C2,
    }, index()).outcome).toBe('orphan');
  });

  it('6 exact known contact (email or phone, normalized)', () => {
    linked({ contact: { email: 'PAT.SMITH@example.org' } }, PROJ_B,
      'known_contact');
    linked({ contact: { phone: '212.555.0100' } }, PROJ_B, 'known_contact');
    expect(matchProject({ contact: { email: 'nobody@example.org' } }, index())
      .outcome).toBe('orphan');
  });

  it('7 approved deterministic alias (approved + active only)', () => {
    linked({ contact: { email: 'Ops@Vendor.example' } }, PROJ_B,
      'approved_alias');
    expect(matchProject({ contact: { email: 'unapproved@vendor.example' } },
      index()).outcome).toBe('orphan');
    expect(matchProject({ contact: { email: 'retired@vendor.example' } },
      index()).outcome).toBe('orphan');
  });

  it('8 AI candidate yields candidate only, never a link', () => {
    const r = matchProject({
      ai_candidate: { project_id: PROJ_B, rationale: 'similar subject' },
      subject_type: 'gmail_message', subject_id: 'msg-9',
    }, index());
    expect(r.outcome).toBe('candidate');
    expect(r.confidence).toBe('candidate');
    expect(r.project_id).toBe(PROJ_B);
    expect(r.signal).toBe('ai_candidate');
    expect(r.review_item?.candidate_entity_id).toBe(PROJ_B);
    expect(r.review_item?.subject_id).toBe('msg-9');
    expect(matchProject({
      ai_candidate: { project_id: 'not-a-project', rationale: 'x' },
    }, index()).outcome).toBe('orphan');
  });
});

describe('priority precedence', () => {
  it('a stronger signal wins even when weaker signals disagree', () => {
    linked({
      project_code: 'P26-0001',
      external: { system: 'home_depot_case', id: 'HD-100' },
      gmail_thread_id: 'thread-A',
      order_numbers: ['W123456'],
      ai_candidate: { project_id: PROJ_B, rationale: 'x' },
    }, PROJ_A, 'project_code');
    linked({
      external: { system: 'home_depot_case', id: 'HD-100' },
      gmail_thread_id: 'thread-A',
    }, PROJ_B, 'external_id');
    linked({
      gmail_thread_id: 'thread-A',
      order_numbers: ['W123456'],
    }, PROJ_A, 'gmail_thread');
    linked({
      order_numbers: ['W123456'],
      contact: { email: 'alex.smith@example.com' },
    }, PROJ_B, 'order_number');
  });

  it('a deterministic signal beats an AI candidate that disagrees', () => {
    linked({
      contact: { email: 'pat.smith@example.org' },
      ai_candidate: { project_id: PROJ_A, rationale: 'x' },
    }, PROJ_B, 'known_contact');
  });
});

describe('ambiguity fails closed', () => {
  it('two projects on one signal -> ambiguous + review item, no fallthrough', () => {
    const r = matchProject({
      order_numbers: ['DUP-1'],
      ai_candidate: { project_id: PROJ_A, rationale: 'tie-break attempt' },
      subject_type: 'vendor_email', subject_id: 'msg-7',
    }, index());
    expect(r.outcome).toBe('ambiguous');
    expect(r.confidence).toBe('orphan');
    expect(r.project_id).toBeUndefined();
    expect(r.signal).toBe('order_number');
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0].project_ids).toEqual([PROJ_A, PROJ_B].sort());
    expect(r.review_item).toBeDefined();
    expect(r.review_item?.candidate_entity_type).toBe('project');
    expect(r.review_item?.candidate_entity_id).toBeNull();
    expect(r.review_item?.reason).toMatch(/matched 2 projects/);
    expect(r.review_item?.subject_id).toBe('msg-7');
  });

  it('a known contact whose client has two projects is ambiguous', () => {
    const r = matchProject({ contact: { email: 'alex.smith@example.com' } },
      index());
    expect(r.outcome).toBe('ambiguous');
    expect(r.evidence[0].project_ids).toEqual([PROJ_A, PROJ_C].sort());
  });

  it('a client-level alias spanning two projects is ambiguous', () => {
    const r = matchProject({ contact: { phone: '+1 212 555 0199' } }, index());
    expect(r.outcome).toBe('ambiguous');
    expect(r.signal).toBe('approved_alias');
  });
});

describe('false-merge gold set', () => {
  it('two clients, same last name, different addresses: never merge', () => {
    // Nothing name-shaped is even an input. The only shared thing is a
    // surname, and the property of one with the confirmed identity of
    // the other yields nothing.
    const r1 = matchProject({
      property: { address_line: '9 Park Place' },
      confirmed_client_id: C1,
    }, index());
    expect(r1.outcome).toBe('orphan');
    const r2 = matchProject({
      property: { address_line: '123 West 72nd Street', unit: '4B' },
      confirmed_client_id: C2,
    }, index());
    expect(r2.outcome).toBe('orphan');
  });

  it('same address, different unit: never merge', () => {
    const r = matchProject({
      property: { address_line: '123 West 72nd Street', unit: '6D' },
      confirmed_client_id: C1,
    }, index());
    expect(r.outcome).toBe('orphan');
    // The two real units resolve to two different projects.
    linked({
      property: { address_line: '123 West 72nd Street', unit: '5C' },
      confirmed_client_id: C1,
    }, PROJ_C, 'property_client');
    linked({
      property: { address_line: '123 West 72nd Street #4B' },
      confirmed_client_id: C1,
    }, PROJ_A, 'property_client');
  });

  it('an empty input is an orphan with no evidence', () => {
    expect(matchProject({}, index())).toEqual({
      outcome: 'orphan', confidence: 'orphan', signal: null, evidence: [],
    });
  });
});
