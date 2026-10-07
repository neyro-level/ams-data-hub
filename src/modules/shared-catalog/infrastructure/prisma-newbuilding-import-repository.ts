import { createUlid } from "@ams-data-hub/data-contracts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { NewbuildingImportRepository, NewbuildingImportScope, NewbuildingImportState } from "../application/ports/newbuilding-import-repository.ts";
import type { NewbuildingStagingPayload } from "../domain/newbuilding-import.ts";
import { normalizeGeoName } from "../domain/normalize-geo-name.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";
import { PrismaSharedCatalogRepository } from "./prisma-shared-catalog-repository.ts";

export class PrismaNewbuildingImportRepository implements NewbuildingImportRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async read(scope: NewbuildingImportScope, payload: NewbuildingStagingPayload): Promise<NewbuildingImportState> {
    // Source runtime and final publication are global-first. Never hold a
    // Source row while waiting for their safety lock, including preview.
    await this.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`;
    const sources = await this.transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Source" WHERE "organizationId" = ${scope.organizationId}
      AND "projectId" = ${scope.projectId} AND "id" = ${payload.source.sourceId} FOR UPDATE
    `;
    if (sources.length !== 1) throw new SharedCatalogError("NEWBUILDING_SOURCE_NOT_FOUND");
    const identity = await this.transaction.developmentExternalIdentity.findUnique({
      where: { organizationId_projectId_sourceId_externalId: { ...scope, sourceId: payload.source.sourceId, externalId: payload.source.externalId } },
    });
    if (identity && payload.target.developmentUid && identity.developmentUid !== payload.target.developmentUid) {
      throw new SharedCatalogError("NEWBUILDING_IDENTITY_CONFLICT");
    }
    if (identity && new Date(payload.source.observedAt) < identity.lastObservedAt) throw new SharedCatalogError("NEWBUILDING_OBSERVATION_STALE");
    const uid = identity?.developmentUid ?? payload.target.developmentUid;
    const development = uid ? await this.transaction.development.findUnique({ where: { uid } }) : null;
    if (uid && (!development || development.mergedIntoUid || development.lifecycle === "ARCHIVED")) throw new SharedCatalogError("NEWBUILDING_TARGET_INVALID");
    if (development && (development.developerUid !== payload.target.developerUid || development.cityUid !== payload.target.cityUid || development.districtUid !== payload.target.districtUid)) {
      throw new SharedCatalogError("NEWBUILDING_TARGET_IDENTITY_MISMATCH");
    }
    const prices = uid ? await this.transaction.priceObservation.findMany({ where: { ...scope, sourceId: payload.source.sourceId, developmentUid: uid } }) : [];
    const media = uid ? await this.transaction.sharedMediaAsset.findMany({ where: { ...scope, sourceId: payload.source.sourceId, developmentUid: uid } }) : [];
    return {
      developmentUid: uid, version: development?.version ?? 0,
      name: development?.name ?? null, addressLine: development?.addressLine ?? null,
      latitude: development?.latitude?.toNumber() ?? null, longitude: development?.longitude?.toNumber() ?? null,
      knownPriceKeys: new Set(prices.map((price) => [price.externalId, price.observedAt.toISOString(), price.basis].join("\u0000"))),
      knownMediaUrls: new Set(media.map((item) => item.canonicalSourceUrl)),
    };
  }

  async apply(scope: NewbuildingImportScope, payload: NewbuildingStagingPayload, state: NewbuildingImportState) {
    const uid = state.developmentUid ?? createUlid();
    const fields = { ...payload.development, normalizedName: normalizeGeoName(payload.development.name) };
    if (state.developmentUid) {
      const changed = await this.transaction.development.updateMany({ where: { uid, version: state.version }, data: { ...fields, version: { increment: 1 } } });
      if (changed.count !== 1) throw new SharedCatalogError("NEWBUILDING_REVIEW_STALE");
    } else {
      await this.transaction.development.create({ data: { uid, ...fields, developerUid: payload.target.developerUid, cityUid: payload.target.cityUid, districtUid: payload.target.districtUid } });
    }
    const observedAt = new Date(payload.source.observedAt);
    const sourceScope = { ...scope, sourceId: payload.source.sourceId };
    await this.transaction.developmentExternalIdentity.upsert({
      where: { organizationId_projectId_sourceId_externalId: { ...sourceScope, externalId: payload.source.externalId } },
      create: { ...sourceScope, developmentUid: uid, externalId: payload.source.externalId, firstObservedAt: observedAt, lastObservedAt: observedAt },
      update: { lastObservedAt: observedAt },
    });
    for (const price of payload.prices) {
      const key = { ...sourceScope, externalId: price.externalId, observedAt, basis: price.basis };
      const existing = await this.transaction.priceObservation.findUnique({ where: { organizationId_projectId_sourceId_externalId_observedAt_basis: key } });
      if (existing) {
        if (existing.developmentUid !== uid || existing.amount.toNumber() !== price.amount || existing.currency !== price.currency || (existing.areaM2?.toNumber() ?? null) !== price.areaM2 || existing.roomCount !== price.roomCount) {
          throw new SharedCatalogError("NEWBUILDING_PRICE_OBSERVATION_CONFLICT");
        }
      } else await this.transaction.priceObservation.create({ data: { ...sourceScope, ...price, developmentUid: uid, observedAt } });
    }
    for (const item of payload.media) {
      await this.transaction.sharedMediaAsset.upsert({
        where: { organizationId_projectId_sourceId_developmentUid_canonicalSourceUrl: { ...sourceScope, developmentUid: uid, canonicalSourceUrl: item.sourceUrl } },
        create: { ...sourceScope, ...item, developmentUid: uid, canonicalSourceUrl: item.sourceUrl, observedAt },
        update: { ...item, observedAt },
      });
    }
    return { uid, version: state.version + 1 };
  }

  async appendAudit(scope: NewbuildingImportScope, actorId: string, correlationId: string, result: { uid: string; version: number }) {
    await new PrismaSharedCatalogRepository(this.transaction).appendRevision({
      actorId, correlationId, action: "newbuilding.manual-import",
      entities: [{ entityType: "DEVELOPMENT", uid: result.uid, version: result.version, changeKind: result.version === 1 ? "CREATE" : "UPDATE" }],
    });
    await this.transaction.auditEvent.create({ data: {
      organizationId: scope.organizationId, actorType: "USER", actorId, correlationId,
      action: "newbuilding.manual-import", entityType: "Development", entityId: result.uid,
      source: "shared-catalog", afterMarker: { projectId: scope.projectId, version: result.version },
    } });
  }
}
