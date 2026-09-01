// Hermes Supervisor Dashboard v0 - Preston Control data adapter.
//
// Hermes is the dashboard/business interface ABOVE Preston Control. It is
// NOT a second control plane. This adapter is the ONLY doorway between
// Hermes surfaces and the Preston platform, and it exposes EXACTLY the
// supported READ operations of the sealed Preston Control service layer:
//
//   getPrestonStatus     -> tools.prestonStatus
//   getPrestonGoal       -> tools.prestonGetGoal
//   getPrestonJob        -> tools.prestonGetJob
//   listPrestonApprovals -> tools.prestonListApprovals
//   pollPrestonEvents    -> tools.prestonPollEvents
//   getPrestonEvidence   -> tools.prestonGetEvidence
//   getPrestonArtifact   -> tools.prestonGetArtifact
//
// Deliberately ABSENT (guardrail-pinned in test/hermes-guardrails.test.ts):
// submit, follow-up, approval decisions, goal cancellation, any
// owner-confirmation phrase composition, and any direct SSOT table query.
// Hermes
// observes; every action stays with the owner through Preston Control.
//
// The tool handlers already project rows through explicit allowlists and
// screen free text for secrets; this adapter never re-widens their output.

import type { OwnerContext } from '@/lib/ai-os/owner-context';
import type { ComposerClient } from '@/lib/ai-os/orchestration/composer-persist';
import {
  prestonGetArtifact,
  prestonGetEvidence,
  prestonGetGoal,
  prestonGetJob,
  prestonListApprovals,
  prestonPollEvents,
  prestonStatus,
  type ToolContext,
} from '@/lib/preston-control/tools';

// Authoritative result shapes come from the tool layer itself - Hermes
// never redefines them, so a platform change cannot drift silently.
export type PrestonStatusResult = Awaited<ReturnType<typeof prestonStatus>>;
export type PrestonGoalResult = Awaited<ReturnType<typeof prestonGetGoal>>;
export type PrestonJobResult = Awaited<ReturnType<typeof prestonGetJob>>;
export type PrestonApprovalsResult =
  Awaited<ReturnType<typeof prestonListApprovals>>;
export type PrestonEventsResult =
  Awaited<ReturnType<typeof prestonPollEvents>>;
export type PrestonEvidenceResult =
  Awaited<ReturnType<typeof prestonGetEvidence>>;
export type PrestonArtifactResult =
  Awaited<ReturnType<typeof prestonGetArtifact>>;

// Build the tool context from the owner's RLS-bound dashboard session.
// Same shape controlRoute (REST) and the MCP server hand to the tools:
// the DB stays the authority for every read.
export function hermesToolContext(
  ctx: OwnerContext,
  now: string = new Date().toISOString(),
): ToolContext {
  return {
    client: ctx.client as unknown as ComposerClient,
    ownerEmail: ctx.ownerEmail,
    now,
  };
}

export function getPrestonStatus(
  ctx: ToolContext,
): Promise<PrestonStatusResult> {
  return prestonStatus(ctx);
}

export function getPrestonGoal(
  ctx: ToolContext,
  goalId: string,
): Promise<PrestonGoalResult> {
  return prestonGetGoal(ctx, goalId);
}

export function getPrestonJob(
  ctx: ToolContext,
  jobId: string,
): Promise<PrestonJobResult> {
  return prestonGetJob(ctx, jobId);
}

export function listPrestonApprovals(
  ctx: ToolContext,
): Promise<PrestonApprovalsResult> {
  return prestonListApprovals(ctx);
}

export function pollPrestonEvents(
  ctx: ToolContext,
  input: { cursor?: string; limit?: number },
): Promise<PrestonEventsResult> {
  return prestonPollEvents(ctx, input);
}

export function getPrestonEvidence(
  ctx: ToolContext,
  input: { goal_id?: string; job_id?: string },
): Promise<PrestonEvidenceResult> {
  return prestonGetEvidence(ctx, input);
}

export function getPrestonArtifact(
  ctx: ToolContext,
  artifactId: string,
): Promise<PrestonArtifactResult> {
  return prestonGetArtifact(ctx, artifactId);
}
