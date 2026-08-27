// Preston AI OS - durable artifact platform (power-station master goal
// sections 5/6). Server-side. The smallest write contract that makes worker
// output SURVIVE worktree cleanup:
//
//   worker file -> validate allowed path -> secret screen -> hash -> upload
//     -> metadata row -> evidence ref (artifact:<id>) -> worktree may clean
//
// Posture rules:
//   - ENV-GATED (ORCH_ARTIFACTS_ENABLED=true): unset => this module performs
//     ZERO storage/DB operations - provider-free Preston pays nothing.
//   - Deterministic ids + object paths => idempotent uploads (a replayed run
//     converges on the same object + row; uq_artifacts_object_path).
//   - Path traversal / absolute paths / unknown extensions REJECTED.
//   - Text artifacts are secret-screened; a hit fails THAT file closed.
//   - A persistence failure after successful real work NEVER fabricates
//     success: the pass reports condition 'artifact_unrecorded', the job
//     carries an artifact_unrecorded evidence ref, and the attention loop
//     surfaces it (master goal section 6 - never silently lose work).
//
// Storage: the private per-environment Supabase Storage bucket 'artifacts'
// (owner Gate C creates it; migration 0027 holds the metadata table). The
// runtime identity's existing JWT authorizes through storage RLS - no new
// secret, no new vendor.

import { createHash } from 'node:crypto';
import { hasSecretText } from './commands';
import type { RuntimeClient, WriteOutcome } from './store';
import { insertEvent } from './store';
import { makeEnvelope } from './transport';
import { deploymentEnvironment } from './runtime-environment';

export const ARTIFACTS_ENABLED_ENV = 'ORCH_ARTIFACTS_ENABLED';
export const ARTIFACT_BUCKET = 'artifacts';
export const MAX_ARTIFACTS_PER_RUN = 10;
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

// Extension -> (mime, artifact_type, text?). A file outside this table is
// refused (fail closed; widen deliberately, per change review).
const EXT_TABLE: Readonly<Record<string, { mime: string; type: string; text: boolean }>> = {
  '.md': { mime: 'text/markdown', type: 'document', text: true },
  '.txt': { mime: 'text/plain', type: 'document', text: true },
  '.json': { mime: 'application/json', type: 'data', text: true },
  '.csv': { mime: 'text/csv', type: 'export', text: true },
  '.html': { mime: 'text/html', type: 'document', text: true },
  '.diff': { mime: 'text/plain', type: 'diff', text: true },
  '.patch': { mime: 'text/plain', type: 'diff', text: true },
  '.pdf': { mime: 'application/pdf', type: 'document', text: false },
  '.png': { mime: 'image/png', type: 'image', text: false },
  // Prod audit finding PF4 (2026-08-27): a completed CODE job's edits exist
  // ONLY in its worktree, which is force-removed after the run - and every
  // source extension was refused here, so the entire work product was
  // silently dropped with condition 'ok'. Deliberate widening (this is the
  // change review the header demands): the source types the platform's own
  // code/test/migration jobs produce, all TEXT (secret-screened) and served
  // as text/plain so a retrieved artifact can never execute in a browser.
  // Shell/PowerShell scripts stay refused (pinned in artifact-platform
  // tests): workers have no reason to produce them and they are the
  // platform's own guard surface.
  '.ts': { mime: 'text/plain', type: 'code', text: true },
  '.tsx': { mime: 'text/plain', type: 'code', text: true },
  '.js': { mime: 'text/plain', type: 'code', text: true },
  '.mjs': { mime: 'text/plain', type: 'code', text: true },
  '.cjs': { mime: 'text/plain', type: 'code', text: true },
  '.sql': { mime: 'text/plain', type: 'code', text: true },
  '.yml': { mime: 'text/plain', type: 'code', text: true },
  '.yaml': { mime: 'text/plain', type: 'code', text: true },
  '.css': { mime: 'text/plain', type: 'code', text: true },
};

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export type PathValidation =
  | { ok: true; ext: string }
  | { ok: false; reason: string };

// Relative, forward-slash, traversal-free, allowlisted extension.
export function validateArtifactPath(rel: string): PathValidation {
  const p = String(rel ?? '');
  if (!p || p.length > 400) return { ok: false, reason: 'path_length' };
  if (p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
    return { ok: false, reason: 'path_not_relative' };
  }
  const segments = p.split('/');
  if (segments.length > 12) return { ok: false, reason: 'path_depth' };
  for (const s of segments) {
    if (s === '.' || s === '..' || !SEGMENT_RE.test(s)) {
      return { ok: false, reason: 'path_segment_invalid' };
    }
  }
  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!EXT_TABLE[ext]) return { ok: false, reason: 'extension_not_allowed' };
  return { ok: true, ext };
}

