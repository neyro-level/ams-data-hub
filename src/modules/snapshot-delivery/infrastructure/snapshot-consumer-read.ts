import "server-only";
import { randomUUID } from "node:crypto";
import { canonicalJson, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { DEFAULT_SNAPSHOT_VERIFIER_LIMITS, snapshotManifestV1Schema } from "@ams-data-hub/snapshot-verifier";
import { Prisma } from "../../../generated/prisma/client.ts";
import { runInAuthorizedDatabaseTransaction, type DatabaseAuthorizationContext } from "../../../platform/database/transaction.ts";
import { calculateObjectSha256, createProjectSnapshotKey, ProjectSnapshotStorage, type BoundedObjectStorage, type ObjectStorage } from "../../../platform/storage/object-storage.ts";
import { readSnapshotConsumerBearer, snapshotConsumerScopeSchema, snapshotConsumerSequenceSchema,
  snapshotConsumerKindSchema, type SnapshotConsumerScope } from "../consumer-contracts.ts";
import type { ProjectAckCredential, SnapshotTrustSet } from "../contracts.ts";
import { verifyProjectAckToken } from "../application/snapshot-ack.ts";
import { verifySnapshotPublicArtifacts } from "../application/snapshot-public-verification.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";

type PublicCut = { publishSequence: number; manifestCanonical: string; manifestSha256: string; keyId: string; publishedAt: Date };
function context(scope: SnapshotConsumerScope, actorId: "snapshot-consumer-auth" | "snapshot-consumer-read"): DatabaseAuthorizationContext {
  return { principalKind: "snapshot-consumer", actorId, ...scope, projectIds: [scope.projectId], correlationId: randomUUID() };
}
function sameCredential(left: ProjectAckCredential | null, right: ProjectAckCredential): boolean {
  return left !== null && left.organizationId === right.organizationId && left.projectId === right.projectId
    && left.version === right.version && left.currentTokenHash === right.currentTokenHash && left.nextTokenHash === right.nextTokenHash;
}
function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("SNAPSHOT_CONSUMER_CANCELLED");
}

/** Public read only: no signing, producer reads, publication or status writes.
 * Dependencies are server-owned configuration, never request-supplied keys. */
