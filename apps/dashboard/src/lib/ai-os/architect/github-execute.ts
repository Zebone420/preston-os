import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { hasSecretText } from '../commands';
import {
  type ApprovalDecisionInput,
  type ApprovalRequest,
  type MakeApprovalInput,
  type MakeApprovalResult,
  makeApprovalRequest,
  validateApprovalDecision,
} from '../orchestration/approvals';
import {
  UNIVERSAL_PROHIBITIONS,
  canAgentPerform,
} from '../orchestration/agent-contracts';
import { requireAttribution } from './actor';
import {
  githubChangeDigest,
  isStale,
  validateGithubChangeEnvelope,
  type GithubChangeEnvelope,
} from './change-binding';
import { hasRequiredEvidence } from './evidence';
import { buildPrPayload, type GithubPrPayload } from './pr-provenance';
import type { ArchitectProposal } from './proposal';
import { evaluateRepoAllowlist } from './repo-policy';
import { isBranchAllowed, isProtectedBase } from './branch-policy';

const execFile = promisify(execFileCallback);

export interface CurrentGithubChangeState {
  base_sha: string;
  diff_hash: string;
}

export interface GithubPrRecord {
  created_at: string;
  head_sha: string;
  pr_number: number;
  pr_url: string;
}

export interface GithubExecutionIo {
  findExistingPr(change: GithubChangeEnvelope): Promise<GithubPrRecord | null>;
  openPr(repo: string, payload: GithubPrPayload): Promise<GithubPrRecord>;
  pushExact(change: GithubChangeEnvelope): Promise<void>;
  readCurrentState(change: GithubChangeEnvelope): Promise<CurrentGithubChangeState>;
}

export interface GithubExecutionCache {
  get(key: string): GithubPrRecord | undefined;
  set(key: string, value: GithubPrRecord): void;
}

export interface ExecuteGithubProposalInput {
  approval_decision: ApprovalDecisionInput;
  approval_request: ApprovalRequest;
  proposal: ArchitectProposal;
}

export interface ExecuteGithubProposalContext {
  cache: GithubExecutionCache;
  env?: Record<string, string | undefined>;
  io: GithubExecutionIo;
  seen_nonces?: ReadonlySet<string>;
}

export type ExecuteGithubProposalResult =
  | { executed: true; idempotent: boolean; pr: GithubPrRecord; reused_existing_pr: boolean }
  | { executed: false; reason: string };

function refuse(reason: string): ExecuteGithubProposalResult {
  return { executed: false, reason };
}

export type MakeGithubApprovalInput = Omit<MakeApprovalInput,
  'action' | 'affected_resource' | 'risk_class' | 'evidence_refs' | 'owner_identity'>;

// The ordinary approval builder remains the source of expiry, environment,
// owner and message validation. This narrow adapter replaces only its generic
// action hash with the AG-4 cryptographic digest, making exact-SHA approval a
// canonical path rather than relying on hand-built ApprovalRequest objects.
export function makeGithubApprovalRequest(
  proposal: ArchitectProposal,
  input: MakeGithubApprovalInput,
): MakeApprovalResult {
  if (!proposal.actor.approver) {
    return { ok: false, errors: ['architect_approver_required'] };
  }
  const built = makeApprovalRequest({
    ...input,
    action: 'push exact pinned change and open pull request',
    affected_resource: `${proposal.change.repo}@${proposal.change.head_sha}`,
    risk_class: proposal.risk_class,
    evidence_refs: [...proposal.evidence_refs],
    owner_identity: proposal.actor.approver,
  });
  if (!built.ok) return built;
  return {
    ok: true,
    request: { ...built.request, action_hash: githubChangeDigest(proposal.change) },
  };
}

