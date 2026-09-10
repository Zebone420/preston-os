// Preston Control - input schemas shared by BOTH transport adapters (MCP tool
// inputSchema and the GPT Actions REST facade). One definition, two surfaces,
// so the bounds can never drift apart.

import { z } from 'zod';

export const UUID = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'must be a UUID',
);
export const RUNTIME_ID = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, 'must match ^[A-Za-z0-9._:-]{8,128}$');

export const SUBMIT_GOAL_SHAPE = {
  request: z.string().min(1).max(4000).describe(
    "The owner's request. A single clear sentence becomes one task " +
    "('Audit the repository.'). For multi-step work enumerate the tasks " +
    "explicitly - 'Task 1: ... Task 2: ... after task 1.' or 'Create tasks " +
    "to A, B, and C.' - free multi-sentence prose is rejected as ambiguous.",
  ),
  context: z.string().max(2000).optional().describe('Optional extra context (data only).'),
  priority: z.enum(['normal', 'high']).optional(),
  request_id: RUNTIME_ID.optional().describe('Optional idempotency key; reuse to retry safely.'),
};
export const GET_GOAL_SHAPE = { goal_id: UUID };
export const DECIDE_APPROVAL_SHAPE = {
  approval_id: RUNTIME_ID,
  outcome: z.enum(['approved', 'rejected']),
  reason: z.string().max(300).optional().describe('Optional non-secret note.'),
  owner_confirmation: z.string().max(200).optional().describe(
    "The owner's OWN verbatim confirmation message naming the exact approval id " +
    "(e.g. 'Approve apr-1234abcd...'). NEVER compose, infer, or autofill this value - " +
    'pass it only when the owner has typed it after seeing the restated approval. ' +
    'Omit it on the first call: the server refuses to decide and returns a ' +
    'restatement of the approval id and action to show the owner.',
  ),
};
export const GET_EVIDENCE_SHAPE = { goal_id: UUID.optional(), job_id: UUID.optional() };
export const GET_JOB_SHAPE = { job_id: UUID };
export const CANCEL_GOAL_SHAPE = {
  goal_id: UUID,
  reason: z.string().max(300).optional().describe('Optional non-secret note.'),
  owner_confirmation: z.string().max(200).optional().describe(
    "The owner's OWN verbatim message naming the exact goal id " +
    "(e.g. 'Cancel goal 1234abcd-...'). NEVER compose, infer, or autofill " +
    'this value. Omit it on the first call: the server refuses to cancel and ' +
    'returns a restatement of the goal for the owner to confirm.',
  ),
};

export const FOLLOW_UP_GOAL_SHAPE = {
  parent_goal_id: UUID.describe('The prior goal this continuation follows up on.'),
  instruction: z.string().min(1).max(4000).describe(
    "The owner's follow-up request in plain language (same grammar as a new goal).",
  ),
  context: z.string().max(1900).optional().describe('Optional extra context (data only).'),
  priority: z.enum(['normal', 'high']).optional(),
  request_id: RUNTIME_ID.optional().describe('Optional idempotency key; reuse to retry safely.'),
};

export const GET_ARTIFACT_SHAPE = {
  artifact_id: z.string().regex(/^art-[0-9a-f]{32}$/,
    'must match ^art-[0-9a-f]{32}$'),
};

export const POLL_EVENTS_SHAPE = {
  cursor: z.string().max(240).optional().describe(
    'Opaque cursor from a previous poll (next_cursor). Omit to read from ' +
    'the start of the bounded window. Repeating a cursor returns the ' +
    'identical page (idempotent); advancing it never re-emits an event.',
  ),
  limit: z.number().int().min(1).max(100).optional()
    .describe('Max events per page (default 50).'),
};

export const OWNER_VIEW_SHAPE = {
  view: z.enum(['today', 'project', 'approvals', 'workforce', 'incidents', 'brief']),
  project_ref: z.string().regex(
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|P[0-9]{2}-[0-9]{4})$/i,
    'must be a project UUID or Project ID',
  ).optional(),
};

export const LIST_ARCHITECT_PROPOSALS_SHAPE = {
  limit: z.number().int().min(1).max(50).optional()
    .describe('Maximum session-scoped Architect proposals to return (default 20).'),
};
export const GET_ARCHITECT_PROPOSAL_SHAPE = {
  proposal_id: RUNTIME_ID.describe('The exact Architect proposal correlation id.'),
};
export const DECIDE_ARCHITECT_PROPOSAL_SHAPE = {
  proposal_id: RUNTIME_ID.describe('The exact Architect proposal correlation id.'),
  approval_id: RUNTIME_ID.describe('The matching Preston approval id.'),
  outcome: z.enum(['approved', 'rejected']),
  presented_hash: z.string().regex(/^[0-9a-f]{64}$/,
    'must be the exact AG-4 SHA-256 digest shown to the owner'),
  owner_confirmation: z.string().min(1).max(200).describe(
    "The owner's OWN confirmation naming the exact approval id, for example " +
    "'Approve approval-1234'. Never infer or autofill it.",
  ),
};

export const SubmitGoalSchema = z.object(SUBMIT_GOAL_SHAPE).strict();
export const GetGoalSchema = z.object(GET_GOAL_SHAPE).strict();
export const DecideApprovalSchema = z.object(DECIDE_APPROVAL_SHAPE).strict();
export const GetEvidenceSchema = z.object(GET_EVIDENCE_SHAPE).strict();
export const GetJobSchema = z.object(GET_JOB_SHAPE).strict();
export const CancelGoalSchema = z.object(CANCEL_GOAL_SHAPE).strict();
export const FollowUpGoalSchema = z.object(FOLLOW_UP_GOAL_SHAPE).strict();
export const GetArtifactSchema = z.object(GET_ARTIFACT_SHAPE).strict();
export const PollEventsSchema = z.object(POLL_EVENTS_SHAPE).strict();
export const OwnerViewSchema = z.object(OWNER_VIEW_SHAPE).strict();
export const ListArchitectProposalsSchema = z.object(LIST_ARCHITECT_PROPOSALS_SHAPE).strict();
export const GetArchitectProposalSchema = z.object(GET_ARCHITECT_PROPOSAL_SHAPE).strict();
export const DecideArchitectProposalSchema = z.object(DECIDE_ARCHITECT_PROPOSAL_SHAPE).strict();
// GET-query variant: search params arrive as strings, so limit is coerced
// (same bounds; the tool clamps again defensively).
export const PollEventsQuerySchema = z.object({
  cursor: z.string().max(240).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
