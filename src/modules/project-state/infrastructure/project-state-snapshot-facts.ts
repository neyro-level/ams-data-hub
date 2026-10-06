import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import type { ProjectEditorialEntityType } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

type Kind = "project" | "contacts" | "agents" | "editorial" | "media-order" | "url-policy"
  | "urls" | "redirects" | "tombstones" | "listing-links" | "lifecycle";
export interface ProjectStateSnapshotScope { organizationId: string; projectId: string }
export type ProjectStateSnapshotSink = (kind: Kind, rows: CanonicalJsonValue[]) => void;
const PAGE = 200;
const json = (row: object): CanonicalJsonValue => JSON.parse(JSON.stringify(row)) as CanonicalJsonValue;

/** Explicit private facts in the caller's cut; no admin DTO, evidence or consent actor. */
export function createProjectStateSnapshotFactReader(transaction: DatabaseTransaction) {
  return {
    async capture(scope: ProjectStateSnapshotScope, sink: ProjectStateSnapshotSink): Promise<{
      projectVersion: number; linkedDevelopmentUids: string[];
    }> {
      const where = { organizationId: scope.organizationId, projectId: scope.projectId };
      const project = await transaction.project.findFirst({
        where: { organizationId: scope.organizationId, id: scope.projectId },
        select: { id: true, slug: true, name: true, status: true, serviceState: true,
          version: true, publicUrlPolicyVersion: true },
      });
      if (!project) throw new Error("SNAPSHOT_INPUT_PROJECT_MISSING");
      sink("project", [json(project)]);
      const contact = await transaction.projectPublicContact.findUnique({
        where: { organizationId_projectId: where }, select: { phone: true, email: true,
          addressPublic: true, messengers: true, hours: true, version: true },
      });
      sink("contacts", contact ? [json(contact)] : []);
      const policy = await transaction.projectUrlPolicy.findUnique({
        where: { organizationId_projectId: where }, select: { policyKey: true, pathTemplates: true,
          reservedNamespaces: true, version: true },
      });
      sink("url-policy", policy ? [json(policy)] : []);

      async function scan<T extends object, C>(kind: Kind, read: (cursor: C | undefined) => Promise<T[]>,
        next: (row: T) => C, visit?: (row: T) => void,
        encode: (row: T) => CanonicalJsonValue = json): Promise<void> {
        let cursor: C | undefined;
        while (true) {
          const rows = await read(cursor);
          if (!rows.length) break;
          if (visit) for (const row of rows) visit(row);
          sink(kind, rows.map(encode));
          cursor = next(rows.at(-1)!);
        }
        sink(kind, []);
      }
      // Non-publishable agents are not selected: neither their names nor work
      // contacts may enter the pinned input. Fresh publication checks remain required.
      await scan("agents", (cursor: string | undefined) => transaction.agent.findMany({
        where: { ...where, uid: { gt: cursor ?? "" }, status: "ACTIVE", showOnSite: true,
          consentConfirmedAt: { not: null } }, orderBy: { uid: "asc" }, take: PAGE,
        select: { uid: true, slug: true, role: true, fullName: true, position: true, bio: true,
          specializations: true, photoMediaId: true, feedPhotoMediaId: true, workPhone: true,
          workEmail: true, messengers: true, showOnSite: true, status: true, sortOrder: true,
          consentConfirmedAt: true, version: true },
      }), (row) => row.uid);
      await scan("editorial", (cursor: { entityType: ProjectEditorialEntityType; entityUid: string } | undefined) =>
        transaction.entityEditorial.findMany({ where, orderBy: [{ entityType: "asc" }, { entityUid: "asc" }], take: PAGE,
          ...(cursor ? { cursor: { organizationId_projectId_entityType_entityUid: { ...where, ...cursor } }, skip: 1 } : {}),
          select: { entityType: true, entityUid: true, shortDescription: true, description: true, faq: true,
            mediaOrder: true, mediaOrderPolicyVersion: true, version: true },
        }), (row) => ({ entityType: row.entityType, entityUid: row.entityUid }));
      await scan("media-order", (cursor: { entityType: ProjectEditorialEntityType; entityUid: string } | undefined) =>
        transaction.entityMediaOrderPolicy.findMany({ where, orderBy: [{ entityType: "asc" }, { entityUid: "asc" }], take: PAGE,
          ...(cursor ? { cursor: { organizationId_projectId_entityType_entityUid: { ...where, ...cursor } }, skip: 1 } : {}),
          select: { entityType: true, entityUid: true, sourceMediaOrder: true, isImageOrderChangeAllowed: true, version: true },
        }), (row) => ({ entityType: row.entityType, entityUid: row.entityUid }));
      await scan("urls", (cursor: string | undefined) => transaction.projectUrlEntry.findMany({
        where: { ...where, id: { gt: cursor ?? "" } }, orderBy: { id: "asc" }, take: PAGE,
        select: { id: true, entityType: true, entityUid: true, slug: true, canonicalPath: true,
          factualLifecycle: true, presentationLifecycle: true, redirectTargetPath: true,
          version: true, publishedAt: true, retiredAt: true, reservation: { select: { publicUrlId: true } } },
      }), (row) => row.id, undefined, (row) => json({ factType: "entry", ...row }));
      // Reservations survive entry retirement and can precede an entry. Keep
      // their assigned IDs; a rebuild must never allocate replacement IDs.
      await scan("urls", (cursor: string | undefined) => transaction.publicUrlIdReservation.findMany({
        where: { ...where, id: { gt: cursor ?? "" } }, orderBy: { id: "asc" }, take: PAGE,
        select: { id: true, subjectType: true, subjectUid: true, publicUrlId: true },
      }), (row) => row.id, undefined, (row) => json({ factType: "reservation", ...row }));
      await scan("redirects", (cursor: string | undefined) => transaction.projectRedirect.findMany({
        where: { ...where, id: { gt: cursor ?? "" } }, orderBy: { id: "asc" }, take: PAGE,
        select: { id: true, urlEntryId: true, fromPath: true, toPath: true, code: true, reason: true, createdAt: true },
      }), (row) => row.id);
      await scan("tombstones", (cursor: string | undefined) => transaction.projectUrlTombstone.findMany({
        where: { ...where, id: { gt: cursor ?? "" } }, orderBy: { id: "asc" }, take: PAGE,
        select: { id: true, entityType: true, entityUid: true, canonicalPath: true, reason: true, createdAt: true,
          reservation: { select: { publicUrlId: true } } },
      }), (row) => row.id);
      const linked = new Set<string>();
      await scan("listing-links", (cursor: string | undefined) => transaction.listingDevelopmentLink.findMany({
        where: { ...where, id: { gt: cursor ?? "" }, status: "CONFIRMED" }, orderBy: { id: "asc" }, take: PAGE,
        select: { id: true, inventoryUid: true, developmentUid: true, status: true,
          sourceRevisionId: true, confirmedAt: true, version: true },
      }), (row) => row.id, (row) => {
        if (row.developmentUid) linked.add(row.developmentUid);
        if (linked.size > 5000) throw new Error("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
      });
      await scan("lifecycle", (cursor: string | undefined) => transaction.inventoryLifecycleEvent.findMany({
        where: { ...where, id: { gt: cursor ?? "" } }, orderBy: { id: "asc" }, take: PAGE,
        select: { id: true, inventoryUid: true, type: true, occurredAt: true },
      }), (row) => row.id);
      return { projectVersion: project.version, linkedDevelopmentUids: [...linked].sort() };
    },
  };
}
