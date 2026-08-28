// Preston Control - OpenAPI 3.1 document for the Custom GPT Actions surface.
// PURE. Hand-bounded: six operations, strict request schemas mirroring
// schemas.ts, no generic endpoints.
//
// x-openai-isConsequential contract (ChatGPT platform behaviour):
//   true  -> ChatGPT shows an Allow/Deny card on EVERY call (no always-allow).
//   false -> ChatGPT may offer "Always Allow"; routine calls run frictionless.
// Only decidePrestonApproval is consequential: it records the owner's
// authoritative decision (one-time + owner-only + audited in the DB
// regardless). Goal submission is intake into a default-deny control plane -
// nothing executes inside the call, risk is classified server-side, RED/
// YELLOW work parks behind Preston's own approval rows, production targets
// are rejected, and request_id makes it idempotent - so it is accurately
// non-consequential at the transport layer. Preston's SSOT/control plane
// stays the authoritative action authorization; the ChatGPT prompt is only
// transport friction.
//
// Security: OAuth 2.0 authorization-code against the project's Supabase Auth
// OAuth server; the GPT editor holds the GPT-surface client id/secret. The
// document never contains either.

export const OPENAPI_VERSION = '1.0.0';

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const RUNTIME_ID_PATTERN = '^[A-Za-z0-9._:-]{8,128}$';

