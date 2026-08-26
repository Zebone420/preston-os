import { controlRoute } from '@/lib/preston-control/http';
import { CancelGoalSchema } from '@/lib/preston-control/schemas';
import { prestonCancelGoal } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - cancelPrestonGoal.
// CONSEQUENTIAL WRITE: owner-confirmation handshake enforced in the shared
// service layer (tools.prestonCancelGoal), identically to the MCP surface.
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ goal_id: string }> },
) {
  const { goal_id } = await params;
  return controlRoute(request, {
    source: 'body',
    schema: CancelGoalSchema,
    pathParams: { goal_id },
    handler: (ctx, input) => prestonCancelGoal(ctx, input),
  });
}
