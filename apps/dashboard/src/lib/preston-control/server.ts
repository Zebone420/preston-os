// Preston Control - MCP transport adapter (tool catalogue + annotations).
// The GPT Actions facade (lib/preston-control/http.ts + app/api/control/*)
// is the sibling adapter over the SAME tools.ts service layer.
// One McpServer per request (stateless Streamable HTTP). Schemas are narrow
// and bounded; annotations are accurate (ChatGPT uses readOnlyHint /
// destructiveHint to choose confirmation behaviour, but they are hints -
// authorization is enforced by auth.ts and by the DB, never by annotations).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CANCEL_GOAL_SHAPE,
  DECIDE_APPROVAL_SHAPE,
  FOLLOW_UP_GOAL_SHAPE,
  GET_ARTIFACT_SHAPE,
  GET_EVIDENCE_SHAPE,
  GET_GOAL_SHAPE,
  GET_JOB_SHAPE,
  POLL_EVENTS_SHAPE,
  SUBMIT_GOAL_SHAPE,
} from './schemas';
import {
  prestonCancelGoal,
  prestonDecideApproval,
  prestonFollowUpGoal,
  prestonGetArtifact,
  prestonGetEvidence,
  prestonGetGoal,
  prestonGetJob,
  prestonListApprovals,
  prestonPollEvents,
  prestonStatus,
  prestonSubmitGoal,
  type ToolContext,
} from './tools';

export const PRESTON_CONTROL_SERVER_NAME = 'preston-control';
export const PRESTON_CONTROL_SERVER_VERSION = '1.0.0';

export const TOOL_NAMES = [
  'preston_status',
  'preston_submit_goal',
  'preston_follow_up_goal',
  'preston_get_goal',
  'preston_get_job',
  'preston_list_approvals',
  'preston_decide_approval',
  'preston_cancel_goal',
  'preston_get_evidence',
  'preston_get_artifact',
  'preston_poll_events',
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
      'executes inside this call. A single clear sentence becomes one task; multi-step work must ' +
      "enumerate tasks explicitly ('Task 1: ... Task 2: ... after task 1.') - free multi-sentence " +
      'prose is rejected as ambiguous. Idempotent: re-sending the same request_id replays the same ' +
      'result. Returns accepted | duplicate | rejected with goal and job ids.',
    inputSchema: SUBMIT_GOAL_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonSubmitGoal(ctx, args)));

  server.registerTool('preston_follow_up_goal', {
    title: 'Follow up on a Preston goal',
    description:
      'Continue prior work: submits the instruction as a FRESH goal linked to the parent goal ' +
      '(provenance preserved; nothing inherited - normal classification, approval gates, and ' +
      'idempotency apply exactly as for a new goal). Use when the owner says "continue goal X ' +
      'with ...". Returns the new goal/job ids plus the parent linkage.',
    inputSchema: FOLLOW_UP_GOAL_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonFollowUpGoal(ctx, args)));

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

  server.registerTool('preston_cancel_goal', {
    title: 'Cancel a Preston goal (owner only)',
    description:
      'CONSEQUENTIAL: cancels a non-terminal goal and its non-terminal jobs so no future ' +
      'orchestration tick runs them. SERVER-ENFORCED handshake: without a valid owner_confirmation ' +
      '(the owner\'s OWN message naming the exact goal id, e.g. "Cancel goal <uuid>") NO ' +
      'cancellation happens - the goal is restated instead. Never resolve ambiguous references ' +
      'like "cancel that". Idempotent on replay; does not kill an already-running bounded attempt.',
    inputSchema: CANCEL_GOAL_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonCancelGoal(ctx, args)));

  server.registerTool('preston_get_evidence', {
    title: 'Get Preston evidence',
    description:
      'Read-only: bounded, secret-free evidence for a goal or a job - completion state, worker role, ' +
      'attempts, failure summary, evidence references.',
    inputSchema: GET_EVIDENCE_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetEvidence(ctx, args)));

  server.registerTool('preston_get_artifact', {
    title: 'Get a Preston artifact',
    description:
      'Read-only: one durable artifact by id (art-<32 hex>) - provenance (goal/job/run), type, ' +
      'name, sha256, size, retention state - plus a SHORT-LIVED signed download URL when storage ' +
      'is active. Storage credentials are never exposed; there is no bucket browsing.',
    inputSchema: GET_ARTIFACT_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonGetArtifact(ctx, args.artifact_id)));

  server.registerTool('preston_poll_events', {
    title: 'Poll Preston supervisor events',
    description:
      'Read-only supervisor feed: normalized state-transition events (queued, running, completed, ' +
      'failed, timed_out, dead_lettered, blocked, paused, stopped, approval_required, ' +
      'kind_not_eligible, task_kind_unresolved, submit_rejected) derived from the Preston SSOT, ' +
      'cursor-paginated and deduplicated - repeating a cursor returns the identical page and an ' +
      'advanced cursor never re-emits an event. Submit-time rejections are distinct from runtime ' +
      'failures (goal_id null = never entered the runtime). Observability only: recovery actions ' +
      'still go through preston_submit_goal and the approval gates.',
    inputSchema: POLL_EVENTS_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => result(await prestonPollEvents(ctx, args)));

  return server;
}
