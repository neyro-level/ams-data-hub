import "server-only";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";
import { SNAPSHOT_INPUT_MAX_BYTES, SNAPSHOT_INPUT_MAX_PARTS, SNAPSHOT_INPUT_MAX_RECORDS } from "../application/snapshot-build-input.ts";
import { createRawRetentionSnapshotProvenanceValidator, type RawRetentionCapturedSourceHead, type RawRetentionCapturedInventoryPin } from "../../ingestion-core/server.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const scopeSchema = z.object({ organizationId: id, projectId: id }).strict();
const operationsSchema = scopeSchema.extend({ coverage: z.enum(["COMPLETE", "INCOMPLETE"]),
  buildInputIds: z.array(id).max(501), sourcePublishSequences: z.array(z.number().int().positive()).max(501),
  sourceRevisionIds: z.array(id).max(501) }).strict();
const ROOT_LIMIT = 128;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceFact = z.object({ entityType: z.literal("source"), sourceId: id,
  approvedHead: z.object({ id, status: z.literal("GOOD"), sequence: z.number().int().positive() }).passthrough().nullable() }).passthrough();
const inventoryFact = z.object({ sourceId: id, status: z.enum(["ACTIVE", "INACTIVE"]),
  uid: id, externalOfferId: z.string().min(1).max(240), normalizedHash: hash, sourceHash: hash,
  factRevisionId: id.nullable(), approvedHeadId: id.nullable(),
  factRevisionSequence: z.number().int().positive().nullable(), approvedHeadSequence: z.number().int().positive().nullable() }).passthrough();

/** Worker composition supplies the actual Operations-owned cut in this same
 * transaction, never a request DTO. Payloads are validated internally and only
 * revision/SHA pins escape. COMPLETE is snapshot-owned, not DELETE admission. */
