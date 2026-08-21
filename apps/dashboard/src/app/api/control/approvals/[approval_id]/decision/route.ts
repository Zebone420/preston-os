import { controlRoute } from '@/lib/preston-control/http';
import { DecideApprovalSchema } from '@/lib/preston-control/schemas';
import { prestonDecideApproval } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - decidePrestonApproval.
// CONSEQUENTIAL WRITE through decide_orchestration_approval (owner-only,
// one-time nonce, fail-closed in-transaction audit). Marked
// x-openai-isConsequential in the OpenAPI document so ChatGPT asks the
// owner to confirm before calling.
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approval_id: string }> },
) {
  const { approval_id } = await params;
  return controlRoute(request, {
    source: 'body',
    schema: DecideApprovalSchema,
    pathParams: { approval_id },
    handler: (ctx, input) => prestonDecideApproval(ctx, input),
  });
}
