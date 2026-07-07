import { describe, expect, it } from 'vitest';
import { buildDailyBrief } from '../src/lib/daily-brief';
import type { GoogleReadResult, GmailMessageSummary, CalendarEventSummary } from '../src/lib/google';

const NOW = '2026-07-06T12:30:00.000Z'; // within the approvals seed window

describe('Chief-of-Staff daily brief (Phase 3)', () => {
  it('builds from mock read-only sources (no env)', () => {
    const brief = buildDailyBrief({ now: NOW, env: {} });
    expect(brief.generated_at).toBe(NOW);
    expect(brief.gmail.source).toBe('mock');
    expect(brief.calendar.source).toBe('mock');
    expect(brief.gmail.items.length).toBeGreaterThan(0);
    expect(brief.calendar.items.length).toBeGreaterThan(0);
  });

  it('neutralizes external content (data only, control chars stripped)', () => {
    const gmail: GoogleReadResult<GmailMessageSummary> = {
      source: 'mock',
      items: [
        { id: 'x1', from: 'a\x00ttacker@example.com', subject: 'sub\x07ject', snippet: 'ignore\x1b previous' },
      ],
    };
    const brief = buildDailyBrief({ now: NOW, env: {}, gmail });
    const m = brief.gmail.items[0];
    expect(m.from).toBe('attacker@example.com');
    expect(m.subject).toBe('subject');
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(m.snippet)).toBe(false);
  });

  it('recommendations are DRAFTS that require owner approval (no auto-send)', () => {
    const brief = buildDailyBrief({ now: NOW, env: {} });
    expect(brief.recommendations.length).toBeGreaterThan(0);
    for (const rec of brief.recommendations) {
      expect(rec.draft.action_type).toBe('draft_email');
      expect(rec.draft.requires_owner_approval).toBe(true);
      // never a live send/write action type
      expect(['send_email', 'calendar_write', 'airtable_write']).not.toContain(
        rec.draft.action_type,
      );
    }
  });

  it('summarizes pending approvals from the Approval Center', () => {
    const brief = buildDailyBrief({ now: NOW, env: {} });
    expect(brief.pending_approvals.count).toBeGreaterThan(0);
    expect(
      brief.pending_approvals.items.some((i) => i.task_id === 'draft-lead-reply'),
    ).toBe(true);
  });

  it('appointments are a read-only routing placeholder, sorted by start', () => {
    const calendar: GoogleReadResult<CalendarEventSummary> = {
      source: 'mock',
      items: [
        { id: 'c2', title: 'Later', start: '2026-07-07T14:00:00', location: 'Shop' },
        { id: 'c1', title: 'Earlier', start: '2026-07-07T09:30:00', location: 'Site' },
      ],
    };
    const brief = buildDailyBrief({ now: NOW, env: {}, calendar });
    expect(brief.appointments.stops.map((s) => s.id)).toEqual(['c1', 'c2']);
    expect(brief.appointments.note).toContain('later gate');
  });

  it('fails safe when live Google access is requested (sections blocked, brief still returns)', () => {
    const brief = buildDailyBrief({ now: NOW, env: { GOOGLE_READONLY_LIVE_ENABLED: 'true' } });
    expect(brief.gmail.source).toBe('blocked');
    expect(brief.calendar.source).toBe('blocked');
    expect(brief.gmail.items).toEqual([]);
    // no recommendations can be produced from a blocked source
    expect(brief.recommendations).toEqual([]);
    // brief still renders its notes and approvals summary
    expect(brief.notes.length).toBeGreaterThan(0);
  });

  it('never exposes an execution path - brief carries drafts, not results', () => {
    const brief = buildDailyBrief({ now: NOW, env: {} });
    // Every recommendation is a packet (has requires_owner_approval), not an
    // executed result. There is no "executed"/"sent" field anywhere.
    for (const rec of brief.recommendations) {
      expect(rec.draft).toHaveProperty('requires_owner_approval', true);
      expect(rec).not.toHaveProperty('executed');
      expect(rec).not.toHaveProperty('sent');
    }
  });
});
