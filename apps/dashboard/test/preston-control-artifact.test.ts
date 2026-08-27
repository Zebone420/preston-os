// Preston Control - preston_get_artifact (power-station master goal
// section 7). Pins: id-format fail-closed, metadata projection through the
// owner RLS read, short-lived signed retrieval, storage-unavailable and
// platform-not-activated fail-closed shapes, retention gating, catalogue +
// OpenAPI registration, and NO bucket-browsing surface.

import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SIGNED_URL_TTL_SECONDS,
  prestonGetArtifact,
  type ToolContext,
} from '../src/lib/preston-control/tools';
import { TOOL_NAMES } from '../src/lib/preston-control/server';
import { buildOpenApiDocument } from '../src/lib/preston-control/openapi';
import { GetArtifactSchema } from '../src/lib/preston-control/schemas';
import type { ComposerClient } from '../src/lib/ai-os/orchestration/composer-persist';

const NOW = '2026-08-27T12:00:00.000Z';
const ART_ID = 'art-0123456789abcdef0123456789abcdef';

function artifactRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifact_id: ART_ID,
    goal_id: 'goal-1', job_id: 'job-1', run_id: 'run-1',
    artifact_type: 'document', name: 'docs/report.md',
    object_path: 'goal/goal-1/job/job-1/run/run-1/docs__report.md',
    sha256: 'a'.repeat(64), mime_type: 'text/markdown', size_bytes: 42,
    created_by: 'claude', provider: 'claude', commit_sha: null,
    environment: 'staging', classification: 'internal',
    retention_state: 'active', created_at: NOW,
    ...over,
  };
}

function makeCtx(opts: {
  rows?: Record<string, unknown>[];
  readError?: string;
  withStorage?: boolean;
  signFails?: boolean;
} = {}): ToolContext {
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                limit() {
                  if (opts.readError) {
                    return Promise.resolve({ data: null, error: { message: opts.readError } });
                  }
                  return Promise.resolve({
                    data: table === 'artifacts' ? (opts.rows ?? []) : [],
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
    rpc() { return Promise.resolve({ data: null, error: { message: 'none' } }); },
  } as unknown as ComposerClient;
  if (opts.withStorage) {
    (client as unknown as { storage: unknown }).storage = {
      from() {
        return {
          createSignedUrl(path: string, ttl: number) {
            if (opts.signFails) {
              return Promise.resolve({ data: null, error: { message: 'sign refused' } });
            }
            return Promise.resolve({
              data: { signedUrl: `https://signed.example/${path}?t=${ttl}` },
              error: null,
            });
          },
        };
      },
    };
  }
  return { client, ownerEmail: 'info@preston.nyc', now: NOW };
}

describe('preston_get_artifact', () => {
  it('rejects malformed artifact ids fail-closed', async () => {
    for (const bad of ['', 'art-123', 'not-an-id', 'art-' + 'Z'.repeat(32)]) {
      const r = await prestonGetArtifact(makeCtx(), bad);
      expect(r).toEqual({ found: false, error: 'artifact_id_invalid' });
    }
  });

  it('distinguishes platform-not-activated (0027 absent) from a read failure', async () => {
    const gone = await prestonGetArtifact(
      makeCtx({ readError: 'relation "public.artifacts" does not exist' }), ART_ID);
    expect(gone).toEqual({ found: false, error: 'artifact_platform_not_activated' });
    const err = await prestonGetArtifact(
      makeCtx({ readError: 'service unavailable' }), ART_ID);
    expect(err).toEqual({ found: false, error: 'read_failed' });
  });

  it('returns not_found for an absent id', async () => {
    const r = await prestonGetArtifact(makeCtx({ rows: [] }), ART_ID);
    expect(r).toEqual({ found: false, error: 'not_found' });
  });

  it('projects metadata and mints a short-lived signed URL', async () => {
    const r = await prestonGetArtifact(
      makeCtx({ rows: [artifactRow()], withStorage: true }), ART_ID);
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.artifact.sha256).toBe('a'.repeat(64));
    expect(r.artifact.name).toBe('docs/report.md');
    expect(r.retrieval).toBe('ok');
    expect(r.signed_url).toContain('https://signed.example/');
    expect(r.signed_url_expires_in_seconds).toBe(ARTIFACT_SIGNED_URL_TTL_SECONDS);
    expect(ARTIFACT_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(600); // short-lived
    // storage credentials / object internals never leak
    expect(JSON.stringify(r)).not.toContain('service_role');
  });

  it('fails closed to metadata-only when storage is unavailable or signing fails', async () => {
    const noStorage = await prestonGetArtifact(
      makeCtx({ rows: [artifactRow()] }), ART_ID);
    if (!noStorage.found) throw new Error('should be found');
    expect(noStorage.retrieval).toBe('storage_unavailable');
    expect(noStorage.signed_url).toBeNull();
    const signFail = await prestonGetArtifact(
      makeCtx({ rows: [artifactRow()], withStorage: true, signFails: true }), ART_ID);
    if (!signFail.found) throw new Error('should be found');
    expect(signFail.signed_url).toBeNull();
  });

  it('a non-active retention state yields metadata WITHOUT retrieval', async () => {
    const r = await prestonGetArtifact(
      makeCtx({ rows: [artifactRow({ retention_state: 'expired' })], withStorage: true }),
      ART_ID);
    if (!r.found) throw new Error('should be found');
    expect(r.retrieval).toBe('retention_not_active');
    expect(r.signed_url).toBeNull();
  });
});

describe('surface registration', () => {
  it('the MCP catalogue includes preston_get_artifact', () => {
    expect(TOOL_NAMES).toContain('preston_get_artifact');
  });
  it('the OpenAPI document exposes getPrestonArtifact read-only and nothing bucket-wide', () => {
    const doc = buildOpenApiDocument('https://preston-os-staging.vercel.app');
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    const op = paths['/api/control/artifacts/{artifact_id}']?.get;
    expect(op).toBeDefined();
    expect(op.operationId).toBe('getPrestonArtifact');
    expect(op['x-openai-isConsequential']).toBe(false);
    // no listing/browsing surface exists
    expect(paths['/api/control/artifacts']).toBeUndefined();
  });
  it('the input schema accepts only the exact id shape', () => {
    expect(GetArtifactSchema.safeParse({ artifact_id: ART_ID }).success).toBe(true);
    expect(GetArtifactSchema.safeParse({ artifact_id: 'art-xyz' }).success).toBe(false);
    expect(GetArtifactSchema.safeParse({ artifact_id: ART_ID, extra: 1 }).success).toBe(false);
  });
});
