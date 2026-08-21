// Preston Control - MCP server definition (tool catalogue + annotations).
// One McpServer per request (stateless Streamable HTTP). Schemas are narrow
// and bounded; annotations are accurate (ChatGPT uses readOnlyHint /
// destructiveHint to choose confirmation behaviour, but they are hints -
// authorization is enforced by auth.ts and by the DB, never by annotations).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  prestonDecideApproval,
  prestonGetEvidence,
  prestonGetGoal,
  prestonListApprovals,
  prestonStatus,
  prestonSubmitGoal,
  type ToolContext,
} from './tools';

export const PRESTON_CONTROL_SERVER_NAME = 'preston-control';
export const PRESTON_CONTROL_SERVER_VERSION = '1.0.0';

export const TOOL_NAMES = [
  'preston_status',
  'preston_submit_goal',
  'preston_get_goal',
  'preston_list_approvals',
  'preston_decide_approval',
  'preston_get_evidence',
] as const;

const UUID = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'must be a UUID',
);
const RUNTIME_ID = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, 'must match ^[A-Za-z0-9._:-]{8,128}$');

function result(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function buildPrestonControlServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: PRESTON_CONTROL_SERVER_NAME,
    version: PRESTON_CONTROL_SERVER_VERSION,
  });

  server.registerTool('preston_status', {
    title: 'Preston status',
    description:
      'Read-only snapshot of Preston AI OS: environment, control posture (execution/pause/stop), ' +
      'Hermes mode, recent goals, pending owner approvals, failures and dead letters, and a ' +
      'needs_attention list. Use for: is Preston live, what is running, what failed, what is waiting, ' +
      'what needs my attention, what did Claude finish.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(await prestonStatus(ctx)));

  server.registerTool('preston_submit_goal', {
    title: 'Submit a goal to Preston',
    description:
      'Submit a build / fix / investigate / audit / research / implement mission into the Preston ' +
      'control plane. Preston decomposes it deterministically, classifies risk, parks gated work ' +
      'behind owner approval, and the runtime (Hermes + Claude/Codex workers) executes it. Nothing ' +
      'executes inside this call. Idempotent: re-sending the same request_id replays the same result. ' +
      'Returns accepted | duplicate | rejected with goal and job ids.',
    inputSchema: {
      request: z.string().min(1).max(4000).describe('The owner\'s request in plain language.'),
      context: z.string().max(2000).optional().describe('Optional extra context (data only).'),
      priority: z.enum(['normal', 'high']).optional(),
      request_id: RUNTIME_ID.optional().describe('Optional idempotency key; reuse to retry safely.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonSubmitGoal(ctx, args)));

  server.registerTool('preston_get_goal', {
    title: 'Get a Preston goal',
    description: 'Read-only: one goal with its jobs, status counts, pending approvals and evidence refs.',
    inputSchema: { goal_id: UUID },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetGoal(ctx, args.goal_id)));

  server.registerTool('preston_list_approvals', {
    title: 'List pending Preston approvals',
    description:
      'Read-only: owner-visible pending approvals (approval_id, goal/job, action, reason, risk, ' +
      'environment, expiry, decision_open). Never returns nonces or credentials.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(await prestonListApprovals(ctx)));

  server.registerTool('preston_decide_approval', {
    title: 'Decide a Preston approval (owner only)',
    description:
      'CONSEQUENTIAL: records the owner\'s approve/reject decision on a pending approval through ' +
      'Preston\'s authoritative owner-only decision path. Always confirm the approval_id and the ' +
      'action text with the owner before calling. One-time; already-decided or expired approvals ' +
      'are refused.',
    inputSchema: {
      approval_id: RUNTIME_ID,
      outcome: z.enum(['approved', 'rejected']),
      reason: z.string().max(300).optional().describe('Optional non-secret note.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (args) => result(await prestonDecideApproval(ctx, args)));

  server.registerTool('preston_get_evidence', {
    title: 'Get Preston evidence',
    description:
      'Read-only: bounded, secret-free evidence for a goal or a job - completion state, worker role, ' +
      'attempts, failure summary, evidence references.',
    inputSchema: { goal_id: UUID.optional(), job_id: UUID.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetEvidence(ctx, args)));

  return server;
}