export function createSnapshotConsumerReadServer(dependencies: {
  resolveStorage(scope: SnapshotConsumerScope): ObjectStorage & BoundedObjectStorage;
  resolveTrust(scope: SnapshotConsumerScope): SnapshotTrustSet;
}) {
  async function prepare(rawScope: SnapshotConsumerScope, authorization: string | null, sequence: number | null, incoming?: AbortSignal) {
    const scope = snapshotConsumerScopeSchema.parse(rawScope);
    const token = readSnapshotConsumerBearer(authorization);
    const signal = incoming ? AbortSignal.any([incoming, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    cancelled(signal);
    const captured = await runInAuthorizedDatabaseTransaction(context(scope, "snapshot-consumer-auth"),
      (tx) => new PrismaSnapshotDeliveryRepository(tx).getAckCredential(scope.organizationId, scope.projectId),
      { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    if (!captured || !(verifyProjectAckToken(token, captured.currentTokenHash)
      || (captured.nextTokenHash !== null && verifyProjectAckToken(token, captured.nextTokenHash)))) {
      throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
    }
    cancelled(signal);
    const cut = await runInAuthorizedDatabaseTransaction(context(scope, "snapshot-consumer-read"), async (tx) => {
      if (!sameCredential(await new PrismaSnapshotDeliveryRepository(tx).getAckCredential(scope.organizationId, scope.projectId), captured))
        throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
      const rows = await tx.$queryRaw<PublicCut[]>(Prisma.sql`SELECT * FROM public.snapshot_consumer_manifest(
        ${scope.organizationId},${scope.projectId},${sequence}::integer)`);
      if (rows.length !== 1) throw new Error("SNAPSHOT_CONSUMER_NOT_FOUND");
      return rows[0]!;
    }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
    cancelled(signal);
    const canonical = new TextEncoder().encode(cut.manifestCanonical);
    if (canonical.length > 2 * 1024 * 1024 || calculateObjectSha256(canonical) !== cut.manifestSha256)
      throw new Error("SNAPSHOT_CONSUMER_INTEGRITY_INVALID");
    const raw: unknown = JSON.parse(cut.manifestCanonical);
    const manifest = snapshotManifestV1Schema.parse(raw);
    if (manifest.projectId !== scope.projectId || manifest.publishSequence !== cut.publishSequence || manifest.keyId !== cut.keyId
      || manifest.publishedAt !== cut.publishedAt.toISOString() || canonicalJson(manifest as CanonicalJsonValue) !== cut.manifestCanonical)
      throw new Error("SNAPSHOT_CONSUMER_INTEGRITY_INVALID");
    const checkTrust = () => {
      const proof = verifySnapshotPublicArtifacts({ manifest, files: {}, trustSet: dependencies.resolveTrust(scope),
        expectedProjectId: scope.projectId, supportedSchemaMajor: 1, lastGood: null });
      if (proof.accepted || proof.reason !== "FILE_MISSING") throw new Error("SNAPSHOT_CONSUMER_INTEGRITY_INVALID");
    };
    checkTrust();
    for (const file of manifest.files) if (file.key !== `${file.kind}.${file.sha256}.json.gz`)
      throw new Error("SNAPSHOT_CONSUMER_INTEGRITY_INVALID");
    const storage = new ProjectSnapshotStorage(scope.projectId, dependencies.resolveStorage(scope));
    const manifestKey = createProjectSnapshotKey(scope.projectId, cut.manifestSha256);
    const object = await storage.getBounded({ key: manifestKey, maxBytes: 2 * 1024 * 1024, signal });
    cancelled(signal);
    if (!object || object.key !== manifestKey || object.contentLength !== canonical.length || object.body.length !== canonical.length
      || calculateObjectSha256(object.body) !== cut.manifestSha256 || !Buffer.from(object.body).equals(canonical))
      throw new Error("SNAPSHOT_CONSUMER_INTEGRITY_INVALID");
    const finish = async () => {
      cancelled(signal);
      await runInAuthorizedDatabaseTransaction(context(scope, "snapshot-consumer-auth"), async (tx) => {
        if (!sameCredential(await new PrismaSnapshotDeliveryRepository(tx).getAckCredential(scope.organizationId, scope.projectId), captured))
          throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
      }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
      checkTrust(); // Revocation during the final credential cut must not escape.
      cancelled(signal);
    };
    return { scope, manifest, storage, signal, finish };
  }
  return {
    async manifest(scope: SnapshotConsumerScope, authorization: string | null, rawSequence: string, signal?: AbortSignal) {
      const prepared = await prepare(scope, authorization, snapshotConsumerSequenceSchema.parse(rawSequence), signal);
      await prepared.finish();
      return prepared.manifest;
    },
    async current(scope: SnapshotConsumerScope, authorization: string | null, signal?: AbortSignal) {
      const prepared = await prepare(scope, authorization, null, signal);
      await prepared.finish();
      return prepared.manifest;
    },
    async artifact(scope: SnapshotConsumerScope, authorization: string | null, rawSequence: string, rawKind: string, signal?: AbortSignal) {
      const sequence = snapshotConsumerSequenceSchema.parse(rawSequence);
      const kind = snapshotConsumerKindSchema.parse(rawKind);
      const prepared = await prepare(scope, authorization, sequence, signal);
      const descriptor = prepared.manifest.files.find((file) => file.kind === kind);
      if (!descriptor) throw new Error("SNAPSHOT_CONSUMER_NOT_FOUND");
      const key = createProjectSnapshotKey(prepared.scope.projectId, descriptor.sha256);
      const object = await prepared.storage.getBounded({ key, maxBytes: Math.min(descriptor.bytes,
        DEFAULT_SNAPSHOT_VERIFIER_LIMITS.maxCompressedFileBytes), signal: prepared.signal });
      cancelled(prepared.signal);
      if (!object || object.key !== key || object.contentLength !== descriptor.bytes || object.body.length !== descriptor.bytes
        || calculateObjectSha256(object.body) !== descriptor.sha256) throw new Error("SNAPSHOT_CONSUMER_INTEGRITY_INVALID");
      await prepared.finish();
      return { body: Uint8Array.from(object.body) };
    },
  };
}
