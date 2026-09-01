import { controlRoute, READ_SURFACES } from '@/lib/preston-control/http';
import { GetArtifactSchema } from '@/lib/preston-control/schemas';
import { prestonGetArtifact } from '@/lib/preston-control/tools';

// Preston Control (GPT Actions surface) - getPrestonArtifact. READ ONLY.
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifact_id: string }> },
) {
  const { artifact_id } = await params;
  return controlRoute(request, {
    surfaces: READ_SURFACES,
    source: 'none',
    schema: GetArtifactSchema,
    pathParams: { artifact_id },
    handler: (ctx, input) => prestonGetArtifact(ctx, input.artifact_id),
  });
}
