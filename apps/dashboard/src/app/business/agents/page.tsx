import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import { readSystemControls } from '@/lib/ai-os/store';
import { asString } from '@/lib/business/read-models';
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

// Agent Operations Panel (Phase 6D). Shows the business agents'
// runs, modes, and safety posture. Read-only; controls stay on /os.
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Agent Operations" />;
  const data = await loadBusinessData(ctx?.client ?? null);
  const controls = ctx
    ? await readSystemControls(ctx.client)
    : null;

  return (
    <BusinessShell title="Agent Operations" mode={data.mode}>
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}

      <Card title="Business agents" right={<SimulationBadge />}>
        <Table
          headers={[
            'Agent',
            'Mode',
            'Risk class',
            'Approval',
            'Execution eligible',
            'Last run',
          ]}
        >
          <tr className="border-t border-slate-800">
            <td className="py-1 pr-3">quote-draft-agent</td>
            <td className="py-1 pr-3">
              <span className="rounded bg-purple-900 px-1.5 py-0.5 text-xs">
                simulation
              </span>
            </td>
            <td className="py-1 pr-3">YELLOW (draft proposal)</td>
            <td className="py-1 pr-3">owner approval required</td>
            <td className="py-1 pr-3">false (DB-pinned)</td>
            <td className="py-1 pr-3 text-xs text-slate-400">
              {data.quoteDraftRuns.length > 0
                ? formatTimestamp(data.quoteDraftRuns[0].created_at)
                : 'never'}
            </td>
          </tr>
          <tr className="border-t border-slate-800">
            <td className="py-1 pr-3">recommendation-rules</td>
            <td className="py-1 pr-3">
              <span className="rounded bg-purple-900 px-1.5 py-0.5 text-xs">
                advice-only
              </span>
            </td>
            <td className="py-1 pr-3">GREEN (read-only rules)</td>
            <td className="py-1 pr-3">owner acknowledges/dismisses</td>
            <td className="py-1 pr-3">not applicable (no actions)</td>
            <td className="py-1 pr-3 text-xs text-slate-400">
              {data.recommendations.length > 0
                ? formatTimestamp(data.recommendations[0].created_at)
                : 'never'}
            </td>
          </tr>
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title={`Quote-draft runs (${data.quoteDraftRuns.length})`}
        >
          <EmptyNote
            show={data.quoteDraftRuns.length === 0}
            text="No agent runs recorded."
          />
          {data.quoteDraftRuns.length > 0 && (
            <Table
              headers={['When', 'Status', 'Quote', 'Correlation', 'By']}
            >
              {data.quoteDraftRuns.map((r) => (
                <tr
                  key={asString(r.id)}
                  className="border-t border-slate-800"
                >
                  <td className="py-1 pr-3 text-xs text-slate-400">
                    {formatTimestamp(r.created_at)}
                  </td>
                  <td className="py-1 pr-3">
                    <StatusBadge status={asString(r.status)} />
                    {asString(r.failure_reason) && (
                      <div className="text-xs text-red-300">
                        {asString(r.failure_reason)}
                      </div>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    {asString(r.quote_id).slice(0, 8) || '-'}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    {asString(r.correlation_id)}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    {asString(r.created_by)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Safety posture">
          {controls ? (
            <ul className="space-y-1 text-sm">
              <li>
                execution_enabled:{' '}
                <b>{String(controls.execution_enabled)}</b> (business
                agents can never flip this)
              </li>
              <li>
                remote_runner_enabled:{' '}
                <b>{String(controls.remote_runner_enabled)}</b>
              </li>
              <li>
                hermes_mode: <b>{controls.hermes_mode}</b>
              </li>
              <li>
                owner_stop: <b>{String(controls.owner_stop)}</b> |
                paused: <b>{String(controls.paused)}</b>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-slate-400">
              Setup mode: controls read is unavailable; the fail-closed
              default is fully stopped (execution disabled).
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Quote drafts are DB-pinned simulation_only=true and
            execution_eligible=false (migration 0009 CHECK
            constraints). Approval Center approval records a decision
            only; no execution path exists for business drafts.
          </p>
        </Card>
      </div>

      <FooterNote>
        Runtime controls (pause/resume/stop/kill) live on the /os
        control center and the audited /api/os/control endpoint.
      </FooterNote>
    </BusinessShell>
  );
}
