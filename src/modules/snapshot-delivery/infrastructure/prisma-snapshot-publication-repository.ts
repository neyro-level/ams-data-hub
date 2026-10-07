import "server-only";
import { canonicalJson, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { calculateObjectSha256 } from "../../../platform/storage/object-storage.ts";
import { snapshotManifestV1Schema, type SnapshotManifestV1 } from "../contracts.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

export class PrismaSnapshotPublicationRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  /** Verified server-owned signed output only; persists identity before object IO. */
  async bind(input: { organizationId: string; projectId: string; receiptId: string; inputHash: string; manifest: SnapshotManifestV1 }) {
    const manifest = snapshotManifestV1Schema.parse(input.manifest);
    if (manifest.projectId !== input.projectId || manifest.sourceRevisions.length > 10_000) {
      throw new Error("SNAPSHOT_PUBLICATION_MANIFEST_INVALID");
    }
    const manifestCanonical = canonicalJson(manifest as CanonicalJsonValue);
    if (Buffer.byteLength(manifestCanonical) > 2 * 1024 * 1024) throw new Error("SNAPSHOT_PUBLICATION_MANIFEST_LIMIT");
    const manifestSha256 = calculateObjectSha256(new TextEncoder().encode(manifestCanonical));
    const identity = { organizationId: input.organizationId, projectId: input.projectId, buildInputId: input.receiptId,
      inputHash: input.inputHash, publishSequence: manifest.publishSequence, keyId: manifest.keyId, manifestSha256, manifestCanonical };
    await lockSnapshotPublication(this.transaction, identity);
    const where = { organizationId_projectId_buildInputId: {
      organizationId: identity.organizationId, projectId: identity.projectId, buildInputId: identity.buildInputId } };
    const existing = await this.transaction.snapshotPublicationBinding.findUnique({ where });
    if (existing) {
      if (existing.inputHash !== identity.inputHash || existing.publishSequence !== identity.publishSequence
        || existing.keyId !== identity.keyId || existing.manifestSha256 !== manifestSha256
        || existing.manifestCanonical !== manifestCanonical) throw new Error("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
      return existing;
    }
    return this.transaction.snapshotPublicationBinding.create({ data: identity });
  }
}
