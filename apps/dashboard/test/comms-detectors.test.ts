import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DETECTOR_CONFIG,
  InvalidFindingError,
  makeFinding,
  runDetectors,
  type TimelineEvent,
  type TimelineInput,
  type TimelineMessage,
} from '../src/lib/business/comms/detectors';
import { DETECTORS } from '../src/lib/business/comms/types';
import { NOW, OWNER, PROJECT_A } from './comms-fixtures';

// NOW = 2026-09-08T12:00Z (a Tuesday).
const H = 3_600_000;
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * H).toISOString();

function msg(over: Partial<TimelineMessage> & { id: string }): TimelineMessage {
  return {
    provider_thread_id: 't1',
    direction: 'inbound',
    from_address_norm: 'jane@example.com',
    to_addresses_norm: [OWNER],
    subject: 'Re: windows',
    received_at: ago(72),
    ingestion_class: 'INCLUDE_PROJECT',
    project_id: PROJECT_A,
    link_confidence: 'linked_auto',
    ...over,
  };
}

type EvtOver = Partial<TimelineEvent> & { id: string; event_type: TimelineEvent['event_type'] };
function evt(over: EvtOver): TimelineEvent {
  return {
    message_id: 'm1',
    payload: {},
    project_id: PROJECT_A,
    occurred_at: ago(72),
    ...over,
  };
}

function input(over: Partial<TimelineInput>): TimelineInput {
  return {
    messages: [],
    events: [],
    projects: [{ id: PROJECT_A, title: 'Sample St windows', status: 'contracted' }],
    quotes: [],
    vendorOrders: [],
    leads: [],
    now: NOW,
    ...over,
  };
}

function only(name: (typeof DETECTORS)[number], i: TimelineInput) {
  return runDetectors(i, [name]);
}

