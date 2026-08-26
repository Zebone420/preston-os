import { controlRoute } from '@/lib/preston-control/http';
import { FollowUpGoalSchema } from '@/lib/preston-control/schemas';
import { prestonFollowUpGoal } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - followUpPrestonGoal.
// WRITE (idempotent on request_id): creates a FRESH goal linked to the
// parent goal named in the path; shared service layer with the MCP surface.
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ goal_id: string }> },
) {
  const { goal_id } = await params;
  return controlRoute(request, {
    source: 'body',
    schema: FollowUpGoalSchema,
    pathParams: { parent_goal_id: goal_id },
    handler: (ctx, input) => prestonFollowUpGoal(ctx, input),
  });
}