export function artifactObjectPath(
  goalId: string, jobId: string, runId: string, rel: string,
): string {
  // Flatten the relative path into a single safe filename segment so the
  // object key depth is fixed (goal/<g>/job/<j>/run/<r>/<file>).
  //
  // Prod audit finding PF3 (2026-08-27): bare '__' flattening COLLIDED for
  // distinct sources ('a/b.md' and a literal file 'a__b.md' both flattened
  // to 'a__b.md'), so the second upsert overwrote the first object while
  // its metadata row deduplicated as a replay - the stored sha256 then
  // described the WRONG bytes. The object key now embeds an 8-hex sha256
  // tag of the ORIGINAL relative path: distinct sources get distinct keys
  // deterministically, and an idempotent replay of the same source still
  // converges on the same key. persistArtifacts additionally fails closed
  // on any residual in-pass destination conflict.
  const flat = rel.replace(/\//g, '__');
  const tag = createHash('sha256').update(rel, 'utf8').digest('hex').slice(0, 8);
  return `goal/${goalId}/job/${jobId}/run/${runId}/${tag}-${flat}`;
}

export function deriveArtifactId(objectPath: string): string {
  const h = createHash('sha256').update(objectPath, 'utf8').digest('hex');
  return `art-${h.slice(0, 32)}`;
}

// Value-shaped secret spans (mirrors structured-result SECRET_SPANS; a text
// artifact carrying one is refused rather than scrubbed - artifacts are
// verbatim work product, so a modified upload would lie about its hash).
const SECRET_VALUE_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  /-----BEGIN[\s\S]{0,200}?PRIVATE KEY/,
  /\bghp_[A-Za-z0-9]{10,}/,
];

export function textLooksSecret(text: string): boolean {
  if (hasSecretText(text)) return true;
  return SECRET_VALUE_SHAPES.some((re) => re.test(text));
}

// Storage seam. The runtime binds the real supabase-js storage API
// (bindSupabaseArtifactStorage); tests bind fakes. upload MUST be
// idempotent for the same object path (upsert semantics).
export interface ArtifactStorage {
  upload(objectPath: string, bytes: Uint8Array, contentType: string):
    Promise<{ ok: boolean; error?: string }>;
  createSignedUrl(objectPath: string, ttlSeconds: number):
    Promise<{ ok: boolean; url?: string; error?: string }>;
}

// Bind the supabase-js storage surface when the client carries one (the
// real runtime client does; PostgREST-only fakes do not => null, callers
// fail closed).
export function bindSupabaseArtifactStorage(
  client: RuntimeClient,
): ArtifactStorage | null {
  const storage = (client as unknown as {
    storage?: { from: (bucket: string) => {
      upload: (path: string, body: Uint8Array, opts: Record<string, unknown>) =>
        Promise<{ error: { message: string } | null }>;
      createSignedUrl: (path: string, ttl: number) =>
        Promise<{ data: { signedUrl?: string } | null; error: { message: string } | null }>;
    } };
  }).storage;
  if (!storage || typeof storage.from !== 'function') return null;
  return {
    async upload(objectPath, bytes, contentType) {
      try {
        const res = await storage.from(ARTIFACT_BUCKET)
          .upload(objectPath, bytes, { contentType, upsert: true });
        return res.error ? { ok: false, error: res.error.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'upload failed' };
      }
    },
    async createSignedUrl(objectPath, ttlSeconds) {
      try {
        const res = await storage.from(ARTIFACT_BUCKET)
          .createSignedUrl(objectPath, ttlSeconds);
        if (res.error || !res.data?.signedUrl) {
          return { ok: false, error: res.error?.message ?? 'no signed url' };
        }
        return { ok: true, url: res.data.signedUrl };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'sign failed' };
      }
    },
  };
}

export interface PersistArtifactsDeps {
  client: RuntimeClient;
  storage: ArtifactStorage | null;
  env: Record<string, string | undefined>;
  // Bounded file reader for the (already path-audited) worktree. Throws on
  // unreadable files.
  readFileBytes: (workspaceRelPath: string) => Uint8Array;
  now: () => number;
  log?: (fields: Record<string, unknown>) => void;
}

export interface PersistArtifactsInput {
  goal_id: string;
  job_id: string;
  run_id: string;
  files: string[]; // worktree-relative touched paths (post-audit)
  created_by: string;
  provider: string | null;
  commit_sha: string | null;
}

export interface PersistArtifactsResult {
  condition: 'disabled' | 'ok' | 'artifact_unrecorded';
  artifact_refs: string[]; // artifact:<id> for each persisted file
  rejected: Array<{ path: string; reason: string }>;
  failed: Array<{ path: string; reason: string }>;
}

export function artifactsEnabled(env: Record<string, string | undefined>): boolean {
  return String(env[ARTIFACTS_ENABLED_ENV] ?? '').trim() === 'true';
}

