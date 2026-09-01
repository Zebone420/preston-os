import { controlRoute, READ_SURFACES } from '@/lib/preston-control/http';
import { GetJobSchema } from '@/lib/preston-control/schemas';
import { prestonGetJob } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - getPrestonJob. READ ONLY.
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await params;
  return controlRoute(request, {
    surfaces: READ_SURFACES,
    source: 'none',
    schema: GetJobSchema,
    pathParams: { job_id },
    handler: (ctx, input) => prestonGetJob(ctx, input.job_id),
  });
}
