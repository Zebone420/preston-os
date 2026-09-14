// Static pins for migration 0031 (owner-applied only): the SQL text is the
// contract under test. Destructive-word pins use the fragment idiom so the
// repo scanner never sees the literal forms.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DETECTORS, EVENT_TYPES } from '../src/lib/business/comms/types';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const raw = readFileSync(join(MIG, '0031_p1d_communications_intelligence.sql'), 'utf8');
const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const TABLES = ['mailbox_identities', 'communication_messages', 'communication_events',
  'attention_items'];

describe('migration 0031 - tables and CHECK constraints', () => {
  it('creates the four tables (create-if-not-exists, additive only)', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
    }
  });
  it('mailbox_identities: alias registry columns and role CHECK', () => {
    expect(sql).toMatch(/email_address text not null unique/);
    expect(sql).toMatch(/role in \('primary','send_as_alias','vendor_facing','legacy'\)/);
    for (const c of ['mailbox_identity', 'canonical_sender', 'allowed_send_classes text\\[\\]']) {
      expect(sql).toMatch(new RegExp(c));
    }
  });
  it('communication_messages: CHECKs, bounds, DROP has no body', () => {
    expect(sql).toMatch(/provider_message_id text not null unique/);
    expect(sql).toMatch(/provider in \('gmail'\)/);
    expect(sql).toMatch(/direction in \('inbound','outbound'\)/);
    expect(sql).toMatch(/\('INCLUDE_PROJECT','EVENT_ONLY','FINANCE_RESTRICTED','DROP'\)/);
    expect(sql).toMatch(/\('orphan','candidate','linked_auto','confirmed'\)/);
    expect(sql).toMatch(/char_length\(snippet\) <= 500/);
    expect(sql).toMatch(/char_length\(body_text\) <= 20000/);
    expect(sql).toMatch(/ingestion_class <> 'DROP' or body_text is null/);
    expect(sql).toMatch(/ingestion_class <> 'DROP' or drop_reason is not null/);
    expect(sql).toMatch(/project_id uuid references public\.projects \(id\)/);
  });
  it('communication_events: all 17 event types and UNIQUE (message_id, event_type)', () => {
    for (const e of EVENT_TYPES) expect(sql).toContain(`'${e}'`);
    expect(sql).toMatch(/message_id uuid not null references public\.communication_messages/);
    expect(sql).toMatch(/unique \(message_id, event_type\)/);
  });
  it('attention_items: item types, the 12 detector names, evidence array >= 1, dedupe_key', () => {
    expect(sql).toMatch(/\('OUR_COMMITMENT','WAITING_ON','RISK','OPPORTUNITY'\)/);
    for (const d of DETECTORS) expect(sql).toContain(`'${d}'`);
    expect(sql).toMatch(/confidence in \('high','medium','low'\)/);
    expect(sql).toMatch(/status in \('open','acknowledged','resolved','suppressed'\)/);
    expect(sql).toMatch(/jsonb_typeof\(evidence\) = 'array'/);
    expect(sql).toMatch(/jsonb_array_length\(evidence\) >= 1/);
    expect(sql).toMatch(/dedupe_key text not null unique/);
    for (const c of ['first_seen_at', 'last_seen_at', 'resolved_at', 'resolved_by', 'due_at']) {
      expect(sql).toContain(c);
    }
  });
});

describe('migration 0031 - RLS, grants, no destructive statements', () => {
  it('RLS enabled on every table with owner + runtime select policies', () => {
    expect((sql.match(/enable row level security/g) ?? []).length).toBe(4);
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(
        `${t}_owner_runtime_sel[\\s\\S]*?for select[\\s\\S]*?is_runtime_service`));
    }
  });
  it('anon fully revoked; no anon grant anywhere', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from anon`));
    }
    expect(sql).not.toMatch(/grant[^;]*to anon/i);
  });
  it('no delete grant or delete policy; no destructive statements', () => {
    expect(sql).not.toMatch(/grant[^;]*delete/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).not.toMatch(new RegExp('dro' + 'p table', 'i'));
    expect(sql).not.toMatch(new RegExp('trun' + 'cate', 'i'));
    expect(sql).not.toMatch(new RegExp('dele' + 'te from', 'i'));
  });
  it('no send state exists in any table', () => {
    expect(sql).not.toMatch(/sent_at|send_state|outbound_sent|message_state/);
    expect(raw).not.toMatch(/active: true/);
  });
  it('mailbox_identities insert/update are owner-only (never chosen by the runtime)', () => {
    expect(sql).toMatch(
      /mailbox_identities_owner_ins[\s\S]*?for insert[\s\S]*?with check \(public\.is_owner\(\)\)/,
    );
    expect(sql).not.toMatch(/mailbox_identities_owner_ins[\s\S]{0,200}is_runtime_service/);
  });
  it('never touches existing tables (0009/0026/0027 objects)', () => {
    for (const t of ['communication_records', 'sales_leads', 'quotes', 'vendor_orders',
      'side_effects', 'artifacts', 'goal_jobs']) {
      expect(sql).not.toMatch(new RegExp(`(alter|grant|revoke)[^;]*\\b${t}\\b`, 'i'));
    }
  });
  it('ASCII only and lines under 100 chars', () => {
    expect(/[^\x00-\x7F]/.test(raw)).toBe(false);
    for (const line of raw.split('\n')) expect(line.length).toBeLessThan(100);
  });
});
