import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createHash } from "node:crypto";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";

const PAGE = 200;
const MAX_CANDIDATES = 5000;
const aliases = { orderBy: { normalizedValue: "asc" as const }, take: 51,
  select: { value: true, normalizedValue: true } };
export interface CatalogSnapshotFactScope { organizationId: string; projectId: string }
export type CatalogSnapshotFactSink = (kind: "subscription" | "catalog" | "prices" | "shared-media", records: CanonicalJsonValue[]) => void;

/** Shares the caller's authorized MVCC transaction; never opens a second cut. */
export function createCatalogSnapshotFactReader(transaction: DatabaseTransaction) {
  return {
    async captureCandidates(scope: CatalogSnapshotFactScope, linkedDevelopmentUids: readonly string[],
      sink: CatalogSnapshotFactSink): Promise<{ developmentUids: string[] }> {
      if (linkedDevelopmentUids.length > MAX_CANDIDATES) throw new SharedCatalogError("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      const subscription = await transaction.projectCatalogSubscription.findUnique({
        where: { organizationId_projectId: { organizationId: scope.organizationId, projectId: scope.projectId } }, select: {
          mode: true, version: true,
          cities: { orderBy: { cityUid: "asc" }, take: 101, select: { cityUid: true } },
          selections: { orderBy: { developmentUid: "asc" }, take: 501, select: { developmentUid: true, decision: true } },
        },
      });
      if (!subscription) throw new SharedCatalogError("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
      if (subscription.cities.length > 100 || subscription.selections.length > 500) throw new SharedCatalogError("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      sink("subscription", [{ mode: subscription.mode, version: subscription.version,
        cityUids: subscription.cities.map((city) => city.cityUid), selections: subscription.selections }]);
      const subscribedCityUids = subscription.cities.map((city) => city.cityUid);
      const developmentUids = new Set<string>();
      const developerUids = new Set<string>();
      const cityUids = new Set(subscription.cities.map((city) => city.cityUid));
      const districtUids = new Set<string>();
      const regionUids = new Set<string>();
      const emit = (entityType: string, rows: readonly Record<string, unknown>[]) => {
        for (const row of rows) {
          const rowAliases = row.aliases;
          if (Array.isArray(rowAliases) && rowAliases.length > 50) throw new SharedCatalogError("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
        }
        // Only explicitly selected fact columns reach this private capture seam.
        // Decimal JSON is an exact string; timestamps are not accidental revisions.
        sink("catalog", rows.map((row) => JSON.parse(JSON.stringify({ entityType, ...row })) as CanonicalJsonValue));
      };
      let after = "";
      let count = 0;
      while (true) {
        const rows = await transaction.development.findMany({
          where: { uid: { gt: after }, OR: [
            subscription.mode === "ALL_SHARED" ? { cityUid: { in: subscribedCityUids } }
              : { uid: { in: subscription.selections.filter((selection) => selection.decision === "INCLUDE").map((selection) => selection.developmentUid) } },
            { uid: { in: [...new Set(linkedDevelopmentUids)] } },
          ] }, orderBy: { uid: "asc" }, take: PAGE,
          select: { uid: true, developerUid: true, cityUid: true, districtUid: true,
            name: true, normalizedName: true, addressLine: true, latitude: true, longitude: true,
            lifecycle: true, version: true, mergedIntoUid: true, aliases },
        });
        if (!rows.length) break;
        count += rows.length;
        if (count > MAX_CANDIDATES) throw new SharedCatalogError("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
        for (const row of rows) {
          developmentUids.add(row.uid); developerUids.add(row.developerUid); cityUids.add(row.cityUid);
          if (row.districtUid) districtUids.add(row.districtUid);
        }
        emit("development", rows);
        after = rows.at(-1)!.uid;
      }
      after = "";
      count = 0;
      while (true) {
        const rows = await transaction.building.findMany({ where: { uid: { gt: after }, developmentUid: { in: [...developmentUids] } },
          orderBy: { uid: "asc" }, take: PAGE, select: { uid: true, developmentUid: true, label: true, normalizedLabel: true,
            floors: true, commissioningYear: true, commissioningQuarter: true, constructionStatus: true,
            material: true, housingClass: true, lifecycle: true, version: true, mergedIntoUid: true, aliases } });
        if (!rows.length) break;
        count += rows.length;
        if (count > MAX_CANDIDATES) throw new SharedCatalogError("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
        emit("building", rows); after = rows.at(-1)!.uid;
      }
      after = "";
      while (true) {
        const rows = await transaction.developer.findMany({ where: { uid: { gt: after, in: [...developerUids] } },
          orderBy: { uid: "asc" }, take: PAGE, select: { uid: true, name: true, normalizedName: true,
            lifecycle: true, version: true, mergedIntoUid: true, aliases } });
        if (!rows.length) break;
        emit("developer", rows); after = rows.at(-1)!.uid;
      }
      after = "";
      while (true) {
        const rows = await transaction.city.findMany({ where: { uid: { gt: after, in: [...cityUids] } },
          orderBy: { uid: "asc" }, take: PAGE, select: { uid: true, regionUid: true, name: true, normalizedName: true, lifecycle: true, aliases } });
        if (!rows.length) break;
        for (const row of rows) regionUids.add(row.regionUid);
        emit("city", rows); after = rows.at(-1)!.uid;
      }
      after = "";
      while (true) {
        const rows = await transaction.district.findMany({ where: { uid: { gt: after, in: [...districtUids] } },
          orderBy: { uid: "asc" }, take: PAGE, select: { uid: true, cityUid: true, name: true, normalizedName: true, lifecycle: true, aliases } });
        if (!rows.length) break;
        emit("district", rows); after = rows.at(-1)!.uid;
      }
      after = "";
      while (true) {
        const rows = await transaction.region.findMany({ where: { uid: { gt: after, in: [...regionUids] } },
          orderBy: { uid: "asc" }, take: PAGE, select: { uid: true, code: true, name: true, normalizedName: true, lifecycle: true, aliases } });
        if (!rows.length) break;
        emit("region", rows); after = rows.at(-1)!.uid;
      }
      // A genuinely empty candidate closure is explicit, not an unread section.
      sink("catalog", []);
      return { developmentUids: [...developmentUids].sort() };
    },

    /** Global catalog membership never authorizes another project's observations. */
    async captureObservations(scope: CatalogSnapshotFactScope, candidateUids: readonly string[],
      sink: CatalogSnapshotFactSink): Promise<void> {
      if (candidateUids.length > MAX_CANDIDATES) throw new SharedCatalogError("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      const where = { organizationId: scope.organizationId, projectId: scope.projectId,
        developmentUid: { in: [...new Set(candidateUids)].sort() } };
      let after = "";
      while (true) {
        const rows = await transaction.priceObservation.findMany({ where: { ...where, id: { gt: after } },
          orderBy: { id: "asc" }, take: PAGE, select: { id: true, sourceId: true, developmentUid: true,
            buildingUid: true, externalId: true, observedAt: true, amount: true, currency: true,
            basis: true, areaM2: true, roomCount: true } });
        if (!rows.length) break;
        sink("prices", rows.map((row) => JSON.parse(JSON.stringify(row)) as CanonicalJsonValue));
        after = rows.at(-1)!.id;
      }
      sink("prices", []);
      after = "";
      while (true) {
        const rows = await transaction.sharedMediaAsset.findMany({ where: { ...where, id: { gt: after } },
          orderBy: { id: "asc" }, take: PAGE, select: { id: true, sourceId: true, developmentUid: true,
            buildingUid: true, externalId: true, kind: true, position: true, rightsBasis: true,
            canonicalSourceUrl: true, license: true, attribution: true, observedAt: true, updatedAt: true } });
        if (!rows.length) break;
        sink("shared-media", rows.map(({ canonicalSourceUrl, license, attribution, ...row }) =>
          JSON.parse(JSON.stringify({ ...row,
            canonicalUrlHash: createHash("sha256").update(canonicalSourceUrl).digest("hex"),
            hasLicense: Boolean(license?.trim()), hasAttribution: Boolean(attribution?.trim()),
          })) as CanonicalJsonValue));
        after = rows.at(-1)!.id;
      }
      sink("shared-media", []);
    },
  };
}
