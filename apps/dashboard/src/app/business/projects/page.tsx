import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import { asBool, asString } from '@/lib/business/read-models';
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

// Project Operations + Orders + Installations (Phase 6D). Read-only.
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Project Operations" />;
  const data = await loadBusinessData(ctx?.client ?? null);

  return (
    <BusinessShell title="Project Operations" mode={data.mode}>
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}
      <EmptyNote
        show={data.projects.length === 0}
        text="No projects recorded yet."
      />

      {data.projects.map((p) => {
        const pid = asString(p.id);
        const milestones = data.milestones.filter(
          (m) => asString(m.project_id) === pid,
        );
        const orders = data.vendorOrders.filter(
          (o) => asString(o.project_id) === pid,
        );
        const installs = data.installationEvents.filter(
          (e) => asString(e.project_id) === pid,
        );
        return (
          <div key={pid} className="mb-4">
            <Card
              title={asString(p.title)}
              right={<StatusBadge status={asString(p.status)} />}
            >
              <p className="mb-2 text-xs text-slate-400">
                contract: {asString(p.contract_status)} | deposit:{' '}
                {asString(p.deposit_status)} | updated{' '}
                {formatTimestamp(p.updated_at)}
              </p>

              <div className="grid gap-4 lg:grid-cols-3">
                <div>
                  <h3 className="mb-1 text-sm text-slate-400">
                    Milestones ({milestones.length})
                  </h3>
                  <EmptyNote
                    show={milestones.length === 0}
                    text="No milestones."
                  />
                  <ul className="space-y-1 text-sm">
                    {milestones.map((m) => (
                      <li
                        key={asString(m.id)}
                        className="flex items-center gap-2"
                      >
                        <StatusBadge status={asString(m.status)} />
                        <span>{asString(m.kind)}</span>
                        {asString(m.due_date) && (
                          <span className="text-xs text-slate-500">
                            due {asString(m.due_date)}
                          </span>
                        )}
                        {asString(m.note) && (
                          <span className="text-xs text-slate-400">
                            {asString(m.note)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-1 text-sm text-slate-400">
                    Vendor orders ({orders.length})
                  </h3>
                  <EmptyNote show={orders.length === 0} text="No orders." />
                  {orders.length > 0 && (
                    <Table headers={['Order', 'Vendor', 'Status', 'Ship']}>
                      {orders.map((o) => (
                        <tr
                          key={asString(o.id)}
                          className="border-t border-slate-800"
                        >
                          <td className="py-1 pr-3">
                            {asString(o.order_number) || '-'}
                          </td>
                          <td className="py-1 pr-3">
                            {asString(o.vendor)}
                          </td>
                          <td className="py-1 pr-3">
                            <StatusBadge
                              status={asString(o.delivery_status)}
                            />
                            {asBool(o.backordered) && (
                              <span className="ml-1 rounded bg-red-900 px-1.5 py-0.5 text-xs">
                                backorder
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-xs">
                            exp {asString(o.expected_ship_date) || '?'}
                            {asString(o.actual_ship_date) &&
                              ` / act ${asString(o.actual_ship_date)}`}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </div>

                <div>
                  <h3 className="mb-1 text-sm text-slate-400">
                    Installations ({installs.length})
                  </h3>
                  <EmptyNote
                    show={installs.length === 0}
                    text="No installation events."
                  />
                  <ul className="space-y-1 text-sm">
                    {installs.map((e) => (
                      <li key={asString(e.id)}>
                        <StatusBadge status={asString(e.status)} />{' '}
                        {asString(e.scheduled_date) || 'no date'} | crew:{' '}
                        {asString(e.crew) || '?'} | site{' '}
                        {asBool(e.site_ready) ? 'ready' : 'NOT ready'}
                        {asString(e.note) && (
                          <div className="text-xs text-slate-400">
                            {asString(e.note)}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </div>
        );
      })}

      <FooterNote>
        Read-only operational view. Status changes are owner data
        entry or future owner-approved data-change proposals.
      </FooterNote>
    </BusinessShell>
  );
}
