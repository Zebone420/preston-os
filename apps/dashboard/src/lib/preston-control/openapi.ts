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
            request: { type: 'string', minLength: 1, maxLength: 4000, description: "The owner's request in plain language." },
            context: { type: 'string', maxLength: 2000, description: 'Optional extra context (data only).' },
            priority: { type: 'string', enum: ['normal', 'high'] },
            request_id: { type: 'string', pattern: RUNTIME_ID_PATTERN, description: 'Optional idempotency key; reuse to retry safely.' },
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
                "'Approve apr-1234abcd...'. NEVER compose, infer, or autofill this value; only " +
                'pass a message the owner typed after seeing the restated approval. Omit on the ' +
                'first call - the server refuses to decide and returns the restatement to show ' +
                'the owner.',
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
          description:
            'CONSEQUENTIAL: records the owner decision through Preston\'s authoritative owner-only, ' +
            'one-time, audited decision path. SERVER-ENFORCED two-step handshake: a call without a ' +
            'valid owner_confirmation makes NO decision - it returns a restatement of the exact ' +
            'approval_id and action text plus the required confirmation phrase. The decision only ' +
            'happens when owner_confirmation is the owner\'s OWN message naming the exact approval ' +
            'id (e.g. "Approve apr-...."). Ambiguous requests like "approve that" must never be ' +
            'resolved to an approval id; ask the owner for the exact id instead. Already-decided ' +
            'or expired approvals are refused.',
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
    },
  };
}
