import { handleSnapshotConsumerGet } from "../../../../../../../../modules/snapshot-delivery/server.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; projectId: string; publishSequence: string; kind: string }> }) {
  return handleSnapshotConsumerGet(request, await context.params);
}