function authorizationChecks(
  input: ExecuteGithubProposalInput,
  env: Record<string, string | undefined>,
  currentDigest: string,
): string | null {
  const { proposal, approval_request: request, approval_decision: decision } = input;
  const actor = requireAttribution(proposal.actor);
  if (!actor.ok) return `actor_invalid:${actor.errors.join(',')}`;
  if (!canAgentPerform(actor.attribution.executor, 'propose_github_change')) {
    return 'executor_capability_denied';
  }
  if (!UNIVERSAL_PROHIBITIONS.includes('push')) return 'push_prohibition_missing';
  if (proposal.status !== 'approved') return 'proposal_not_approved';
  if (proposal.policy_decision?.requires_approval !== true) {
    return 'policy_approval_not_required';
  }
  if (proposal.change.repo !== proposal.request.repo) return 'request_change_repo_mismatch';
  if (proposal.change.base_branch !== proposal.request.base_branch) {
    return 'request_change_base_mismatch';
  }
  if (!isBranchAllowed(proposal.change.head_branch, proposal.request.correlation_id) ||
      isProtectedBase(proposal.change.head_branch)) return 'head_branch_denied';
  const allowlist = evaluateRepoAllowlist(
    proposal.change.repo, env.ARCHITECT_REPO_ALLOWLIST,
  );
  if (!allowlist.allowed) return `repo_denied:${allowlist.reason}`;
  if (request.action_hash !== currentDigest) return 'approval_request_hash_mismatch';
  if (decision.presented_hash !== currentDigest) return 'approval_presented_hash_mismatch';
  if (request.owner_identity !== proposal.actor.approver) return 'approval_owner_mismatch';
  if (decision.decided_by !== proposal.actor.approver) return 'approval_actor_mismatch';
  if (decision.outcome !== 'approve') return 'approval_not_approved';
  const outboundPayload = buildPrPayload(proposal);
  if (hasSecretText(outboundPayload.title, outboundPayload.body)) {
    return 'secret_boundary_refusal';
  }
  return null;
}

export async function executeGithubProposal(
  input: ExecuteGithubProposalInput,
  context: ExecuteGithubProposalContext,
): Promise<ExecuteGithubProposalResult> {
  const env = context.env ?? process.env;
  if (env.ARCHITECT_GITHUB_EXECUTE_ENABLED !== 'true') return refuse('execution_disabled');
  if (!env.ARCHITECT_GITHUB_TOKEN) return refuse('github_token_missing');

  const validated = validateGithubChangeEnvelope(input.proposal.change);
  if (!validated.ok) return refuse(`change_invalid:${validated.errors.join(',')}`);
  const digest = githubChangeDigest(input.proposal.change);
  const denied = authorizationChecks(input, env, digest);
  if (denied) return refuse(denied);
  const evidence = hasRequiredEvidence(input.proposal);
  if (!evidence.complete) return refuse(`evidence_incomplete:${evidence.missing.join(',')}`);
  const approval = validateApprovalDecision(
    input.approval_request,
    input.approval_decision,
    context.seen_nonces ?? new Set<string>(),
    input.proposal.actor.proposer,
  );
  if (!approval.ok || approval.status !== 'approved') {
    return refuse(`approval_invalid:${approval.reason}`);
  }

  let current: CurrentGithubChangeState;
  try {
    current = await context.io.readCurrentState(input.proposal.change);
  } catch {
    return refuse('github_state_unavailable');
  }
  const stale = isStale(input.proposal.change, current.base_sha, current.diff_hash);
  if (stale.stale) return refuse(`change_stale:${stale.reasons.join(',')}`);

  const cacheKey = `${input.approval_request.approval_id}:${digest}`;
  const cached = context.cache.get(cacheKey);
  if (cached) {
    if (cached.head_sha !== input.proposal.change.head_sha) {
      return refuse('cached_head_sha_mismatch');
    }
    return { executed: true, idempotent: true, pr: cached, reused_existing_pr: true };
  }
  let existing: GithubPrRecord | null;
  try {
    existing = await context.io.findExistingPr(input.proposal.change);
  } catch {
    return refuse('github_pr_lookup_failed');
  }
  if (existing) {
    if (existing.head_sha !== input.proposal.change.head_sha) {
      return refuse('existing_pr_head_sha_mismatch');
    }
    context.cache.set(cacheKey, existing);
    return { executed: true, idempotent: true, pr: existing, reused_existing_pr: true };
  }

  try {
    await context.io.pushExact(input.proposal.change);
  } catch {
    return refuse('github_push_failed');
  }
  let opened: GithubPrRecord;
  try {
    opened = await context.io.openPr(
      input.proposal.change.repo, buildPrPayload(input.proposal),
    );
  } catch {
    return refuse('github_pr_open_failed_after_push');
  }
  if (opened.head_sha !== input.proposal.change.head_sha) {
    return refuse('opened_pr_head_sha_mismatch');
  }
  context.cache.set(cacheKey, opened);
  return { executed: true, idempotent: false, pr: opened, reused_existing_pr: false };
}

