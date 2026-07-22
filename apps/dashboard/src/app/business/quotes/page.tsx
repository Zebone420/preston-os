import Link from 'next/link';
import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import {
  asNumber,
  asString,
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
  StatusBadge,
  Table,
  formatTimestamp,
} from '@/components/business/ui';
import { createBusinessClient } from '../actions';
import { QuoteForm } from './quote-form';

// Quote Management + quote-draft agent form (Phase 6D/6E).
// The form runs the SIMULATION-ONLY quote-draft agent: it validates,
// prices deterministically, stores a versioned draft, and creates an
// owner approval request. Nothing is sent to any client. Client
// quick-add lives here too so a fresh staging database is usable
// without leaving the product (staging-operational audit H1).
export const dynamic = 'force-dynamic';

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Quote Management" />;
  const data = await loadBusinessData(ctx?.client ?? null);

  const latestVersionByQuote = new Map<string, Record<string, unknown>>();
  for (const v of data.quoteVersions) {
    const qid = asString(v.quote_id);
    const existing = latestVersionByQuote.get(qid);
    if (!existing || asNumber(v.version) > asNumber(existing.version)) {
      latestVersionByQuote.set(qid, v);
    }
  }

  const opt = (rows: typeof data.clients, labelKey: string) =>
    rows.map((r) => ({
      id: asString(r.id),
      label: asString(r[labelKey]) || asString(r.id).slice(0, 8),
    }));

  return (
    <BusinessShell title="Quote Management" mode={data.mode}>
      {msg && (
        <p className="mb-4 rounded bg-slate-800 p-2 text-xs">{msg}</p>
      )}
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card
            title={`Quotes (${data.quotes.length})`}
            right={<SimulationBadge />}
          >
            <EmptyNote
              show={data.quotes.length === 0}
              text="No quotes yet. Draft one with the agent form."
            />
            {data.quotes.length > 0 && (
              <Table
                headers={[
                  'Title',
                  'Status',
                  'Version',
                  'Total',
                  'Updated',
                ]}
              >
                {data.quotes.map((q) => {
                  const v = latestVersionByQuote.get(asString(q.id));
                  return (
                    <tr
                      key={asString(q.id)}
                      className="border-t border-slate-800"
                    >
                      <td className="py-1 pr-3">
                        <Link
                          href={`/business/quotes/${asString(q.id)}`}
                          className="underline"
                        >
                          {asString(q.title)}
                        </Link>
                      </td>
                      <td className="py-1 pr-3">
                        <StatusBadge status={asString(q.status)} />
                      </td>
                      <td className="py-1 pr-3">
                        v{asNumber(q.current_version)}
                      </td>
                      <td className="py-1 pr-3">
                        {v ? formatCents(v.total_cents) : '-'}
                      </td>
                      <td className="py-1 pr-3 text-xs text-slate-400">
                        {formatTimestamp(q.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>

          <Card title="Add client (owner data entry)">
            {data.mode === 'setup' ? (
              <p className="text-xs text-amber-300">
                Setup mode: connect Supabase to add clients.
              </p>
            ) : (
              <form
                action={createBusinessClient}
                className="grid gap-2 text-sm sm:grid-cols-2"
              >
                <label className="block">
                  <span className="text-xs text-slate-400">
                    Client name *
                  </span>
                  <input
                    name="display_name"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Type</span>
                  <select
                    name="client_type"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  >
                    <option value="residential">residential</option>
                    <option value="commercial">commercial</option>
                    <option value="institution">institution</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Email</span>
                  <input
                    name="primary_email"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Phone</span>
                  <input
                    name="primary_phone"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-slate-400">Notes</span>
                  <input
                    name="notes"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  />
                </label>
                <div className="sm:col-span-2">
                  <button className="rounded bg-slate-700 px-3 py-1.5 text-sm">
                    Add client
                  </button>
                  <span className="ml-2 text-xs text-slate-500">
                    staging business record only - nothing external
                  </span>
                </div>
              </form>
            )}
          </Card>
        </div>

        <Card title="Quote-draft agent" right={<SimulationBadge />}>
          {data.mode === 'setup' ? (
            <p className="text-xs text-amber-300">
              Setup mode: the agent form needs the connected owner
              session. Fixture quotes above show the resulting shape.
            </p>
          ) : (
            <QuoteForm
              clients={opt(data.clients, 'display_name')}
              leads={opt(data.leads, 'display_name')}
              properties={opt(data.properties, 'address_line')}
              quotes={opt(data.quotes, 'title')}
            />
          )}
        </Card>
      </div>

      <FooterNote>
        Agent runs recorded: {data.quoteDraftRuns.length}. Every draft
        requires owner approval in the Approval Center before any
        follow-on step (and no follow-on step exists in V1).
      </FooterNote>
    </BusinessShell>
  );
}
