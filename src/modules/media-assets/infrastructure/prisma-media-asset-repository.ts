import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { MediaAssetRecord } from "../contracts.ts";
import type {
  MediaAssetAuditInput,
  MediaAssetRepository,
  PersistMediaAssetInput,
} from "../application/ports/media-asset-repository.ts";

const mediaAssetSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  sha256: true,
  storageKey: true,
  contentType: true,
  byteSize: true,
  originalFileName: true,
  rightsBasis: true,
  source: true,
  license: true,
} satisfies Prisma.MediaAssetSelect;

export class PrismaMediaAssetRepository implements MediaAssetRepository {
  public constructor(private readonly transaction: DatabaseTransaction) {}

  public async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return (await this.transaction.project.count({ where: { id: projectId, organizationId } })) === 1;
  }

  public findByDigest(projectId: string, sha256: string): Promise<MediaAssetRecord | null> {
    return this.transaction.mediaAsset.findUnique({
      where: { projectId_sha256: { projectId, sha256 } },
      select: mediaAssetSelect,
    });
  }

  public upsert(input: PersistMediaAssetInput): Promise<MediaAssetRecord> {
    const data = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sha256: input.sha256,
      storageKey: input.storageKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      originalFileName: input.originalFileName,
      rightsBasis: input.rightsBasis,
      source: input.source,
      license: input.license ?? null,
      uploadedBy: input.uploadedBy,
    };
    return this.transaction.mediaAsset.upsert({
      where: { projectId_sha256: { projectId: input.projectId, sha256: input.sha256 } },
      create: data,
      update: {},
      select: mediaAssetSelect,
    });
  }

  public async appendAudit(input: MediaAssetAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: "media.intake",
        entityType: "MediaAsset",
        entityId: input.assetId,
        beforeMarker: Prisma.JsonNull,
        afterMarker: { projectId: input.projectId, sha256: input.sha256 },
        source: "media-assets",
        correlationId: input.correlationId,
      },
    });
  }
}
