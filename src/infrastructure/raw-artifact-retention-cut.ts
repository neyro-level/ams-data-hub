import "server-only";
import type { DatabaseTransaction } from "../platform/database/transaction.ts";
import { createRawArtifactRetentionSourceReader } from "../modules/ingestion-core/server.ts";
import { createRawRetentionOperationReader } from "../modules/operations-control/server.ts";
import { createRawRetentionSnapshotReader } from "../modules/snapshot-delivery/server.ts";

/** Production worker root composes owner readers in one fresh fenced cut.
 * Caller owns the short transaction and (for DELETE admission) an exclusive
 * project/SHA lifetime guardian. This function neither commits nor performs IO. */
export function createRawArtifactRetentionCutReader(tx: DatabaseTransaction) {
  return {
    async read(scope: { organizationId: string; projectId: string }) {
      const source = await createRawArtifactRetentionSourceReader(tx).read(scope);
      const operations = await createRawRetentionOperationReader(tx).read(scope);
      const snapshots = await createRawRetentionSnapshotReader(tx).read(scope, operations);
      let complete = source.sourceCoverage === "COMPLETE" && operations.coverage === "COMPLETE"
        && snapshots.snapshotCoverage === "COMPLETE";
      const pins = new Set([...source.pinnedRevisionIds, ...snapshots.pinnedRevisionIds]);
      const references = new Map(source.references.map((row) => [row.revisionId, row]));
      const goodByProvenance = new Map<string, string[]>();
      for (const row of source.references) if (row.status === "GOOD") {
        const key = `${row.sourceId}:${row.rawArtifactHash}`;
        const ids = goodByProvenance.get(key) ?? [];
        ids.push(row.revisionId); goodByProvenance.set(key, ids);
      }
      // A syntactically valid captured pin cannot silently disappear from the
      // bounded Source cut. Historical provenance may refer to an older GOOD.
      for (const pin of pins) if (!references.has(pin)) complete = false;
      for (const pin of snapshots.rawArtifactPins) {
        const matching = goodByProvenance.get(`${pin.sourceId}:${pin.rawArtifactHash}`) ?? [];
        if (!matching.length) complete = false;
        for (const revisionId of matching) pins.add(revisionId);
      }
      return { references: source.references, pinnedRevisionIds: [...pins].sort(),
        coverage: complete ? "COMPLETE" as const : "INCOMPLETE" as const,
        jobsFrozen: source.jobsFrozen, now: source.now };
    },
  };
}
