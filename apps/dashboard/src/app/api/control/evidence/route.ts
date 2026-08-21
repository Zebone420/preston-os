import { controlRoute } from '@/lib/preston-control/http';
import { GetEvidenceSchema } from '@/lib/preston-control/schemas';
import { prestonGetEvidence } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - getPrestonEvidence. READ ONLY.
// Query: ?goal_id=<uuid> and/or ?job_id=<uuid>.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return controlRoute(request, {
    source: 'query',
    schema: GetEvidenceSchema,
    handler: (ctx, input) => prestonGetEvidence(ctx, input),
  });
}