export function buildOpenApiDocument(origin: string): Record<string, unknown> {
  const base = origin.replace(/\/+$/, '');
  // The GPT authenticates against the same-origin PKCE bridge, which
  // forwards to the Supabase Auth OAuth server; see gpt-bridge.ts.
  const authBase = base + '/oauth/gpt';
  const uuid = { type: 'string', pattern: UUID_PATTERN };
  const okError = {
    type: 'object',
    properties: { ok: { type: 'boolean' }, status: { type: 'string' } },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Preston Control',
      version: OPENAPI_VERSION,
      description:
        'Owner control surface for Preston AI OS. Read status, submit missions into the Preston ' +
        'control plane, inspect goals and evidence, and decide owner approvals. Preston classifies ' +
        'and gates every mission; nothing executes inside these calls.',
    },
    servers: [{ url: base }],
    security: [{ prestonOAuth: ['email'] }],
    components: {
      securitySchemes: {
        prestonOAuth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: `${authBase}/authorize`,
              tokenUrl: `${authBase}/token`,
              scopes: { email: 'Identify the Preston owner' },
            },
          },
        },
      },
      schemas: {
        Error: okError,
        // Response bodies are Preston's projected objects; exact fields vary by
        // operation, so they are documented as open objects (the GPT editor
        // requires a `properties` block for object schemas).
        Result: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, status: { type: 'string' } },
          additionalProperties: true,
        },
        SubmitGoalRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['request'],
          properties: {
            request: { type: 'string', minLength: 1, maxLength: 4000, description: "The owner's request. A single clear sentence becomes one task ('Audit the repository.'). For multi-step work enumerate the tasks explicitly - 'Task 1: ... Task 2: ... after task 1.' or 'Create tasks to A, B, and C.' - free multi-sentence prose is rejected as ambiguous." },
            context: { type: 'string', maxLength: 2000, description: 'Optional extra context (data only).' },
            priority: { type: 'string', enum: ['normal', 'high'] },
            request_id: { type: 'string', pattern: RUNTIME_ID_PATTERN, description: 'Optional idempotency key; reuse to retry safely.' },
          },
        },
        FollowUpGoalRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['instruction'],
          properties: {
            instruction: { type: 'string', minLength: 1, maxLength: 4000, description: "The owner's follow-up request in plain language." },
            context: { type: 'string', maxLength: 1900, description: 'Optional extra context (data only).' },
            priority: { type: 'string', enum: ['normal', 'high'] },
            request_id: { type: 'string', pattern: RUNTIME_ID_PATTERN, description: 'Optional idempotency key; reuse to retry safely.' },
          },
        },
        CancelGoalRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reason: { type: 'string', maxLength: 300, description: 'Optional non-secret note.' },
            owner_confirmation: {
              type: 'string',
              maxLength: 200,
              description:
                "The owner's OWN verbatim message naming the exact goal id, e.g. " +
                "'Cancel goal 1234abcd-...'. NEVER compose, infer, or autofill; omit on the " +
                'first call to get the restatement.',
            },
          },
        },
        DecideApprovalRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['outcome'],
          properties: {
            outcome: { type: 'string', enum: ['approved', 'rejected'] },
            reason: { type: 'string', maxLength: 300, description: 'Optional non-secret note.' },
            owner_confirmation: {
              type: 'string',
              maxLength: 200,
              description:
                "The owner's OWN verbatim confirmation naming the exact approval id, e.g. " +
                "'Approve apr-1234abcd...'. NEVER compose, infer, or autofill; pass only a " +
                'message the owner typed after seeing the restated approval. Omit on the first ' +
                'call to get the restatement.',
            },
          },
        },
      },
    },
    paths: {
      '/api/control/status': {
        get: {
          operationId: 'getPrestonStatus',
          summary: 'Preston status',
          description:
            'Read-only snapshot: environment, control posture, Hermes mode, recent goals, pending owner ' +
            'approvals, failures, dead letters, needs_attention. Use for: is Preston live, what is running, ' +
            'what failed, what is waiting, what needs my attention, what did Claude finish.',
          'x-openai-isConsequential': false,
          responses: { '200': { description: 'Status snapshot', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '401': { description: 'Not authenticated' }, '403': { description: 'Not the owner' } },
        },
      },
      '/api/control/goals': {
        post: {
          operationId: 'submitPrestonGoal',
          summary: 'Submit a goal to Preston',
          description:
            'Creates non-executing intake for a Preston goal. Preston classifies risk server-side, parks ' +
            'gated work behind its approval rows, rejects production targets, and uses request_id for ' +
            'idempotency. Returns accepted, duplicate, or rejected with goal and job ids.',
          'x-openai-isConsequential': false,
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitGoalRequest' } } } },
          responses: { '200': { description: 'Intake result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid input' }, '401': { description: 'Not authenticated' }, '403': { description: 'Not the owner' } },
        },
      },
      '/api/control/goals/{goal_id}': {
        get: {
          operationId: 'getPrestonGoal',
          summary: 'Get one Preston goal',
          description: 'Read-only: one goal with its jobs, status counts, pending approvals and evidence refs.',
          'x-openai-isConsequential': false,
          parameters: [{ name: 'goal_id', in: 'path', required: true, schema: uuid }],
          responses: { '200': { description: 'Goal detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid id' }, '401': { description: 'Not authenticated' } },
        },
      },
      '/api/control/goals/{goal_id}/follow-up': {
        post: {
          operationId: 'followUpPrestonGoal',
          summary: 'Follow up on a Preston goal',
          description:
            'Continues prior work as a FRESH goal linked to the parent (path goal_id). Nothing is ' +
            'inherited: normal classification, approval gates and request_id idempotency apply as ' +
            'for a new goal. Returns the new goal/job ids plus parent linkage.',
          'x-openai-isConsequential': false,
          parameters: [{ name: 'goal_id', in: 'path', required: true, schema: uuid }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FollowUpGoalRequest' } } } },
          responses: { '200': { description: 'Continuation result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid input' }, '401': { description: 'Not authenticated' }, '403': { description: 'Not the owner' } },
        },
      },
      '/api/control/goals/{goal_id}/cancel': {
        post: {
          operationId: 'cancelPrestonGoal',
          summary: 'Cancel a Preston goal (owner only)',
          // ChatGPT Actions rejects operation descriptions over 300 chars.
          description:
            'CONSEQUENTIAL owner cancellation, server-enforced handshake: without a valid ' +
            'owner_confirmation naming the exact goal id NO cancellation happens and the goal is ' +
            'restated with the required phrase. Never resolve ambiguous refs like "cancel that". ' +
            'Idempotent; terminal goals refused.',
          'x-openai-isConsequential': true,
          parameters: [{ name: 'goal_id', in: 'path', required: true, schema: uuid }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CancelGoalRequest' } } } },
          responses: { '200': { description: 'Cancellation result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid input' }, '401': { description: 'Not authenticated' }, '403': { description: 'Not the owner' } },
        },
      },
      '/api/control/jobs/{job_id}': {
        get: {
          operationId: 'getPrestonJob',
          summary: 'Get one Preston job',
          description:
            'Read-only: one job by id - status, role, risk, attempts, run liveness, linked ' +
            'approval, evidence refs, and per-attempt readable result reports (summary, result ' +
            'excerpt, files changed). Answers "what did the worker actually do on this job".',
          'x-openai-isConsequential': false,
          parameters: [{ name: 'job_id', in: 'path', required: true, schema: uuid }],
          responses: { '200': { description: 'Job detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid id' }, '401': { description: 'Not authenticated' } },
        },
      },
      '/api/control/approvals': {
        get: {
          operationId: 'listPrestonApprovals',
          summary: 'List pending owner approvals',
          description: 'Read-only: pending approvals (approval_id, goal/job, action, reason, risk, environment, expiry, decision_open). Never returns credentials.',
          'x-openai-isConsequential': false,
          responses: { '200': { description: 'Pending approvals', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '401': { description: 'Not authenticated' } },
        },
      },
      '/api/control/approvals/{approval_id}/decision': {
        post: {
          operationId: 'decidePrestonApproval',
          summary: 'Approve or reject a pending Preston approval (owner only)',
          // ChatGPT Actions rejects operation descriptions over 300 chars.
          description:
            'CONSEQUENTIAL owner decision, server-enforced handshake: without a valid ' +
            'owner_confirmation NO decision is made and the approval is restated with the required ' +
            'phrase. Never resolve ambiguous refs like "approve that" - ask the owner for the ' +
            'exact id. One-time; decided/expired refused.',
          'x-openai-isConsequential': true,
          parameters: [{ name: 'approval_id', in: 'path', required: true, schema: { type: 'string', pattern: RUNTIME_ID_PATTERN } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DecideApprovalRequest' } } } },
          responses: { '200': { description: 'Decision result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid input' }, '401': { description: 'Not authenticated' }, '403': { description: 'Not the owner' } },
        },
      },
      '/api/control/evidence': {
        get: {
          operationId: 'getPrestonEvidence',
          summary: 'Get evidence for a goal or job',
          description: 'Read-only: bounded, secret-free evidence - completion state, worker role, attempts, failure summary, evidence references.',
          'x-openai-isConsequential': false,
          parameters: [
            { name: 'goal_id', in: 'query', required: false, schema: uuid },
            { name: 'job_id', in: 'query', required: false, schema: uuid },
          ],
          responses: { '200': { description: 'Evidence items', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid input' }, '401': { description: 'Not authenticated' } },
        },
      },
      '/api/control/events': {
        get: {
          operationId: 'pollPrestonEvents',
          summary: 'Poll normalized Preston supervisor events',
          description:
            'Read-only supervisor feed of normalized state transitions (queued, running, ' +
            'completed, failed, timed_out, dead_lettered, blocked, paused, stopped, ' +
            'approval_required, kind_not_eligible, task_kind_unresolved, submit_rejected). ' +
            'Cursor-paginated, deduplicated; submit rejections carry goal_id null.',
          'x-openai-isConsequential': false,
          parameters: [
            { name: 'cursor', in: 'query', required: false, schema: { type: 'string', maxLength: 240 } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
          ],
          responses: { '200': { description: 'Event page with next_cursor', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid cursor or input' }, '401': { description: 'Not authenticated' } },
        },
      },
      '/api/control/artifacts/{artifact_id}': {
        get: {
          operationId: 'getPrestonArtifact',
          summary: 'Get one durable Preston artifact',
          description:
            'Read-only: one durable artifact by id (from a job\'s artifact:<id> evidence ref) - ' +
            'provenance, type, name, sha256, size, retention state, plus a short-lived signed ' +
            'download URL when storage is active. No bucket browsing; no credentials.',
          'x-openai-isConsequential': false,
          parameters: [{ name: 'artifact_id', in: 'path', required: true, schema: { type: 'string', pattern: '^art-[0-9a-f]{32}$' } }],
          responses: { '200': { description: 'Artifact metadata and retrieval', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } }, '400': { description: 'Invalid id' }, '401': { description: 'Not authenticated' } },
        },
      },
    },
  };
}
