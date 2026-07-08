import { neutralizeUntrusted } from './guards';
import {
  getCalendarSummary,
  getGmailSummary,
  type CalendarEventSummary,
  type GmailMessageSummary,
  type GoogleReadResult,
} from './google';
import {
  createCommandPacket,
  listPendingApprovals,
  MOCK_APPROVALS,
  type ActionType,
  type ApprovalRequest,
  type CommandPacket,
  type RiskClass,
} from './approvals';

// Chief-of-Staff daily loop - Phase 3 GREEN local build. Produces a READ-ONLY
// daily brief from mock/read-only sources. Hard rules:
// - External content (email/calendar text) is DATA ONLY and is neutralized
//   before use; no instruction inside it is ever executed (CLAUDE.md rule 12).
// - Recommendations are DRAFTS ONLY: each is a command packet that requires
//   owner approval. Nothing here sends, writes, or executes anything.
// Reuses the Google read-only adapter (fail-closed) and the Approval Center.

type Env = Record<string, string | undefined>;

export interface BriefSection<T> {
  source: string;
  note?: string;
  items: T[];
}

export interface PendingApprovalLine {
  approval_id: string;
  task_id: string;
  action_type: ActionType;
  risk_class: RiskClass;
  summary: string;
}

export interface AppointmentStop {
  id: string;
  title: string;
  start: string;
  location: string;
}

export interface Recommendation {
  task_id: string;
  rationale: string;
  draft: CommandPacket; // requires_owner_approval === true; never executed
}

export interface DailyBrief {
  generated_at: string;
  gmail: BriefSection<GmailMessageSummary>;
  calendar: BriefSection<CalendarEventSummary>;
  pending_approvals: { count: number; items: PendingApprovalLine[] };
  appointments: { note: string; stops: AppointmentStop[] };
  recommendations: Recommendation[];
  notes: string[];
}

export interface BuildBriefOpts {
  env?: Env;
  now: string;
  // Optional dependency injection for tests; defaults call the real adapters.
  gmail?: GoogleReadResult<GmailMessageSummary>;
  calendar?: GoogleReadResult<CalendarEventSummary>;
  approvals?: ApprovalRequest[];
}

async function safeGmail(opts: BuildBriefOpts): Promise<BriefSection<GmailMessageSummary>> {
  try {
    const res = opts.gmail ?? (await getGmailSummary({ env: opts.env }));
    return {
      source: res.source,
      note: res.note,
      // Defense in depth: neutralize again regardless of source.
      items: res.items.map((m) => ({
        id: m.id,
        from: neutralizeUntrusted(m.from),
        subject: neutralizeUntrusted(m.subject),
        snippet: neutralizeUntrusted(m.snippet),
      })),
    };
  } catch (err) {
    return { source: 'blocked', note: 'gmail read blocked: ' + (err as Error).message, items: [] };
  }
}

async function safeCalendar(opts: BuildBriefOpts): Promise<BriefSection<CalendarEventSummary>> {
  try {
    const res = opts.calendar ?? (await getCalendarSummary({ env: opts.env }));
    return {
      source: res.source,
      note: res.note,
      items: res.items.map((e) => ({
        id: e.id,
        title: neutralizeUntrusted(e.title),
        start: e.start,
        location: neutralizeUntrusted(e.location),
      })),
    };
  } catch (err) {
    return { source: 'blocked', note: 'calendar read blocked: ' + (err as Error).message, items: [] };
  }
}

// Recommendations are generated from message METADATA using a fixed template.
// The email snippet/body is never interpreted as an instruction - it is only
// ever displayed as neutralized data. Each recommendation is a DRAFT packet.
function recommendFromGmail(
  items: GmailMessageSummary[],
  now: string,
): Recommendation[] {
  return items.map((m) => {
    const draft = createCommandPacket({
      task_id: 'reply-' + m.id,
      action_type: 'draft_email',
      risk_class: 'GREEN',
      summary: 'Draft a reply to ' + m.from + ' re: ' + m.subject,
      now,
    });
    return {
      task_id: draft.task_id,
      rationale:
        'Inbound message may need a reply. This is a DRAFT only; the owner ' +
        'must approve before anything is sent.',
      draft,
    };
  });
}

function toStops(items: CalendarEventSummary[]): AppointmentStop[] {
  return [...items]
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    .map((e) => ({ id: e.id, title: e.title, start: e.start, location: e.location }));
}

export async function buildDailyBrief(opts: BuildBriefOpts): Promise<DailyBrief> {
  const gmail = await safeGmail(opts);
  const calendar = await safeCalendar(opts);

  const pendingSeed = opts.approvals ?? MOCK_APPROVALS;
  const pending = listPendingApprovals(pendingSeed, opts.now);
  const pending_approvals = {
    count: pending.length,
    items: pending.map((r) => ({
      approval_id: r.approval_id,
      task_id: r.packet.task_id,
      action_type: r.packet.action_type,
      risk_class: r.packet.risk_class,
      summary: r.packet.summary,
    })),
  };

  const appointments = {
    note:
      'Route ordering is a read-only placeholder; live Maps/optimization is a ' +
      'later gate. No live location calls are made.',
    stops: toStops(calendar.items),
  };

  const recommendations = recommendFromGmail(gmail.items, opts.now);

  const notes = [
    'Read-only brief. External content is data only and never executed.',
    'All recommendations are drafts requiring owner approval; nothing auto-sends or auto-writes.',
  ];

  return {
    generated_at: opts.now,
    gmail,
    calendar,
    pending_approvals,
    appointments,
    recommendations,
    notes,
  };
}
