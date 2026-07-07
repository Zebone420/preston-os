import Link from 'next/link';
import {
  MOCK_APPROVALS,
  resolveStatus,
  type ApprovalStatus,
  type RiskClass,
} from '@/lib/approvals';

// Approval Center - Phase 2 GREEN local foundation (read-only, fail-closed).
// Shows command packets awaiting owner decision. Approve/Reject controls are
// INERT placeholders: no execution path exists here. Nothing sends or writes.

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

export default function ApprovalsPage() {
  const now = new Date().toISOString();
  const rows = MOCK_APPROVALS.map((r) => ({ req: r, status: resolveStatus(r, now) }));

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Approval Center</h1>
        <nav className="flex items-center gap-3">
          <Link href="/" className="text-sm text-slate-300 underline">
            Dashboard
          </Link>
          <Link href="/audit" className="text-sm text-slate-300 underline">
            Audit View
          </Link>
          <span className="rounded bg-amber-900 px-2 py-1 text-xs">
            PHASE 2 - fail-closed, no execution
          </span>
        </nav>
      </header>

      <p className="mb-4 rounded bg-slate-900 p-3 text-xs text-slate-400">
        MOCK data. Every action requires an explicit owner approval and nothing
        executes a live send or write in Phase 2. Approve / Reject buttons below
        are inert placeholders.
      </p>

      <div className="overflow-x-auto">
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
              <tr key={req.approval_id} className="border-t border-slate-800 align-top">
                <td className="p-2 text-slate-300">{req.packet.task_id}</td>
                <td className="p-2">{req.packet.action_type}</td>
                <td className="p-2">
                  <span
                    className={
                      'rounded px-2 py-0.5 text-xs ' + RISK_STYLE[req.packet.risk_class]
                    }
                  >
                    {req.packet.risk_class}
                  </span>
                </td>
                <td className="p-2">
                  <span className={'rounded px-2 py-0.5 text-xs ' + STATUS_STYLE[status]}>
                    {status}
                  </span>
                </td>
                <td className="p-2 text-slate-400">{req.packet.summary}</td>
                <td className="p-2 text-slate-500">{req.created_at}</td>
                <td className="p-2">
                  <span className="flex gap-2">
                    <button
                      disabled
                      title="Inert placeholder - no execution in Phase 2"
                      className="cursor-not-allowed rounded bg-emerald-950 px-2 py-0.5 text-xs text-slate-500"
                    >
                      Approve
                    </button>
                    <button
                      disabled
                      title="Inert placeholder - no execution in Phase 2"
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
      </div>
    </main>
  );
}