interface NativeGithubIoOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  readCurrentDiffHash(change: GithubChangeEnvelope): Promise<string>;
}

interface GithubApiPr {
  created_at?: string;
  head?: { sha?: string };
  html_url?: string;
  number?: number;
}

export function makeNativeGithubIo(options: NativeGithubIoOptions): GithubExecutionIo {
  const env = options.env ?? process.env;
  const token = env.ARCHITECT_GITHUB_TOKEN;
  if (!token) throw new Error('github_token_missing');
  const apiBase = (env.ARCHITECT_GITHUB_API_BASE ?? 'https://api.github.com')
    .replace(/\/$/, '');

  async function githubFetch(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`github_api_${response.status}`);
    return response.json();
  }
  function splitRepo(repo: string): [string, string] {
    const parts = repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('repo_invalid');
    return [parts[0], parts[1]];
  }
  return {
    async readCurrentState(change) {
      const [owner, repository] = splitRepo(change.repo);
      const branch = encodeURIComponent(change.base_branch);
      const raw = await githubFetch(`/repos/${owner}/${repository}/branches/${branch}`) as {
        commit?: { sha?: string };
      };
      if (!raw.commit?.sha) throw new Error('github_base_sha_missing');
      return { base_sha: raw.commit.sha, diff_hash: await options.readCurrentDiffHash(change) };
    },
    async findExistingPr(change) {
      const [owner, repository] = splitRepo(change.repo);
      const head = encodeURIComponent(`${owner}:${change.head_branch}`);
      const raw = await githubFetch(
        `/repos/${owner}/${repository}/pulls?state=open&head=${head}`,
      ) as GithubApiPr[];
      const exact = raw.find((candidate) => candidate.head?.sha === change.head_sha);
      if (!exact) return null;
      if (!exact.number || !exact.html_url || !exact.created_at) {
        throw new Error('github_pr_shape_invalid');
      }
      return { created_at: exact.created_at, head_sha: change.head_sha,
        pr_number: exact.number, pr_url: exact.html_url };
    },
    async pushExact(change) {
      const childEnv: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        GIT_TERMINAL_PROMPT: '0',
      };
      await execFile('git', [
        'push', 'origin', `${change.head_sha}:refs/heads/${change.head_branch}`,
      ], { cwd: options.cwd, env: childEnv, windowsHide: true });
    },
    async openPr(repo, payload) {
      const [owner, repository] = splitRepo(repo);
      const raw = await githubFetch(`/repos/${owner}/${repository}/pulls`, {
        method: 'POST', body: JSON.stringify(payload),
      }) as GithubApiPr;
      if (!raw.number || !raw.html_url || !raw.head?.sha || !raw.created_at) {
        throw new Error('github_pr_shape_invalid');
      }
      return { created_at: raw.created_at, head_sha: raw.head.sha,
        pr_number: raw.number, pr_url: raw.html_url };
    },
  };
}
