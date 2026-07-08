// Approval Center Supabase store - Gate 3 control-plane wiring.
// Reads approval rows and records OWNER decisions in the `approvals`
// table (staging control plane), writing an audit_log row for every
// decision. This module NEVER executes anything: recording a decision
// is control-plane state only. Execution remains governed by the
// fail-closed guard in approvals.ts (evaluateExecution), which still
// blocks every live action type in this phase.
//
// Fail-closed by design:
// - null client (setup mode)            -> caller falls back to mock
// - unknown/invalid decision or id      -> blocked, no write attempted
// - row missing or not 'pending'        -> blocked, no write attempted
// - conditional update matches 0 rows   -> blocked (lost race, no-op)
// - explicit_confirmation stays false: a single button click is an
//   approval, not the explicit confirmation RED actions require, so
//   RED execution stays impossible downstream regardless.
//
// Injectable client (same idiom as cards.ts SupabaseLike) so every
// branch is unit-testable without any network access.

export interface StoreResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

export interface ApprovalsTable {
  select(columns: string): {
    order(
      column: string,
      opts: { ascending: boolean },
    ): { limit(n: number): PromiseLike<StoreResult> };
  };
  update(patch: Record<string, unknown>): {
    eq(
      column: string,
      value: string,
    ): {
      eq(
        column: string,
        value: string,
      ): { select(columns: string): PromiseLike<StoreResult> };
    };
  };
}

export interface AuditTable {
  insert(row: Record<string, unknown>): PromiseLike<{
    error: { message: string } | null;
  }>;
}

export interface ControlPlaneClient {
  from(table: 'approvals'): ApprovalsTable;
  from(table: 'audit_log'): AuditTable;
  from(table: string): ApprovalsTable | AuditTable;
}

export interface ApprovalRow {
  id: string;
  task_id: string | null;
  requested_action: string;
  action_class: string;
  decision: string;
  decision_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface ListOutcome {
  rows: ApprovalRow[];
  error?: string;
}

const APPROVAL_COLUMNS =
  'id, task_id, requested_action, action_class, decision, decision_at, notes, created_at';

export async function listApprovalRows(
  client: ControlPlaneClient,
  limit = 20,
): Promise<ListOutcome> {
  const res = await (client.from('approvals') as ApprovalsTable)
    .select(APPROVAL_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) {
    return { rows: [], error: 'approvals read failed: ' + res.error.message };
  }
  const rows = (res.data ?? []).map((r) => ({
    id: String(r['id'] ?? ''),
    task_id: r['task_id'] == null ? null : String(r['task_id']),
    requested_action: String(r['requested_action'] ?? ''),
    action_class: String(r['action_class'] ?? '?'),
    decision: String(r['decision'] ?? 'pending'),
    decision_at: r['decision_at'] == null ? null : String(r['decision_at']),
    notes: r['notes'] == null ? null : String(r['notes']),
    created_at: String(r['created_at'] ?? ''),
  }));
  return { rows };
}

export interface DecideInput {
  approvalId: string;
  decision: 'approved' | 'rejected';
  now: string; // ISO timestamp, injected (no ambient clock here)
  reason?: string;
}

export interface DecideOutcome {
  ok: boolean;
  code:
    | 'decided'
    | 'invalid_decision'
    | 'invalid_id'
    | 'not_pending'
    | 'write_failed'
    | 'audit_failed';
  message: string;
}

// Record an owner decision. Control-plane write ONLY; executes nothing.
export async function decideApprovalRow(
  client: ControlPlaneClient,
  input: DecideInput,
): Promise<DecideOutcome> {
  // Inputs arrive from an untrusted POST body: validate before any I/O.
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    return {
      ok: false,
      code: 'invalid_decision',
      message: 'decision must be approved or rejected',
    };
  }
  const id = (input.approvalId ?? '').trim();
  // Control-plane ids are uuids; anything else is rejected unseen.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(id)) {
    return { ok: false, code: 'invalid_id', message: 'invalid approval id' };
  }

  // Conditional update: only a row that is still 'pending' can receive a
  // decision. Matching on decision='pending' makes the write a no-op if
  // the row was decided elsewhere first (fail-closed under races).
  const patch: Record<string, unknown> = {
    decision: input.decision,
    decision_at: input.now,
    // A one-click UI decision is NOT the explicit confirmation that RED
    // execution requires. Kept false on purpose.
    explicit_confirmation: false,
  };
  if (input.reason && input.reason.trim() !== '') {
    patch['notes'] = input.reason.trim().slice(0, 500);
  }

  const updated = await (client.from('approvals') as ApprovalsTable)
    .update(patch)
    .eq('id', id)
    .eq('decision', 'pending')
    .select('id');
  if (updated.error) {
    return {
      ok: false,
      code: 'write_failed',
      message: 'decision write failed: ' + updated.error.message,
    };
  }
  if (!updated.data || updated.data.length === 0) {
    return {
      ok: false,
      code: 'not_pending',
      message: 'approval not found or no longer pending; nothing changed',
    };
  }

  // Audit row for the decision itself. The decision stands even if the
  // audit insert fails, but the failure is surfaced loudly.
  const audit = await (client.from('audit_log') as AuditTable).insert({
    actor: 'owner',
    actor_type: 'human',
    action: 'approval_decision:' + input.decision,
    action_class: 'GREEN',
    environment: 'staging',
    production_touched: false,
    write_actions_performed: false,
    secrets_exposed: false,
    detail: {
      approval_id: id,
      decision: input.decision,
      reason: input.reason ?? null,
      via: 'dashboard_approvals_page',
    },
  });
  if (audit.error) {
    return {
      ok: false,
      code: 'audit_failed',
      message:
        'decision recorded but audit write failed: ' + audit.error.message,
    };
  }

  return {
    ok: true,
    code: 'decided',
    message: 'decision recorded: ' + input.decision,
  };
}
