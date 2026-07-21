import {
  loadBusinessData,
  resolveBusinessPageContext,
} from '@/lib/business/page-data';
import {
  asString,
  buildPipeline,
} from '@/lib/business/read-models';
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

// Sales Pipeline (Phase 6D). Read-only stage board over sales_leads.
export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const { needsLogin, ctx } = await resolveBusinessPageContext();
  if (needsLogin) return <LoginRequired title="Sales Pipeline" />;
  const data = await loadBusinessData(ctx?.client ?? null);
  const columns = buildPipeline(data.leads, LEAD_STAGES);
  const nonEmpty = columns.filter((c) => c.leads.length > 0);

  return (
    <BusinessShell title="Sales Pipeline" mode={data.mode}>
      {data.errors.map((e) => (
        <ErrorNote key={e} error={e} />
      ))}
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
                    since {formatTimestamp(l.stage_changed_at)}
                  </div>
                  {asString(l.owner_next_action) && (
                    <div className="text-xs text-amber-300">
                      next: {asString(l.owner_next_action)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <FooterNote>
        {nonEmpty.length} of {LEAD_STAGES.length} stages populated.
        Stage changes are recorded manually or by owner-approved data
        changes; nothing here modifies a lead.
      </FooterNote>
    </BusinessShell>
  );
}
