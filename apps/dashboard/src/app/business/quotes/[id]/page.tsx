import Link from 'next/link';
import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import {
  asNumber,
  asString,
  formatCents,
  formatMilliPct,
} from '@/lib/business/read-models';
import {
  BusinessShell,
  Card,
  EmptyNote,
  ErrorNote,
  FooterNote,
  LoginRequired,
  SimulationBadge,
  StatusBadge,
  Table,
  formatTimestamp,
} from '@/components/business/ui';

// Quote detail (Phase 6D): versions, line items, payment schedule,
// assumptions/exclusions, approval state, provenance. Read-only.
export const dynamic = 'force-dynamic';

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const { id } = await params;
  const { msg } = await searchParams;
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Quote Detail" />;
  const data = await loadBusinessData(ctx?.client ?? null);

  const quote = data.quotes.find((q) => asString(q.id) === id);
  if (!quote) {
    return (
      <BusinessShell title="Quote Detail" mode={data.mode}>
        <p className="rounded bg-amber-900 p-3 text-sm">
          Quote not found.{' '}
          <Link href="/business/quotes" className="underline">
            Back to quotes
          </Link>
          .
        </p>
      </BusinessShell>
    );
  }

  const versions = data.quoteVersions
    .filter((v) => asString(v.quote_id) === id)
    .sort((a, b) => asNumber(b.version) - asNumber(a.version));
  const client = data.clients.find(
    (c) => asString(c.id) === asString(quote.client_id),
  );
  const approval = data.approvals.find(
    (a) => asString(a.id) === asString(quote.approval_id),
  );

  return (
    <BusinessShell
      title={`Quote: ${asString(quote.title)}`}
      mode={data.mode}
    >
      {msg && (
        <p className="mb-4 rounded bg-slate-800 p-2 text-xs">
          agent result: {msg}
          {msg === 'duplicate' &&
            ' - this is the previously created draft for that form ' +
              'submission (idempotent replay). If you intended a NEW ' +
              'quote, reload the quotes page and submit again.'}
        </p>
      )}
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={asString(quote.status)} />
        <SimulationBadge />
        <span className="text-slate-400">
          client: {client ? asString(client.display_name) : 'unknown'}
        </span>
        <span className="text-slate-400">
          source: {asString(quote.source)}
        </span>
        <span className="text-xs text-slate-500">
          created {formatTimestamp(quote.created_at)}
        </span>
        {approval && (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
            approval: {asString(approval.decision)}
          </span>
        )}
        <Link
          href="/approvals"
          className="text-xs underline"
        >
          Approval Center
        </Link>
      </div>

      <EmptyNote
        show={versions.length === 0}
        text="No priced versions recorded for this quote."
      />

      {versions.map((v) => {
        const items = data.quoteItems
          .filter(
            (it) => asString(it.quote_version_id) === asString(v.id),
          )
          .sort((a, b) => asNumber(a.position) - asNumber(b.position));
        const schedule = v.payment_schedule as {
          schedule_type?: string;
          stages?: Array<{
            label?: string;
            amount_cents?: number;
          }>;
        } | null;
        const assumptions = Array.isArray(v.assumptions)
          ? (v.assumptions as unknown[])
          : [];
        const exclusions = Array.isArray(v.exclusions)
          ? (v.exclusions as unknown[])
          : [];
        return (
          <Card
            key={asString(v.id)}
            title={`Version ${asNumber(v.version)} - ${asString(
              v.scope_type,
            )} - ${asString(v.jurisdiction)}`}
            right={<SimulationBadge />}
          >
            {items.length > 0 && (
              <Table
                headers={[
                  'Opening',
                  'Description',
                  'Qty',
                  'Material',
                  'Labor',
                  'Fees',
                  'Line total',
                ]}
              >
                {items.map((it) => (
                  <tr
                    key={asString(it.id)}
                    className="border-t border-slate-800"
                  >
                    <td className="py-1 pr-3">
                      {asString(it.opening_label)}
                    </td>
                    <td className="py-1 pr-3">
                      {asString(it.description)}
                    </td>
                    <td className="py-1 pr-3">{asNumber(it.quantity)}</td>
                    <td className="py-1 pr-3">
                      {formatCents(it.unit_material_cents)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatCents(it.unit_labor_cents)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatCents(it.line_fees_cents)}
                    </td>
                    <td className="py-1 pr-3">
                      {formatCents(it.line_total_cents)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              <div>material: {formatCents(v.material_cents)}</div>
              <div>labor: {formatCents(v.labor_cents)}</div>
              <div>fees: {formatCents(v.fees_cents)}</div>
              <div>
                markup: {formatCents(v.markup_cents)} (
                {asString(v.markup_mode)})
              </div>
              <div>subtotal: {formatCents(v.subtotal_cents)}</div>
              <div>
                tax ({formatMilliPct(v.tax_rate_milli_pct)}):{' '}
                {formatCents(v.tax_cents)}
              </div>
              <div className="font-semibold">
                total: {formatCents(v.total_cents)}
              </div>
              <div>
                projected margin: {formatCents(v.margin_cents)}
              </div>
            </div>

            {schedule?.stages && (
              <div className="mt-3 text-sm">
                <span className="text-slate-400">
                  payment schedule ({asString(schedule.schedule_type)}):
                </span>{' '}
                {schedule.stages.map((s, i) => (
                  <span key={i} className="mr-3">
                    {String(s.label)}: {formatCents(s.amount_cents)}
                  </span>
                ))}
              </div>
            )}

            {assumptions.length > 0 && (
              <div className="mt-3 text-xs text-amber-300">
                assumptions:
                <ul className="ml-4 list-disc">
                  {assumptions.map((a, i) => (
                    <li key={i}>{String(a)}</li>
                  ))}
                </ul>
              </div>
            )}
            {exclusions.length > 0 && (
              <div className="mt-2 text-xs text-slate-400">
                exclusions:{' '}
                {exclusions.map((e) => String(e)).join('; ')}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              drafted by {asString(v.created_by)} at{' '}
              {formatTimestamp(v.created_at)} | correlation{' '}
              {asString(v.correlation_id)} | state{' '}
              {asString(v.simulation_state)} | owner confirmation
              required
            </p>
          </Card>
        );
      })}

      <FooterNote>
        This is a simulation draft, not a price commitment. Approving
        it in the Approval Center records a decision only; sending a
        quote to a client remains a manual owner action outside this
        system in V1.
      </FooterNote>
    </BusinessShell>
  );
}
