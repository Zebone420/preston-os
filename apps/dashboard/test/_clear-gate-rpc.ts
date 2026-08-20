// Shared test stand-in for the migration-0022 SECURITY DEFINER RPC
// public.clear_approval_gate. Fake `makeFakeDb` clients attach this as their
// `.rpc` so driver/orchestrate tests exercise the SAME contract the real SQL
// enforces: CAS-bind the job's action fields AND require the job's linked
// approval to be owner-'approved' and scoped to this job/goal before clearing.
export function clearGateRpc(rowsOf: (t: string) => Record<string, unknown>[]) {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return (fn: string, a: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => {
    if (fn !== 'clear_approval_gate') {
      return Promise.resolve({ data: null, error: { message: 'unknown_fn:' + fn } });
    }
    const job = rowsOf('goal_jobs').find((r) => String(r.id) === s(a.p_job_id));
    if (!job) return Promise.resolve({ data: { ok: false, reason: 'job_not_found' }, error: null });
    const cas = String(job.status) === s(a.p_from_status)
      && job.requires_approval === true
      && s(job.approval_id) === s(a.p_approval_id)
      && s(job.goal_id) === s(a.p_goal_id)
      && String(job.kind) === s(a.p_kind)
      && s(job.objective) === s(a.p_objective)
      && String(job.title) === s(a.p_title)
      && String(job.risk_class) === s(a.p_risk_class)
      && s(job.assigned_role) === s(a.p_assigned_role);
    if (!cas) return Promise.resolve({ data: { ok: false, reason: 'stale_cas' }, error: null });
    if (job.approval_id === null || job.approval_id === undefined) {
      return Promise.resolve({ data: { ok: false, reason: 'no_approval_linked' }, error: null });
    }
    const appr = rowsOf('orchestration_approvals').find((r) => String(r.approval_id) === s(job.approval_id));
    if (!appr) return Promise.resolve({ data: { ok: false, reason: 'approval_not_found' }, error: null });
    if (String(appr.status) !== 'approved') return Promise.resolve({ data: { ok: false, reason: 'not_approved' }, error: null });
    if (s(appr.job_id) !== s(job.id) || s(appr.goal_id) !== s(job.goal_id)) {
      return Promise.resolve({ data: { ok: false, reason: 'scope_mismatch' }, error: null });
    }
    job.requires_approval = false;
    job.status = 'ready';
    return Promise.resolve({ data: { ok: true, job_id: job.id }, error: null });
  };
}
