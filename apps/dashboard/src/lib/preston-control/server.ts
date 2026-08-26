// Preston Control - MCP transport adapter (tool catalogue + annotations).
// The GPT Actions facade (lib/preston-control/http.ts + app/api/control/*)
// is the sibling adapter over the SAME tools.ts service layer.
// One McpServer per request (stateless Streamable HTTP). Schemas are narrow
// and bounded; annotations are accurate (ChatGPT uses readOnlyHint /
// destructiveHint to choose confirmation behaviour, but they are hints -
// authorization is enforced by auth.ts and by the DB, never by annotations).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DECIDE_APPROVAL_SHAPE,
  GET_EVIDENCE_SHAPE,
  GET_GOAL_SHAPE,
  GET_JOB_SHAPE,
  SUBMIT_GOAL_SHAPE,
} from './schemas';
import {
  prestonDecideApproval,
  prestonGetEvidence,
  prestonGetGoal,
  prestonGetJob,
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
  'preston_get_job',
  'preston_list_approvals',
  'preston_decide_approval',
  'preston_get_evidence',
] as const;

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
    inputSchema: SUBMIT_GOAL_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonSubmitGoal(ctx, args)));

  server.registerTool('preston_get_goal', {
    title: 'Get a Preston goal',
    description: 'Read-only: one goal with its jobs, status counts, pending approvals and evidence refs.',
    inputSchema: GET_GOAL_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetGoal(ctx, args.goal_id)));

  server.registerTool('preston_get_job', {
    title: 'Get one Preston job',
    description:
      'Read-only: one job by id - status, role, risk, attempts, run liveness, linked approval, ' +
      'evidence refs, and per-attempt readable result reports (what the worker actually did: ' +
      'summary, result excerpt, files changed). Use to answer "what did Claude do on this job".',
    inputSchema: GET_JOB_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetJob(ctx, args.job_id)));

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
      'Preston\'s authoritative owner-only decision path. SERVER-ENFORCED handshake: without a ' +
      'valid owner_confirmation (the owner\'s OWN message naming the exact approval id, e.g. ' +
      '"Approve apr-...") NO decision is made - the server returns a restatement of the approval ' +
      'id and action to show the owner. Never resolve ambiguous references like "approve that"; ' +
      'ask the owner for the exact id. One-time; already-decided or expired approvals are refused.',
    inputSchema: DECIDE_APPROVAL_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (args) => result(await prestonDecideApproval(ctx, args)));

  server.registerTool('preston_get_evidence', {
    title: 'Get Preston evidence',
    description:
      'Read-only: bounded, secret-free evidence for a goal or a job - completion state, worker role, ' +
      'attempts, failure summary, evidence references.',
    inputSchema: GET_EVIDENCE_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetEvidence(ctx, args)));

  return server;
}
