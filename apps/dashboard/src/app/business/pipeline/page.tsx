import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import { asString, buildPipeline } from '@/lib/business/read-models';
import { LEAD_STAGES } from '@/lib/business/types';
import {
  BusinessShell,
  Card,
  EmptyNote,
  ErrorNote,
  FooterNote,
  LoginRequired,
  formatTimestamp,
} from '@/components/business/ui';
import { createSalesLead, moveLeadStage } from '../actions';

// Sales Pipeline (Phase 6D). Stage board over sales_leads, plus
// owner data entry: add a lead and move a lead between stages
// (recorded staging facts only - nothing sends or executes).
export const dynamic = 'force-dynamic';

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Sales Pipeline" />;
  const data = await loadBusinessData(ctx?.client ?? null);
  const columns = buildPipeline(data.leads, LEAD_STAGES);
  const nonEmpty = columns.filter((c) => c.leads.length > 0);

  return (
    <BusinessShell title="Sales Pipeline" mode={data.mode}>
      {msg && (
        <p className="mb-4 rounded bg-slate-800 p-2 text-xs">{msg}</p>
      )}
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="mb-4">
        <Card title="Add lead (owner data entry)">
          {data.mode === 'setup' ? (
            <p className="text-xs text-amber-300">
              Setup mode: connect Supabase to add leads.
            </p>
          ) : (
            <form
              action={createSalesLead}
              className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5"
            >
              <label className="block lg:col-span-2">
                <span className="text-xs text-slate-400">
                  Lead name *
                </span>
                <input
                  name="display_name"
                  className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Stage</span>
                <select
                  name="stage"
                  className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                >
                  {LEAD_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">
                  Client (optional)
                </span>
                <select
                  name="client_id"
                  className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                >
                  <option value="">none</option>
                  {data.clients.map((c) => (
                    <option
                      key={asString(c.id)}
                      value={asString(c.id)}
                    >
                      {asString(c.display_name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Source</span>
                <input
                  name="lead_source"
                  placeholder="referral, website..."
                  className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                />
              </label>
              <label className="block sm:col-span-2 lg:col-span-4">
                <span className="text-xs text-slate-400">
                  Next action (optional)
                </span>
                <input
                  name="owner_next_action"
                  className="mt-0.5 w-full rounded bg-slate-800 p-1.5"
                />
              </label>
              <div className="self-end">
                <button className="rounded bg-slate-700 px-3 py-1.5 text-sm">
                  Add lead
                </button>
              </div>
            </form>
          )}
        </Card>
      </div>

      <EmptyNote
        show={data.leads.length === 0}
        text="No leads recorded yet."
      />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        {columns.map((col) => (
          <Card
            key={col.stage}
            title={`${col.stage} (${col.leads.length})`}
          >
            <EmptyNote show={col.leads.length === 0} text="-" />
            <ul className="space-y-2 text-sm">
              {col.leads.map((l) => (
                <li
                  key={asString(l.id)}
                  className="rounded border border-slate-800 p-2"
                >
                  <div>{asString(l.display_name)}</div>
                  <div className="text-xs text-slate-400">
                    source: {asString(l.lead_source) || 'unknown'} |
                    since{' '}
                    {formatTimestamp(l.stage_changed_at) || 'unknown'}
                  </div>
                  {asString(l.owner_next_action) && (
                    <div className="text-xs text-amber-300">
                      next: {asString(l.owner_next_action)}
                    </div>
                  )}
                  {data.mode === 'connected' && (
                    <form
                      action={moveLeadStage}
                      className="mt-1 flex items-center gap-1"
                    >
                      <input
                        type="hidden"
                        name="lead_id"
                        value={asString(l.id)}
                      />
                      <input
                        type="hidden"
                        name="from_stage"
                        value={col.stage}
                      />
                      <select
                        name="to_stage"
                        defaultValue={col.stage}
                        className="rounded bg-slate-800 p-1 text-xs"
                      >
                        {LEAD_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button className="rounded bg-slate-700 px-2 py-1 text-xs">
                        Move
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <FooterNote>
        {nonEmpty.length} of {LEAD_STAGES.length} stages populated.
        Adding and moving leads records staging data with an activity
        entry; nothing is sent and nothing executes.
      </FooterNote>
    </BusinessShell>
  );
}
