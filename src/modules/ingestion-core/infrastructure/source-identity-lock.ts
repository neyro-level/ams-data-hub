import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

/** Shared by legacy identity commands and concrete Source apply. Acquire before
 * reading an identity used for mutation; no provider I/O occurs under this lock. */
export async function lockSourceIdentities(transaction: DatabaseTransaction, scope: {
  organizationId: string; projectId: string; sourceId: string;
}) {
  const key = JSON.stringify(["source-identities", scope.organizationId, scope.projectId, scope.sourceId]);
  await transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`);
}
