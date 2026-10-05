import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type {
  MediaMirrorRepository,
  PersistMediaWarningInput,
  PersistMirroredAssetInput,
} from "../application/ports/media-mirror-repository.ts";

export class PrismaMediaMirrorRepository implements MediaMirrorRepository {
  public constructor(private readonly transaction: DatabaseTransaction) {}

  public async scopeExists(input: { organizationId: string; projectId: string; sourceId: string }): Promise<boolean> {
    return await this.transaction.source.count({
      where: { id: input.sourceId, organizationId: input.organizationId, projectId: input.projectId },
    }) === 1;
  }

  private async agentState(input: { organizationId: string; projectId: string; entityUid: string; kind: string }) {
    if (input.kind !== "AGENT_PHOTO") return null;
    return this.transaction.agent.findFirst({
      where: { organizationId: input.organizationId, projectId: input.projectId, uid: input.entityUid },
      select: { status: true, showOnSite: true, consentConfirmedAt: true },
    });
  }

  public async persistMirrored(input: PersistMirroredAssetInput) {
    const asset = await this.transaction.mediaAsset.upsert({
      where: { projectId_sha256: { projectId: input.projectId, sha256: input.sha256 } },
      create: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sha256: input.sha256,
        storageKey: input.storageKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        originalFileName: input.originalFileName,
        rightsBasis: input.rightsBasis,
        source: input.canonicalSourceUrl,
        license: input.license,
        uploadedBy: input.uploadedBy,
      },
      update: {},
      select: { id: true },
    });
    await this.transaction.mediaSource.upsert({
      where: {
        organizationId_projectId_sourceId_entityType_entityUid_kind_canonicalSourceUrl: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          sourceId: input.sourceId,
          entityType: input.entityType,
          entityUid: input.entityUid,
          kind: input.kind,
          canonicalSourceUrl: input.canonicalSourceUrl,
        },
      },
      create: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        sourceRevisionId: input.sourceRevisionId,
        entityType: input.entityType,
        entityUid: input.entityUid,
        kind: input.kind,
        position: input.position,
        sourceUrl: input.sourceUrl,
        canonicalSourceUrl: input.canonicalSourceUrl,
        isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
        status: "MIRRORED",
        warningCode: null,
        assetId: asset.id,
        firstSeenAt: input.observedAt,
        lastAttemptAt: input.observedAt,
        mirroredAt: input.observedAt,
      },
      update: {
        sourceRevisionId: input.sourceRevisionId,
        position: input.position,
        sourceUrl: input.sourceUrl,
        isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
        status: "MIRRORED",
        warningCode: null,
        assetId: asset.id,
        lastAttemptAt: input.observedAt,
        mirroredAt: input.observedAt,
      },
    });
    return { assetId: asset.id, agent: await this.agentState(input) };
  }

  public async persistWarning(input: PersistMediaWarningInput) {
    const source = await this.transaction.mediaSource.upsert({
      where: {
        organizationId_projectId_sourceId_entityType_entityUid_kind_canonicalSourceUrl: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          sourceId: input.sourceId,
          entityType: input.entityType,
          entityUid: input.entityUid,
          kind: input.kind,
          canonicalSourceUrl: input.canonicalSourceUrl,
        },
      },
      create: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        sourceRevisionId: input.sourceRevisionId,
        entityType: input.entityType,
        entityUid: input.entityUid,
        kind: input.kind,
        position: input.position,
        sourceUrl: input.sourceUrl,
        canonicalSourceUrl: input.canonicalSourceUrl,
        isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
        status: "WARNING",
        warningCode: input.warningCode,
        firstSeenAt: input.observedAt,
        lastAttemptAt: input.observedAt,
      },
      update: {
        sourceRevisionId: input.sourceRevisionId,
        position: input.position,
        sourceUrl: input.sourceUrl,
        isImageOrderChangeAllowed: input.isImageOrderChangeAllowed,
        status: "WARNING",
        warningCode: input.warningCode,
        lastAttemptAt: input.observedAt,
      },
      select: { assetId: true },
    });
    return { assetId: source.assetId, agent: await this.agentState(input) };
  }
}
