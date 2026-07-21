import Link from 'next/link';
import {
  MOCK_APPROVALS,
  resolveStatus,
  type ApprovalStatus,
  type RiskClass,
} from '@/lib/approvals';
import {
  interpretApprovalsError,
  listApprovalRows,
  type ApprovalRow,
  type ControlPlaneClient,
} from '@/lib/approvals-store';
import { getServerSupabase } from '@/lib/supabase/server';
import {
  BUSINESS_TABLES,
  listBusinessRows,
} from '@/lib/business/business-store';
import type { RuntimeClient } from '@/lib/ai-os/store';
import { decideApproval } from './actions';

// Approval Center - Gate 3 control-plane wiring.
// Setup mode (no Supabase env): MOCK rows, INERT buttons, exactly as in
// the Phase 2 foundation - nothing changed in the fail-closed posture.
// Connected mode (owner logged in, RLS-bound): real `approvals` rows
// from Supabase staging; Approve/Reject record an owner DECISION in the
// control plane and execute NOTHING (see lib/approvals-store.ts and the
// evaluateExecution guard, which still blocks every live action type).

export const dynamic = 'force-dynamic';

const RISK_STYLE: Record<RiskClass, string> = {
  GREEN: 'bg-emerald-900',
  YELLOW: 'bg-amber-900',
  RED: 'bg-red-900',
  BLACK: 'bg-slate-700',
};

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-900',
  approved: 'bg-emerald-900',
  rejected: 'bg-red-900',
  expired: 'bg-slate-700',
  blocked: 'bg-red-950',
};

const MSG_TEXT: Record<string, string> = {
  decided: 'Decision recorded. Nothing was executed.',
  setup_mode: 'Setup mode: Supabase env is not configured.',
  denied: 'Denied: owner login required.',
  invalid: 'Invalid request.',
  invalid_decision: 'Invalid decision value.',
  invalid_id: 'Invalid approval id.',
  not_pending: 'Approval not found or no longer pending; nothing changed.',
  write_failed: 'Decision write failed; nothing changed.',
  audit_failed: 'Decision recorded but the audit write FAILED - investigate.',
};

function riskStyle(actionClass: string): string {
  return RISK_STYLE[actionClass as RiskClass] ?? 'bg-slate-700';
}

function statusStyle(decision: string): string {
  const map: Record<string, string> = {
    pending: STATUS_STYLE.pending,
    approved: STATUS_STYLE.approved,
    rejected: STATUS_STYLE.rejected,
    expired: STATUS_STYLE.expired,
  };
  return map[decision] ?? 'bg-slate-700';
}

function MockTable() {
  const now = new Date().toISOString();
  const rows = MOCK_APPROVALS.map((r) => ({
    req: r,
    status: resolveStatus(r, now),
  }));
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-400">
        <tr>
          <th className="p-2">Task</th>
          <th className="p-2">Action</th>
          <th className="p-2">Risk</th>
          <th className="p-2">Status</th>
          <th className="p-2">Summary</th>
          <th className="p-2">Created</th>
          <th className="p-2">Decision</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ req, status }) => (
          <tr
            key={req.approval_id}
            className="border-t border-slate-800 align-top"
          >
            <td className="p-2 text-slate-300">{req.packet.task_id}</td>
            <td className="p-2">{req.packet.action_type}</td>
            <td className="p-2">
              <span
                className={
                  'rounded px-2 py-0.5 text-xs ' +
                  RISK_STYLE[req.packet.risk_class]
                }
              >
                {req.packet.risk_class}
              </span>
            </td>
            <td className="p-2">
              <span
                className={'rounded px-2 py-0.5 text-xs ' + STATUS_STYLE[status]}
              >
                {status}
              </span>
            </td>
            <td className="p-2 text-slate-400">{req.packet.summary}</td>
            <td className="p-2 text-slate-500">{req.created_at}</td>
            <td className="p-2">
              <span className="flex gap-2">
                <button
                  disabled
                  title="Inert placeholder - setup mode has no write path"
                  className="cursor-not-allowed rounded bg-emerald-950 px-2 py-0.5 text-xs text-slate-500"
                >
                  Approve
                </button>
                <button
                  disabled
                  title="Inert placeholder - setup mode has no write path"
                  className="cursor-not-allowed rounded bg-red-950 px-2 py-0.5 text-xs text-slate-500"
                >
                  Reject
                </button>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface LinkRow {
  entity_type: string;
  entity_id: string;
  link_kind: string;
}

// Business-entity context for an approval (Phase 6F). Metadata only:
// a link never changes what approval decisions do (record-only).
function LinkedEntities({ links }: { links: LinkRow[] }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-1 text-xs text-slate-500">
      {links.map((l) =>
        l.entity_type === 'quote' ? (
          <Link
            key={l.entity_type + l.entity_id}
            href={`/business/quotes/${l.entity_id}`}
            className="mr-2 underline"
          >
            view quote draft
          </Link>
        ) : (
          <span key={l.entity_type + l.entity_id} className="mr-2">
            {l.link_kind}: {l.entity_type} {l.entity_id.slice(0, 8)}
          </span>
        ),
      )}
    </div>
  );
}

