'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { intakeCommand } from '@/lib/ai-os/orchestration/goal-intake';
import { decomposeGoal, type TaskSpec } from '@/lib/ai-os/orchestration/decomposition';
import { persistDecomposedGoal } from '@/lib/ai-os/orchestration/store';
import type { GoalState } from '@/lib/ai-os/orchestration/model';

// Preston AI OS - Phase 7 goal submission. A Server Action is a public POST
// entry point, so the owner is re-checked HERE. Authenticated intake ->
// decomposition -> persistence. SIMULATION-ONLY: nothing executes, sends, or
// deploys. Fail-closed: a non-owner, malformed envelope, or absent migration
// 0010 all reject cleanly. The owner supplies a title + objective + a small
// ordered task list; the engine decomposes and persists it.

function str(fd: FormData, name: string): string {
  return String(fd.get(name) ?? '').trim();
}

// Parse up to 6 task rows: kind|title|objective|depends(comma of row numbers).
function readTasks(fd: FormData): TaskSpec[] {
  const tasks: TaskSpec[] = [];
  for (let i = 1; i <= 6; i++) {
    const title = str(fd, `task${i}_title`);
    const kind = str(fd, `task${i}_kind`);
    if (!title && !kind) continue;
    const deps = str(fd, `task${i}_depends`)
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((n) => `t${n}`);
    tasks.push({
      local_id: `t${i}`,
      kind: (kind || 'unknown') as TaskSpec['kind'],
      title,
      objective: str(fd, `task${i}_objective`),
      depends_on_local: deps,
    });
  }
  return tasks;
}

export async function submitMasterGoal(formData: FormData) {
  const ctx = await resolveOwner();
  if (!ctx) redirect('/os/orchestration?msg=denied');

  const now = new Date().toISOString();
  const nonce = randomUUID();
  const correlationId = `goal-${randomUUID().slice(0, 8)}`;
  const goalId = randomUUID();

  const intake = intakeCommand({
    envelope: {
      owner_identity: ctx.ownerEmail,
      source: 'dashboard',
      command_type: 'submit_master_goal',
      correlation_id: correlationId,
      nonce,
      issued_at: now,
      expires_at: new Date(Date.parse(now) + 10 * 60 * 1000).toISOString(),
      title: str(formData, 'title'),
      objective: str(formData, 'objective'),
    },
    ownerAllowlist: new Set([ctx.ownerEmail]),
    seenNonces: new Set(),
    goalId,
    now,
  });
  if (!intake.ok || intake.kind !== 'goal') {
    const detail = intake.ok ? 'not_a_goal' : intake.errors.slice(0, 5).join(',');
    redirect('/os/orchestration?msg=' + encodeURIComponent('rejected: ' + detail));
  }

  const specs = readTasks(formData);
  if (specs.length === 0) {
    redirect('/os/orchestration?msg=' + encodeURIComponent('rejected: no tasks'));
  }
  const d = decomposeGoal(intake.goal, specs, () => randomUUID(), now);
  if (!d.ok) {
    redirect('/os/orchestration?msg=' + encodeURIComponent('rejected: ' + d.errors.slice(0, 5).join(',')));
  }

  const state: GoalState = {
    goal: { ...intake.goal, status: 'decomposed' },
    jobs: d.jobs,
    iteration: 0,
    started_at: now,
  };
  const persisted = await persistDecomposedGoal(ctx.client, state);

  await logAudit(
    {
      actor: 'orchestration', action: 'master_goal_submitted',
      action_class: 'GREEN', environment: 'staging',
      detail: { goal_id: goalId, jobs: d.jobs.length, persisted: persisted.ok, correlation_id: correlationId },
    },
    { supabase: ctx.audit },
  );

  revalidatePath('/os/orchestration');
  if (!persisted.ok) {
    // A migration-absent / write error surfaces here, fail-closed.
    const first = persisted.errors[0] ?? 'persist_failed';
    const migrationAbsent = /does not exist|42P01/i.test(first);
    redirect('/os/orchestration?msg=' + encodeURIComponent(
      migrationAbsent ? 'migration 0010 not applied - goal not persisted' : 'persist error: ' + first,
    ));
  }
  redirect('/os/orchestration?msg=' + encodeURIComponent(
    `goal submitted: ${d.jobs.length} jobs decomposed (simulation)`,
  ));
}
