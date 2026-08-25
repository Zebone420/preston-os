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
  request: z.string().min(1).max(4000).describe("The owner's request in plain language."),
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

export const SubmitGoalSchema = z.object(SUBMIT_GOAL_SHAPE).strict();
export const GetGoalSchema = z.object(GET_GOAL_SHAPE).strict();
export const DecideApprovalSchema = z.object(DECIDE_APPROVAL_SHAPE).strict();
export const GetEvidenceSchema = z.object(GET_EVIDENCE_SHAPE).strict();
