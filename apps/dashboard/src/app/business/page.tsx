import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { isAuthConfigured } from '@/lib/owner-auth';
import { loadBusinessData } from '@/lib/business/page-data';
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
  SimulationBadge,
  StatTile,
  formatTimestamp,
} from '@/components/business/ui';
import { decideRecommendation } from './actions';

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
  const configured = isAuthConfigured(process.env);
  const ctx = configured ? await resolveOwner() : null;
  if (configured && !ctx) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Business Command Center</h1>
        <p className="mt-4 rounded bg-amber-900 p-3 text-sm">
          Owner login required.{' '}
          <Link href="/login" className="underline">
            Sign in
          </Link>
          .
        </p>
      </main>
    );
  }

  const data = await loadBusinessData(ctx?.client ?? null);
  const nowIso = new Date().toISOString();
  const paymentSummaries = data.projects.map((p) =>
    buildProjectPaymentSummary(p, data.paymentSchedules, data.paymentEvents),
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
    [...data.activity, ...data.leads, ...data.quotes],
    nowIso,
    24 * 7,
  );
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
        Data refresh: page render {formatTimestamp(nowIso)}; newest
        record {formatTimestamp(staleness.latest_iso) || 'none'}
        {staleness.stale ? ' (STALE - over 7 days old)' : ''}. Mode:{' '}
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
