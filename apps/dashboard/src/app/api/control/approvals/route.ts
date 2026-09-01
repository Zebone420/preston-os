import { z } from 'zod';
import { controlRoute, READ_SURFACES } from '@/lib/preston-control/http';
import { prestonListApprovals } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - listPrestonApprovals. READ ONLY.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return controlRoute(request, {
    surfaces: READ_SURFACES,
    source: 'none',
    schema: z.object({}).strict(),
    handler: (ctx) => prestonListApprovals(ctx),
  });
}
