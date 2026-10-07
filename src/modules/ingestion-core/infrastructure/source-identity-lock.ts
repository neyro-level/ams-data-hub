import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

/** Shared by legacy identity commands and concrete Source apply. Acquire before
 * reading an identity used for mutation; no provider I/O occurs under this lock. */
export async function lockSourceIdentities(transaction: DatabaseTransaction, scope: {
  organizationId: string; projectId: string; sourceId: string;
}) {
  // Legacy identity commands share Source runtime's global-before-domain order.
  // A later fact-writer trigger must never wait for global while owning this key.
  await transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
  const key = JSON.stringify(["source-identities", scope.organizationId, scope.projectId, scope.sourceId]);
  await transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`);
}
