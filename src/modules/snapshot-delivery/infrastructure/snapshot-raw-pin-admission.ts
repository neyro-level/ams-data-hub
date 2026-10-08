import "server-only";
import { z } from "zod";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createRawPinAdmissionReader } from "../../ingestion-core/server.ts";
import type { SnapshotInputPart } from "../application/snapshot-build-input.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const sourcePin = z.object({ entityType: z.literal("source"),
  approvedHead: z.object({ id }).passthrough().nullable() }).passthrough();
const inventoryPin = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u), factRevisionId: id.nullable(), approvedHeadId: id.nullable() }).passthrough();

/** Exact new pins are server-owned, not a request DTO. Outer RR holds global. */
export async function assertCapturedRawPinsAvailable(principal: PrincipalContext, parts: readonly SnapshotInputPart[]) {
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input") throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
  const revisions = new Set<string>(); const hashes = new Set<string>();
  for (const part of parts) for (const value of part.payload) {
    if (part.kind === "sources") {
      if (value && typeof value === "object" && !Array.isArray(value) && value.entityType === "profile") continue;
      const pin = sourcePin.parse(value); if (pin.approvedHead) revisions.add(pin.approvedHead.id);
    }
    if (part.kind === "inventory") {
      const pin = inventoryPin.parse(value);
      if (pin.status === "ACTIVE") {
        if (!pin.factRevisionId || !pin.approvedHeadId) throw new Error("SNAPSHOT_INPUT_INVENTORY_FACT_MISSING");
        revisions.add(pin.factRevisionId); revisions.add(pin.approvedHeadId); hashes.add(pin.sourceHash);
      }
    }
  }
  await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal), (tx) =>
    createRawPinAdmissionReader(tx).assertAvailable({ organizationId: principal.organizationId, projectId: principal.projectId },
      [...revisions], [...hashes]), { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}
