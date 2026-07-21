import Link from 'next/link';
import { randomUUID } from 'node:crypto';
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
import { createQuoteDraft } from '../actions';

// Quote Management + quote-draft agent form (Phase 6D/6E).
// The form runs the SIMULATION-ONLY quote-draft agent: it validates,
// prices deterministically, stores a versioned draft, and creates an
// owner approval request. Nothing is sent to any client.
export const dynamic = 'force-dynamic';

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; detail?: string }>;
}) {
  const { msg, detail } = await searchParams;
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

  return (
    <BusinessShell title="Quote Management" mode={data.mode}>
      {msg && (
        <p className="mb-4 rounded bg-slate-800 p-2 text-xs">
          agent result: {msg}
          {detail ? ` (${detail})` : ''}
        </p>
      )}
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Quotes (${data.quotes.length})`}>
          <EmptyNote
            show={data.quotes.length === 0}
            text="No quotes yet. Draft one with the agent form."
          />
          {data.quotes.length > 0 && (
            <Table
              headers={['Title', 'Status', 'Version', 'Total', 'Updated']}
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

        <Card
          title="Quote-draft agent"
          right={<SimulationBadge />}
        >
          {data.mode === 'setup' ? (
            <p className="text-xs text-amber-300">
              Setup mode: the agent form needs the connected owner
              session. Fixture quotes above show the resulting shape.
            </p>
          ) : (
            <form action={createQuoteDraft} className="space-y-2 text-sm">
              <input
                type="hidden"
                name="idempotency_key"
                value={randomUUID()}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-slate-400">Title *</span>
                  <input
                    name="title"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Client *</span>
                  <select
                    name="client_id"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  >
                    <option value="">select client</option>
                    {data.clients.map((c) => (
                      <option key={asString(c.id)} value={asString(c.id)}>
                        {asString(c.display_name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Scope *</span>
                  <select
                    name="scope_type"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  >
                    <option value="installation">
                      installation (50/25/25)
                    </option>
                    <option value="product_only">
                      product only (75/25)
                    </option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">
                    Jurisdiction *
                  </span>
                  <select
                    name="jurisdiction"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  >
                    <option value="NYC">NYC (8.875% tax)</option>
                    <option value="NJ">
                      NJ (6.625% - owner confirmation flagged)
                    </option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">
                    Quote-level fees ($)
                  </span>
                  <input
                    name="quote_fees"
                    inputMode="decimal"
                    className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">
                    Markup (V4 unverified - always flagged)
                  </span>
                  <div className="mt-0.5 flex gap-2">
                    <select
                      name="markup_mode"
                      className="w-1/2 rounded bg-slate-800 p-1.5"
                    >
                      <option value="none">none</option>
                      <option value="percent_milli">percent</option>
                      <option value="fixed_cents">fixed $</option>
                    </select>
                    <input
                      name="markup_percent"
                      placeholder="%"
                      inputMode="decimal"
                      className="w-1/4 rounded bg-slate-800 p-1.5"
                    />
                    <input
                      name="markup_fixed"
                      placeholder="$"
                      inputMode="decimal"
                      className="w-1/4 rounded bg-slate-800 p-1.5"
                    />
                  </div>
                </label>
              </div>

              <div className="mt-2 text-xs text-slate-400">
                Line items (up to 5; quantity, material $ and - for
                installation - labor $ are required; missing data fails
                closed and is reported, never guessed)
              </div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="grid grid-cols-6 gap-1">
                  <input
                    name={`item${i}_label`}
                    placeholder={`opening ${i}`}
                    className="rounded bg-slate-800 p-1.5"
                  />
                  <input
                    name={`item${i}_description`}
                    placeholder="description"
                    className="col-span-2 rounded bg-slate-800 p-1.5"
                  />
                  <input
                    name={`item${i}_quantity`}
                    placeholder="qty"
                    inputMode="numeric"
                    className="rounded bg-slate-800 p-1.5"
                  />
                  <input
                    name={`item${i}_material`}
                    placeholder="mat $"
                    inputMode="decimal"
                    className="rounded bg-slate-800 p-1.5"
                  />
                  <input
                    name={`item${i}_labor`}
                    placeholder="labor $"
                    inputMode="decimal"
                    className="rounded bg-slate-800 p-1.5"
                  />
                </div>
              ))}

              <label className="block">
                <span className="text-xs text-slate-400">
                  Exclusions (one per line)
                </span>
                <textarea
                  name="exclusions"
                  rows={2}
                  className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="st124" />
                Track ST-124 capital-improvement paperwork (no tax
                determination is made)
              </label>
              <button className="rounded bg-purple-900 px-3 py-1.5 text-sm">
                Run quote-draft agent (simulation)
              </button>
              <p className="text-xs text-slate-500">
                Produces a draft + owner approval request. Never sends a
                quote, never creates an invoice, never updates external
                systems. execution_eligible stays false.
              </p>
            </form>
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
