import { controlRoute } from '@/lib/preston-control/http';
import { GetGoalSchema } from '@/lib/preston-control/schemas';
import { prestonGetGoal } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - getPrestonGoal. READ ONLY.
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ goal_id: string }> },
) {
  const { goal_id } = await params;
  return controlRoute(request, {
    source: 'none',
    schema: GetGoalSchema,
    pathParams: { goal_id },
    handler: (ctx, input) => prestonGetGoal(ctx, input.goal_id),
  });
}
