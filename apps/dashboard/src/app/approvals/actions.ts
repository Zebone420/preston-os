'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOwnerEmail } from '@/lib/owner-auth';
import {
  decideApprovalRow,
  type ControlPlaneClient,
} from '@/lib/approvals-store';
import { getServerSupabase } from '@/lib/supabase/server';

// Owner decision server action. A Server Action is a public POST entry
// point (see node_modules/next/dist/docs/01-app/02-guides/server-actions.md
// "Security"), so the owner check is re-done HERE, inside the action -
// the proxy gate and Supabase RLS are additional layers, not substitutes.
// This action records a decision in the control plane and executes
// NOTHING. No secrets are read, logged, or returned.
export async function decideApproval(formData: FormData) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    // Setup mode: no auth env, no client, no write path.
    redirect('/approvals?msg=setup_mode');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isOwnerEmail(user.email, process.env)) {
    // Fail closed: unauthenticated or non-owner POSTs change nothing.
    redirect('/approvals?msg=denied');
  }

  const approvalId = String(formData.get('approval_id') ?? '');
  const decisionRaw = String(formData.get('decision') ?? '');
  const decision =
    decisionRaw === 'approved' || decisionRaw === 'rejected'
      ? decisionRaw
      : null;
  if (!decision) {
    redirect('/approvals?msg=invalid');
  }

  const outcome = await decideApprovalRow(
    supabase as unknown as ControlPlaneClient,
    {
      approvalId,
      decision,
      now: new Date().toISOString(),
    },
  );

  revalidatePath('/approvals');
  redirect('/approvals?msg=' + outcome.code);
}
