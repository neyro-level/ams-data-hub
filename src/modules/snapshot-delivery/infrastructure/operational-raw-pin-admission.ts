import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";

/** Snapshot-owned boolean boundary; no private parts/journal rows escape. */
export async function assertOperationalRawPinAdmission(tx: DatabaseTransaction,
  scope: { organizationId: string; projectId: string }, target: { buildInputId: string | null; sourcePublishSequence: number | null }) {
  const rows = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`
    SELECT public.snapshot_operational_raw_pin_admission(${scope.organizationId},${scope.projectId},
      ${target.buildInputId},${target.sourcePublishSequence}::integer) AS allowed`);
  if (rows.length !== 1) throw new Error("RAW_PIN_ADMISSION_READ_INVALID");
  if (!rows[0]!.allowed) throw Object.assign(new Error("RAW_RETENTION_IN_PROGRESS"), { retryable: true });
}
