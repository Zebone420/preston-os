import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import { asString } from '@/lib/business/read-models';
import {
  BusinessShell,
  Card,
  EmptyNote,
  ErrorNote,
  FooterNote,
  LoginRequired,
  StatusBadge,
  Table,
  formatTimestamp,
} from '@/components/business/ui';

// Business Activity Ledger + Unified Communication History (Phase 6D).
// Both are read-only. The ledger is append-only at the DB level.
export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Activity Ledger" />;
  const data = await loadBusinessData(ctx?.client ?? null);

  return (
    <BusinessShell title="Activity and Communications" mode={data.mode}>
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Activity ledger (${data.activity.length})`}>
          <EmptyNote
            show={data.activity.length === 0}
            text="No activity events recorded."
          />
          {data.activity.length > 0 && (
            <Table headers={['When', 'Entity', 'Action', 'Summary', 'Actor']}>
              {data.activity.map((a) => (
                <tr
                  key={asString(a.id)}
                  className="border-t border-slate-800"
                >
                  <td className="py-1 pr-3 text-xs text-slate-400">
                    {formatTimestamp(a.created_at)}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    {asString(a.entity_type)}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    {asString(a.action)}
                    {asString(a.simulation_state) === 'simulation' && (
                      <span className="ml-1 rounded bg-purple-900 px-1 py-0.5 text-xs">
                        sim
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3">{asString(a.summary)}</td>
                  <td className="py-1 pr-3 text-xs">
                    {asString(a.actor)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title={`Communications (${data.communications.length})`}
        >
          <EmptyNote
            show={data.communications.length === 0}
            text="No communications recorded."
          />
          <ul className="space-y-2 text-sm">
            {data.communications.map((c) => (
              <li
                key={asString(c.id)}
                className="rounded border border-slate-800 p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                    {asString(c.channel)}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                    {asString(c.direction)}
                  </span>
                  <StatusBadge status={asString(c.message_state)} />
                  <span className="text-xs text-slate-500">
                    {formatTimestamp(c.occurred_at)}
                  </span>
                </div>
                <div className="mt-1">{asString(c.subject)}</div>
                <div className="text-xs text-slate-400">
                  {asString(c.summary)}
                </div>
                {asString(c.direction) === 'outbound_draft' && (
                  <div className="mt-1 text-xs text-amber-300">
                    DRAFT - never sent by this system; sending stays a
                    manual owner action in V1.
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <FooterNote>
        The activity ledger is append-only (no update/delete
        privileges). Communications have no sent state in V1:
        directions are inbound or outbound_draft only.
      </FooterNote>
    </BusinessShell>
  );
}
