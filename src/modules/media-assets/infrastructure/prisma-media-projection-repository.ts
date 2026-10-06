import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { InventoryMediaProjectionInput } from "../contracts.ts";
import type { MediaProjectionRepository, InventoryMediaProjectionState } from "../application/ports/media-projection-repository.ts";

/** All facts come from the scoped immutable GOOD record, never caller URLs. */
export class PrismaMediaProjectionRepository implements MediaProjectionRepository {
  public constructor(private readonly transaction: DatabaseTransaction) {}

  public async loadInventory(input: InventoryMediaProjectionInput): Promise<InventoryMediaProjectionState | null> {
    const scope = { organizationId: input.organizationId, projectId: input.projectId, sourceId: input.sourceId };
    const source = await this.transaction.source.findFirst({
      where: { id: input.sourceId, organizationId: input.organizationId, projectId: input.projectId,
        lastGoodRevisionId: input.sourceRevisionId }, select: { id: true },
    });
    if (!source) return null;
    const records = await this.transaction.sourceRevisionRecord.findMany({
      where: { ...scope, revisionId: input.sourceRevisionId, inventoryUid: input.inventoryUid,
        revision: { status: "GOOD" } }, take: 2, select: { payload: true },
    });
    if (records.length !== 1) return null;
    const payload = records[0]!.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const draft = payload.draft;
    if (!draft || typeof draft !== "object" || Array.isArray(draft) || !Array.isArray(draft.imageUrls)
      || draft.imageUrls.length > 500 || draft.imageUrls.some((url) => typeof url !== "string")) return null;
    const relations = await this.transaction.mediaSource.findMany({
      where: { ...scope, sourceRevisionId: input.sourceRevisionId, entityType: "INVENTORY",
        entityUid: input.inventoryUid, kind: "LISTING_IMAGE" },
      orderBy: [{ position: "asc" }, { id: "asc" }], take: 501,
      select: { id: true, canonicalSourceUrl: true, position: true, status: true, mirroredAt: true,
        asset: { select: { id: true, organizationId: true, projectId: true, sha256: true, storageKey: true,
          contentType: true, byteSize: true, originalFileName: true, rightsBasis: true, source: true, license: true } } },
    });
    if (relations.length > 500) throw new Error("MEDIA_PROJECTION_LIMIT_EXCEEDED");
    return { images: (draft.imageUrls as string[]).map((sourceUrl, position) => ({ sourceUrl, position })), relations };
  }
}
