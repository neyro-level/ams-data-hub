import "server-only";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { PrismaReliabilityRepository } from "../../platform-operations/server.ts";
import { SNAPSHOT_BUILD_REQUEST_TOPIC, sourceGoodSnapshotBuildRequestSchema } from "../../snapshot-delivery/contracts.ts";
import { normalizedContentHash, type GoodRevisionReceipt, type SourceImportTarget } from "../application/import-pipeline.ts";

/** Call only inside the same transaction as GOOD / Last Good apply. An enqueue
 * failure propagates and rolls back that apply; remote publication never runs here. */
export async function enqueueSourceGoodSnapshot(transaction: DatabaseTransaction, principal: ProjectJobPrincipal,
  target: SourceImportTarget, revision: GoodRevisionReceipt) {
  if (principal.kind !== "project-job" || principal.jobName !== "source-import" || principal.organizationId !== target.organizationId
    || principal.projectId !== target.projectId) throw new Error("SOURCE_SNAPSHOT_INTENT_SCOPE_INVALID");
  const good = await transaction.sourceRevision.findFirst({ where: {
    ...target, id: revision.revisionId, status: "GOOD", sequence: revision.sequence,
    source: { lastGoodRevisionId: revision.revisionId },
  }, select: { id: true } });
  if (!good) throw new Error("SOURCE_SNAPSHOT_INTENT_REVISION_INVALID");
  const payload = sourceGoodSnapshotBuildRequestSchema.parse({ schemaVersion: 1,
    organizationId: target.organizationId, projectId: target.projectId, sourceId: target.sourceId,
    sourceRevisionId: revision.revisionId, sourceRevisionSequence: revision.sequence,
  });
  const now = new Date();
  return new PrismaReliabilityRepository(transaction).enqueueEvent({
    organizationId: target.organizationId, organizationScope: target.organizationId,
    idempotencyScope: "ingestion.source-good.snapshot", idempotencyKey: `${target.sourceId}:${revision.revisionId}`,
    requestHash: normalizedContentHash(payload), topic: SNAPSHOT_BUILD_REQUEST_TOPIC, payload,
    actorType: "SYSTEM", actorId: principal.jobName, action: SNAPSHOT_BUILD_REQUEST_TOPIC,
    entityType: "SourceRevision", entityId: revision.revisionId, source: "ingestion-core",
    correlationId: principal.correlationId, schemaVersion: 1, occurredAt: now.toISOString(), availableAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 24 * 3_600_000).toISOString(),
  });
}
