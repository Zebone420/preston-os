import { controlRoute } from '@/lib/preston-control/http';
import { PollEventsQuerySchema } from '@/lib/preston-control/schemas';
import { prestonPollEvents } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - pollPrestonEvents. READ ONLY.
// ChatGPT Supervisor Bridge slice 1: cursor-paginated, deduplicated feed of
// normalized state-transition events derived from the SSOT read model.
// Query: ?cursor=<opaque>&limit=<1..100>.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return controlRoute(request, {
    source: 'query',
    schema: PollEventsQuerySchema,
    handler: (ctx, input) => prestonPollEvents(ctx, input),
  });
}