export async function persistArtifacts(
  deps: PersistArtifactsDeps,
  input: PersistArtifactsInput,
): Promise<PersistArtifactsResult> {
  const res: PersistArtifactsResult = {
    condition: 'disabled', artifact_refs: [], rejected: [], failed: [],
  };
  if (!artifactsEnabled(deps.env)) return res; // fully inert (zero ops)
  res.condition = 'ok';
  const nowIso = new Date(deps.now()).toISOString();

  if (!deps.storage) {
    // Enabled but no storage surface: EVERY candidate file is unrecorded.
    res.condition = input.files.length ? 'artifact_unrecorded' : 'ok';
    res.failed = input.files.slice(0, MAX_ARTIFACTS_PER_RUN)
      .map((p) => ({ path: p, reason: 'storage_unavailable' }));
    await recordPassEvent(deps, input, res, nowIso);
    return res;
  }

  const candidates = input.files.slice(0, MAX_ARTIFACTS_PER_RUN);
  if (input.files.length > MAX_ARTIFACTS_PER_RUN) {
    for (const p of input.files.slice(MAX_ARTIFACTS_PER_RUN)) {
      res.rejected.push({ path: p, reason: 'artifact_cap_exceeded' });
    }
  }

  // Belt on top of the hash-tagged object path (PF3): two candidates in the
  // SAME pass must never target one destination - the second is refused,
  // never uploaded over the first.
  const usedObjectPaths = new Set<string>();
  for (const rel of candidates) {
    const val = validateArtifactPath(rel);
    if (!val.ok) { res.rejected.push({ path: rel, reason: val.reason }); continue; }
    const meta = EXT_TABLE[val.ext];
    let bytes: Uint8Array;
    try {
      bytes = deps.readFileBytes(rel);
    } catch {
      res.failed.push({ path: rel, reason: 'file_unreadable' });
      continue;
    }
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
      res.rejected.push({ path: rel, reason: 'size_cap_exceeded' });
      continue;
    }
    if (meta.text && textLooksSecret(Buffer.from(bytes).toString('utf8'))) {
      // Fail closed: never upload secret-shaped content (section 6).
      res.rejected.push({ path: rel, reason: 'secret_detected' });
      continue;
    }
    const objectPath = artifactObjectPath(
      input.goal_id, input.job_id, input.run_id, rel);
    if (usedObjectPaths.has(objectPath)) {
      res.rejected.push({ path: rel, reason: 'object_path_conflict' });
      continue;
    }
    usedObjectPaths.add(objectPath);
    const artifactId = deriveArtifactId(objectPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const up = await deps.storage.upload(objectPath, bytes, meta.mime);
    if (!up.ok) {
      res.failed.push({ path: rel, reason: 'upload_failed' });
      continue;
    }
    const row = await insertArtifactRow(deps.client, {
      artifact_id: artifactId,
      goal_id: input.goal_id, job_id: input.job_id, run_id: input.run_id,
      artifact_type: meta.type, name: rel, object_path: objectPath,
      sha256, mime_type: meta.mime, size_bytes: bytes.byteLength,
      created_by: input.created_by, provider: input.provider,
      commit_sha: input.commit_sha,
    }, nowIso);
    if (!row.ok) {
      res.failed.push({ path: rel, reason: 'metadata_unrecorded' });
      continue;
    }
    res.artifact_refs.push(`artifact:${artifactId}`);
  }

  if (res.failed.length > 0) res.condition = 'artifact_unrecorded';
  await recordPassEvent(deps, input, res, nowIso);
  return res;
}

async function insertArtifactRow(
  client: RuntimeClient,
  row: Record<string, unknown>,
  nowIso: string,
): Promise<WriteOutcome> {
  try {
    const res = await client.from('artifacts').insert({
      ...row,
      environment: deploymentEnvironment(),
      classification: 'internal',
      retention_policy: 'standard',
      retention_state: 'active',
      created_at: nowIso,
    }).select('artifact_id');
    if (res.error) {
      if (/duplicate key|unique constraint|already exists/i.test(res.error.message)) {
        return { ok: true, duplicate: true, id: String(row.artifact_id) };
      }
      return { ok: false, error: res.error.message };
    }
    return { ok: true, id: String(row.artifact_id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'artifact row failed' };
  }
}

// One idempotent ArtifactRecorded event per run pass - the durable, readable
// record of what persisted and what went UNRECORDED (attention surfaces the
// latter). A failed append never changes the pass outcome.
async function recordPassEvent(
  deps: PersistArtifactsDeps,
  input: PersistArtifactsInput,
  res: PersistArtifactsResult,
  nowIso: string,
): Promise<void> {
  try {
    const id = `ev-artifacts-${input.job_id}-${input.run_id}`;
    await insertEvent(deps.client, makeEnvelope({
      id,
      type: 'ArtifactRecorded',
      actor: input.created_by,
      source: 'artifact-persist',
      correlation_id: `artifacts:job:${input.job_id}`,
      idempotency_key: id,
      now: nowIso,
      payload: {
        goal_id: input.goal_id, job_id: input.job_id, run_id: input.run_id,
        condition: res.condition,
        artifact_refs: res.artifact_refs.slice(0, MAX_ARTIFACTS_PER_RUN),
        rejected: res.rejected.slice(0, MAX_ARTIFACTS_PER_RUN),
        failed: res.failed.slice(0, MAX_ARTIFACTS_PER_RUN),
      },
    }));
  } catch {
    deps.log?.({ event: 'artifact_persist', error: 'event_append_failed' });
  }
}