export function createRawRetentionSnapshotReader(tx: DatabaseTransaction) {
  return {
    async read(rawScope: z.input<typeof scopeSchema>, rawOperations: z.input<typeof operationsSchema>) {
      const scope = scopeSchema.parse(rawScope); const operations = operationsSchema.parse(rawOperations);
      const access = await tx.$queryRaw<{ allowed: boolean; isolation: string }[]>(Prisma.sql`
        SELECT public.raw_artifact_retention_scope(${scope.organizationId},${scope.projectId}) AS allowed,
          current_setting('transaction_isolation') AS isolation`);
      if (access.length !== 1 || access[0]!.allowed !== true) throw new Error("RAW_RETENTION_ACCESS_DENIED");
      if (access[0]!.isolation !== "read committed") throw new Error("RAW_RETENTION_FRESH_CUT_REQUIRED");
      if (operations.organizationId !== scope.organizationId || operations.projectId !== scope.projectId) throw new Error("RAW_RETENTION_OPERATION_SCOPE_INVALID");
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
      const project = await tx.project.findFirst({ where: { organizationId: scope.organizationId, id: scope.projectId }, select: { id: true } });
      let complete = operations.coverage === "COMPLETE" && project !== null;
      const roots = new Set(operations.buildInputIds);
      const expectedHashes = new Map<string, string>();
      const pinnedRevisionIds = new Set(operations.sourceRevisionIds);
      const rawPins = new Map<string, { sourceId: string; rawArtifactHash: string }>();
      const [current, runs, reservations, unpublished] = await Promise.all([
        tx.projectCurrentSnapshotManifest.findUnique({ where: { organizationId_projectId: scope },
          select: { publishSequence: true, manifestSha256: true, manifestKey: true, publishedAt: true } }),
        tx.deliveryRun.findMany({ where: { ...scope, OR: [{ status: { in: ["PENDING", "NOTIFIED", "DOWNLOADED", "APPLIED"] } },
          { publishSequence: { in: operations.sourcePublishSequences } }] }, take: ROOT_LIMIT + 1, orderBy: { publishSequence: "asc" },
          select: { publishSequence: true, manifestSha256: true, manifestKey: true, publishedAt: true } }),
        tx.snapshotRollbackReservation.findMany({ where: scope, take: ROOT_LIMIT + 1, orderBy: { requestId: "asc" }, select: { rootBuildInputId: true, inputHash: true } }),
        tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT i.id FROM public."SnapshotBuildInput" i
          WHERE i."organizationId"=${scope.organizationId} AND i."projectId"=${scope.projectId}
            AND NOT EXISTS (SELECT 1 FROM public."SnapshotPublicationBinding" b
              JOIN public."DeliveryRun" d ON d."organizationId"=b."organizationId" AND d."projectId"=b."projectId"
                AND d."publishSequence"=b."publishSequence" AND d."manifestSha256"=b."manifestSha256"
              WHERE b."organizationId"=i."organizationId" AND b."projectId"=i."projectId" AND b."buildInputId"=i.id)
          ORDER BY i.id LIMIT ${ROOT_LIMIT + 1}`),
      ]);
      if (runs.length > ROOT_LIMIT || reservations.length > ROOT_LIMIT || unpublished.length > ROOT_LIMIT) complete = false;
      for (const row of reservations) {
        roots.add(row.rootBuildInputId);
        if (expectedHashes.has(row.rootBuildInputId) && expectedHashes.get(row.rootBuildInputId) !== row.inputHash) complete = false;
        expectedHashes.set(row.rootBuildInputId, row.inputHash);
      }
      for (const row of unpublished) roots.add(row.id);
      for (const sequence of operations.sourcePublishSequences) if (!runs.some((row) => row.publishSequence === sequence)) complete = false;
      for (const run of [...runs, ...(current ? [current] : [])]) {
        // Current identity must still match its immutable DeliveryRun.
        const stored = await tx.deliveryRun.findUnique({ where: { organizationId_projectId_publishSequence: { ...scope, publishSequence: run.publishSequence } },
          select: { manifestSha256: true, manifestKey: true, publishedAt: true } });
        if (!stored || stored.manifestSha256 !== run.manifestSha256 || stored.manifestKey !== run.manifestKey
          || stored.publishedAt.getTime() !== run.publishedAt.getTime()) { complete = false; continue; }
        const [normal, rollback] = await Promise.all([
          tx.snapshotPublicationBinding.findUnique({ where: { organizationId_projectId_publishSequence: { ...scope, publishSequence: run.publishSequence } },
            select: { buildInputId: true, manifestSha256: true } }),
          tx.snapshotRollbackBinding.findUnique({ where: { organizationId_projectId_publishSequence: { ...scope, publishSequence: run.publishSequence } },
            select: { manifestSha256: true, reservation: { select: { rootBuildInputId: true } } } }),
        ]);
        if (normal && !rollback && normal.manifestSha256 === run.manifestSha256) roots.add(normal.buildInputId);
        else if (rollback && !normal && rollback.manifestSha256 === run.manifestSha256) roots.add(rollback.reservation.rootBuildInputId);
        else complete = false; // Legacy/unreconstructable or conflicting roots.
      }
      if (roots.size > ROOT_LIMIT) complete = false;
      const empty = () => ({ pinnedRevisionIds: [...pinnedRevisionIds].sort(), rawArtifactPins: [...rawPins.values()],
        snapshotCoverage: "INCOMPLETE" as const });
      if (!complete) return empty();
      const rootIds = [...roots];
      const budgets = await tx.snapshotBuildInputPart.aggregate({ where: { ...scope, buildInputId: { in: rootIds } },
        _sum: { payloadByteCount: true, payloadRecordCount: true }, _count: true });
      if (budgets._count > SNAPSHOT_INPUT_MAX_PARTS || (budgets._sum.payloadByteCount ?? 0) > SNAPSHOT_INPUT_MAX_BYTES
        || (budgets._sum.payloadRecordCount ?? 0) > SNAPSHOT_INPUT_MAX_RECORDS) return empty();
      const repository = new PrismaSnapshotInputRepository(tx);
      const capturedHeads: RawRetentionCapturedSourceHead[] = [];
      const capturedInventory: RawRetentionCapturedInventoryPin[] = [];
      for (const rootId of rootIds) {
        const header = await tx.snapshotBuildInput.findFirst({ where: { ...scope, id: rootId }, select: { idempotencyKeyHash: true, requestHash: true } });
        if (!header) return empty();
        // Integrity errors propagate: do not mask DB failures as empty coverage.
        const receipt = await repository.find(scope.organizationId, scope.projectId, header.idempotencyKeyHash, header.requestHash);
        if (!receipt || receipt.id !== rootId || ![0, 1].includes(receipt.schemaMinor)
          || (expectedHashes.has(rootId) && expectedHashes.get(rootId) !== receipt.inputHash)) return empty();
        const binding = await tx.snapshotPublicationBinding.findUnique({ where: { organizationId_projectId_buildInputId: { ...scope, buildInputId: rootId } },
          select: { inputHash: true, publishSequence: true } });
        if (binding && (binding.inputHash !== receipt.inputHash || binding.publishSequence !== receipt.publishSequence)) return empty();
        const sourceHeads = new Map<string, { id: string; sequence: number } | null>();
        const inventoryPins: RawRetentionCapturedInventoryPin[] = [];
        for (const part of receipt.parts) for (const raw of part.payload) {
          if (part.kind === "sources") {
            if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.entityType === "profile") continue;
            const fact = sourceFact.safeParse(raw); if (!fact.success) return empty();
            if (sourceHeads.has(fact.data.sourceId)) return empty();
            sourceHeads.set(fact.data.sourceId, fact.data.approvedHead);
            if (fact.data.approvedHead) {
              pinnedRevisionIds.add(fact.data.approvedHead.id);
              capturedHeads.push({ sourceId: fact.data.sourceId, revisionId: fact.data.approvedHead.id, sequence: fact.data.approvedHead.sequence });
            }
          }
          if (part.kind === "inventory") {
            const fact = inventoryFact.safeParse(raw); if (!fact.success) return empty();
            if (fact.data.status === "ACTIVE") {
              if (!fact.data.factRevisionId || !fact.data.approvedHeadId || !fact.data.factRevisionSequence || !fact.data.approvedHeadSequence) return empty();
              inventoryPins.push({ ...fact.data, factRevisionId: fact.data.factRevisionId, approvedHeadId: fact.data.approvedHeadId,
                factRevisionSequence: fact.data.factRevisionSequence, approvedHeadSequence: fact.data.approvedHeadSequence });
              pinnedRevisionIds.add(fact.data.factRevisionId); pinnedRevisionIds.add(fact.data.approvedHeadId);
              const pin = { sourceId: fact.data.sourceId, rawArtifactHash: fact.data.sourceHash };
              rawPins.set(JSON.stringify(pin), pin);
            }
          }
        }
        const seenInventory = new Set<string>();
        for (const pin of inventoryPins) {
          const head = sourceHeads.get(pin.sourceId);
          if (!head || head.id !== pin.approvedHeadId || head.sequence !== pin.approvedHeadSequence
            || pin.factRevisionSequence > head.sequence || seenInventory.has(pin.uid)) return empty();
          seenInventory.add(pin.uid); capturedInventory.push(pin);
        }
      }
      if (!await createRawRetentionSnapshotProvenanceValidator(tx).validate(scope, capturedHeads, capturedInventory)) return empty();
      return { pinnedRevisionIds: [...pinnedRevisionIds].sort(), rawArtifactPins: [...rawPins.values()], snapshotCoverage: "COMPLETE" as const };
    },
  };
}
