import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { ReliabilityService } from "../../platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../../platform-operations/server.ts";

import { SNAPSHOT_NOTIFICATION_TOPIC, snapshotNotificationIntentSchema } from "../contracts.ts";

/** Same short publication transaction: durable hint only, never HTTP/config IO. */
export async function enqueueSnapshotNotification(tx: DatabaseTransaction,
  input: { organizationId: string; projectId: string; deliveryRunId: string; publishSequence: number }) {
  const payload = snapshotNotificationIntentSchema.parse({ ...input, schemaVersion: 1 });
  const identity = createHash("sha256").update(JSON.stringify([input.organizationId, input.projectId, input.publishSequence])).digest("hex");
  return new ReliabilityService(new PrismaReliabilityRepository(tx)).enqueue({ organizationId: input.organizationId,
    organizationScope: input.organizationId, idempotencyScope: "snapshot.notification", idempotencyKey: identity,
    topic: SNAPSHOT_NOTIFICATION_TOPIC, payload, actorType: "SYSTEM", actorId: "snapshot-publication",
    action: "snapshot.notification.requested", entityType: "DeliveryRun", entityId: input.deliveryRunId,
    source: "snapshot-delivery", correlationId: randomUUID(), schemaVersion: 1 });
}
