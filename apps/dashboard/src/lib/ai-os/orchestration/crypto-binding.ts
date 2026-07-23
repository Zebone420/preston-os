// Preston AI OS - Phase 7 CANONICAL cryptographic action binding.
// SERVER-ONLY (uses node:crypto - a trusted runtime primitive, no new dep).
// This is the hash that WILL be used as authorization evidence at the
// Telegram/ChatGPT activation gate. The simulation approvals.actionHash
// (32-bit FNV) is a NON-authoritative UI/dedup binding and must NEVER be
// accepted as activation evidence (documented in the threat model).
//
// The canonical hash is SHA-256 over a deterministic, canonicalized JSON
// envelope so field order can never change the digest.

import { createHash } from 'node:crypto';

export interface ActionEnvelope {
  approval_id: string;
  action: string;
  affected_resource: string;
  environment: 'staging';
  owner_identity: string;
  risk_class: string;
  created_at: string;
  expires_at: string;
  // Complete, SEPARATELY-bound action-defining fields (audit BLOCKER): every
  // field that determines what actually executes is bound on its own - never
  // collapsed into a single fallback string - so no unbound field (e.g. the
  // title when objective is set, or the executing role) can be altered after
  // approval while keeping the same digest.
  job_kind?: string;
  job_objective?: string;
  job_title?: string;
  assigned_role?: string;
}

// Canonical serialization: keys sorted, no whitespace. EVERY field is bound
// separately; any change to any field changes the digest. New fields are
// coalesced to '' so non-job envelopes remain stable.
function canonicalize(e: ActionEnvelope): string {
  const ordered: Record<string, string> = {
    action: String(e.action),
    affected_resource: String(e.affected_resource),
    approval_id: String(e.approval_id),
    assigned_role: String(e.assigned_role ?? ''),
    created_at: String(e.created_at),
    environment: String(e.environment),
    expires_at: String(e.expires_at),
    job_kind: String(e.job_kind ?? ''),
    job_objective: String(e.job_objective ?? ''),
    job_title: String(e.job_title ?? ''),
    owner_identity: String(e.owner_identity),
    risk_class: String(e.risk_class),
  };
  return JSON.stringify(ordered, Object.keys(ordered).sort());
}

// SHA-256 hex digest of the canonical envelope. 256-bit; collision-resistant.
export function canonicalActionHash(e: ActionEnvelope): string {
  return createHash('sha256').update(canonicalize(e), 'utf8').digest('hex');
}

// Canonical ActionEnvelope for a gated goal_job approval - the SINGLE source of
// truth that BOTH the approval creator and the durable driver use, so the
// approved action and the executed action bind to the SAME SHA-256 digest. If
// the job's action, resource, owner, risk, or validity window differs at
// execution from what the owner approved, the digest differs and execution is
// refused. Deterministic derivation (kind + objective/title, goal_job:<id>).
export function jobApprovalEnvelope(args: {
  approval_id: string;
  job_kind: string;
  job_id: string;
  job_objective: string;
  job_title: string;
  risk_class: string;
  assigned_role: string;
  owner_identity: string;
  created_at: string;
  expires_at: string;
}): ActionEnvelope {
  return {
    approval_id: args.approval_id,
    // `action` is the human-readable label only; the SECURITY binding is the
    // separate job_* / assigned_role fields below, each bound independently.
    action: `${args.job_kind}: ${args.job_objective || args.job_title}`,
    affected_resource: `goal_job:${args.job_id}`,
    environment: 'staging',
    owner_identity: args.owner_identity,
    risk_class: args.risk_class,
    created_at: args.created_at,
    expires_at: args.expires_at,
    job_kind: args.job_kind,
    job_objective: args.job_objective,
    job_title: args.job_title,
    assigned_role: args.assigned_role,
  };
}

// Verify a presented hash against a rebuilt envelope. Constant-time-ish
// compare on equal-length hex strings.
export function verifyActionHash(
  e: ActionEnvelope,
  presented: string,
): boolean {
  const expected = canonicalActionHash(e);
  if (typeof presented !== 'string' || presented.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}
