import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { snapshotPublicationProjectAnchorsSchema, type SnapshotPublicationProjectAnchors } from "../application/snapshot-publication-project-anchors.ts";

const stale = () => { throw new Error("SNAPSHOT_PUBLICATION_PROJECT_STALE"); };
const PAGE = 200;
/** Plain metadata reads in caller's ReadCommitted cut under global -> publication locks. */
export function createSnapshotPublicationProjectReader(transaction: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationProjectAnchors): Promise<void> => {
    const parsed = snapshotPublicationProjectAnchorsSchema.safeParse(raw);
    if (!parsed.success || parsed.data.projectId !== scope.projectId) throw new Error("SNAPSHOT_PUBLICATION_PROJECT_ANCHORS_INVALID");
    const expected = parsed.data;
    const access = await transaction.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
      SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_PUBLICATION_PROJECT_ACCESS_DENIED");
    const safety = await transaction.dataSafetyState.findUnique({ where: { id: "global" }, select: { jobsFrozen: true } });
    if (!safety || safety.jobsFrozen) throw new Error("SNAPSHOT_PUBLICATION_JOBS_FROZEN");
    const project = await transaction.project.findFirst({ where: { organizationId: scope.organizationId, id: scope.projectId },
      select: { status: true, serviceState: true } });
    if (!project || project.status !== "ACTIVE" || project.serviceState !== "ACTIVE") throw new Error("SNAPSHOT_PUBLICATION_PROJECT_BLOCKED");
    if (expected.contactVersion !== null) {
      const contact = await transaction.projectPublicContact.findUnique({ where: { organizationId_projectId: scope }, select: { version: true } });
      if (!contact || contact.version !== expected.contactVersion) stale();
    }
    for (let offset = 0; offset < expected.agents.length; offset += PAGE) {
      const pins = expected.agents.slice(offset, offset + PAGE);
      const rows = await transaction.agent.findMany({ where: { ...scope, uid: { in: pins.map((row) => row.uid) } }, take: PAGE + 1,
        select: { uid: true, version: true, consentConfirmedAt: true, photoMediaId: true, feedPhotoMediaId: true, status: true, showOnSite: true } });
      const byUid = new Map(rows.map((row) => [row.uid, row]));
      if (rows.length !== pins.length || byUid.size !== rows.length) stale();
      for (const pin of pins) {
        const row = byUid.get(pin.uid);
        if (!row || row.status !== "ACTIVE" || !row.showOnSite || row.version !== pin.version
          || row.consentConfirmedAt?.getTime() !== new Date(pin.consentConfirmedAt).getTime()
          || row.photoMediaId !== pin.photoMediaId || row.feedPhotoMediaId !== pin.feedPhotoMediaId) stale();
      }
    }
    for (let offset = 0; offset < expected.bindings.length; offset += PAGE) {
      const pins = expected.bindings.slice(offset, offset + PAGE);
      const rows = await transaction.listingAgentBinding.findMany({ where: { ...scope, OR: pins }, take: PAGE + 1,
        select: { inventoryUid: true, sourceId: true, sourceRevisionId: true, recordHash: true, agentUid: true } });
      const key = (row: typeof pins[number]) => JSON.stringify([row.inventoryUid, row.sourceId, row.sourceRevisionId, row.recordHash, row.agentUid]);
      const found = new Set(rows.map(key));
      if (rows.length !== pins.length || found.size !== rows.length || pins.some((pin) => !found.has(key(pin)))) stale();
    }
  };
}
