import Link from 'next/link';
import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import {
  assessStaleness,
  asString,
  buildExecutiveSummary,
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
  StatTile,
  formatTimestamp,
} from '@/components/business/ui';
import { decideRecommendation, refreshRecommendations } from './actions';

// Executive Dashboard (Phase 6D). Read-oriented; the only actions are
// acknowledge/dismiss on recommendations (recorded decisions - nothing
// executes). Simulation output is always labeled.
export const dynamic = 'force-dynamic';

export default async function BusinessOverview({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) {
    return <LoginRequired title="Business Command Center" />;
  }

  const data = await loadBusinessData(ctx?.client ?? null);
  const nowIso = new Date().toISOString();
  // Outstanding money is aggregated over ACTIVE projects only;
  // closed/cancelled project balances live on /business/payments.
  const activeProjects = data.projects.filter((p) =>
    [
      'pending_contract',
      'contracted',
      'in_progress',
      'punch_list',
      'final_inspection',
    ].includes(asString(p.status)),
  );
  const paymentSummaries = activeProjects.map((p) =>
    buildProjectPaymentSummary(
      p,
      data.paymentSchedules,
      data.paymentEvents,
      data.quoteVersions,
    ),
  );
  const summary = buildExecutiveSummary({
    leads: data.leads,
    quotes: data.quotes,
    projects: data.projects,
    vendorOrders: data.vendorOrders,
    installationEvents: data.installationEvents,
    paymentSummaries,
    approvals: data.approvals,
    recommendations: data.recommendations,
    milestones: data.milestones,
  });
  const staleness = assessStaleness(
    [
      ...data.activity,
      ...data.leads,
      ...data.quotes,
      ...data.projects,
      ...data.paymentEvents,
      ...data.communications,
    ],
    nowIso,
    24 * 7,
  );
  const hasAnyRecord = staleness.latest_iso !== '';
  const openRecs = data.recommendations.filter(
    (r) => asString(r.status) === 'open',
  );
  const recentActivity = data.activity.slice(0, 8);

  return (
    <BusinessShell title="Business Command Center" mode={data.mode}>
      {msg && (
        <p className="mb-4 rounded bg-slate-800 p-2 text-xs">
          action result: {msg}
        </p>
      )}
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Active leads" value={String(summary.active_leads)} />
        <StatTile label="Open quotes" value={String(summary.open_quotes)} />
        <StatTile label="Won jobs" value={String(summary.won_jobs)} tone="ok" />
        <StatTile
          label="Active projects"
          value={String(summary.active_projects)}
        />
        <StatTile
          label="Pending orders"
          value={String(summary.pending_orders)}
        />
        <StatTile
          label="Upcoming installs"
          value={String(summary.upcoming_installations)}
        />
        <StatTile
          label="Outstanding"
          value={formatCents(summary.outstanding_cents)}
          tone={summary.outstanding_cents > 0 ? 'warn' : 'ok'}
        />
        <StatTile
          label="Pending approvals"
          value={String(summary.pending_approvals)}
          tone={summary.pending_approvals > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Agent alerts"
          value={String(summary.open_recommendations)}
          tone={summary.open_recommendations > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Exceptions"
          value={String(summary.operational_exceptions)}
          tone={summary.operational_exceptions > 0 ? 'bad' : 'ok'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={`AI recommendations (${openRecs.length} open)`}
          right={<SimulationBadge />}
        >
          {data.mode === 'connected' && (
            <form action={refreshRecommendations} className="mb-3">
              <button className="rounded bg-slate-700 px-2 py-1 text-xs">
                Generate recommendations now
              </button>
              <span className="ml-2 text-xs text-slate-500">
                runs the advice rules over current data; advice only
              </span>
            </form>
          )}
          <EmptyNote
            show={openRecs.length === 0}
            text="No open recommendations."
          />
          <ul className="space-y-3 text-sm">
            {openRecs.map((r) => (
              <li
                key={asString(r.id) || asString(r.idempotency_key)}
                className="rounded border border-slate-800 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">
                    {asString(r.kind)}
                  </span>
                  <span className="text-xs text-slate-400">
                    confidence: {asString(r.confidence)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatTimestamp(r.created_at)}
                  </span>
                </div>
                <p className="mt-1">{asString(r.suggested_next_step)}</p>
                <details className="mt-1 text-xs text-slate-400">
                  <summary>evidence and assumptions</summary>
                  <ul className="ml-4 list-disc">
                    {(Array.isArray(r.evidence) ? r.evidence : []).map(
                      (e, i) => (
                        <li key={i}>{String(e)}</li>
                      ),
                    )}
                    {(Array.isArray(r.assumptions)
                      ? r.assumptions
                      : []
                    ).map((a, i) => (
                      <li key={`a${i}`} className="text-slate-500">
                        assumption: {String(a)}
                      </li>
                    ))}
                  </ul>
                </details>
                {data.mode === 'connected' && (
                  <div className="mt-2 flex gap-2">
                    <form action={decideRecommendation}>
                      <input
                        type="hidden"
                        name="recommendation_id"
                        value={asString(r.id)}
                      />
                      <input
                        type="hidden"
                        name="decision"
                        value="acknowledged"
                      />
                      <button className="rounded bg-emerald-900 px-2 py-1 text-xs">
                        Acknowledge
                      </button>
                    </form>
                    <form action={decideRecommendation}>
                      <input
                        type="hidden"
                        name="recommendation_id"
                        value={asString(r.id)}
                      />
                      <input
                        type="hidden"
                        name="decision"
                        value="dismissed"
                      />
                      <button className="rounded bg-slate-700 px-2 py-1 text-xs">
                        Dismiss
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recent business activity">
          <EmptyNote
            show={recentActivity.length === 0}
            text="No activity recorded yet."
          />
          <ul className="space-y-2 text-sm text-slate-300">
            {recentActivity.map((a) => (
              <li key={asString(a.id)}>
                <span className="text-xs text-slate-500">
                  {formatTimestamp(a.created_at)}
                </span>{' '}
                {asString(a.summary)}
                {asString(a.simulation_state) === 'simulation' && (
                  <span className="ml-2 rounded bg-purple-900 px-1.5 py-0.5 text-xs">
                    sim
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            <Link href="/business/activity" className="underline">
              Full activity ledger
            </Link>
          </p>
        </Card>
      </div>

      <FooterNote>
        Data refresh: page render {formatTimestamp(nowIso)};{' '}
        {hasAnyRecord
          ? `newest record ${formatTimestamp(staleness.latest_iso)}` +
            (staleness.stale ? ' (STALE - over 7 days old)' : '')
          : 'no business records yet (nothing to be stale)'}
        . Mode:{' '}
        {data.mode === 'setup'
          ? 'setup (labeled fixture data, nothing live)'
          : 'connected to Supabase staging (owner-only RLS)'}
        . All agent output is simulation-only and requires owner
        approval. Nothing on this page sends messages or executes
        actions.
      </FooterNote>
    </BusinessShell>
  );
}
