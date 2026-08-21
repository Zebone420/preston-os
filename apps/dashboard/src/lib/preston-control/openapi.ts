// Preston Control - OpenAPI 3.1 document for the Custom GPT Actions surface.
// PURE. Hand-bounded: six operations, strict request schemas mirroring
// schemas.ts, no generic endpoints. x-openai-isConsequential marks the two
// write operations so ChatGPT asks the owner before calling (the approval
// decision is additionally one-time + owner-only in the DB regardless).
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
            'Submit a build / fix / investigate / audit / research / implement mission. Preston decomposes ' +
            'it, classifies risk, parks gated work behind owner approval, and the runtime executes it. ' +
            'Idempotent on request_id. Returns accepted | duplicate | rejected with goal and job ids.',
          'x-openai-isConsequential': true,
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
            'one-time, audited decision path. Always confirm the approval_id and action text with the ' +
            'owner first. Already-decided or expired approvals are refused.',
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