function LiveTable({
  rows,
  linksByApproval,
}: {
  rows: ApprovalRow[];
  linksByApproval: Map<string, LinkRow[]>;
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-400">
        <tr>
          <th className="p-2">Requested action</th>
          <th className="p-2">Risk</th>
          <th className="p-2">Decision</th>
          <th className="p-2">Decided at</th>
          <th className="p-2">Notes</th>
          <th className="p-2">Created</th>
          <th className="p-2">Decide</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-slate-800 align-top">
            <td className="p-2 text-slate-300">
              {row.requested_action}
              <LinkedEntities
                links={linksByApproval.get(row.id) ?? []}
              />
            </td>
            <td className="p-2">
              <span
                className={
                  'rounded px-2 py-0.5 text-xs ' + riskStyle(row.action_class)
                }
              >
                {row.action_class}
              </span>
            </td>
            <td className="p-2">
              <span
                className={
                  'rounded px-2 py-0.5 text-xs ' + statusStyle(row.decision)
                }
              >
                {row.decision}
              </span>
            </td>
            <td className="p-2 text-slate-500">{row.decision_at ?? '-'}</td>
            <td className="p-2 text-slate-400">{row.notes ?? ''}</td>
            <td className="p-2 text-slate-500">{row.created_at}</td>
            <td className="p-2">
              {row.decision === 'pending' ? (
                <form action={decideApproval} className="flex gap-2">
                  <input type="hidden" name="approval_id" value={row.id} />
                  <button
                    type="submit"
                    name="decision"
                    value="approved"
                    className="rounded bg-emerald-800 px-2 py-0.5 text-xs hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="rejected"
                    className="rounded bg-red-800 px-2 py-0.5 text-xs hover:bg-red-700"
                  >
                    Reject
                  </button>
                </form>
              ) : (
                <span className="text-xs text-slate-500">decided</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const supabase = (await getServerSupabase()) as unknown as
    | ControlPlaneClient
    | null;

  let live: { rows: ApprovalRow[]; error?: string } | null = null;
  const linksByApproval = new Map<string, LinkRow[]>();
  if (supabase) {
    live = await listApprovalRows(supabase);
    const linkRows = await listBusinessRows(
      supabase as unknown as RuntimeClient,
      BUSINESS_TABLES.approvalLinks,
      { limit: 200 },
    );
    for (const raw of linkRows.rows) {
      const approvalId = String(raw.approval_id ?? '');
      if (!approvalId) continue;
      const list = linksByApproval.get(approvalId) ?? [];
      list.push({
        entity_type: String(raw.entity_type ?? ''),
        entity_id: String(raw.entity_id ?? ''),
        link_kind: String(raw.link_kind ?? ''),
      });
      linksByApproval.set(approvalId, list);
    }
  }

  const banner = msg ? MSG_TEXT[msg] : undefined;
  const errorHint = live?.error ? interpretApprovalsError(live.error) : undefined;

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Approval Center</h1>
        <nav className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-300 underline">
            Dashboard
          </Link>
          <Link href="/business" className="text-sm text-slate-300 underline">
            Business
          </Link>
          <Link href="/audit" className="text-sm text-slate-300 underline">
            Audit View
          </Link>
          <span className="rounded bg-amber-900 px-2 py-1 text-xs">
            {supabase
              ? 'CONTROL PLANE - decisions only, no execution'
              : 'SETUP MODE - fail-closed, no execution'}
          </span>
        </nav>
      </header>

      {banner && (
        <p className="mb-4 rounded bg-slate-800 p-3 text-xs text-amber-300">
          {banner}
        </p>
      )}

      <p className="mb-4 rounded bg-slate-900 p-3 text-xs text-slate-400">
        {supabase
          ? 'SUPABASE STAGING control plane. Approve / Reject record an ' +
            'owner decision only. No decision here sends, writes to any ' +
            'business system, or executes anything: every live action ' +
            'type is blocked by the fail-closed execution guard.'
          : 'MOCK data. Every action requires an explicit owner approval ' +
            'and nothing executes a live send or write. Approve / Reject ' +
            'buttons below are inert placeholders.'}
      </p>

      <div className="overflow-x-auto">
        {live ? (
          live.error ? (
            <div className="rounded bg-red-950 p-3 text-xs">
              <p>{live.error}</p>
              {errorHint && <p className="mt-1 text-amber-300">{errorHint}</p>}
            </div>
          ) : live.rows.length === 0 ? (
            <p className="rounded bg-slate-900 p-3 text-xs text-slate-400">
              No approval rows in the control plane yet.
            </p>
          ) : (
            <LiveTable rows={live.rows} linksByApproval={linksByApproval} />
          )
        ) : (
          <MockTable />
        )}
      </div>
    </main>
  );
}
