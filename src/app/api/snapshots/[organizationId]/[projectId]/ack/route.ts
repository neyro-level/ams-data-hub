import { handleSnapshotConsumerAck } from "../../../../../../modules/snapshot-delivery/server.ts";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; projectId: string }> }) {
  return handleSnapshotConsumerAck(request, await context.params);
}
