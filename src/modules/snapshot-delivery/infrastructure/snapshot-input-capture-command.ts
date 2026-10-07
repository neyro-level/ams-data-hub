import "server-only";
import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createCommandFactory } from "../../../platform/commands/define-command.ts";
import { createSourceSnapshotFactReader } from "../../ingestion-core/server.ts";
import { createMediaSnapshotFactReader } from "../../media-assets/server.ts";
import { createProjectStateSnapshotFactReader } from "../../project-state/server.ts";
import { createCatalogSnapshotFactReader } from "../../shared-catalog/server.ts";
import {
  SNAPSHOT_INPUT_PROJECTOR_VERSION, SNAPSHOT_INPUT_SCHEMA_VERSION, SnapshotInputPartsBuilder,
  snapshotInputHash, snapshotInputRequestHashes, snapshotInputRequestSchema,
  type SnapshotInputPartKind,
} from "../application/snapshot-build-input.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { runInSnapshotInputTransaction } from "./snapshot-input-transaction.ts";

const defineCaptureCommand = createCommandFactory({ runInTransaction: runInSnapshotInputTransaction });

/** Private worker command. Replay retains current admission, but never re-reads fact values. */
export const captureSnapshotInput = defineCaptureCommand({
  name: "snapshot-delivery.capture-input",
  input: snapshotInputRequestSchema,
  authorize(principal: PrincipalContext, input) {
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input"
      || principal.organizationId !== input.organizationId || principal.projectId !== input.projectId) {
      throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
    }
  },
  async execute({ transaction, input }) {
    const scope = { organizationId: input.organizationId, projectId: input.projectId };
    const repository = new PrismaSnapshotInputRepository(transaction);
    const hashes = snapshotInputRequestHashes(input);
    const previous = await repository.find(scope.organizationId, scope.projectId, hashes.idempotencyKeyHash, hashes.requestHash);
    if (previous) return previous;

    const publishSequence = await repository.reserveSequence(scope.organizationId, scope.projectId);
    const times = await transaction.$queryRaw<{ capturedAt: Date }[]>`SELECT transaction_timestamp() AS "capturedAt"`;
    if (times.length !== 1) throw new Error("SNAPSHOT_INPUT_CAPTURE_TIME_INVALID");
    // Construct inside execute: every whole-transaction retry owns a new builder.
    const builder = new SnapshotInputPartsBuilder();
    const sink = (kind: SnapshotInputPartKind, rows: CanonicalJsonValue[]) => builder.add(kind, rows);
    const project = await createProjectStateSnapshotFactReader(transaction).capture(scope, sink);
    const catalog = createCatalogSnapshotFactReader(transaction);
    const candidates = await catalog.captureCandidates(scope, project.linkedDevelopmentUids, sink);
    await catalog.captureObservations(scope, candidates.developmentUids, sink);
    const media = createMediaSnapshotFactReader(transaction, sink);
    await createSourceSnapshotFactReader(transaction).capture(scope, sink, async (rows) => {
      const pins = rows.filter((row) => row.status === "ACTIVE").map((row) => {
        if (!row.factRevisionId || !row.factRevisionSequence || !row.approvedHeadId || !row.approvedHeadSequence) {
          throw new Error("SNAPSHOT_INPUT_INVENTORY_FACT_MISSING");
        }
        return { sourceId: row.sourceId, inventoryUid: row.uid, externalOfferId: row.externalOfferId,
          normalizedHash: row.normalizedHash, factRevisionId: row.factRevisionId,
          factRevisionSequence: row.factRevisionSequence, approvedHeadId: row.approvedHeadId,
          approvedHeadSequence: row.approvedHeadSequence };
      });
      await media.captureInventoryPage(scope, pins);
    });
    await media.captureAgents(scope);
    await media.captureShared(scope, candidates.developmentUids);
    media.finishCapture();
    const parts = builder.finish();
    // Capture digest of exact catalog values, not a global catalog sequence.
    const catalogRevision = snapshotInputHash(parts.filter((part) => part.kind === "catalog")
      .map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash })));
    return repository.save({ ...scope, ...hashes, inputSchemaVersion: SNAPSHOT_INPUT_SCHEMA_VERSION,
      projectorVersion: SNAPSHOT_INPUT_PROJECTOR_VERSION, schemaMinor: input.schemaMinor,
      publishSequence, projectStateRevision: project.projectVersion, catalogRevision,
      capturedAt: times[0]!.capturedAt, parts });
  },
});
