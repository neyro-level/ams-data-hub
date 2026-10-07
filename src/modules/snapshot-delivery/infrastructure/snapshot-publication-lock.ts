import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

/** Acquire before row/domain locks in a caller-owned ReadCommitted cut. */
export async function lockSnapshotPublication(transaction: DatabaseTransaction,
  scope: { organizationId: string; projectId: string }): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
  await transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(
    hashtextextended(${JSON.stringify(["snapshot-publication", scope.organizationId, scope.projectId])}, 0))::text`);
}