describe('detectors - finding contract', () => {
  it('a finding without evidence is invalid', () => {
    expect(() => makeFinding({
      item_type: 'RISK', detector: 'bounced_email', project_id: null, subject: 's',
      source_system: 'gmail', source_ref: 'x', evidence: [], confidence: 'low',
      suggested_action: 'a', dedupe_suffix: 'x',
    })).toThrow(InvalidFindingError);
  });
  it('every finding carries >= 1 evidence entry with ref + timestamp', () => {
    const findings = runDetectors(input({
      messages: [msg({ id: 'm1' })],
      events: [evt({ id: 'e1', event_type: 'delivery_failed', message_id: 'm1' })],
    }));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence.length).toBeGreaterThanOrEqual(1);
      for (const e of f.evidence) {
        expect(e.ref).toBeTruthy();
        expect(e.timestamp).toBeTruthy();
      }
      expect(f.dedupe_key.startsWith(`${f.detector}:`)).toBe(true);
    }
  });
  it('re-running is idempotent: identical dedupe keys and order', () => {
    const i = input({
      messages: [msg({ id: 'm1' })],
      events: [evt({ id: 'e1', event_type: 'delivery_failed', message_id: 'm1' })],
    });
    const a = runDetectors(i).map((f) => f.dedupe_key);
    const b = runDetectors(i).map((f) => f.dedupe_key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
  it('all 12 detector names are wired', () => {
    for (const d of DETECTORS) expect(runDetectors(input({}), [d])).toEqual([]);
  });
});

describe('1. inbound_unanswered', () => {
  it('fires for an inbound business message older than 48h with no reply', () => {
    const f = only('inbound_unanswered', input({ messages: [msg({ id: 'm1' })] }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ item_type: 'OUR_COMMITMENT', confidence: 'medium',
      dedupe_key: 'inbound_unanswered:m1', project_id: PROJECT_A });
    expect(f[0].evidence[0]).toMatchObject({ kind: 'message', ref: 'm1' });
  });
  it('does not fire when replied, too fresh, non-business, or a system notification', () => {
    const replied = input({ messages: [msg({ id: 'm1' }),
      msg({ id: 'm2', direction: 'outbound', from_address_norm: OWNER, received_at: ago(70) })] });
    expect(only('inbound_unanswered', replied)).toEqual([]);
    const fresh = input({ messages: [msg({ id: 'm1', received_at: ago(10) })] });
    expect(only('inbound_unanswered', fresh)).toEqual([]);
    expect(only('inbound_unanswered', input({ messages: [msg({ id: 'm1',
      ingestion_class: 'FINANCE_RESTRICTED' })] }))).toEqual([]);
    const system = input({ messages: [msg({ id: 'm1' })],
      events: [evt({ id: 'e1', event_type: 'hd_case_submitted', message_id: 'm1' })] });
    expect(only('inbound_unanswered', system)).toEqual([]);
  });
  it('high confidence after twice the window', () => {
    const old = input({ messages: [msg({ id: 'm1', received_at: ago(100) })] });
    const f = only('inbound_unanswered', old);
    expect(f[0].confidence).toBe('high');
  });
});

describe('2. first_response_lag', () => {
  const lead = { id: 'l1', project_id: PROJECT_A, display_name: 'Jane', stage: 'lead',
    stage_changed_at: ago(48), created_at: ago(48) };
  it('no outbound after the lead window -> OUR_COMMITMENT high', () => {
    const f = only('first_response_lag', input({ leads: [lead] }));
    expect(f[0]).toMatchObject({ item_type: 'OUR_COMMITMENT', confidence: 'high',
      dedupe_key: 'first_response_lag:l1' });
  });
  it('late first outbound -> RISK medium with both evidence entries', () => {
    const f = only('first_response_lag', input({ leads: [lead],
      messages: [msg({ id: 'o1', direction: 'outbound', received_at: ago(10) })] }));
    expect(f[0]).toMatchObject({ item_type: 'RISK', confidence: 'medium' });
    expect(f[0].evidence.map((e) => e.kind)).toEqual(['lead', 'message']);
  });
  it('prompt response or configured wider window -> nothing', () => {
    expect(only('first_response_lag', input({ leads: [lead],
      messages: [msg({ id: 'o1', direction: 'outbound', received_at: ago(40) })] }))).toEqual([]);
    const wide = input({ leads: [lead], config: { firstResponseHours: 72 } });
    expect(only('first_response_lag', wide)).toEqual([]);
  });
});

describe('3. quote_follow_up_overdue', () => {
  const quote = { id: 'q1', project_id: PROJECT_A, title: 'Q', status: 'approved',
    sent_at: ago(30), decided_at: null };
  it('fires 24h after send with no follow-up; due_at from the ladder', () => {
    const f = only('quote_follow_up_overdue', input({ quotes: [quote] }));
    expect(f[0]).toMatchObject({ item_type: 'OUR_COMMITMENT',
      dedupe_key: 'quote_follow_up_overdue:q1',
      due_at: ago(6) });
    expect(f[0].suggested_action).toMatch(/follow-up 1/);
  });
  it('second rung is 48h after the first follow-up; weekly afterwards', () => {
    const one = input({ quotes: [quote],
      messages: [msg({ id: 'o1', direction: 'outbound', received_at: ago(20) })] });
    expect(only('quote_follow_up_overdue', one)).toEqual([]);
    const twoLate = input({ quotes: [{ ...quote, sent_at: ago(200) }],
      messages: [msg({ id: 'o1', direction: 'outbound', received_at: ago(180) }),
        msg({ id: 'o2', direction: 'outbound', received_at: ago(170) })] });
    expect(only('quote_follow_up_overdue', twoLate)[0].suggested_action).toMatch(/follow-up 3/);
    const twoFresh = { ...twoLate, messages: [twoLate.messages[0],
      msg({ id: 'o2', direction: 'outbound', received_at: ago(100) })] };
    expect(only('quote_follow_up_overdue', twoFresh)).toEqual([]);
  });
  it('decided, closed, or unsent quotes never fire; config ladder is honoured', () => {
    expect(only('quote_follow_up_overdue', input({ quotes: [{ ...quote, decided_at: ago(1) }] })))
      .toEqual([]);
    expect(only('quote_follow_up_overdue', input({ quotes: [{ ...quote, status: 'lost' }] })))
      .toEqual([]);
    expect(only('quote_follow_up_overdue', input({ quotes: [{ ...quote, sent_at: null }] })))
      .toEqual([]);
    const ladder = input({ quotes: [quote], config: { followUpHours: [72] } });
    expect(only('quote_follow_up_overdue', ladder))
      .toEqual([]);
  });
});

describe('4. stale_quote', () => {
  const quote = { id: 'q1', project_id: PROJECT_A, title: 'Q', status: 'approved',
    sent_at: ago(24 * 15), decided_at: null };
  it('fires after 14 days without a decision; high after 28', () => {
    expect(only('stale_quote', input({ quotes: [quote] }))[0]).toMatchObject({
      item_type: 'RISK', confidence: 'medium', dedupe_key: 'stale_quote:q1' });
    const older = input({ quotes: [{ ...quote, sent_at: ago(24 * 30) }] });
    expect(only('stale_quote', older)[0].confidence)
      .toBe('high');
  });
  it('does not fire when fresh or decided', () => {
    const fresh = input({ quotes: [{ ...quote, sent_at: ago(24 * 5) }] });
    expect(only('stale_quote', fresh)).toEqual([]);
    expect(only('stale_quote', input({ quotes: [{ ...quote, decided_at: ago(1) }] }))).toEqual([]);
  });
});

describe('5. stale_negotiation', () => {
  const lead = { id: 'l1', project_id: PROJECT_A, display_name: 'Jane', stage: 'negotiation',
    stage_changed_at: ago(24 * 20), created_at: ago(24 * 40) };
  it('fires when nothing moved for 10 days', () => {
    const f = only('stale_negotiation', input({ leads: [lead] }));
    expect(f[0]).toMatchObject({ item_type: 'RISK', dedupe_key: 'stale_negotiation:l1' });
  });
  it('recent traffic or a non-negotiation stage -> nothing', () => {
    expect(only('stale_negotiation', input({ leads: [lead],
      messages: [msg({ id: 'm1', received_at: ago(24 * 2) })] }))).toEqual([]);
    expect(only('stale_negotiation', input({ leads: [{ ...lead, stage: 'won' }] }))).toEqual([]);
  });
});

describe('6. andersen_deadline_breach', () => {
  const lead = evt({ id: 'e1', event_type: 'andersen_lead_new', message_id: 'm1',
    occurred_at: ago(60), payload: { claim_deadline: ago(12), homeowner_name: 'Jane Sample' } });
  it('deadline passed with no outbound -> RISK high with event + message evidence', () => {
    const f = only('andersen_deadline_breach', input({ messages: [msg({ id: 'm1',
      from_address_norm: 'certifiedcontractor@e.andersencorp.com', received_at: ago(60) })],
      events: [lead] }));
    expect(f[0]).toMatchObject({ item_type: 'RISK', confidence: 'high', due_at: ago(12),
      dedupe_key: 'andersen_deadline_breach:e1' });
    expect(f[0].evidence.map((e) => e.kind)).toEqual(['event', 'message']);
  });
  it('acknowledged by an outbound in the project, or before the deadline -> nothing', () => {
    expect(only('andersen_deadline_breach', input({ events: [lead],
      messages: [msg({ id: 'o1', direction: 'outbound', received_at: ago(50) })] }))).toEqual([]);
    expect(only('andersen_deadline_breach', input({ events: [{ ...lead,
      payload: { claim_deadline: ago(-5) } }] }))).toEqual([]);
  });
  it('unlinked lead past deadline is medium confidence; nudge unanswered fires', () => {
    const f = only('andersen_deadline_breach', input({ events: [{ ...lead, project_id: null }] }));
    expect(f[0].confidence).toBe('medium');
    const nudge = only('andersen_deadline_breach', input({ events: [evt({ id: 'e2',
      event_type: 'andersen_status_nudge', occurred_at: ago(30) })] }));
    expect(nudge[0]).toMatchObject({ item_type: 'OUR_COMMITMENT',
      dedupe_key: 'andersen_deadline_breach:e2' });
  });
});

describe('7. orphan_communication', () => {
  it('fires for INCLUDE_PROJECT messages with no link', () => {
    const f = only('orphan_communication', input({ messages: [msg({ id: 'm1', project_id: null,
      link_confidence: 'orphan' })] }));
    expect(f[0]).toMatchObject({ item_type: 'RISK', confidence: 'low', project_id: null,
      dedupe_key: 'orphan_communication:m1' });
  });
  it('does not fire for linked, candidate, or non-project classes', () => {
    expect(only('orphan_communication', input({ messages: [msg({ id: 'm1' })] }))).toEqual([]);
    expect(only('orphan_communication', input({ messages: [msg({ id: 'm1', project_id: null,
      link_confidence: 'orphan', ingestion_class: 'EVENT_ONLY' })] }))).toEqual([]);
  });
});

describe('8. commitment_due', () => {
  const commit = (party: string, due_at: string | null, due_hint: string | null = null) =>
    evt({ id: 'e1', event_type: 'commitment_detected', message_id: 'm1', occurred_at: ago(100),
      payload: { commitments: [{ party, phrase: 'i will call you', due_at, due_hint }] } });
  it('our promise past its hint with no outbound -> OUR_COMMITMENT high', () => {
    const f = only('commitment_due', input({ messages: [msg({ id: 'm1', direction: 'outbound',
      received_at: ago(100) })], events: [commit('us', ago(10), 'friday')] }));
    expect(f[0]).toMatchObject({ item_type: 'OUR_COMMITMENT', confidence: 'high', due_at: ago(10),
      dedupe_key: 'commitment_due:e1:0' });
  });
  it('their promise uses the default window and WAITING_ON; fulfilled -> nothing', () => {
    const f = only('commitment_due', input({ messages: [msg({ id: 'm1', received_at: ago(100) })],
      events: [commit('them', null)] }));
    expect(f[0]).toMatchObject({ item_type: 'WAITING_ON', confidence: 'medium' });
    const fulfilled = input({ messages: [msg({ id: 'm1', received_at: ago(100) }),
      msg({ id: 'm2', received_at: ago(50) })], events: [commit('them', null)] });
    expect(only('commitment_due', fulfilled)).toEqual([]);
  });
  it('not yet due -> nothing', () => {
    expect(only('commitment_due', input({ messages: [msg({ id: 'm1' })],
      events: [commit('us', ago(-24))] }))).toEqual([]);
  });
});

describe('9. bounced_email', () => {
  it('every delivery_failed event is a high RISK with masked subject', () => {
    const f = only('bounced_email', input({ events: [evt({ id: 'e1', event_type: 'delivery_failed',
      payload: { failed_recipient: 'nobody@example.com', reason: 'address_not_found' } })] }));
    expect(f[0]).toMatchObject({ item_type: 'RISK', confidence: 'high',
      dedupe_key: 'bounced_email:e1' });
    expect(f[0].suggested_action).toMatch(/before any further send/);
  });
  it('no bounce events -> nothing', () => {
    expect(only('bounced_email', input({ events: [evt({ id: 'e1', event_type: 'voice_sms' })] })))
      .toEqual([]);
  });
});

describe('10. vendor_quote_no_return', () => {
  const submitted = evt({ id: 'e1', event_type: 'hd_case_submitted', message_id: 'm1',
    occurred_at: '2026-09-01T10:00:00.000Z', payload: { case_number: '12345678' } });
  it('case older than 3 business days with no quote -> WAITING_ON', () => {
    const f = only('vendor_quote_no_return', input({ messages: [msg({ id: 'm1' })],
      events: [submitted] }));
    expect(f[0]).toMatchObject({ item_type: 'WAITING_ON', due_at: '2026-09-04T10:00:00.000Z',
      dedupe_key: 'vendor_quote_no_return:e1' });
  });
  it('quote returned in thread / project / by case number -> nothing', () => {
    const back = evt({ id: 'e2', event_type: 'hd_quote_received', message_id: 'm2',
      occurred_at: '2026-09-02T10:00:00.000Z', payload: { case_number: '12345678' } });
    expect(only('vendor_quote_no_return', input({ messages: [msg({ id: 'm1' }), msg({ id: 'm2' })],
      events: [submitted, back] }))).toEqual([]);
  });
  it('weekend-aware: a Friday case is not overdue on Tuesday', () => {
    const friday = { ...submitted, occurred_at: '2026-09-04T16:00:00.000Z' };
    expect(only('vendor_quote_no_return', input({ messages: [msg({ id: 'm1' })],
      events: [friday] }))).toEqual([]);
  });
});

describe('11. delivery_status_overdue', () => {
  const order = { id: 'v1', project_id: PROJECT_A, vendor: 'Home Depot', order_number: 'W1',
    expected_ship_date: '2026-09-05', delivery_status: 'ordered' };
  it('order past expected ship date -> WAITING_ON (high after 7 days)', () => {
    const f = only('delivery_status_overdue', input({ vendorOrders: [order] }));
    expect(f[0]).toMatchObject({ item_type: 'WAITING_ON', confidence: 'medium',
      dedupe_key: 'delivery_status_overdue:v1' });
    expect(f[0].evidence[0].kind).toBe('vendor_order');
    expect(only('delivery_status_overdue', input({ vendorOrders: [{ ...order,
      expected_ship_date: '2026-08-20' }] }))[0].confidence).toBe('high');
  });
  it('shipped/delivered or future dates -> nothing', () => {
    expect(only('delivery_status_overdue', input({ vendorOrders: [{ ...order,
      delivery_status: 'shipped' }] }))).toEqual([]);
    expect(only('delivery_status_overdue', input({ vendorOrders: [{ ...order,
      expected_ship_date: '2026-09-20' }] }))).toEqual([]);
  });
  it('ready-for-pickup left > 5 days -> OUR_COMMITMENT; later delivery clears it', () => {
    const ready = evt({ id: 'e1', event_type: 'hd_order_status', occurred_at: ago(24 * 6),
      payload: { status: 'ready_for_pickup' } });
    expect(only('delivery_status_overdue', input({ events: [ready] }))[0])
      .toMatchObject({ item_type: 'OUR_COMMITMENT', dedupe_key: 'delivery_status_overdue:e1' });
    const done = evt({ id: 'e2', event_type: 'hd_order_status', occurred_at: ago(24),
      payload: { status: 'delivered' } });
    expect(only('delivery_status_overdue', input({ events: [ready, done] }))).toEqual([]);
  });
});

describe('12. client_update_unanswered', () => {
  const ask = evt({ id: 'e1', event_type: 'client_status_request', message_id: 'm1',
    occurred_at: ago(30), payload: { phrase: 'any update' } });
  it('status request older than 24h with no outbound in thread -> OUR_COMMITMENT high', () => {
    const f = only('client_update_unanswered', input({
      messages: [msg({ id: 'm1', received_at: ago(30) })],
      events: [ask] }));
    expect(f[0]).toMatchObject({ item_type: 'OUR_COMMITMENT', confidence: 'high',
      due_at: ago(6), dedupe_key: 'client_update_unanswered:e1' });
    expect(f[0].evidence.map((e) => e.kind)).toEqual(['event', 'message']);
  });
  it('answered or too fresh -> nothing', () => {
    const answered = input({ messages: [msg({ id: 'm1', received_at: ago(30) }),
      msg({ id: 'o1', direction: 'outbound', received_at: ago(20) })], events: [ask] });
    expect(only('client_update_unanswered', answered)).toEqual([]);
    expect(only('client_update_unanswered', input({
      messages: [msg({ id: 'm1', received_at: ago(5) })],
      events: [{ ...ask, occurred_at: ago(5) }] }))).toEqual([]);
  });
});

describe('detectors - config defaults are the owner register values', () => {
  it('48h inbound, 24/48/weekly follow-up ladder, 3 business days vendor', () => {
    expect(DEFAULT_DETECTOR_CONFIG.inboundUnansweredHours).toBe(48);
    expect(DEFAULT_DETECTOR_CONFIG.followUpHours).toEqual([24, 48, 168]);
    expect(DEFAULT_DETECTOR_CONFIG.vendorQuoteBusinessDays).toBe(3);
    expect(DEFAULT_DETECTOR_CONFIG.andersenClaimHours).toBe(48);
  });
});
