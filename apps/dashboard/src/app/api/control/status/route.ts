import { z } from 'zod';
import { controlRoute } from '@/lib/preston-control/http';
import { prestonStatus } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - getPrestonStatus. READ ONLY.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return controlRoute(request, {
    source: 'none',
    schema: z.object({}).strict(),
    handler: (ctx) => prestonStatus(ctx),
  });
}
