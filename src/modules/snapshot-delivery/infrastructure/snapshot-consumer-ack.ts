import "server-only";
import { randomUUID } from "node:crypto";
import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { calculateObjectSha256 } from "../../../platform/storage/object-storage.ts";
import { readSnapshotConsumerBearer, snapshotConsumerAckSchema, snapshotConsumerScopeSchema, type SnapshotConsumerScope } from "../consumer-contracts.ts";
import { createSnapshotAckService, verifyProjectAckToken } from "../application/snapshot-ack.ts";
import { verifySnapshotPublicArtifacts } from "../application/snapshot-public-verification.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";
import { createSnapshotConsumerReadServer } from "./snapshot-consumer-read.ts";

export function createSnapshotConsumerAckServer(dependencies: Parameters<typeof createSnapshotConsumerReadServer>[0]) {
  const reader = createSnapshotConsumerReadServer(dependencies);
  return async (rawScope: SnapshotConsumerScope, authorization: string | null, rawInput: unknown, signal?: AbortSignal) => {
    const scope = snapshotConsumerScopeSchema.parse(rawScope);
    const input = snapshotConsumerAckSchema.parse(rawInput);
    const token = readSnapshotConsumerBearer(authorization);
    if (input.projectId !== scope.projectId) throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
    const cancelled = () => { if (signal?.aborted) throw new Error("SNAPSHOT_CONSUMER_CANCELLED"); };
    cancelled();
    // Cached consumer files are allowed. The Hub independently authenticates
    // the immutable public manifest; applied:true is the consumer's attestation.
    const manifest = await reader.manifest(scope, authorization, String(input.publishSequence), signal);
    if (calculateObjectSha256(canonicalJsonBytes(manifest as CanonicalJsonValue)) !== input.manifestSha256)
      throw new Error("SNAPSHOT_CONSUMER_ACK_CONFLICT");
    return runInAuthorizedDatabaseTransaction({ principalKind: "snapshot-consumer", actorId: "snapshot-consumer-ack",
      organizationId: scope.organizationId, projectIds: [scope.projectId], correlationId: randomUUID() }, async (tx) => {
      await lockSnapshotPublication(tx, scope);
      for (const purpose of ["snapshot-input", "snapshot-ack-rotation"]) await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([purpose, scope.organizationId, scope.projectId])},0))::text`);
      cancelled();
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.snapshot_consumer_ack_sequence',${String(input.publishSequence)},true)`);
      const repository = new PrismaSnapshotDeliveryRepository(tx);
      // Reuse the actual service under the same locks as credential writers.
      // Credential + token validation is fresh here, not a pre-rotation result.
      const credential = await repository.getAckCredential(scope.organizationId, scope.projectId);
      if (!credential || !(verifyProjectAckToken(token, credential.currentTokenHash)
        || (credential.nextTokenHash !== null && verifyProjectAckToken(token, credential.nextTokenHash))))
        throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
      const checkTrust = () => {
        const proof = verifySnapshotPublicArtifacts({ manifest, files: {}, trustSet: dependencies.resolveTrust(scope),
          expectedProjectId: scope.projectId, supportedSchemaMajor: 1, lastGood: null });
        if (proof.accepted || proof.reason !== "FILE_MISSING") throw new Error("SNAPSHOT_CONSUMER_ACK_CONFLICT");
      };
      checkTrust();
      const run = await repository.getRun(scope.organizationId, scope.projectId, input.publishSequence);
      if (!run || run.manifestSha256 !== input.manifestSha256 || run.publishedAt.toISOString() !== manifest.publishedAt)
        throw new Error("SNAPSHOT_CONSUMER_ACK_CONFLICT");
      const occurredAt = new Date(Math.max(Date.now(), run.downloadedAt?.getTime() ?? 0, run.appliedAt?.getTime() ?? 0));
      const service = createSnapshotAckService({ repository, now: () => occurredAt });
      let status = run.status;
      if (status === "PENDING" || status === "NOTIFIED") {
        await repository.transitionRun({ ...scope, publishSequence: input.publishSequence, expectedStatuses: [status], nextStatus: "DOWNLOADED", occurredAt });
        status = "DOWNLOADED";
      }
      if (status === "DOWNLOADED") await repository.transitionRun({ ...scope, publishSequence: input.publishSequence,
        expectedStatuses: ["DOWNLOADED"], nextStatus: "APPLIED", occurredAt });
      const result = await service.acknowledge({ ...scope, publishSequence: input.publishSequence, token, idempotencyKey: input.idempotencyKey });
      checkTrust(); // Revocation during awaited ACK writes must roll back the whole cut.
      cancelled();
      return { projectId: scope.projectId, publishSequence: input.publishSequence, status: result.run.status, idempotent: result.idempotent };
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
  };
}
