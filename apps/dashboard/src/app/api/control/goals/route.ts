import { controlRoute } from '@/lib/preston-control/http';
import { SubmitGoalSchema } from '@/lib/preston-control/schemas';
import { prestonSubmitGoal } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - submitPrestonGoal. WRITE through
// the owner composer; idempotent on request_id.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return controlRoute(request, {
    source: 'body',
    schema: SubmitGoalSchema,
    handler: (ctx, input) => prestonSubmitGoal(ctx, input),
  });
}
