'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { composeRequest } from '@/lib/ai-os/orchestration/composer';
import {
  confirmComposedRequest,
  type ComposerClient,
} from '@/lib/ai-os/orchestration/composer-persist';
import { isMigrationAbsentError } from '@/lib/ai-os/orchestration/read-model';
import { INITIAL_COMPOSER_STATE, type ComposerActionState } from './state';

// Preston AI OS - Phase 7 Composer server actions. Server Actions are public
// POST entry points, so the OWNER IS RE-CHECKED IN EACH ACTION (proxy gate +
// RLS are additional layers, not substitutes). Two-step boundary:
//   compose  - interprets the request; PURE, persists NOTHING.
//   confirm  - the owner-confirmation gate; persists the previewed proposal
//              atomically + idempotently (simulation-only staging rows).
// Nothing in either action executes, sends, deploys, approves, or escalates.

function str(fd: FormData, name: string): string {
  return String(fd.get(name) ?? '');
}

export async function composeProposalAction(
  prev: ComposerActionState,
  formData: FormData,
): Promise<ComposerActionState> {
  const ctx = await resolveOwner();
  if (!ctx) {
    return { ...INITIAL_COMPOSER_STATE, step: 'error', errors: ['owner_login_required'] };
  }
  const raw = str(formData, 'request').trim();
  const outcome = composeRequest(raw);
  if (!outcome.ok) {
    return {
      ...INITIAL_COMPOSER_STATE,
      step: 'error',
      raw_request: raw,
      errors: outcome.errors,
      notice: 'Request rejected - nothing was created.',
    };
  }
  // A fresh request key per previewed proposal: duplicate CONFIRMS of this
  // proposal are idempotent; a new compose is a new request.
  return {
    step: 'proposal',
    raw_request: raw,
    request_key: `cmpreq-${randomUUID()}`,
    proposal: outcome,
    created: [],
    replayed: false,
    errors: [],
    notice: 'Proposal only - nothing has been created yet.',
  };
}

export async function confirmProposalAction(
  prev: ComposerActionState,
  formData: FormData,
): Promise<ComposerActionState> {
  const ctx = await resolveOwner();
  if (!ctx) {
    return { ...INITIAL_COMPOSER_STATE, step: 'error', errors: ['owner_login_required'] };
  }
  const raw = str(formData, 'raw_request');
  const requestKey = str(formData, 'request_key');
  const presentedHash = str(formData, 'proposal_hash');
  const now = new Date().toISOString();

  const outcome = await confirmComposedRequest(
    ctx.client as ComposerClient,
    {
      ownerEmail: ctx.ownerEmail,
      rawRequest: raw,
      requestKey,
      presentedHash,
      now,
    },
  );

  await logAudit(
    {
      actor: 'orchestration',
      action: 'composer_confirm',
      action_class: 'GREEN',
      environment: 'staging',
      detail: {
        request_key: requestKey,
        ok: outcome.ok,
        replayed: outcome.ok ? outcome.replayed : false,
        goals: outcome.ok ? outcome.created.map((g) => g.goal_id) : [],
        errors: outcome.ok ? [] : outcome.errors.slice(0, 5),
      },
    },
    { supabase: ctx.audit },
  );
  revalidatePath('/os/orchestration');
  revalidatePath('/os/composer');

  if (!outcome.ok) {
    const first = outcome.errors[0] ?? 'confirm_failed';
    const migrationAbsent = isMigrationAbsentError(first) ||
      outcome.errors.some((e) => isMigrationAbsentError(e));
    return {
      step: 'error',
      raw_request: raw,
      request_key: requestKey,
      proposal: null,
      created: [],
      replayed: false,
      errors: migrationAbsent
        ? ['migration_0010_not_applied', ...outcome.errors]
        : outcome.errors,
      notice: outcome.compensated.length > 0
        ? `Creation failed; compensating cancellation applied to: ${outcome.compensated.join(', ')}`
        : 'Creation failed - no active goal graph was left behind.',
    };
  }
  return {
    step: 'created',
    raw_request: raw,
    request_key: requestKey,
    proposal: null,
    created: outcome.created,
    replayed: outcome.replayed,
    errors: [],
    notice: outcome.replayed
      ? 'Duplicate confirmation detected - existing records returned, nothing new created.'
      : outcome.created.some((g) => g.approval_ids.length > 0)
        ? 'Goal graph created (simulation-only). Gated tasks await owner approval.'
        : 'Goal graph created (simulation-only). All tasks are auto-runnable - no owner approval required.',
  };
}
