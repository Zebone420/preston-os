import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import {
  asString,
  buildMarginSummary,
  buildProjectPaymentSummary,
  formatCents,
} from '@/lib/business/read-models';
import {
  BusinessShell,
  Card,
  EmptyNote,
  ErrorNote,
  FooterNote,
  LoginRequired,
  SimulationBadge,
  Table,
  formatTimestamp,
} from '@/components/business/ui';

// Payment and Margin Visibility (Phase 6D). Read-only.
export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Payments and Margin" />;
  const data = await loadBusinessData(ctx?.client ?? null);

  const summaries = data.projects.map((p) => ({
    project: p,
    pay: buildProjectPaymentSummary(
      p,
      data.paymentSchedules,
      data.paymentEvents,
      data.quoteVersions,
    ),
  }));
  const margins = data.quoteVersions.map(buildMarginSummary);

  return (
    <BusinessShell title="Payments and Margin" mode={data.mode}>
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Project payments (${summaries.length})`}>
          <EmptyNote
            show={summaries.length === 0}
            text="No projects with payment data."
          />
          {summaries.length > 0 && (
            <Table
              headers={[
                'Project',
                'Contract',
                'Collected',
                'Outstanding',
                'Schedule',
              ]}
            >
              {summaries.map(({ project, pay }) => (
                <tr
                  key={pay.project_id}
                  className="border-t border-slate-800"
                >
                  <td className="py-1 pr-3">
                    {asString(project.title)}
                    {pay.overdue && (
                      <span className="ml-2 rounded bg-red-900 px-1.5 py-0.5 text-xs">
                        overdue
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(pay.contract_value_cents)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(pay.collected_cents)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(pay.outstanding_cents)}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    {pay.schedule_type || '-'}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Recorded payment events">
          <EmptyNote
            show={data.paymentEvents.length === 0}
            text="No payment events recorded."
          />
          <ul className="space-y-1 text-sm">
            {data.paymentEvents.map((e) => (
              <li key={asString(e.id)}>
                <span className="text-xs text-slate-500">
                  {formatTimestamp(e.created_at)}
                </span>{' '}
                {asString(e.kind)}: {formatCents(e.amount_cents)} (
                {asString(e.method) || 'unspecified'})
                {asString(e.note) && (
                  <span className="text-xs text-slate-400">
                    {' '}
                    - {asString(e.note)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title={`Quote margins (${margins.length} versions)`}
          right={<SimulationBadge />}
        >
          <EmptyNote
            show={margins.length === 0}
            text="No quote versions."
          />
          {margins.length > 0 && (
            <Table
              headers={[
                'Version',
                'Material',
                'Labor',
                'Fees',
                'Markup',
                'Tax',
                'Total',
                'Projected margin',
              ]}
            >
              {margins.map((m) => (
                <tr
                  key={m.quote_version_id}
                  className="border-t border-slate-800"
                >
                  <td className="py-1 pr-3 text-xs">
                    {m.quote_version_id.slice(0, 8)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(m.material_cents)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(m.labor_cents)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(m.fees_cents)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(m.markup_cents)}
                  </td>
                  <td className="py-1 pr-3">{formatCents(m.tax_cents)}</td>
                  <td className="py-1 pr-3">
                    {formatCents(m.total_cents)}
                  </td>
                  <td className="py-1 pr-3">
                    {formatCents(m.margin_cents)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-amber-300">
            Projected margin equals the explicit markup input only. A
            realized-margin cost model needs the V4 markup ruling and
            recorded actual costs (future gate).
          </p>
        </Card>
      </div>

      <FooterNote>
        Payment events are owner-recorded facts (append-only). No
        payment is ever collected, requested, or sent by this system.
      </FooterNote>
    </BusinessShell>
  );
}
