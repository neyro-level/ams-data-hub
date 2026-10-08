import "server-only";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { RawArtifactRetentionReference } from "../domain/raw-artifact-retention.ts";

const scopeSchema = z.object({ organizationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) }).strict();
const SOURCE_LIMIT = 500;
const REVISION_LIMIT = 5_000;
const INVENTORY_LIMIT = 50_000;

export interface RawArtifactRetentionSourceCut {
  readonly references: readonly RawArtifactRetentionReference[];
  readonly pinnedRevisionIds: readonly string[];
  readonly sourceCoverage: "COMPLETE" | "INCOMPLETE";
  readonly jobsFrozen: boolean;
  readonly now: Date;
}

/** Ingestion-owned, private metadata only. The caller owns a short transaction;
 * this reader takes global safety first and requires fresh ReadCommitted cuts.
 * COMPLETE covers Source references only, not snapshot/rollback pins. Combine
 * with the snapshot-owned cut before any retention journal/DELETE admission. */
export function createRawArtifactRetentionSourceReader(tx: DatabaseTransaction) {
  return {
    async read(rawScope: z.input<typeof scopeSchema>): Promise<RawArtifactRetentionSourceCut> {
      const scope = scopeSchema.parse(rawScope);
      const access = await tx.$queryRaw<{ allowed: boolean; isolation: string }[]>(Prisma.sql`
        SELECT public.raw_artifact_retention_scope(${scope.organizationId},${scope.projectId}) AS allowed,
          current_setting('transaction_isolation') AS isolation`);
      if (access.length !== 1 || access[0]!.allowed !== true) throw new Error("RAW_RETENTION_ACCESS_DENIED");
      if (access[0]!.isolation !== "read committed") throw new Error("RAW_RETENTION_FRESH_CUT_REQUIRED");
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations',0))::text`);
      const times = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp()::timestamptz(3) AS now`);
      if (times.length !== 1) throw new Error("RAW_RETENTION_CLOCK_INVALID");
      const project = await tx.project.findFirst({ where: { organizationId: scope.organizationId, id: scope.projectId }, select: { id: true } });
      const state = await tx.dataSafetyState.findUnique({ where: { id: "global" }, select: { jobsFrozen: true } });
      let complete = project !== null && state !== null;
      const sources = await tx.source.findMany({ where: scope, take: SOURCE_LIMIT + 1, orderBy: { id: "asc" },
        select: { id: true, lastGoodRevisionId: true } });
      const revisions = await tx.sourceRevision.findMany({ where: scope, take: REVISION_LIMIT + 1, orderBy: { id: "asc" },
        select: { id: true, sourceId: true, status: true, sequence: true, rawArtifactHash: true, rawStorageKey: true,
          rawByteCount: true, startedAt: true, completedAt: true } });
      const attempts = await tx.rawArtifactPutAttempt.findMany({ where: scope, take: REVISION_LIMIT + 1, orderBy: { revisionId: "asc" },
        select: { revisionId: true, sourceId: true, rawArtifactHash: true, storageKey: true, byteCount: true, status: true } });
      if (sources.length > SOURCE_LIMIT || revisions.length > REVISION_LIMIT || attempts.length > REVISION_LIMIT) complete = false;
      const byId = new Map(revisions.map((revision) => [revision.id, revision]));
      const pins = new Set<string>();
      const references = new Map<string, RawArtifactRetentionReference>();
      const knownSourceIds = new Set(sources.map((source) => source.id));
      for (const source of sources) if (source.lastGoodRevisionId) {
        const revision = byId.get(source.lastGoodRevisionId);
        if (!revision || revision.status !== "GOOD" || revision.sourceId !== source.id || !revision.sequence) complete = false;
        else pins.add(revision.id);
      }
      for (const revision of revisions) {
        if (!knownSourceIds.has(revision.sourceId)) complete = false;
        if (revision.rawArtifactHash === null && revision.rawStorageKey === null && revision.rawByteCount === null) continue;
        if (!revision.rawArtifactHash || revision.rawStorageKey !== `source-artifacts/${revision.rawArtifactHash}`
          || revision.rawByteCount === null || revision.rawByteCount < 0 || revision.rawByteCount > 268_435_456) { complete = false; continue; }
        references.set(revision.id, { ...scope, sourceId: revision.sourceId, revisionId: revision.id,
          rawArtifactHash: revision.rawArtifactHash, storageKey: revision.rawStorageKey, status: revision.status,
          sequence: revision.sequence, startedAt: revision.startedAt, completedAt: revision.completedAt });
      }
      for (const attempt of attempts) {
        const revision = byId.get(attempt.revisionId);
        if (!revision || revision.sourceId !== attempt.sourceId) { complete = false; continue; }
        if (attempt.status === "PENDING") {
          if (references.has(attempt.revisionId) || attempt.storageKey !== `source-artifacts/${attempt.rawArtifactHash}`) { complete = false; continue; }
          // Unknown/unfinished IO is always unsettled, even if the Source
          // attempt failed and a newer revision subsequently became GOOD.
          references.set(attempt.revisionId, { ...scope, sourceId: attempt.sourceId, revisionId: attempt.revisionId,
            rawArtifactHash: attempt.rawArtifactHash, storageKey: attempt.storageKey, status: "PENDING",
            sequence: revision.sequence, startedAt: revision.startedAt, completedAt: revision.completedAt });
        } else if (attempt.status !== "STORED" || revision.rawArtifactHash !== attempt.rawArtifactHash
          || revision.rawStorageKey !== attempt.storageKey || revision.rawByteCount !== attempt.byteCount) complete = false;
      }
      const facts = await tx.$queryRaw<{ uid: string; factRevisionId: string | null; provenanceRevisionId: string | null }[]>(Prisma.sql`
        SELECT i.uid, fact."revisionId" AS "factRevisionId", provenance.id AS "provenanceRevisionId"
        FROM public."InventoryIdentity" i
        LEFT JOIN public."Source" s ON s.id=i."sourceId" AND s."organizationId"=i."organizationId" AND s."projectId"=i."projectId"
        LEFT JOIN public."SourceRevision" head ON head.id=s."lastGoodRevisionId" AND head.status='GOOD'
          AND head."organizationId"=i."organizationId" AND head."projectId"=i."projectId" AND head."sourceId"=i."sourceId"
        LEFT JOIN LATERAL (SELECT r."revisionId" FROM public."SourceRevisionRecord" r
          JOIN public."SourceRevision" v ON v.id=r."revisionId" AND v."organizationId"=r."organizationId"
            AND v."projectId"=r."projectId" AND v."sourceId"=r."sourceId"
          WHERE r."organizationId"=i."organizationId" AND r."projectId"=i."projectId" AND r."sourceId"=i."sourceId"
            AND r."inventoryUid"=i.uid AND r."externalId"=i."externalOfferId" AND r."recordHash"=i."normalizedHash"
            AND v.status='GOOD' AND v.sequence<=head.sequence ORDER BY v.sequence DESC LIMIT 1) fact ON true
        LEFT JOIN LATERAL (SELECT v.id FROM public."SourceRevision" v JOIN public."SourceRevisionRecord" r
          ON r."revisionId"=v.id AND r."organizationId"=v."organizationId" AND r."projectId"=v."projectId" AND r."sourceId"=v."sourceId"
          WHERE v."organizationId"=i."organizationId" AND v."projectId"=i."projectId" AND v."sourceId"=i."sourceId"
            AND v.status='GOOD' AND v.sequence<=head.sequence AND v."rawArtifactHash"=i."sourceHash"
            AND r."inventoryUid"=i.uid AND r."externalId"=i."externalOfferId" AND r."recordHash"=i."normalizedHash"
          ORDER BY v.sequence DESC LIMIT 1) provenance ON true
        WHERE i."organizationId"=${scope.organizationId} AND i."projectId"=${scope.projectId} AND i.status='ACTIVE'
        ORDER BY i.uid LIMIT ${INVENTORY_LIMIT + 1}`);
      if (facts.length > INVENTORY_LIMIT) complete = false;
      for (const fact of facts) {
        for (const pin of [fact.factRevisionId, fact.provenanceRevisionId]) {
          if (!pin || !references.has(pin) || byId.get(pin)?.status !== "GOOD") complete = false;
          else pins.add(pin);
        }
      }
      return { references: [...references.values()], pinnedRevisionIds: [...pins].sort(),
        sourceCoverage: complete ? "COMPLETE" : "INCOMPLETE", jobsFrozen: state?.jobsFrozen ?? true, now: times[0]!.now };
    },
  };
}
