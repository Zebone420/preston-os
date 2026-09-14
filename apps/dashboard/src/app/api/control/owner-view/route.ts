import { controlRoute, READ_SURFACES } from '@/lib/preston-control/http';
import { OwnerViewSchema } from '@/lib/preston-control/schemas';
import { prestonOwnerView } from '@/lib/preston-control/tools';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return controlRoute(request, {
    surfaces: READ_SURFACES,
    source: 'query',
    schema: OwnerViewSchema,
    handler: (ctx, input) => prestonOwnerView(ctx, input),
  });
}
