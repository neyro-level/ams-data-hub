import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { snapshotPublicationProjectAnchorsSchema, type SnapshotPublicationProjectAnchors } from "../application/snapshot-publication-project-anchors.ts";
import { createSnapshotPublicationProjectReader } from "./snapshot-publication-project-reader.ts";
import { snapshotRollbackAgentContactPinsSchema, type SnapshotRollbackAgentContactPins } from "../application/snapshot-rollback-agent-contacts.ts";

const PAGE = 200;
const denied = (): never => { throw new Error("SNAPSHOT_ROLLBACK_PROJECT_DENIED"); };

/** Caller holds global -> publication locks in RC. Cosmetic Agent version and
 * newer fact binding are allowed; consent epoch, photo assignment, contact and
 * assignment to the SAME person remain strict to avoid resurrecting withdrawn PII. */
export function createSnapshotRollbackProjectReader(tx: DatabaseTransaction) {
  return async (scope: { organizationId: string; projectId: string }, raw: SnapshotPublicationProjectAnchors,
    rawContacts: SnapshotRollbackAgentContactPins): Promise<void> => {
    const parsed = snapshotPublicationProjectAnchorsSchema.safeParse(raw);
    if (!parsed.success || parsed.data.projectId !== scope.projectId) throw new Error("SNAPSHOT_ROLLBACK_PROJECT_ANCHORS_INVALID");
    const access = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
      SELECT snapshot_publication_scope(${scope.organizationId}, ${scope.projectId}) AS allowed`);
    if (access.length !== 1 || !access[0]!.allowed) throw new Error("SNAPSHOT_ROLLBACK_PROJECT_ACCESS_DENIED");
    const pins = parsed.data; // Schema owns copies; never mutate caller's capture.
    const contacts = snapshotRollbackAgentContactPinsSchema.safeParse(rawContacts);
    const agentUids = new Set(pins.agents.map((row) => row.uid));
    if (!contacts.success || contacts.data.length !== pins.agents.length
      || contacts.data.some((row) => !agentUids.has(row.uid))) throw new Error("SNAPSHOT_ROLLBACK_CONTACT_PINS_INVALID");
    const byUid = new Map(contacts.data.map((row) => [row.uid, row]));
    for (let offset = 0; offset < pins.agents.length; offset += PAGE) {
      const page = pins.agents.slice(offset, offset + PAGE);
      const values = page.map((pin) => { const contact = byUid.get(pin.uid)!;
        return Prisma.sql`(${pin.uid}::text, ${contact.workPhoneHash}::text, ${contact.workEmailHash}::text, ${contact.messengersHash}::text)`; });
      const rows = await tx.$queryRaw<{ uid: string; version: number }[]>(Prisma.sql`
        WITH requested(uid, phone, email, messengers) AS (VALUES ${Prisma.join(values)})
        SELECT a.uid, a.version FROM "Agent" a JOIN requested q ON a.uid=q.uid
        WHERE a."organizationId"=${scope.organizationId} AND a."projectId"=${scope.projectId}
          AND encode(sha256(convert_to(COALESCE('string:' || a."workPhone", 'null:'), 'UTF8')), 'hex')=q.phone
          AND encode(sha256(convert_to(COALESCE('string:' || a."workEmail", 'null:'), 'UTF8')), 'hex')=q.email
          AND encode(sha256(convert_to('array:' || COALESCE((SELECT string_agg(octet_length(m.value)::text || ':' || m.value, '' ORDER BY m.ordinality)
            FROM jsonb_array_elements_text(a.messengers) WITH ORDINALITY AS m(value, ordinality)), ''), 'UTF8')), 'hex')=q.messengers
        LIMIT ${PAGE + 1}`);
      const found = new Map(rows.map((row) => [row.uid, row]));
      if (rows.length !== page.length || found.size !== rows.length) denied();
      for (const pin of page) { const row = found.get(pin.uid) ?? denied(); pin.version = row.version; }
    }
    for (let offset = 0; offset < pins.bindings.length; offset += PAGE) {
      const page = pins.bindings.slice(offset, offset + PAGE);
      const values = page.map((pin) => Prisma.sql`(${pin.inventoryUid}::text, ${pin.sourceId}::text, ${pin.agentUid}::text)`);
      const rows = await tx.$queryRaw<{ inventoryUid: string; sourceId: string; agentUid: string; sourceRevisionId: string; recordHash: string }[]>(Prisma.sql`
        WITH requested(uid, source, agent) AS (VALUES ${Prisma.join(values)})
        SELECT i.uid AS "inventoryUid", b."sourceId", b."sourceRevisionId", b."recordHash", b."agentUid"
        FROM requested q JOIN "InventoryIdentity" i ON i.uid=q.uid AND i."sourceId"=q.source AND i.status='ACTIVE'
          AND i."organizationId"=${scope.organizationId} AND i."projectId"=${scope.projectId}
        JOIN "Source" s ON s.id=i."sourceId" AND s."organizationId"=i."organizationId" AND s."projectId"=i."projectId"
        JOIN "SourceRevision" h ON h.id=s."lastGoodRevisionId" AND h.status='GOOD'
          AND h."organizationId"=i."organizationId" AND h."projectId"=i."projectId" AND h."sourceId"=i."sourceId"
        JOIN LATERAL (SELECT r."revisionId" FROM "SourceRevisionRecord" r JOIN "SourceRevision" v ON v.id=r."revisionId"
          WHERE r."organizationId"=i."organizationId" AND r."projectId"=i."projectId" AND r."sourceId"=i."sourceId"
            AND r."inventoryUid"=i.uid AND r."externalId"=i."externalOfferId" AND r."recordHash"=i."normalizedHash"
            AND v."organizationId"=i."organizationId" AND v."projectId"=i."projectId" AND v."sourceId"=i."sourceId"
            AND v.status='GOOD' AND v.sequence<=h.sequence ORDER BY v.sequence DESC LIMIT 1) fact ON true
        JOIN "ListingAgentBinding" b ON b."organizationId"=i."organizationId" AND b."projectId"=i."projectId"
          AND b."sourceId"=i."sourceId" AND b."inventoryUid"=i.uid AND b."recordHash"=i."normalizedHash"
          AND b."sourceRevisionId"=fact."revisionId" AND b."agentUid"=q.agent
        LIMIT ${PAGE + 1}`);
      const key = (row: { inventoryUid: string; sourceId: string; agentUid: string }) => JSON.stringify([row.inventoryUid, row.sourceId, row.agentUid]);
      const found = new Map(rows.map((row) => [key(row), row]));
      if (rows.length !== page.length || found.size !== rows.length) denied();
      for (const pin of page) {
        const row = found.get(key(pin)) ?? denied();
        pin.sourceRevisionId = row.sourceRevisionId; pin.recordHash = row.recordHash;
      }
    }
    await createSnapshotPublicationProjectReader(tx)(scope, pins);
  };
}
